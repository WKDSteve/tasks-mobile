<script lang="ts">
  // The exercise of a learning point (rule LP-21) as a sheet over its path: the task, "done when" and the proof asked
  // for, each part named, its code as code and no `**` left in the text (lib/exercise.ts; untrusted text, drawn as text
  // only, hidden characters made visible: MSEC-05). Below them the field of the result: sent with the state `learned`
  // in one `node_set` (capability `node_result`; the engine writes the proof first), through the queue like every tick
  // (MOB-07, offline too). Whether a point may be learned is the engine's (MOB-05): the sheet only asks for the proof
  // first, where the block names one, so that no tick goes out that the engine would refuse.
  import { tick as settled } from 'svelte';
  import { markHidden } from 'appkit-ui/text';
  import { modal } from '../lib/modal';
  import { parseExercise, RESULT_MAX, spans, type ExerciseKey } from '../lib/exercise';
  import { pointResult } from '../lib/typed.svelte';
  import type { App } from '../lib/app.svelte';
  import type { Translate, TextKey } from '../lib/i18n';
  import type { PathPoint } from '../lib/types';

  let { app, t, point }: { app: App; t: Translate; point: PathPoint } = $props();

  const CLOSED = new Set(['learned', 'seen', 'dropped']);
  const parts = $derived(parseExercise(point.note));
  const asksProof = $derived(!!parts.nachweis);
  /** The point can be learned here: a leaf of its own, not closed, not a task of its own, and this device may change. */
  const tickable = $derived(app.may('change') && point.children === 0 && !point.promoted && !CLOSED.has(point.state));
  /** The field of the result: only where the engine writes it with the state (a hub without `node_result`: none). */
  const field = $derived(tickable && app.hasResults);
  const shown = $derived((['aufgabe', 'fertig', 'nachweis'] as ExerciseKey[]).filter((k) => !!parts[k]));

  let attempted = $state(false);
  let resultField: HTMLTextAreaElement | undefined = $state();
  let dialog: HTMLDialogElement | undefined = $state();
  const missing = $derived(attempted && asksProof && pointResult.text.trim() === '');

  async function learn(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (asksProof && pointResult.text.trim() === '') {
      attempted = true;
      await settled();
      resultField?.focus();
      return;
    }
    dialog?.close();
    // What was typed stays until the write is queued: refused on the phone (a full queue), it is there to send again.
    if (await app.tickPoint(point, 'learned', undefined, pointResult.text)) pointResult.text = '';
  }
</script>

<dialog
  bind:this={dialog}
  class="exercise"
  aria-labelledby="exercise-title"
  data-testid="exercise"
  data-point={point.key}
  use:modal
  onclose={() => (pointResult.open = false)}
>
  <h1 id="exercise-title" class="untrusted">{t('ex.title', { label: markHidden(point.label) })}</h1>
  <p class="muted">{t(`point.${point.state}` as TextKey)}</p>
  <dl>
    {#each shown as key (key)}
      <div data-part={key}>
        <dt>{t(`ex.${key}` as TextKey)}</dt>
        <dd class="untrusted">
          {#each spans(markHidden(parts[key]!)) as s, i (i)}{#if s.kind === 'code'}<code>{s.text}</code>{:else if s.kind === 'strong'}<strong>{s.text}</strong>{:else}{s.text}{/if}{/each}
        </dd>
      </div>
    {/each}
    {#if parts.ergebnis && !field}
      <div data-part="ergebnis">
        <dt>{t('ex.ergebnis')}</dt>
        <dd class="untrusted">{markHidden(parts.ergebnis)}</dd>
      </div>
    {/if}
  </dl>
  {#if field}
    <form onsubmit={(e) => void learn(e)}>
      <label for="exercise-result">{t('ex.ergebnis')}</label>
      <textarea
        id="exercise-result"
        bind:this={resultField}
        bind:value={pointResult.text}
        maxlength={RESULT_MAX}
        rows="3"
        data-testid="exercise-result"
        aria-required={asksProof ? 'true' : undefined}
        aria-invalid={missing ? 'true' : undefined}
        aria-describedby={missing ? 'exercise-missing exercise-hint' : 'exercise-hint'}
      ></textarea>
      <p class="muted hint" id="exercise-hint">{t('ex.hint')}</p>
      {#if missing}<p class="bad" id="exercise-missing" role="alert">{t('ex.missing')}</p>{/if}
      <div class="actions">
        <button class="primary" type="submit" disabled={app.busy}>{t('ex.learned')}</button>
        <!-- The focus starts here, not in the field: on a phone a focused field brings up the keyboard over the task
             that is to be read first. The field gets it when the proof is missing. -->
        <!-- svelte-ignore a11y_autofocus -->
        <button type="button" autofocus onclick={() => dialog?.close()}>{t('ex.close')}</button>
      </div>
    </form>
  {:else}
    {#if tickable && asksProof}<p class="muted" data-testid="exercise-no-field">{t('ex.no_field')}</p>{/if}
    <div class="actions">
      <!-- svelte-ignore a11y_autofocus -->
      <button type="button" autofocus onclick={() => dialog?.close()}>{t('ex.close')}</button>
    </div>
  {/if}
</dialog>

<style>
  .exercise {
    width: min(94vw, 34rem);
    max-height: 88dvh;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--bg);
    color: var(--text);
    padding: 16px;
  }
  h1 {
    font-size: 1.15rem;
    margin: 0 0 4px;
  }
  dl {
    margin: 12px 0;
    display: grid;
    gap: 10px;
  }
  dt {
    font-weight: 600;
  }
  dd {
    margin: 2px 0 0;
  }
  code {
    font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
    font-size: 0.95em;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 0 3px;
  }
  form {
    display: grid;
    gap: 6px;
  }
  label {
    font-weight: 600;
  }
  textarea {
    /* grows with what is typed where the browser can (field-sizing); elsewhere a field of three lines that scrolls */
    field-sizing: content;
    min-block-size: 96px;
    max-block-size: 40dvh;
  }
  .hint {
    margin: 0;
    font-size: 0.9rem;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
</style>
