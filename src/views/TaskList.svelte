<script lang="ts">
  // The open tasks of the shown areas, in the order the engine sent them; filtered by area and words here (a filter
  // of what is shown, no rule of the tasks).
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate, TextKey } from '../lib/i18n';

  let { app, t }: { app: App; t: Translate } = $props();
  let area = $state('');
  let words = $state('');

  const tasks = $derived.by(() => {
    const all = app.view?.tasks ?? [];
    const query = words.trim().toLowerCase();
    return all.filter((task) => (area === '' || task.area === area) && (query === '' || task.title.toLowerCase().includes(query)));
  });
</script>

<div class="filters">
  <label for="list-area" class="visually-hidden">{t('list.filter')}</label>
  <select id="list-area" bind:value={area}>
    <option value="">{t('list.all')}</option>
    {#each app.view?.areas ?? [] as a (a.name)}
      <option value={a.name}>{a.name}</option>
    {/each}
  </select>
  <label for="list-search" class="visually-hidden">{t('list.search')}</label>
  <input id="list-search" type="search" placeholder={t('list.search')} bind:value={words} />
</div>

{#if tasks.length === 0}
  <p class="muted">{t('list.empty')}</p>
{:else}
  <ul data-testid="task-list">
    {#each tasks as task (task.id)}
      <li>
        <button class="row" onclick={() => void app.openTask(task)} data-id={task.id}>
          <span class="title untrusted">{markHidden(task.title)}</span>
          <span class="meta muted">
            {task.area}{#if task.status} · {t(`status.${task.status}` as TextKey)}{/if}{#if task.prio !== null} · P{task.prio}{/if}{#if task.due} · {t('list.due', { day: task.due })}{/if}{#if task.openQuestions > 0} · {t('list.questions', { n: task.openQuestions })}{/if}
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .filters {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 10px;
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
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    font-size: 0.88rem;
  }
</style>
