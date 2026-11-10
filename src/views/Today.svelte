<script lang="ts">
  // The start view: what the engine would take next, the tasks that wait for an answer, the tasks whose day has
  // come, and the engine's counts per status over the shown areas (`lib/today.ts`). Offline it shows the kept copy
  // and says how old it is.
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate, TextKey } from '../lib/i18n';
  import { todayOf } from '../lib/today';
  import type { TaskBrief } from '../lib/types';

  let { app, t }: { app: App; t: Translate } = $props();

  const today = $derived(todayOf(app.view, app.day));
  const at = $derived(app.viewAt ? new Date(app.viewAt).toLocaleString() : null);

  /** A pick of the engine opens like a task of the list: the brief of the list when it is there. */
  function open(id: string, fallback: TaskBrief | null): void {
    const brief = app.view?.tasks.find((x) => x.id === id) ?? fallback;
    if (brief) void app.openTask(brief);
  }

  function pickBrief(p: { id: string; area: string; title: string; status: TaskBrief['status']; prio: number | null }): TaskBrief {
    return { ...p, due: null, remind: null, openQuestions: 0, etag: null };
  }
</script>

{#if app.connection === 'offline' && at}
  <p class="muted" data-testid="today-as-of">{t('today.as_of', { at })}</p>
{/if}

<section aria-labelledby="today-next">
  <h2 id="today-next">{t('today.next')}</h2>
  {#if today.next.length === 0}
    <p class="muted">{t('today.next_none')}</p>
  {:else}
    <ul data-testid="today-next">
      {#each today.next as pick (pick.id)}
        <li>
          <button class="row" data-id={pick.id} onclick={() => open(pick.id, pickBrief(pick))}>
            <span class="title untrusted">{markHidden(pick.title)}</span>
            <span class="meta muted">
              {pick.area}{#if pick.status} · {t(`status.${pick.status}` as TextKey)}{/if}{#if pick.prio !== null} · P{pick.prio}{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section aria-labelledby="today-questions">
  <h2 id="today-questions">{t('today.questions')}</h2>
  {#if today.questions.length === 0}
    <p class="muted">{t('today.questions_none')}</p>
  {:else}
    <ul data-testid="today-questions">
      {#each today.questions as task (task.id)}
        <li>
          <button class="row" data-id={task.id} onclick={() => void app.openTask(task)}>
            <span class="title untrusted">{markHidden(task.title)}</span>
            <span class="meta muted">{task.area} · {t('list.questions', { n: task.openQuestions })}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section aria-labelledby="today-due">
  <h2 id="today-due">{t('today.due')}</h2>
  {#if today.due.length === 0}
    <p class="muted">{t('today.due_none')}</p>
  {:else}
    <ul data-testid="today-due">
      {#each today.due as item (item.task.id)}
        <li>
          <button class="row" data-id={item.task.id} onclick={() => void app.openTask(item.task)}>
            <span class="title untrusted">{markHidden(item.task.title)}</span>
            <span class="meta muted">
              {item.task.area} · {t(item.why === 'due' ? 'today.due_day' : 'today.remind_day', { day: item.day })}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section aria-labelledby="today-counts">
  <h2 id="today-counts">{t('today.counts')}</h2>
  {#if today.counts.length === 0}
    <p class="muted">{t('today.counts_none')}</p>
  {:else}
    <dl data-testid="today-counts">
      {#each today.counts as row (row.status)}
        <div data-status={row.status}>
          <dt>{t(`status.${row.status}` as TextKey)}</dt>
          <dd>{row.n}</dd>
        </div>
      {/each}
    </dl>
  {/if}
  {#if app.view && app.view.hiddenAreas > 0}
    <p class="muted note" data-testid="today-counts-part">{t('today.counts_part', { n: app.view.hiddenAreas })}</p>
  {/if}
</section>

<style>
  section {
    margin-bottom: 18px;
  }
  h2 {
    font-size: 1rem;
    margin: 0 0 8px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .row {
    width: 100%;
    text-align: left;
    display: grid;
    gap: 2px;
  }
  .title {
    font-weight: 600;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    font-size: 0.88rem;
  }
  dl {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
    margin: 0;
  }
  dl > div {
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  dt {
    font-size: 0.85rem;
  }
  dd {
    margin: 0;
    font-size: 1.3rem;
    font-weight: 600;
  }
  .note {
    font-size: 0.9rem;
    margin-top: 8px;
  }
</style>
