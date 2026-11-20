<script lang="ts">
  // One meeting: its time and place, Join when the hub let the address out (MOB-02), its agenda, its minutes and its
  // follow-ups, and one field for a line of the minutes: a note, a task, a decision or a question. Each line is one
  // `meeting_capture` through the queue (the engine appends it, so it needs no version); the minutes show it once the
  // hub answered (MOB-07). All text is shown as text, hidden characters made visible (MSEC-05).
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate, TextKey } from '../lib/i18n';
  import { CAPTURE_KINDS, type CaptureKind } from '../lib/types';

  let { app, t }: { app: App; t: Translate } = $props();

  const meeting = $derived(app.meetingView?.meeting ?? app.openedMeeting);
  const canWrite = $derived(app.may('change'));
  let line = $state('');

  async function add(kind: CaptureKind): Promise<void> {
    if (await app.captureLine(kind, line)) line = '';
  }
</script>

<p><button onclick={() => (app.screen = 'meetings')}>← {t('meetings.back')}</button></p>

{#if meeting}
  <h2 class="untrusted" data-testid="meeting-title">{#if meeting.icon}<span aria-hidden="true">{meeting.icon} </span>{/if}{markHidden(meeting.title)}</h2>
  <p class="muted">
    {meeting.date}{#if meeting.time} · {meeting.time}{#if meeting.end}–{meeting.end}{/if}{/if}{#if meeting.location} · {markHidden(meeting.location)}{/if}
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
    <h3>{t('meeting.minutes')}</h3>
    {#if app.meetingView.minutes.length === 0}
      <p class="muted">{t('meeting.minutes_none')}</p>
    {:else}
      <ul class="plain" data-testid="minutes">
        {#each app.meetingView.minutes as m, i (`${m.at}:${i}`)}<li class="untrusted"><span class="at">{m.at}</span> {markHidden(m.text)}</li>{/each}
      </ul>
    {/if}
    {#if canWrite && meeting.status !== 'cancelled'}
      <form class="capture" onsubmit={(e) => { e.preventDefault(); void add('text'); }}>
        <label>
          <span>{t('meeting.line')}</span>
          <input bind:value={line} maxlength="2000" data-testid="minutes-line" />
        </label>
        <div class="actions">
          {#each CAPTURE_KINDS as kind (kind)}
            <button type="button" class:primary={kind === 'text'} disabled={app.busy || line.trim() === ''} onclick={() => void add(kind)}
              >{t(`meeting.kind.${kind}` as TextKey)}</button
            >
          {/each}
        </div>
      </form>
    {:else if !canWrite}
      <p class="muted">{t('rights.change_none', { level: app.level ?? '' })}</p>
    {/if}
    {#if app.meetingView.followups.length > 0}
      <h3>{t('meeting.followups')}</h3>
      <ul class="plain">
        {#each app.meetingView.followups as f (f.n)}<li class="untrusted">{f.ticked ? '✓' : '○'} {markHidden(f.text)}{#if f.task} → {f.task}{/if}</li>{/each}
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
</style>
