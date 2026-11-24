<script lang="ts">
  // One contact: who the person is, and how to reach them: a number is a `tel:` link, an address a `mailto:` link, both
  // large enough to hit with a thumb (and only when the hub gave them: a public area, or an internal one the PC
  // released). The notes and the meetings of the contact follow. A number or an address is never put into a notice; the
  // links carry only what `plainPhone` and `plainEmail` let through (no `;`, no `?`). All text is shown as text, hidden
  // characters made visible (MSEC-05).
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate } from '../lib/i18n';

  let { app, t }: { app: App; t: Translate } = $props();

  const contact = $derived(app.contactView?.contact ?? app.openedContact);
  /** The digits and the leading `+` of a number: what a `tel:` link needs. */
  const dial = (number: string) => number.replace(/[^0-9+]/g, '');
</script>

<p><button onclick={() => (app.screen = 'contacts')}>← {t('contacts.back')}</button></p>

{#if contact}
  <h2 class="untrusted" data-testid="contact-name">{markHidden(contact.name)}</h2>
  <p class="muted untrusted">
    {contact.area}{#if contact.org} · {markHidden(contact.org)}{/if}{#if contact.role} · {markHidden(contact.role)}{/if}{#if contact.tz} · {contact.tz}{/if}
  </p>
  {#if contact.tags.length > 0}<p class="muted untrusted">{contact.tags.map(markHidden).join(' · ')}</p>{/if}
  {#if !contact.data}
    <p class="muted" role="status">{t('contact.no_data')}</p>
  {:else}
    <ul class="reach" data-testid="reach">
      {#each contact.phones as number (number)}
        <li><a class="link" href={`tel:${dial(number)}`} data-testid="tel">{t('contact.call', { number })}</a></li>
      {/each}
      {#each contact.emails as address (address)}
        <li><a class="link" href={`mailto:${address}`} data-testid="mailto">{t('contact.mail', { address })}</a></li>
      {/each}
    </ul>
  {/if}
  {#if app.contactView === null}
    <p class="muted" role="status">{app.connection === 'live' ? t('paths.loading') : t('contacts.unread')}</p>
  {:else}
    {#if app.contactView.notes !== ''}
      <h3>{t('contact.notes')}</h3>
      <p class="untrusted notes">{markHidden(app.contactView.notes)}</p>
    {/if}
    {#if app.contactView.history.length > 0}
      <h3>{t('contact.history')}</h3>
      <ul class="plain">
        {#each app.contactView.history as h (h.id)}<li class="untrusted">{markHidden(h.title)}{#if h.present} · {t('contact.present')}{/if}</li>{/each}
      </ul>
    {/if}
  {/if}
  {#if app.may('change')}
    <p><button data-testid="contact-edit" onclick={() => app.openContactForm(contact)}>{t('contact.edit')}</button></p>
  {/if}
{/if}

<style>
  .reach,
  .plain {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    display: grid;
    gap: 6px;
  }
  .link {
    display: block;
    padding: 12px;
    min-height: 48px;
    box-sizing: border-box;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    overflow-wrap: anywhere;
  }
  .notes {
    white-space: pre-wrap;
  }
</style>
