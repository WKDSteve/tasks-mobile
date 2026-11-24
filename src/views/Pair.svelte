<script lang="ts">
  import { DEFAULT_DEVICE_NAME, type App } from '../lib/app.svelte';
  import type { Translate } from '../lib/i18n';
  import { tick } from 'svelte';
  import { focusFirstInvalid } from '../lib/formErrors';
  import ExportPick from './ExportPick.svelte';

  let { app, t }: { app: App; t: Translate } = $props();
  let code = $state('');
  let name = $state('');
  let sending = $state(false);
  // A send without a code says so at the field and puts the focus there.
  let attempted = $state(false);
  let formEl: HTMLFormElement | undefined = $state();
  const codeMissing = $derived(attempted && code.trim() === '');

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (sending) return;
    if (code.trim() === '') {
      attempted = true;
      await tick();
      focusFirstInvalid(formEl);
      return;
    }
    sending = true;
    try {
      // The field is emptied either way: a code works once.
      const text = code;
      code = '';
      await app.pair(text, name);
    } finally {
      sending = false;
    }
  }
</script>

<section>
  <h2>{t('pair.title')}</h2>
  <p>{t('pair.intro')}</p>
  <form onsubmit={submit} novalidate aria-busy={sending} bind:this={formEl}>
    <label for="pair-code">{t('pair.field')}</label>
    <input id="pair-code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={code} aria-invalid={codeMissing ? 'true' : undefined} aria-describedby={codeMissing ? 'pair-code-error' : undefined} />
    {#if codeMissing}<p class="bad" id="pair-code-error">{t('form.missing')}</p>{/if}
    <label for="pair-name">{t('pair.name')}</label>
    <input id="pair-name" type="text" maxlength="40" autocomplete="off" spellcheck="false" autocapitalize="words" translate="no" placeholder={DEFAULT_DEVICE_NAME} bind:value={name} />
    <p><button class="primary" type="submit" disabled={sending}>{t('pair.go')}</button></p>
  </form>
  <ExportPick {app} {t} />
</section>
