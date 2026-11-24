<script lang="ts">
  import { dayText } from '../lib/format';
  // One meeting: its time and place, Join when the hub let the address out (MOB-02), its agenda, its participants when
  // the hub gave them (a public area, or an internal one the PC released), its minutes and its follow-ups, and one
  // field for a line of the minutes: a note, a task, a decision or a question. A photo (the camera) or a voice note (the
  // microphone, asked for only on the button, AND-01) goes into the minutes as well: the file waits on the phone, goes
  // to the meeting, and its line follows. Each write goes through the queue; the minutes and the ticks show it once the
  // hub answered (MOB-07). All text is shown as text, hidden characters made visible (MSEC-05).
  import { onDestroy, tick } from 'svelte';
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import { MAX_FILE_BYTES, MAX_VOICE_MS, sizeText } from '../lib/attach';
  import type { Translate, TextKey } from '../lib/i18n';
  import { shrinkPhoto } from '../lib/photo';
  import { lineFor, setLine } from '../lib/typed.svelte';
  import { minuteShown } from '../lib/parse';
  import { clock, startRecording, type Recording } from '../lib/recorder';
  import { CAPTURE_KINDS, type CaptureKind } from '../lib/types';

  let { app, t }: { app: App; t: Translate } = $props();

  const meeting = $derived(app.meetingView?.meeting ?? app.openedMeeting);
  const canWrite = $derived(app.may('change'));
  // The line typed for the minutes outlives this screen (typed.svelte.ts); sent empty, it says so at the field.
  const line = {
    get value(): string {
      return lineFor(meeting?.id ?? '');
    },
    set value(text: string) {
      setLine(meeting?.id ?? '', text);
    },
  };
  let attempted = $state(false);
  let lineField: HTMLInputElement | undefined = $state();
  const lineMissing = $derived(attempted && line.value.trim() === '');
  let photoInput: HTMLInputElement | undefined = $state();
  let recording = $state<Recording | null>(null);
  let startedAt = $state(0);
  let elapsed = $state(0);
  let ticker: ReturnType<typeof setInterval> | null = null;
  let micProblem = $state<string | null>(null);

  async function add(kind: CaptureKind): Promise<void> {
    if (line.value.trim() === '') {
      attempted = true;
      await tick();
      lineField?.focus();
      return;
    }
    attempted = false;
    if (await app.captureLine(kind, line.value)) line.value = '';
  }

  function picked(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void shrinkPhoto(file).then((blob) => app.captureMedia({ blob, kind: 'photo' }));
  }

  async function startVoice(): Promise<void> {
    micProblem = null;
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
    // A quarter of a second: the clock shows whole seconds, and this keeps a late tick within a quarter of one.
    }, 250);
  }

  async function stopVoice(): Promise<void> {
    const rec = recording;
    if (!rec) return;
    recording = null;
    if (ticker !== null) clearInterval(ticker);
    ticker = null;
    const note = await rec.stop();
    if (note) await app.captureMedia({ blob: note, kind: 'voice' });
  }

  // A recording runs in the foreground only: the page going to the background ends it, and the note is sent.
  $effect(() => {
    const away = () => {
      if (document.visibilityState === 'hidden') void stopVoice();
    };
    document.addEventListener('visibilitychange', away);
    return () => document.removeEventListener('visibilitychange', away);
  });

  // Left while recording: the note is ended and sent into the minutes of this meeting (said, so it is no surprise).
  onDestroy(() => {
    if (!recording) return;
    app.notice = { key: 'meeting.media_kept', tone: 'info' };
    void stopVoice();
  });

  function shown(text: string): string {
    const m = minuteShown(text);
    if (m.kind === 'photo') return t('meeting.photo_line', { name: m.text });
    if (m.kind === 'audio') return t('meeting.audio_line', { name: m.text });
    return m.text;
  }
</script>

<p><button onclick={() => (app.screen = 'meetings')}>← {t('meetings.back')}</button></p>

