import AxeBuilder from '@axe-core/playwright';
import { expect, fakeHub, open, test } from './fixtures';

test('shows only the areas that may leave the PC, says it is a part, and keeps nothing else (MOB-02, MUI-06)', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('fake-badge')).toBeVisible();
  await expect(page.getByTestId('task-list').getByRole('button')).toHaveCount(5);
  await expect(page.getByTestId('partial')).toContainText('2 areas stay on the PC');
  const html = await page.content();
  expect(html).not.toContain('SECRET-MARKER');
  expect(html).not.toContain('UNCLASSIFIED-MARKER');
  // What the phone keeps (IndexedDB) holds none of it either.
  const kept = await page.evaluate(async () => {
    const read = (name: string, store: string, key: string) =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(store);
        req.onsuccess = () => {
          const get = req.result.transaction(store, 'readonly').objectStore(store).get(key);
          get.onsuccess = () => resolve(JSON.stringify(get.result ?? null));
          get.onerror = () => resolve('error');
        };
      });
    return read('tasks-mobile-view', 'view', 'last');
  });
  expect(kept).toContain('garden/water-the-plants');
  expect(kept).not.toContain('SECRET-MARKER');
});

test('shows hidden characters as marks and foreign markup as text (MSEC-05)', async ({ page }) => {
  await open(page);
  await expect(page.getByText('⟦U+202E⟧txt.exe⟦U+202C⟧')).toBeVisible();
  await page.locator('[data-id="kitchen/hidden-characters"]').click();
  await expect(page.getByTestId('task-body')).toHaveText('<img src=x onerror=alert(1)> stays text.');
  await expect(page.locator('img')).toHaveCount(0);
});

test('a link with a script scheme in a body is not a link', async ({ page }) => {
  await open(page);
  await page.locator('[data-id="garden/water-the-plants"]').click();
  await expect(page.getByTestId('task-body')).toContainText('javascript:alert(1)');
  await expect(page.getByTestId('task-body').locator('a')).toHaveCount(0);
});

test('captures a task; the list shows it after the engine said yes', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Title').fill('Buy seeds');
  await page.getByLabel('Area').selectOption('garden');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('notice')).toContainText('Buy seeds');
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.locator('[data-id="garden/buy-seeds"]')).toBeVisible();
});

test('names the problems of a capture and creates nothing', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('problems')).toContainText('The title is missing.');
});

test('keeps a capture offline, then sends it (MOB-08)', async ({ page }) => {
  await open(page);
  await fakeHub(page, { offline: true });
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'offline');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Title').fill('Call the plumber');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('queue-count')).toHaveText('1');
  await fakeHub(page, { offline: false });
  await page.getByRole('button', { name: /Waiting/ }).click();
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.locator('[data-id="garden/call-the-plumber"]')).toBeVisible();
});

test('a conflict is shown and nothing is overwritten', async ({ page }) => {
  await open(page);
  await page.locator('[data-id="garden/water-the-plants"]').click();
  await fakeHub(page, { touch: 'garden/water-the-plants' });
  await page.getByLabel('Status').selectOption('doing');
  await page.getByRole('button', { name: 'Set status' }).click();
  await page.getByRole('button', { name: /Waiting/ }).click();
  await expect(page.getByTestId('queue').locator('li')).toHaveAttribute('data-state', 'conflict');
  await expect(page.getByText('Nothing was overwritten.')).toBeVisible();
});

test('finishing shows what it sets off and needs a yes (MUI-01)', async ({ page }) => {
  await open(page);
  await page.locator('[data-id="kitchen/fix-the-tap"]').click();
  await page.getByRole('button', { name: 'Finish …' }).click();
  await expect(page.getByTestId('done-preview')).toContainText('Frees 1 waiting tasks.');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('done-preview')).toHaveCount(0);
  await page.getByRole('button', { name: 'Finish …' }).click();
  await page.getByRole('button', { name: 'Yes, finish' }).click();
  await page.getByRole('button', { name: /Back/ }).click();
  await expect(page.locator('[data-id="kitchen/fix-the-tap"]')).toHaveCount(0);
});

