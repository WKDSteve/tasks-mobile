<script lang="ts">
  // The form of a contact: a new one (Create) or the opened one (Change). The fields are the ones the hub lets a phone
  // write; the addresses and numbers only appear when the hub gave them. A problem names the field, never its text: no
  // address and no number goes into a notice. The write goes through the queue (MOB-07).
  import type { App } from '../lib/app.svelte';
  import { emptyForm, formOf, type ContactForm, type ContactProblem } from '../lib/contactForm';
  import type { Translate, TextKey } from '../lib/i18n';

  let { app, t }: { app: App; t: Translate } = $props();

  const editing = $derived(app.editingContact);
  // svelte-ignore state_referenced_locally
  let form = $state<ContactForm>(editing ? formOf(editing) : emptyForm(app.areas[0] ?? ''));
  let problems = $state<ContactProblem[]>([]);
  // A new contact asks for its addresses and numbers; an edited one only when the hub gave them.
  const reach = $derived(editing === null || editing.data);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const result = await app.saveContact(form);
    problems = result.ok ? [] : result.problems;
  }

  function cancel(): void {
    app.screen = editing ? 'contact' : 'contacts';
  }
</script>

<form onsubmit={submit} data-testid="contact-form">
  <h2>{editing ? t('contact.edit') : t('contacts.new')}</h2>
  {#if editing === null}
    <label>
      {t('contact.area')}
      <select bind:value={form.area} data-testid="contact-area">
        {#each app.areas as a (a)}<option value={a}>{a}</option>{/each}
      </select>
    </label>
  {/if}
  <label>
    {t('contact.name')}
    <input bind:value={form.name} maxlength="200" autocomplete="off" required data-testid="contact-field-name" />
  </label>
  <label>
    {t('contact.org')}
    <input bind:value={form.org} maxlength="200" autocomplete="off" />
  </label>
  <label>
    {t('contact.role')}
    <input bind:value={form.role} maxlength="200" autocomplete="off" />
  </label>
  {#if reach}
    <label>
      {t('contact.emails')}
      <textarea bind:value={form.emails} rows="3" autocomplete="off" inputmode="email" data-testid="contact-field-emails"></textarea>
    </label>
    <label>
      {t('contact.phones')}
      <textarea bind:value={form.phones} rows="3" autocomplete="off" inputmode="tel" data-testid="contact-field-phones"></textarea>
    </label>
  {/if}
  <label>
    {t('contact.tags')}
    <input bind:value={form.tags} autocomplete="off" />
  </label>
  {#if problems.length > 0}
    <ul class="problems" role="alert" data-testid="contact-problems">
      {#each problems as p (p)}<li>{t(`contact.problem.${p}` as TextKey)}</li>{/each}
    </ul>
  {/if}
  <p class="actions">
    <button class="primary" type="submit" disabled={app.busy} data-testid="contact-save">{t('contact.save')}</button>
    <button type="button" onclick={cancel}>{t('contact.cancel')}</button>
  </p>
</form>

<style>
  form {
    display: grid;
    gap: 12px;
  }
  label {
    display: grid;
    gap: 4px;
  }
  .problems {
    margin: 0;
    padding-left: 18px;
    color: var(--bad, inherit);
  }
  .actions {
    display: flex;
    gap: 8px;
    margin: 0;
  }
</style>
