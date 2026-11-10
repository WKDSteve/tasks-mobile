<script lang="ts">
  // Capturing a task, with a photo or a voice note if wanted. The files are shown before the task is made, wait on
  // the phone with it, and are sent once the engine made it (`lib/queue.ts`). The microphone is asked for only when
  // the button is pressed (AND-01), and a recording stops when the page goes to the background.
  import { onDestroy } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { MAX_FILE_BYTES, MAX_FILES, MAX_VOICE_MS, sizeText, type AttachmentKind } from '../lib/attach';
  import type { Translate, TextKey } from '../lib/i18n';
  import { clock, startRecording, type Recording } from '../lib/recorder';
  import type { Shared } from '../lib/share';

  let { app, t, shared }: { app: App; t: Translate; shared: Shared | null } = $props();
  // The problems of an earlier try belong to that form: a form opened anew starts without them (once, on mounting).
  // svelte-ignore state_referenced_locally
  app.problems = [];

  // svelte-ignore state_referenced_locally
  let title = $state(shared?.title ?? '');
  // svelte-ignore state_referenced_locally
  let context = $state(shared?.context ?? '');
  // svelte-ignore state_referenced_locally
  let fromShare = $state(shared !== null);
  let area = $state('');

  interface Picked {
    id: number;
    blob: Blob;
    kind: AttachmentKind;
    /** A `blob:` address of this page for the preview; given back when the file leaves the form. */
    url: string;
  }
  let files = $state<Picked[]>([]);
  let nextId = 0;
  let photoInput: HTMLInputElement | undefined = $state();
  let recording = $state<Recording | null>(null);
  let startedAt = $state(0);
  let elapsed = $state(0);
  let ticker: ReturnType<typeof setInterval> | null = null;
  let micProblem = $state<string | null>(null);

  $effect(() => {
    // The first area that may be written to, until the user picks one.
    if (area === '' && app.areas.length > 0) area = app.areas[0] ?? '';
  });

  function add(blob: Blob, kind: AttachmentKind): void {
    if (app.checkFile({ blob, kind }, files.length) !== null) return;
    files = [...files, { id: (nextId += 1), blob, kind, url: URL.createObjectURL(blob) }];
  }

  function remove(id: number): void {
    const gone = files.find((f) => f.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    files = files.filter((f) => f.id !== id);
    app.fileProblem = null;
  }

  function picked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    for (const file of input.files ?? []) add(file, 'photo');
    input.value = '';
  }

  async function startVoice(): Promise<void> {
    micProblem = null;
    if (files.length >= MAX_FILES) {
      app.checkFile({ blob: new Blob(['x'], { type: 'audio/webm' }), kind: 'voice' }, files.length);
      return;
    }
    try {
      recording = await startRecording({
        getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
        Recorder: MediaRecorder,
      });
    } catch (error) {
      micProblem = error instanceof Error ? error.message : String(error);
      return;
    }
    startedAt = Date.now();
    elapsed = 0;
    ticker = setInterval(() => {
      elapsed = Date.now() - startedAt;
      if (elapsed >= MAX_VOICE_MS) void stopVoice();
    }, 250);
  }

  async function stopVoice(): Promise<void> {
    const rec = recording;
    if (!rec) return;
    recording = null;
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
    const note = await rec.stop();
    if (note) add(note, 'voice');
  }

  // A recording runs in the foreground only.
  $effect(() => {
    const away = () => {
      if (document.visibilityState === 'hidden') void stopVoice();
    };
    document.addEventListener('visibilitychange', away);
    return () => document.removeEventListener('visibilitychange', away);
  });

  onDestroy(() => {
    void stopVoice();
    for (const f of files) URL.revokeObjectURL(f.url);
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (recording) await stopVoice();
    const ok = await app.capture({ area, title, context }, files.map((f) => ({ blob: f.blob, kind: f.kind })));
    if (ok) {
      title = '';
      context = '';
      fromShare = false;
      for (const f of files) URL.revokeObjectURL(f.url);
      files = [];
    }
  }
</script>

<form onsubmit={submit} novalidate>
  {#if fromShare}
    <p class="muted" data-testid="from-share">{t('capture.shared')}</p>
  {/if}
  {#if app.areas.length === 0}
    <p class="bad">{t('capture.no_area')}</p>
  {/if}
  <label for="cap-title">{t('capture.title')}</label>
  <input id="cap-title" type="text" maxlength="400" enterkeyhint="next" bind:value={title} aria-invalid={app.problems.some((p) => p.startsWith('title')) || undefined} />

  <label for="cap-area">{t('capture.area')}</label>
  <select id="cap-area" bind:value={area}>
    {#each app.areas as a (a)}
      <option value={a}>{a}</option>
    {/each}
  </select>

  <label for="cap-context">{t('capture.context')}</label>
  <textarea id="cap-context" maxlength="4000" bind:value={context}></textarea>

  <div class="attach">
    <input
      bind:this={photoInput}
      id="cap-photo"
      class="hidden-input"
      type="file"
      accept="image/*"
      tabindex="-1"
      aria-hidden="true"
      onchange={picked}
      data-testid="photo-input"
    />
    <button type="button" onclick={() => photoInput?.click()} disabled={files.length >= MAX_FILES || recording !== null}>{t('capture.photo')}</button>
    {#if recording}
      <button type="button" class="recording" onclick={() => void stopVoice()} data-testid="voice-stop">
        ● {t('capture.voice_stop', { time: clock(elapsed) })}
      </button>
    {:else}
      <button type="button" onclick={() => void startVoice()} disabled={files.length >= MAX_FILES} data-testid="voice-start">{t('capture.voice')}</button>
    {/if}
  </div>
  <p class="muted note">{t('capture.files_limit', { n: MAX_FILES, size: sizeText(MAX_FILE_BYTES) })}</p>

  {#if micProblem}
    <p class="bad" role="alert" data-testid="mic-problem">{t('capture.mic_failed', { message: micProblem })}</p>
  {/if}
  {#if app.fileProblem}
    <p class="bad" role="alert" data-testid="file-problem">
      {t(`capture.file_problem.${app.fileProblem}` as TextKey, { n: MAX_FILES, size: sizeText(MAX_FILE_BYTES) })}
    </p>
  {/if}

  {#if files.length > 0}
    <ul class="files" data-testid="attachments">
      {#each files as file (file.id)}
        <li data-kind={file.kind}>
          {#if file.kind === 'photo'}
            <img src={file.url} alt={t('capture.file_photo', { size: sizeText(file.blob.size) })} />
          {:else}
            <audio controls src={file.url}></audio>
          {/if}
          <span class="muted">{t(file.kind === 'photo' ? 'capture.file_photo' : 'capture.file_voice', { size: sizeText(file.blob.size) })}</span>
          <button type="button" onclick={() => remove(file.id)} aria-label={t('capture.file_remove')}>✕</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if app.problems.length > 0}
    <ul class="bad" role="alert" data-testid="problems">
      {#each app.problems as problem (problem)}
        <li>{t(`capture.problem.${problem}` as TextKey)}</li>
      {/each}
    </ul>
  {/if}

  <p><button class="primary" type="submit" disabled={app.busy || app.areas.length === 0}>{t('capture.save')}</button></p>
</form>

<style>
  .attach {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .hidden-input {
    display: none;
  }
  .recording {
    border-color: var(--bad);
    color: var(--bad);
  }
  .note {
    font-size: 0.88rem;
    margin: 6px 0;
  }
  .files {
    list-style: none;
    padding: 0;
    margin: 8px 0;
    display: grid;
    gap: 8px;
  }
  .files li {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 8px;
    padding: 6px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
  }
  .files img {
    width: 64px;
    height: 64px;
    object-fit: cover;
    border-radius: 6px;
  }
  .files audio {
    max-width: 160px;
  }
</style>
