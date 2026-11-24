<script lang="ts">
  // The contacts of the areas this phone shows (the hub cut them, MOB-02), by name, with a search over what is on the
  // page. A tap opens one. They are read when the page opens, not with the list. All text is shown as text, hidden
  // characters made visible (MSEC-05); no address and no number stands in the list.
  import { markHidden } from 'appkit-ui/text';
  import type { App } from '../lib/app.svelte';
  import type { Translate } from '../lib/i18n';

  let { app, t }: { app: App; t: Translate } = $props();
  let query = $state('');

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const all = app.contacts ?? [];
    return q === '' ? all : all.filter((c) => [c.name, c.org ?? '', c.role ?? '', ...c.tags].some((x) => x.toLowerCase().includes(q)));
  });
  const canCreate = $derived(app.may('create') && app.areas.length > 0);
</script>

<p><button onclick={() => (app.screen = 'today')}>← {t('nav.today')}</button></p>
<section aria-labelledby="contacts-title" data-testid="contacts">
  <h2 id="contacts-title">{t('contacts.title')}</h2>
  {#if app.contactsRefused}
    <p class="muted" role="status">{t('contacts.refused')}</p>
  {:else if app.contacts === null}
    <p class="muted">{t('contacts.unread')}</p>
  {:else}
    <p>
      <label class="search"
        >{t('contacts.search')}
        <input type="search" bind:value={query} autocomplete="off" data-testid="contacts-search" />
      </label>
    </p>
    {#if canCreate}
      <p><button class="primary" data-testid="contact-new" onclick={() => app.openContactForm(null)}>{t('contacts.new')}</button></p>
    {/if}
    {#if shown.length === 0}
      <p class="muted">{t('contacts.none')}</p>
    {:else}
      <ul>
        {#each shown as c (c.id)}
          <li>
            <button class="row" data-contact={c.id} onclick={() => void app.openContact(c)}>
              <span class="title untrusted">{markHidden(c.name)}</span>
              <span class="muted untrusted">{c.area}{#if c.org} · {markHidden(c.org)}{/if}{#if c.role} · {markHidden(c.role)}{/if}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if app.contactsPartial}<p class="muted" role="status">{t('contacts.partial')}</p>{/if}
  {/if}
</section>

<style>
  ul {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    display: grid;
    gap: 6px;
  }
  .row {
    width: 100%;
    display: grid;
    gap: 2px;
    text-align: left;
    padding: 10px 12px;
    min-height: 48px;
  }
  .title {
    font-weight: 600;
  }
  .search {
    display: grid;
    gap: 4px;
  }
</style>
