<script lang="ts">
  import type { App } from './lib/app.svelte';
  import { chooseLang, reason, translator } from './lib/i18n';
  import type { Shared } from './lib/share';
  import StatusBar from './views/StatusBar.svelte';
  import Pair from './views/Pair.svelte';
  import Today from './views/Today.svelte';
  import TaskList from './views/TaskList.svelte';
  import Capture from './views/Capture.svelte';
  import Queue from './views/Queue.svelte';
  import TaskView from './views/TaskView.svelte';

  let { app, shared, storageMissing }: { app: App; shared: Shared | null; storageMissing: boolean } = $props();

  const lang = chooseLang(typeof navigator === 'undefined' ? [] : navigator.languages);
  const t = translator(lang);
  if (typeof document !== 'undefined') document.documentElement.lang = lang;

  // A share opens the form with what was shared in it (once: the form keeps it from then on).
  // svelte-ignore state_referenced_locally
  if (shared) app.takeShare(shared);

  const waiting = $derived(app.pending.length);

  // A refusal names its reason: the hub's words, or the page's for the code.
  function shownParams(params: Record<string, string | number> | undefined): Record<string, string | number> | undefined {
    if (!params || !('code' in params)) return params;
    return { ...params, message: reason(t, String(params['message'] ?? ''), String(params['code'])) };
  }
</script>

<header>
  <div class="top">
    <h1>{t('app.title')}</h1>
    {#if app.kind === 'fake'}
      <span class="fake" data-testid="fake-badge">{t('app.fake')}</span>
    {/if}
  </div>

  <StatusBar {app} {t} />

  {#if storageMissing}
    <p class="notice bad" role="alert">{t('error.storage')}</p>
  {/if}

  {#if app.notice}
    <p class="notice" class:bad={app.notice.tone === 'error'} role={app.notice.tone === 'error' ? 'alert' : 'status'} data-testid="notice">
      {t(app.notice.key, shownParams(app.notice.params))}
    </p>
  {/if}
</header>

<main>
  {#if app.screen === 'pair'}
    <Pair {app} {t} />
  {:else if app.screen === 'capture'}
    <Capture {app} {t} />
  {:else if app.screen === 'queue'}
    <Queue {app} {t} />
  {:else if app.screen === 'task'}
    <TaskView {app} {t} />
  {:else if app.screen === 'today'}
    <Today {app} {t} />
  {:else}
    <TaskList {app} {t} />
  {/if}
</main>

{#if app.screen !== 'pair'}
  <nav class="bottom" aria-label={t('app.title')}>
    <button aria-current={app.screen === 'today' ? 'page' : undefined} onclick={() => (app.screen = 'today')}>{t('nav.today')}</button>
    <button aria-current={app.screen === 'list' ? 'page' : undefined} onclick={() => (app.screen = 'list')}>{t('nav.list')}</button>
    <button aria-current={app.screen === 'capture' ? 'page' : undefined} onclick={() => (app.screen = 'capture')}>{t('nav.capture')}</button>
    <button aria-current={app.screen === 'queue' ? 'page' : undefined} onclick={() => (app.screen = 'queue')}>
      {t('nav.queue')}{#if waiting > 0}<span class="badge" data-testid="queue-count">{waiting}</span>{/if}
    </button>
  </nav>
{/if}

<style>
  .top {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px 0;
  }
  h1 {
    font-size: 1.2rem;
    margin: 0;
  }
  .fake {
    font-size: 0.8rem;
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--warn);
    border: 1px solid var(--warn);
  }
  .notice {
    margin: 8px 16px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  main {
    padding: 8px 16px calc(88px + env(safe-area-inset-bottom));
  }
  .bottom {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    padding: 8px 8px calc(8px + env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 1px solid var(--line);
  }
  .bottom button[aria-current='page'] {
    background: var(--accent-soft);
    border-color: var(--accent);
    font-weight: 600;
  }
  .badge {
    display: inline-block;
    margin-left: 6px;
    min-width: 22px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 0.85rem;
  }
</style>
