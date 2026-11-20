<script lang="ts">
  // The learning paths of the areas this phone shows (the hub cut them, MOB-02): each with its progress over its
  // leaves, as the engine counted (MOB-05). A tap opens the path. Read when the list opens; not kept on the phone.
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate } from '../lib/i18n';

  let { app, t }: { app: App; t: Translate } = $props();

  const done = (p: { progress: { learned: number; seen: number; dropped: number } }) =>
    p.progress.learned + p.progress.seen + p.progress.dropped;
</script>

<h2>{t('paths.title')}</h2>
{#if app.connection !== 'live'}
  <p class="muted" data-testid="paths-offline">{t('paths.offline')}</p>
{/if}
{#if app.pathsPartial}
  <p class="muted" role="status" data-testid="paths-partial">{t('paths.partial')}</p>
{/if}
{#if app.paths === null}
  {#if app.connection === 'live'}<p class="muted" role="status">{t('paths.loading')}</p>{/if}
{:else if app.paths.length === 0}
  <p class="muted" data-testid="paths-empty">{t('paths.none')}</p>
{:else}
  <ul class="paths" data-testid="paths">
    {#each app.paths as p (p.id)}
      <li>
        <button class="row" onclick={() => void app.openPath(p)}>
          <span class="title untrusted">{#if p.icon}<span aria-hidden="true">{p.icon} </span>{/if}{markHidden(p.title)}</span>
          <span class="muted">
            {p.area} · {t('paths.progress', { done: done(p), total: p.progress.total })}{#if p.level} · {t('paths.level', { n: p.level.level })}{#if p.level.name} {markHidden(p.level.name)}{/if}{/if}
          </span>
          <progress max={Math.max(p.progress.total, 1)} value={done(p)} aria-hidden="true"></progress>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .paths {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 8px;
  }
  .row {
    width: 100%;
    display: grid;
    gap: 4px;
    text-align: left;
    padding: 12px;
  }
  .title {
    font-weight: 600;
  }
  progress {
    width: 100%;
    height: 6px;
  }
</style>
