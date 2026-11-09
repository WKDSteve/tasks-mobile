<script lang="ts">
  // Whether the phone speaks to the hub right now, and how old what it shows is (MUI-05); and that it shows a part of
  // the vault when areas stay on the PC (MUI-06).
  import type { App } from '../lib/app.svelte';
  import type { Translate } from '../lib/i18n';

  let { app, t }: { app: App; t: Translate } = $props();

  const at = $derived(app.viewAt ? new Date(app.viewAt).toLocaleString() : null);
</script>

<div class="bar" data-testid="connection" data-state={app.connection}>
  {#if app.connection === 'live'}
    <span class="ok">● {t('conn.live')}</span>
  {:else if app.connection === 'checking'}
    <span class="muted">◌ {t('conn.checking')}</span>
  {:else if at}
    <span class="bad">○ {t('conn.offline', { at })}</span>
  {:else}
    <span class="bad">○ {t('conn.offline_none')}</span>
  {/if}
  {#if app.canRetry && app.connection !== 'checking'}
    <button onclick={() => void app.refresh()}>{t('conn.refresh')}</button>
  {/if}
</div>
{#if app.engineProblem}
  <p class="line bad" role="alert">{t('conn.engine', { problem: app.engineProblem })}</p>
{/if}
{#if app.view && app.view.hiddenAreas > 0}
  <p class="line muted" data-testid="partial">{t('part.hidden', { n: app.view.hiddenAreas })}</p>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 16px;
    min-height: 56px;
  }
  .line {
    margin: 0 16px 4px;
    font-size: 0.9rem;
  }
</style>
