<script lang="ts">
  import { DEFAULT_DEVICE_NAME, type App } from '../lib/app.svelte';
  import type { Translate } from '../lib/i18n';

  let { app, t }: { app: App; t: Translate } = $props();
  let code = $state('');
  let name = $state('');
  let sending = $state(false);

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
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
  <form onsubmit={submit}>
    <label for="pair-code">{t('pair.field')}</label>
    <input id="pair-code" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" bind:value={code} />
    <label for="pair-name">{t('pair.name')}</label>
    <input id="pair-name" type="text" maxlength="40" autocomplete="off" placeholder={DEFAULT_DEVICE_NAME} bind:value={name} />
    <p><button class="primary" type="submit" disabled={sending || code.trim() === ''}>{t('pair.go')}</button></p>
  </form>
</section>
