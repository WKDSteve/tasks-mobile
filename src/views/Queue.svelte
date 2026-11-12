<script lang="ts">
  // The writes that wait for the hub, or that it did not take (MOB-07, MOB-09): each with its state in words, and what
  // the user can do about it.
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate, TextKey } from '../lib/i18n';
  import type { Pending } from '../lib/queue';

  let { app, t }: { app: App; t: Translate } = $props();
  let forgetting = $state(false);

  function what(item: Pending): string {
    const label = markHidden(item.label);
    switch (item.op.op) {
      case 'new':
        return item.op.files?.length
          ? t('queue.op.new_files', { label, n: item.op.files.length })
          : t('queue.op.new', { label });
      case 'upload':
        return t('queue.op.upload', { label, name: item.op.file.name });
      case 'set':
        return t('queue.op.set', { label, status: t(`status.${item.op.patch.status}` as TextKey) });
      case 'answer':
        return t('queue.op.answer', { label });
      case 'done':
        return t('queue.op.done', { label });
    }
  }
</script>

{#if app.pending.length === 0}
  <p class="muted">{t('queue.empty')}</p>
{:else}
  <p><button class="primary" onclick={() => void app.sendNow()} disabled={app.busy}>{t('queue.send')}</button></p>
  <ul data-testid="queue">
    {#each app.pending as item (item.clientOpId)}
      <li data-state={item.state}>
        <p class="what untrusted">{what(item)}</p>
        <p class:bad={item.state === 'conflict' || item.state === 'refused' || item.state === 'unknown'}>
          {t(`queue.state.${item.state}` as TextKey)}{#if item.message && item.state !== 'conflict'}: <span class="untrusted">{markHidden(item.message)}</span>{/if}
        </p>
        {#if item.message && item.state === 'conflict'}
          <!-- The engine's words name versions by hash: there for whoever wants them, not in the way. -->
          <details class="muted">
            <summary>{t('queue.details')}</summary>
            <span class="untrusted">{markHidden(item.message)}</span>
          </details>
        {/if}
        {#if item.state === 'unknown' && item.op.op === 'upload'}
          <!-- The hub attaches with `exact`: a file sent again that had arrived is answered `exists`, never attached twice. -->
          <p class="muted" data-testid="unknown-upload-help">{t('queue.unknown_upload_help')}</p>
        {:else if item.state === 'unknown'}
          <p class="muted">{t('queue.unknown_help')}</p>
        {:else if item.state === 'conflict'}
          <p class="muted">{t('queue.conflict_help')}</p>
        {/if}
        {#if item.state !== 'sending'}
          <div class="actions">
            {#if item.state === 'unknown' || item.state === 'refused'}
              <button onclick={() => void app.retry(item.clientOpId)}>{t('queue.retry')}</button>
            {/if}
            <button onclick={() => void app.drop(item.clientOpId)}>{t('queue.drop')}</button>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<section class="push" data-testid="push">
  <h2>{t('push.title')}</h2>
  <p class="muted">{t('push.help')}</p>
  <p data-testid="push-state">{t(`push.state.${app.pushState}` as TextKey)}</p>
  {#if app.pushState === 'off'}
    <button onclick={() => void app.enablePush()} disabled={app.busy}>{t('push.enable')}</button>
  {:else if app.pushState === 'on'}
    <button onclick={() => void app.disablePush()} disabled={app.busy}>{t('push.disable')}</button>
  {/if}
</section>

<section class="forget">
  {#if forgetting}
    <div role="alertdialog" aria-labelledby="forget-text" data-testid="forget-confirm">
      <p id="forget-text">{t('pair.forget_confirm')}</p>
      <div class="actions">
        <button class="primary" onclick={() => { forgetting = false; void app.forget(); }}>{t('pair.forget')}</button>
        <button onclick={() => (forgetting = false)}>{t('task.cancel')}</button>
      </div>
    </div>
  {:else}
    <button onclick={() => (forgetting = true)}>{t('pair.forget')}</button>
  {/if}
</section>

<style>
  .push h2 {
    font-size: 1rem;
    margin: 0 0 4px;
  }
  .push,
  .forget {
    margin-top: 28px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 10px;
  }
  li {
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
  }
  li p {
    margin: 4px 0;
  }
  .what {
    font-weight: 600;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
</style>
