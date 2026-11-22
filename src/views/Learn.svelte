<script lang="ts">
  // The page Lernen (concept "Reiter Lernpläne", Handy): the tile My learning with a period (today to year, kept on
  // this device) and its figures against as many days of the period before, in words with a mark (never colour
  // alone), and the next step of each running path to tick on the way: learned at once, seen with a reason, a point
  // under {safety} only after a yes. Every figure is the engine's (`learn_history` by day, `learn_next`, cut by the hub
  // for this phone: MOB-02, MOB-05); a tick is one `node_set` through the queue (MOB-07). One column; the paths are
  // one tap away. Texts of the paths are untrusted: text only, hidden characters made visible.
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate } from '../lib/i18n';
  import { changeOf, knownDays, knowsAll, LEARN_PERIODS, sumSpan, type Figures, type LearnPeriod } from '../lib/learn';
  import type { LearnStep } from '../lib/types';

  let { app, t }: { app: App; t: Translate } = $props();

  const locale = typeof document === 'undefined' ? undefined : document.documentElement.lang || undefined;
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const longDay = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const at = (day: string) => new Date(`${day}T12:00:00Z`);

  const series = $derived(app.learnShown);
  const frame = $derived(app.learnFrame);
  const today = $derived(app.learnToday);
  const first = $derived(series?.first ?? null);
  const now = $derived(series ? sumSpan(series.days, frame.current, today, first) : null);
  const before = $derived(series && knowsAll(frame.previous, first) ? sumSpan(series.days, frame.previous, today, first) : null);
  const ofDays = $derived(knownDays(frame.current, today, first));
  const game = $derived((app.paths ?? []).some((p) => p.xp !== null));
  const todayState = $derived(
    (app.paths ?? []).reduce((sum, p) => ({ learned: sum.learned + p.progress.learned, total: sum.total + p.progress.total }), { learned: 0, total: 0 }),
  );
  const canTick = $derived(app.may('change'));
  const h = (n: number) => t('learn.h', { n: number.format(n) });

  function compare(pick: (f: Figures) => number, format: (n: number) => string = String): { mark: string; text: string } | null {
    if (!now) return null;
    if (!before) return first ? { mark: '', text: t('learn.no_compare', { date: longDay.format(at(first)) }) } : null;
    const c = changeOf(pick(now), pick(before));
    const end = at(frame.previous.until);
    const what = t(`learn.before.${app.learnPeriod}`, { day: weekday.format(end), date: dayMonth.format(end) });
    if (c.direction === 'same') return { mark: '=', text: t('learn.same', { before: what }) };
    return { mark: c.direction === 'up' ? '▲' : '▼', text: t(c.direction === 'up' ? 'learn.up' : 'learn.down', { by: format(c.by), before: what }) };
  }

  const streakText = (n: number) => (n === 0 ? t('learn.streak_none') : n === 1 ? t('learn.streak_one') : t('learn.streak', { n }));

  /** The step a reason or a yes is asked for. */
  let asking = $state<{ path: string; kind: 'reason' | 'confirm' } | null>(null);
  let reason = $state('');

  async function learned(step: LearnStep): Promise<void> {
    if (step.safety && asking?.path !== step.path) {
      asking = { path: step.path, kind: 'confirm' };
      return;
    }
    asking = null;
    await app.tickStep(step, 'learned');
  }
  function seen(step: LearnStep): void {
    asking = { path: step.path, kind: 'reason' };
    reason = '';
  }
  async function saveSeen(step: LearnStep): Promise<void> {
    if (!reason.trim()) return;
    asking = null;
    await app.tickStep(step, 'seen', reason);
  }
  function openInPath(step: LearnStep): void {
    const brief = app.paths?.find((p) => p.id === step.path);
    if (brief) void app.openPath(brief);
  }
  const choose = (p: LearnPeriod) => void app.setLearnPeriod(p);
</script>