test('answers an open question', async ({ page }) => {
  await open(page);
  await page.locator('[data-id="garden/choose-a-fence"]').click();
  await page.getByRole('button', { name: /Wood/ }).click();
  await expect(page.getByText('answered')).toBeVisible();
});

test('a share fills the form, never writes by itself, and leaves the address (MSEC-07)', async ({ page }) => {
  const params = new URLSearchParams({
    share_title: 'An article',
    share_text: 'Read later',
    share_url: 'javascript:alert(1)',
  });
  await page.goto(`/?${params.toString()}`);
  await expect(page.getByTestId('from-share')).toBeVisible();
  await expect(page.getByLabel('Title')).toHaveValue('An article');
  await expect(page.getByLabel('One sentence of context (optional)')).toHaveValue('Read later');
  expect(new URL(page.url()).search).toBe('');
  const writes = await page.evaluate(() => (window as unknown as { __fakeHub: { writes: unknown[] } }).__fakeHub.writes.length);
  expect(writes).toBe(0);
});

test('disconnecting asks first, then deletes the kept list and what waits (MSEC-12)', async ({ page }) => {
  await open(page);
  await fakeHub(page, { offline: true });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Title').fill('Will be dropped');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: /Waiting/ }).click();
  await page.getByRole('button', { name: 'Disconnect and delete the data' }).click();
  await expect(page.getByTestId('forget-confirm')).toBeVisible();
  await expect(page.getByTestId('queue-count')).toHaveText('1');
  await page.getByTestId('forget-confirm').getByRole('button', { name: 'Disconnect and delete the data' }).click();
  await expect(page.getByTestId('queue-count')).toHaveCount(0);
  const kept = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open('tasks-mobile-view', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('view');
        req.onsuccess = () => {
          const get = req.result.transaction('view', 'readonly').objectStore('view').get('last');
          get.onsuccess = () => resolve(JSON.stringify(get.result ?? null));
        };
      }),
  );
  expect(kept).toBe('null');
});

test('every control is at least 48 px (MUI-02)', async ({ page }) => {
  await open(page);
  for (const screen of ['List', 'New']) {
    await page.getByRole('button', { name: screen, exact: true }).click();
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('button, select, input, textarea')]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .map((el) => ({ el: el.outerHTML.slice(0, 60), r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.height < 47.5 || r.width < 47.5)
        .map(({ el }) => el),
    );
    expect(small, screen).toEqual([]);
  }
});

test('the main views pass axe', async ({ page }) => {
  await open(page);
  for (const step of [
    async () => {},
    async () => page.getByRole('button', { name: 'New', exact: true }).click(),
    async () => page.getByRole('button', { name: /Waiting/ }).click(),
    async () => {
      await page.getByRole('button', { name: 'List' }).click();
      await page.locator('[data-id="garden/choose-a-fence"]').click();
    },
  ]) {
    await step();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  }
});

test('installable: manifest with a share target, a service worker that keeps no route of the hub (PWA-02, PWA-07)', async ({ page }) => {
  await open(page);
  const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
  expect(manifest.display).toBe('standalone');
  expect(manifest.share_target.params).toEqual({ title: 'share_title', text: 'share_text', url: 'share_url' });
  await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration()) !== undefined);
  await page.waitForFunction(async () => (await navigator.serviceWorker.ready).active !== null);
  await page.reload();
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
  const cached = await page.evaluate(async () => {
    const keys: string[] = [];
    for (const name of await caches.keys()) for (const r of await (await caches.open(name)).keys()) keys.push(new URL(r.url).pathname);
    return keys;
  });
  expect(cached.length).toBeGreaterThan(0);
  expect(cached.filter((p) => /\/(api|auth)\//.test(p))).toEqual([]);
});
