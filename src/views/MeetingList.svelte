<script lang="ts">
  import { weekdayText } from '../lib/format';
  // The coming meetings of the areas this phone shows (the hub cut them, MOB-02), by day, read with the list. A tap
  // opens one. `limit`: Today shows the first few and a way to all of them.
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate, TextKey } from '../lib/i18n';
  import type { MeetingBrief } from '../lib/types';

  let { app, t, limit }: { app: App; t: Translate; limit?: number } = $props();

  const shown = $derived(limit === undefined ? (app.meetings ?? []) : (app.meetings ?? []).slice(0, limit));
  const days = $derived.by(() => {
    const out: { day: string; items: MeetingBrief[] }[] = [];
    for (const m of shown) {
      const last = out[out.length - 1];
      if (last && last.day === m.date) last.items.push(m);
      else out.push({ day: m.date, items: [m] });
    }
    return out;
  });
  const dayName = (day: string) =>
    day === app.day ? t('meetings.today') : weekdayText(day);
</script>

{#if limit === undefined}
  <p><button onclick={() => (app.screen = 'today')}>← {t('nav.today')}</button></p>
{/if}
<section aria-labelledby="meetings-title" data-testid="meetings">
  <h2 id="meetings-title">{t('meetings.title')}</h2>
  {#if app.meetings === null}
    <p class="muted">{t('meetings.unread')}</p>
  {:else if app.meetings.length === 0}
    <p class="muted">{t('meetings.none')}</p>
  {:else}
    {#each days as group (group.day)}
      <h3 class="day">{dayName(group.day)}</h3>
      <ul>
        {#each group.items as m (m.id)}
          <li>
            <button class="row" data-meeting={m.id} onclick={() => void app.openMeeting(m)}>
              <span class="when">{m.time ?? '·'}</span>
              <span class="title untrusted">{#if m.icon}<span aria-hidden="true">{m.icon} </span>{/if}{markHidden(m.title)}</span>
              <span class="muted">{m.area}{#if m.location} · {markHidden(m.location)}{/if}{#if m.onlineService} · {m.onlineService}{/if}{#if m.status === 'cancelled'} · {t('meeting.cancelled' as TextKey)}{/if}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/each}
    {#if app.meetingsPartial}<p class="muted" role="status">{t('meetings.partial')}</p>{/if}
    {#if limit !== undefined && (app.meetings?.length ?? 0) > limit}
      <p><button onclick={() => (app.screen = 'meetings')}>{t('meetings.all')}</button></p>
    {/if}
  {/if}
</section>

<style>
  ul {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    display: grid;
    gap: 6px;
  }
  .day {
    font-size: 0.95rem;
    margin: 10px 0 4px;
  }
  .row {
    width: 100%;
    display: grid;
    grid-template-columns: 3.2rem 1fr;
    gap: 2px 8px;
    text-align: left;
    padding: 10px 12px;
  }
  .when {
    font-variant-numeric: tabular-nums;
    grid-row: span 2;
  }
  .title {
    font-weight: 600;
  }
</style>
