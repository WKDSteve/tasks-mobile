<script lang="ts">
  // Capturing a task, with a photo or a voice note if wanted. The files are shown before the task is made, wait on
  // the phone with it, and are sent once the engine made it (`lib/queue.ts`). The microphone is asked for only when
  // the button is pressed (AND-01), and a recording stops when the page goes to the background.
  //
  // What is typed and chosen lives in `app.form`, not here: another view (Today, the list, Waiting) takes nothing away.
  // A recording still running when the form is left is ended there and kept in the form as a voice note.
  import { onDestroy } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { MAX_FILE_BYTES, MAX_FILES, MAX_VOICE_MS, sizeText, type AttachmentKind } from '../lib/attach';
  import { formHolds } from '../lib/capture';
  import type { Translate, TextKey } from '../lib/i18n';
  import { clock, startRecording, type Recording } from '../lib/recorder';

  let { app, t }: { app: App; t: Translate } = $props();
  // The problems of an earlier try belong to that form: a form opened anew starts without them (once, on mounting).
  // svelte-ignore state_referenced_locally
  app.problems = [];

  const form = $derived(app.form);
  let photoInput: HTMLInputElement | undefined = $state();
  let recording = $state<Recording | null>(null);
  let startedAt = $state(0);
  let elapsed = $state(0);
  let ticker: ReturnType<typeof setInterval> | null = null;
  let micProblem = $state<string | null>(null);

  $effect(() => {
    // The first area that may be written to, until the user picks one (or when the picked one is gone).
    if (!app.areas.includes(form.area) && app.areas.length > 0) form.area = app.areas[0] ?? '';
  });

  function add(blob: Blob, kind: AttachmentKind): void {
    // The form of the app, not of this component: a note that ends after the form was left still lands in it.
    const target = app.form;
    if (app.checkFile({ blob, kind }, target.files.length) !== null) return;
    const id = target.files.reduce((max, f) => Math.max(max, f.id), 0) + 1;
    target.files = [...target.files, { id, blob, kind, url: URL.createObjectURL(blob) }];
    void app.keepForm();
  }

  function remove(id: number): void {
    const gone = form.files.find((f) => f.id === id);
    if (gone) URL.revokeObjectURL(gone.url);
    form.files = form.files.filter((f) => f.id !== id);
    app.fileProblem = null;
    void app.keepForm();
  }

  // What is typed is kept a moment after the last key (the app may be ended in the background at any time).
  let keepTimer: ReturnType<typeof setTimeout> | null = null;
  function typed(): void {
    if (keepTimer !== null) clearTimeout(keepTimer);
    keepTimer = setTimeout(() => {
      keepTimer = null;
      void app.keepForm();
    }, 400);
  }

  function picked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    for (const file of input.files ?? []) add(file, 'photo');
    input.value = '';
  }

  async function startVoice(): Promise<void> {
    micProblem = null;
    if (form.files.length >= MAX_FILES) {
      app.checkFile({ blob: new Blob(['x'], { type: 'audio/webm' }), kind: 'voice' }, form.files.length);
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

  // Left while recording: the note is ended and kept in the form (said, so it is not a surprise later).
  onDestroy(() => {
    if (keepTimer !== null) {
      clearTimeout(keepTimer);
      void app.keepForm();
    }
    if (!recording) return;
    app.notice = { key: 'capture.voice_kept', tone: 'info' };
    void stopVoice();
  });

  function discard(): void {
    const rec = recording;
    recording = null;
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
    // A note being recorded is let go with the rest: the microphone is released, the note is not kept.
    if (rec) void rec.stop();
    micProblem = null;
    app.problems = [];
    app.discardForm();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (recording) await stopVoice();
    const ok = await app.capture(
      { area: form.area, title: form.title, context: form.context },
      form.files.map((f) => ({ blob: f.blob, kind: f.kind })),
    );
    if (ok) {
      const area = form.area;
      app.discardForm();
      // The next task most likely goes to the same area.
      app.form.area = area;
    }
  }
</script>

{#if app.fromFile}
  <p class="muted" data-testid="file-read-only">{t('file.read_only')}</p>
{/if}
<form onsubmit={submit} oninput={typed} novalidate>
  {#if form.fromShare}
    <p class="muted" data-testid="from-share">{t('capture.shared')}</p>
  {/if}
  {#if app.areas.length === 0}
    <p class="bad">{t('capture.no_area')}</p>
  {/if}
  <label for="cap-title">{t('capture.title')}</label>
  <input id="cap-title" type="text" maxlength="400" enterkeyhint="next" bind:value={form.title} aria-invalid={app.problems.some((p) => p.startsWith('title')) || undefined} />

  <label for="cap-area">{t('capture.area')}</label>
  <select id="cap-area" bind:value={form.area}>
    {#each app.areas as a (a)}
      <option value={a}>{a}</option>
    {/each}
  </select>

  <label for="cap-context">{t('capture.context')}</label>
  <textarea id="cap-context" maxlength="4000" bind:value={form.context}></textarea>

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
    <button type="button" onclick={() => photoInput?.click()} disabled={form.files.length >= MAX_FILES || recording !== null}>{t('capture.photo')}</button>
    {#if recording}
      <button type="button" class="recording" onclick={() => void stopVoice()} data-testid="voice-stop">
        ● {t('capture.voice_stop', { time: clock(elapsed) })}
      </button>
    {:else}
      <button type="button" onclick={() => void startVoice()} disabled={form.files.length >= MAX_FILES} data-testid="voice-start">{t('capture.voice')}</button>
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

  {#if form.files.length > 0}
    <ul class="files" data-testid="attachments">
      {#each form.files as file (file.id)}
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

  <p class="actions">
    <button class="primary" type="submit" disabled={app.busy || app.areas.length === 0}>{t('capture.save')}</button>
    {#if formHolds(form) || recording}
      <button type="button" onclick={discard} data-testid="capture-discard">{t('capture.discard')}</button>
    {/if}
  </p>
</form>

<style>
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
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
