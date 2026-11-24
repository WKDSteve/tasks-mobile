<script lang="ts">
  import { tick as settled } from 'svelte';
  import { pointReason } from '../lib/typed.svelte';
  // One learning path: its points as a tree, each with its state and, for a point with points below it, the state of
  // its leaves (the engine's, MOB-05). A leaf is ticked here: learned at once; seen or dropped with a reason (the engine
  // takes them only with one); a closed one opened again. Each tick is one `node_set` on the version seen (MOB-08),
  // through the queue; the tree shows it once the hub answered (MOB-07). Label, note and reason are text only, hidden
  // characters made visible (MSEC-05); a link is opened only as a web address, in a new tab without a referrer.
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate, TextKey } from '../lib/i18n';
  import type { PathPoint, PointState } from '../lib/types';

  let { app, t }: { app: App; t: Translate } = $props();

  const path = $derived(app.pathView?.path ?? app.openedPath);
  const points = $derived(app.pathView?.points ?? []);
  const canTick = $derived(app.may('change'));
  /** The point a reason is asked for, and the state it is to get. */
  // Kept outside this screen (typed.svelte.ts): left for another screen and back, the reason is still typed.
  const asking = $derived(pointReason.state !== null && pointReason.path === (path?.id ?? '') ? { key: pointReason.key, state: pointReason.state } : null);
  let attempted = $state(false);
  let reasonField: HTMLInputElement | undefined = $state();
  const reasonMissing = $derived(attempted && pointReason.text.trim() === '');

  const CLOSED = new Set(['learned', 'seen', 'dropped']);
  const shownState = (p: PathPoint) => (p.children > 0 ? p.derived : p.state);

  function ask(p: PathPoint, state: 'seen' | 'dropped'): void {
    pointReason.path = path?.id ?? '';
    pointReason.key = p.key;
    pointReason.state = state;
    pointReason.text = '';
    attempted = false;
  }

  async function tick(p: PathPoint, state: PointState, why?: string): Promise<void> {
    pointReason.state = null;
    await app.tickPoint(p, state, why);
  }
</script>

<p><button onclick={() => void app.openPaths()}>← {t('paths.back')}</button></p>

{#if path}
  <h2 class="untrusted" data-testid="path-title">{#if path.icon}<span aria-hidden="true">{path.icon} </span>{/if}{markHidden(path.title)}</h2>
  <p class="muted">
    {path.area} · {t('paths.progress', {
      done: path.progress.learned + path.progress.seen + path.progress.dropped,
      total: path.progress.total,
    })}{#if path.xp} · {t('paths.xp', { earned: path.xp.earned, possible: path.xp.possible })}{/if}
  </p>
  {#if !canTick}
    <p class="muted" data-testid="no-tick">{t('rights.change_none', { level: app.level ?? '' })}</p>
  {/if}
  {#if app.pathView === null}
    {#if app.connection === 'live'}<p class="muted" role="status">{t('paths.loading')}</p>{:else}<p class="muted">{t('paths.offline')}</p>{/if}
  {:else}
    {#if app.pathView.body}<p class="body untrusted">{markHidden(app.pathView.body)}</p>{/if}
    <ul class="points" data-testid="points">
      {#each points as p (p.index)}
        {@const state = shownState(p)}
        <li style:padding-left={`${Math.min(p.depth, 6) * 14}px`} data-point={p.key} data-state={state}>
          <div class="line">
            <span class="mark" aria-hidden="true">{CLOSED.has(state) ? '✓' : '○'}</span>
            <span class="label untrusted">
              {#if p.link}<a class="hit" href={p.link} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{markHidden(p.label)}</a>{:else}{markHidden(p.label)}{/if}
            </span>
            <span class="state muted">{t(`point.${state}` as TextKey)}</span>
          </div>
          {#if p.note}<p class="note untrusted muted">{markHidden(p.note)}</p>{/if}
          {#if p.reason}<p class="note untrusted muted">{t('point.reason')}: {markHidden(p.reason)}</p>{/if}
          {#if p.promoted}<p class="note muted" translate="no">{t('point.promoted', { id: p.promoted })}</p>{/if}
          {#if canTick && p.children === 0 && !p.promoted}
            <div class="actions">
              {#if CLOSED.has(p.state)}
                <button disabled={app.busy} onclick={() => void tick(p, 'open')}>{t('point.reopen')}</button>
              {:else}
                <button class="primary" disabled={app.busy} onclick={() => void tick(p, 'learned')}>{t('point.learned')}</button>
                <button disabled={app.busy} onclick={() => ask(p, 'seen')}>{t('point.seen')}</button>
                <button disabled={app.busy} onclick={() => ask(p, 'dropped')}>{t('point.dropped')}</button>
              {/if}
            </div>
            {#if asking?.key === p.key}
              {@const to = asking.state}
              <form class="reason" onsubmit={async (e) => {
                e.preventDefault();
                if (pointReason.text.trim() === '') {
                  attempted = true;
                  await settled();
                  reasonField?.focus();
                  return;
                }
                void tick(p, to, pointReason.text);
              }}>
                <label>
                  <span>{t('point.reason_for', { state: t(`point.${to}` as TextKey) })}</span>
                  <input bind:this={reasonField} bind:value={pointReason.text} maxlength="500" data-testid="point-reason" aria-invalid={reasonMissing ? 'true' : undefined} aria-describedby={reasonMissing ? 'point-reason-error' : undefined} />
                </label>
                {#if reasonMissing}<p class="bad" id="point-reason-error">{t('form.missing')}</p>{/if}
                <div class="actions">
                  <button class="primary" type="submit" disabled={app.busy}>{t('point.save')}</button>
                  <button type="button" onclick={() => (pointReason.state = null)}>{t('task.cancel')}</button>
                </div>
              </form>
            {/if}
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/if}

<style>
  .points {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    display: grid;
    gap: 10px;
  }
  .line {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .label {
    flex: 1;
    overflow-wrap: anywhere;
  }
  .state {
    font-size: 0.85rem;
  }
  .note {
    margin: 2px 0 0 22px;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }
  .body {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 6px 0 0 22px;
  }
  .reason {
    margin: 6px 0 0 22px;
    display: grid;
    gap: 6px;
  }
  .reason label {
    display: grid;
    gap: 4px;
  }
</style>
