<script lang="ts">
  // The third way to the vault: an export file of `tasks-hub phone export`, picked by the person, read only. The page
  // checks it (`phoneExport`) and refuses it whole when it holds anything that may not be on a phone.
  import type { App } from '../lib/app.svelte';
  import type { Translate } from '../lib/i18n';

  let { app, t }: { app: App; t: Translate } = $props();
  let reading = $state(false);

  async function picked(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // The same file may be picked again after a new export.
    input.value = '';
    if (!file) return;
    reading = true;
    try {
      await app.openExport(file);
    } finally {
      reading = false;
    }
  }
</script>

<section class="export" data-testid="export">
  <p class="muted">{t('file.hint')}</p>
  <label class="pick">
    {t('file.open')}
    <input type="file" accept="application/json,.json" disabled={reading} onchange={(e) => void picked(e)} data-testid="export-file" />
  </label>
</section>

<style>
  .export {
    margin-top: 28px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
  }
  .pick {
    display: grid;
    gap: 6px;
  }
</style>
