<script lang="ts">
  // One task: its text (as text only, hidden characters made visible: MSEC-05), its status, its open questions, and
  // finishing it after the engine said what that sets off (MUI-01: a consequential step is confirmed).
  import { untrack } from 'svelte';
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate, TextKey } from '../lib/i18n';
  import { SETTABLE, type Status } from '../lib/types';

  let { app, t }: { app: App; t: Translate } = $props();

  const task = $derived(app.detail?.task ?? app.opened);
  let chosen = $state<Status | ''>('');

  // The choice follows the task's status when another task is shown or its status changed, not when the same task
  // is read again (a detail that arrives late must not undo what the user picked meanwhile), and after a conflict (the
  // PC changed the task: the choice goes back to what is true now).
  const statusKey = $derived(task ? `${task.id}:${task.status ?? ''}:${app.conflicts}` : '');
  $effect(() => {
    void statusKey;
    chosen = untrack(() => (task?.status && task.status !== 'done' ? task.status : ''));
  });
</script>

<p><button onclick={() => (app.screen = app.returnTo)}>← {t('task.back')}</button></p>

{#if task}
  <article>
    <h2 class="untrusted" data-testid="task-title">{markHidden(task.title)}</h2>
    <p class="muted">{task.area}{#if task.status} · {t(`status.${task.status}` as TextKey)}{/if}</p>

    {#if task.status !== 'done' && !app.may('change')}
      <p class="muted" data-testid="no-change">{t('rights.change_none', { level: app.level ?? '' })}</p>
    {:else if task.status !== 'done'}
      <div class="status">
        <label for="task-status">{t('task.status')}</label>
        <select id="task-status" bind:value={chosen}>
          {#each SETTABLE as s (s)}
            <option value={s}>{t(`status.${s}` as TextKey)}</option>
          {/each}
        </select>
        <button disabled={app.busy || chosen === '' || chosen === task.status} onclick={() => chosen !== '' && void app.setStatus(task, chosen)}>
          {t('task.set')}
        </button>
        <button disabled={app.busy} onclick={() => void app.askFinish(task)}>{t('task.done')}</button>
      </div>
    {/if}

    {#if app.preview}
      <div class="confirm" role="dialog" aria-labelledby="done-title" data-testid="done-preview">
        <h3 id="done-title">{t('task.done_title')}</h3>
        {#if app.preview.already}
          <p>{t('task.done_already')}</p>
        {/if}
        {#if app.preview.closesPlan}<p>{t('task.done_closes_plan', { plan: app.preview.closesPlan })}</p>{/if}
        {#if app.preview.closesProject}<p>{t('task.done_closes_project', { project: app.preview.closesProject })}</p>{/if}
        {#if app.preview.freed.length > 0}<p>{t('task.done_frees', { n: app.preview.freed.length })}</p>{/if}
        {#if app.preview.nextDue}<p>{t('task.done_next', { day: app.preview.nextDue })}</p>{/if}
        <div class="actions">
          {#if app.preview.confirm && !app.preview.already}
            <button class="primary" onclick={() => void app.finish(task)}>{t('task.done_confirm')}</button>
          {/if}
          <button onclick={() => (app.preview = null)}>{t('task.cancel')}</button>
        </div>
      </div>
    {/if}

    {#if app.detail}
      {#if app.detail.questions.length > 0}
        <h3>{t('task.questions')}</h3>
        {#if !app.may('create')}
          <p class="muted" data-testid="no-answer">{t('rights.answer_none', { level: app.level ?? '' })}</p>
        {/if}
        {#each app.detail.questions as q (q.n)}
          <fieldset>
            <legend class="untrusted">{markHidden(q.title)}{#if q.answered} · <span class="ok">{t('task.answered')}</span>{/if}</legend>
            {#each q.options as o (o.n)}
              <button
                class="option"
                class:chosen={o.chosen}
                disabled={app.busy || q.key === null || o.chosen || !app.may('create')}
                onclick={() => q.key !== null && void app.answer(task, q.key, o.n)}
              >
                <span class="untrusted">{markHidden(o.text)}</span>{#if o.recommended} <span class="muted">({t('task.recommended')})</span>{/if}
              </button>
            {/each}
          </fieldset>
        {/each}
      {/if}
      {#if app.detail.body.trim() !== ''}
        <div class="body untrusted" data-testid="task-body">{markHidden(app.detail.body)}</div>
      {/if}
      {#if app.detail.bodyTruncated}
        <p class="muted">{t('task.body_cut')}</p>
      {/if}
    {/if}
  </article>
{/if}

<style>
  .status {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .confirm {
    margin: 14px 0;
    padding: 12px;
    border: 2px solid var(--accent);
    border-radius: 12px;
    background: var(--surface);
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  fieldset {
    border: 1px solid var(--line);
    border-radius: 10px;
    margin: 0 0 10px;
    display: grid;
    gap: 6px;
  }
  .option {
    text-align: left;
  }
  .option.chosen {
    border-color: var(--ok);
    background: var(--accent-soft);
  }
  .body {
    margin-top: 14px;
    padding: 12px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
</style>
