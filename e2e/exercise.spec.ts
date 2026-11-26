import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, fakeHub, open, test } from './fixtures';

// The exercise of a learning point (rule LP-21) on the phone: the point shows its title and a button instead of its raw
// block; a tap opens a sheet with the task, "done when" and the proof, each named, code as code and no `**` left. Its
// field of the result sends the proof with the state `learned` in one `node_set` (capability `node_result`); without a
// result the sheet says the proof is missing instead of sending a tick the engine would refuse. Offline the tick waits
// in the queue like every other (MOB-07, MOB-08).

async function openPath(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Learn' }).click();
  await page.getByTestId('learn-all-paths').click();
  await page.getByTestId('paths').getByRole('button', { name: /Rust lernen/ }).click();
  await expect(page.getByTestId('path-title')).toContainText('Rust lernen');
}

const writes = (page: Page) => page.evaluate(() => (window as unknown as { __fakeHub: { writes: { op: unknown }[] } }).__fakeHub.writes.map((w) => w.op));

test('an exercise point opens its task as a sheet and is learned with its result', async ({ page }) => {
  await open(page);
  await openPath(page);
  const borrow = page.locator('li[data-point="borrow"]');
  await expect(borrow).toContainText('Übung: Leihen');
  // The block is not shown raw in the list.
  await expect(borrow).not.toContainText('**');
  await expect(borrow).not.toContainText('Schreibe eine Funktion');

  // "Learned" on a point that asks for a proof opens the sheet instead of sending a tick.
  await borrow.getByRole('button', { name: 'Learned' }).click();
  const sheet = page.getByTestId('exercise');
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => el instanceof HTMLDialogElement && el.matches(':modal'))).toBe(true);
  await expect(sheet).not.toHaveAttribute('role', /.+/);
  expect(await sheet.getAttribute('closedby')).toBe('closerequest');
  await expect(sheet.getByRole('heading', { level: 1 })).toHaveText('Task: Übung: Leihen');
  await expect(sheet.locator('[data-part="aufgabe"] dt')).toHaveText('Task');
  await expect(sheet.locator('[data-part="fertig"] dt')).toHaveText('Done when');
  await expect(sheet.locator('[data-part="nachweis"] dt')).toHaveText('Proof');
  await expect(sheet.locator('[data-part="aufgabe"] code')).toHaveText('&str');
  await expect(sheet.locator('[data-part="aufgabe"] strong')).toHaveText('nicht');
  await expect(sheet.locator('[data-part="fertig"] code')).toHaveText('cargo test');
  await expect(sheet.locator('[data-part="nachweis"] dd')).toHaveText('Link zum Commit.');
  await expect(sheet).not.toContainText('**');
  await expect(sheet).not.toContainText('`');

  // The focus is on Close, not in the field: on a phone the keyboard would come up over the task to be read. The field
  // has a font of at least 16 px: Chrome on a phone does not zoom into it.
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
  const field = sheet.getByTestId('exercise-result');
  await expect(field).not.toBeFocused();
  expect(parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);

  // Sent without a result: said at the field, the focus there, nothing sent, the point still open.
  const send = sheet.getByRole('button', { name: 'Save with the result as learned' });
  await send.click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(sheet.getByRole('alert')).toHaveText('The proof is missing: enter your result first.');
  await expect(field).toBeFocused();
  expect(await writes(page)).toEqual([]);
  await expect(borrow).toHaveAttribute('data-state', 'open');

  // A close request (Esc, the back gesture) keeps what was typed for the next time.
  await field.fill('https://example.org/commit/1');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await borrow.getByRole('button', { name: 'Task', exact: true }).click();
  await expect(page.getByTestId('exercise-result')).toHaveValue('https://example.org/commit/1');

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => `${scheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  }

  await page.getByTestId('exercise').getByRole('button', { name: 'Save with the result as learned' }).click();
  await expect(page.getByTestId('exercise')).toHaveCount(0);
  await expect(borrow).toHaveAttribute('data-state', 'learned');
  expect(await writes(page)).toEqual([
    { op: 'node_set', id: 'garden/lernpfad-rust', point: 'borrow', state: 'learned', result: 'https://example.org/commit/1', if_match: 'e1' },
  ]);

  // Opened again: the result the engine wrote is shown, no field for a point that is closed.
  await borrow.getByRole('button', { name: 'Task', exact: true }).click();
  await expect(page.getByTestId('exercise').locator('[data-part="ergebnis"] dd')).toHaveText('https://example.org/commit/1');
  await expect(page.getByTestId('exercise-result')).toHaveCount(0);
  await expect(page.getByTestId('exercise').getByRole('button', { name: 'Close' })).toBeFocused();
});

test('offline, the result of an exercise waits in the queue with its tick and is sent later (MOB-08)', async ({ page }) => {
  await open(page);
  await openPath(page);
  await fakeHub(page, { offline: true });
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'offline');
  const borrow = page.locator('li[data-point="borrow"]');
  await borrow.getByRole('button', { name: 'Task', exact: true }).click();
  await page.getByTestId('exercise-result').fill('cargo test grün');
  await page.getByTestId('exercise').getByRole('button', { name: 'Save with the result as learned' }).click();
  await expect(page.getByTestId('queue-count')).toHaveText('1');
  expect(await writes(page)).toEqual([]);

  await fakeHub(page, { offline: false });
  await page.getByRole('button', { name: /Waiting/ }).click();
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  expect(await writes(page)).toEqual([
    { op: 'node_set', id: 'garden/lernpfad-rust', point: 'borrow', state: 'learned', result: 'cargo test grün', if_match: 'e1' },
  ]);
});
