<script lang="ts">
  import type { App } from '../lib/app.svelte';
  import type { Translate, TextKey } from '../lib/i18n';
  import type { Shared } from '../lib/share';

  let { app, t, shared }: { app: App; t: Translate; shared: Shared | null } = $props();

  // svelte-ignore state_referenced_locally
  let title = $state(shared?.title ?? '');
  // svelte-ignore state_referenced_locally
  let context = $state(shared?.context ?? '');
  // svelte-ignore state_referenced_locally
  let fromShare = $state(shared !== null);
  let area = $state('');

  $effect(() => {
    // The first area that may be written to, until the user picks one.
    if (area === '' && app.areas.length > 0) area = app.areas[0] ?? '';
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const ok = await app.capture({ area, title, context });
    if (ok) {
      title = '';
      context = '';
      fromShare = false;
    }
  }
</script>

<form onsubmit={submit} novalidate>
  {#if fromShare}
    <p class="muted" data-testid="from-share">{t('capture.shared')}</p>
  {/if}
  {#if app.areas.length === 0}
    <p class="bad">{t('capture.no_area')}</p>
  {/if}
  <label for="cap-title">{t('capture.title')}</label>
  <input id="cap-title" type="text" maxlength="400" enterkeyhint="next" bind:value={title} aria-invalid={app.problems.some((p) => p.startsWith('title')) || undefined} />

  <label for="cap-area">{t('capture.area')}</label>
  <select id="cap-area" bind:value={area}>
    {#each app.areas as a (a)}
      <option value={a}>{a}</option>
    {/each}
  </select>

  <label for="cap-context">{t('capture.context')}</label>
  <textarea id="cap-context" maxlength="4000" bind:value={context}></textarea>

  {#if app.problems.length > 0}
    <ul class="bad" role="alert" data-testid="problems">
      {#each app.problems as problem (problem)}
        <li>{t(`capture.problem.${problem}` as TextKey)}</li>
      {/each}
    </ul>
  {/if}

  <p><button class="primary" type="submit" disabled={app.busy || app.areas.length === 0}>{t('capture.save')}</button></p>
</form>