{#if meeting}
  <h2 class="untrusted" data-testid="meeting-title">{#if meeting.icon}<span aria-hidden="true">{meeting.icon} </span>{/if}{markHidden(meeting.title)}</h2>
  <p class="muted">
    {dayText(meeting.date)}{#if meeting.time} · {meeting.time}{#if meeting.end}–{meeting.end}{/if}{/if}{#if meeting.location} · {markHidden(meeting.location)}{/if}
    {#if meeting.status === 'cancelled'} · {t('meeting.cancelled')}{/if}
  </p>
  {#if meeting.online}
    <p>
      <a class="join" href={meeting.online} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" data-testid="join"
        >{t('meeting.join')}{#if meeting.onlineService} · {meeting.onlineService}{/if}</a
      >
    </p>
  {/if}
  {#if app.meetingView === null}
    <p class="muted" role="status">{app.connection === 'live' ? t('paths.loading') : t('meetings.unread')}</p>
  {:else}
    {#if app.meetingView.agenda.length > 0}
      <h3>{t('meeting.agenda')}</h3>
      <ul class="plain">
        {#each app.meetingView.agenda as a (a.n)}<li class="untrusted">{a.ticked ? '✓' : '○'} {markHidden(a.text)}</li>{/each}
      </ul>
    {/if}
    {#if app.meetingView.participants.length > 0}
      <h3>{t('meeting.people')}</h3>
      <ul class="plain" data-testid="participants">
        {#each app.meetingView.participants as p (p.n)}
          <li class="untrusted">
            {#if canWrite && meeting.status !== 'cancelled'}
              <label class="person">
                <input
                  type="checkbox"
                  checked={p.present}
                  disabled={app.busy}
                  aria-label={t('meeting.present', { name: p.name })}
                  onchange={(e) => {
                    const box = e.currentTarget as HTMLInputElement;
                    const want = box.checked;
                    // The tick shows what the hub said, not what was clicked (MOB-07): it follows the next read.
                    box.checked = p.present;
                    void app.attend(p.name, want);
                  }}
                  data-person={p.name}
                />
                <span>{markHidden(p.name)}</span>
              </label>
            {:else}
              {p.present ? '✓' : '○'} {markHidden(p.name)}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <h3>{t('meeting.minutes')}</h3>
    {#if app.meetingView.minutes.length === 0}
      <p class="muted">{t('meeting.minutes_none')}</p>
    {:else}
      <ul class="plain" data-testid="minutes">
        {#each app.meetingView.minutes as m, i (`${m.at}:${i}`)}<li class="untrusted"><span class="at">{m.at}</span> {markHidden(shown(m.text))}</li>{/each}
      </ul>
    {/if}
    {#if canWrite && meeting.status !== 'cancelled'}
      <form class="capture" onsubmit={(e) => { e.preventDefault(); void add('text'); }}>
        <label>
          <span>{t('meeting.line')}</span>
          <input bind:this={lineField} bind:value={line.value} maxlength="2000" data-testid="minutes-line" aria-invalid={lineMissing ? 'true' : undefined} aria-describedby={lineMissing ? 'minutes-line-error' : undefined} />
        </label>
        {#if lineMissing}<p class="bad" id="minutes-line-error">{t('form.missing')}</p>{/if}
        <div class="actions">
          {#each CAPTURE_KINDS as kind (kind)}
            <button type="button" class:primary={kind === 'text'} disabled={app.busy} onclick={() => void add(kind)}
              >{t(`meeting.kind.${kind}` as TextKey)}</button
            >
          {/each}
        </div>
      </form>
      <div class="actions media" role="group" aria-label={t('meeting.media')}>
        <input
          bind:this={photoInput}
          class="hidden-input"
          type="file"
          accept="image/*"
          capture="environment"
          tabindex="-1"
          aria-hidden="true"
          onchange={picked}
          data-testid="meeting-photo-input"
        />
        <button type="button" onclick={() => photoInput?.click()} disabled={app.busy || recording !== null} data-testid="meeting-photo"
          >{t('capture.photo')}</button
        >
        {#if recording}
          <button type="button" class="recording num" onclick={() => void stopVoice()} data-testid="meeting-voice-stop">
            ● {t('capture.voice_stop', { time: clock(elapsed) })}
          </button>
        {:else}
          <button type="button" onclick={() => void startVoice()} disabled={app.busy} data-testid="meeting-voice">{t('capture.voice')}</button>
        {/if}
      </div>
      <p class="muted note">{t('capture.files_limit', { n: 1, size: sizeText(MAX_FILE_BYTES) })}</p>
      {#if micProblem}
        <p class="bad" role="alert" data-testid="mic-problem">{t('capture.mic_failed', { message: micProblem })}</p>
      {/if}
      {#if app.fileProblem}
        <p class="bad" role="alert" data-testid="file-problem">
          {t(`capture.file_problem.${app.fileProblem}` as TextKey, { n: 1, size: sizeText(MAX_FILE_BYTES) })}
        </p>
      {/if}
    {:else if !canWrite}
      <p class="muted">{t('rights.change_none', { level: app.level ?? '' })}</p>
    {/if}
    {#if app.meetingView.followups.length > 0}
      <h3>{t('meeting.followups')}</h3>
      <ul class="plain">
        {#each app.meetingView.followups as f (f.n)}<li class="untrusted">{f.ticked ? '✓' : '○'} {markHidden(f.text)}{#if f.task} → <span translate="no">{f.task}</span>{/if}</li>{/each}
      </ul>
    {/if}
  {/if}
{/if}

<style>
  .plain {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 4px;
  }
  .at {
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
  .join {
    display: inline-block;
    padding: 10px 16px;
    border-radius: 10px;
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    color: inherit;
    text-decoration: none;
    font-weight: 600;
  }
  .capture {
    display: grid;
    gap: 6px;
    margin-top: 8px;
  }
  .capture label {
    display: grid;
    gap: 4px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .media {
    margin-top: 8px;
  }
  .person {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
  }
  .person input {
    width: 22px;
    height: 22px;
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
</style>