<h2>{t('learn.title')}</h2>
{#if app.connection !== 'live'}
  <p class="muted" data-testid="learn-offline">{t('learn.offline')}</p>
{/if}

<section class="tile" aria-labelledby="learn-mine">
  <h3 id="learn-mine">{t('learn.mine')}</h3>
  <fieldset class="periods">
    <legend class="sr-only">{t('learn.period')}</legend>
    {#each LEARN_PERIODS as p (p)}
      <label class:on={app.learnPeriod === p}
        ><input type="radio" name="learn-period" value={p} checked={app.learnPeriod === p} onchange={() => choose(p)} />{t(`learn.period.${p}`)}</label
      >
    {/each}
  </fieldset>
  {#if app.learnNoSeries || !series || first === null}
    <dl class="figs">
      <div data-fig="today"><dt>{t('learn.today_state')}</dt><dd class="big">{t('learn.today_learned', todayState)}</dd></div>
    </dl>
    {#if app.connection === 'live'}
      <p class="muted" role="note" data-testid="learn-note">
        {#if app.learnNoSeries}{t('learn.no_series')}{:else if series}{t('learn.series_none')}{:else}{t('learn.reading')}{/if}
      </p>
    {/if}
  {:else}
    {@const learnedCmp = compare((f) => f.learned)}
    {@const xpCmp = compare((f) => f.xp)}
    {@const hoursCmp = compare((f) => f.doneH, h)}
    {@const daysCmp = compare((f) => f.days)}
    <dl class="figs" aria-live="polite">
      <div data-fig="learned">
        <dt>{t('learn.fig.learned')}</dt>
        <dd class="big">{now?.learned ?? 0}</dd>
        {#if learnedCmp}<dd class="cmp"><span aria-hidden="true">{learnedCmp.mark}</span> {learnedCmp.text}</dd>{/if}
      </div>
      {#if game}
        <div data-fig="xp">
          <dt>{t('learn.fig.xp')}</dt>
          <dd class="big">{now?.xp ?? 0}</dd>
          {#if xpCmp}<dd class="cmp"><span aria-hidden="true">{xpCmp.mark}</span> {xpCmp.text}</dd>{/if}
        </div>
      {/if}
      <div data-fig="hours">
        <dt>{t('learn.fig.hours')}</dt>
        <dd class="big">{h(now?.doneH ?? 0)}</dd>
        {#if hoursCmp}<dd class="cmp"><span aria-hidden="true">{hoursCmp.mark}</span> {hoursCmp.text}</dd>{/if}
      </div>
      <div data-fig="days">
        <dt>{t('learn.fig.days')}</dt>
        <dd class="big">{t('learn.days_of', { n: now?.days ?? 0, m: ofDays })}</dd>
        {#if daysCmp}<dd class="cmp"><span aria-hidden="true">{daysCmp.mark}</span> {daysCmp.text}</dd>{/if}
      </div>
      <div data-fig="streak">
        <dt>{t('learn.fig.streak')}</dt>
        <dd class="big"><span aria-hidden="true">🔥</span> {streakText(series.streak?.current ?? 0)}</dd>
        <dd class="cmp">{t('learn.longest', { n: series.streak?.longest ?? 0 })}</dd>
      </div>
    </dl>
  {/if}
</section>

<section class="tile" aria-labelledby="learn-next">
  <h3 id="learn-next">{t('learn.next')}</h3>
  {#if app.learnNoSteps}
    <p class="muted">{t('learn.next.no_hub')}</p>
  {:else if app.learnSteps === null}
    {#if app.connection === 'live'}<p class="muted" role="status">{t('paths.loading')}</p>{/if}
  {:else if app.learnSteps.length === 0}
    <p class="muted" data-testid="learn-steps-none">{t('learn.next.none')}</p>
  {:else}
    {#if app.learnPartial}<p class="muted" role="status">{t('learn.next.partial')}</p>{/if}
    <ul class="steps" data-testid="learn-steps">
      {#each app.learnSteps as step (step.path)}
        {@const label = markHidden(step.label)}
        <li data-step={step.path}>
          <p class="what untrusted">
            <strong>{#if step.icon}<span aria-hidden="true">{step.icon} </span>{/if}{markHidden(step.title)}</strong>
            {#if step.stage}<span class="muted">{markHidden(step.stage)}</span>{/if}
            <span>{#if step.link}<a href={step.link} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{label}</a>{:else}{label}{/if}</span>
            <span class="muted"
              >{#if step.hMin !== null}{t('learn.step.hours', { h: step.hMax !== null && step.hMax !== step.hMin ? `${step.hMin}–${step.hMax}` : step.hMin })}{/if}{#if game && step.xp !== null}{step.hMin !== null ? ' · ' : ''}{t('learn.step.xp', { n: step.xp })}{/if}</span
            >
            {#if step.safety}<span class="warn"><span aria-hidden="true">⚠</span> {t('learn.step.safety')}</span>{/if}
          </p>
          {#if canTick && step.key !== null}
            {#if asking?.path === step.path && asking.kind === 'confirm'}
              <div class="ask" role="group" aria-labelledby="confirm-{step.path}">
                <p id="confirm-{step.path}"><span aria-hidden="true">⚠</span> {t('learn.step.confirm')}</p>
                <button class="primary" disabled={app.busy} onclick={() => void learned(step)}>{t('learn.step.confirm_yes')}</button>
                <button onclick={() => (asking = null)}>{t('learn.step.cancel')}</button>
              </div>
            {:else if asking?.path === step.path && asking.kind === 'reason'}
              <form class="ask" onsubmit={(e) => { e.preventDefault(); void saveSeen(step); }}>
                <label><span>{t('learn.step.reason')}</span><textarea bind:value={reason} rows="2" maxlength="500" required></textarea></label>
                <button class="primary" type="submit" disabled={app.busy || !reason.trim()}>{t('learn.step.save')}</button>
                <button type="button" onclick={() => (asking = null)}>{t('learn.step.cancel')}</button>
              </form>
            {:else}
              <div class="actions">
                <button class="primary" disabled={app.busy} aria-label={t('learn.step.learned_of', { label })} onclick={() => void learned(step)}
                  >✓ {t('learn.step.learned')}</button
                >
                <button disabled={app.busy} aria-label={t('learn.step.seen_of', { label })} onclick={() => seen(step)}>{t('learn.step.seen')}</button>
              </div>
            {/if}
          {/if}
          {#if app.paths?.some((p) => p.id === step.path)}
            <button class="link" onclick={() => openInPath(step)}>{t('learn.step.open')}</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<p><button onclick={() => void app.openPaths()} data-testid="learn-all-paths">{t('learn.all_paths')} →</button></p>

<style>
  .tile {
    display: grid;
    gap: 10px;
    margin: 0 0 14px;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--surface);
  }
  h3 {
    margin: 0;
    font-size: 1rem;
  }
  .periods {
    display: flex;
    flex-wrap: wrap;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    overflow: hidden;
  }
  .periods label {
    position: relative;
    flex: 1 1 auto;
    text-align: center;
    padding: 8px 6px;
    min-height: 44px;
    box-sizing: border-box;
    display: grid;
    place-items: center;
  }
  .periods label + label {
    border-left: 1px solid var(--line);
  }
  .periods label.on {
    background: var(--accent);
    color: var(--accent-text);
    font-weight: 600;
  }
  .periods input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
  }
  .periods label:has(input:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: -3px;
  }
  .figs {
    display: grid;
    gap: 10px;
    margin: 0;
  }
  dt {
    color: var(--muted);
    font-size: 0.9rem;
  }
  dd {
    margin: 0;
  }
  .big {
    font-size: 1.3rem;
    font-weight: 700;
  }
  .cmp {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .steps li {
    display: grid;
    gap: 6px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--line);
  }
  .what {
    display: grid;
    gap: 2px;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .warn {
    color: var(--warn);
  }
  .actions,
  .ask {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .ask label {
    display: grid;
    gap: 4px;
    width: 100%;
  }
  .ask p {
    margin: 0;
    width: 100%;
  }
  .link {
    justify-self: start;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--accent);
    text-decoration: underline;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
