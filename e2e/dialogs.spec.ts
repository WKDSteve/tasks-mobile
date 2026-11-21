import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, fakeHub, open, test } from './fixtures';

// The two confirmations of a task (finish it, run its sheets on the PC) are native modal <dialog>s (MUI-01). The
// browser closes them on Esc and on the back gesture of Android (a close request); a tap beside them neither confirms
// nor discards (`closedby` is never `any`). The back gesture itself cannot be made in Chrome on a desktop: the list of
// the acceptance on a real phone is in the report of the task; `requestClose()` is the same close request.

async function openDonePreview(page: Page): Promise<void> {
  await open(page);
  await page.locator('[data-id="kitchen/fix-the-tap"]').click();
  await page.getByRole('button', { name: 'Finish …' }).click();
  await expect(page.getByTestId('done-preview')).toBeVisible();
}

async function openRunConfirm(page: Page): Promise<void> {
  await open(page);
  await fakeHub(page, { deviceLevel: 'trigger' });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
  await page.locator('[data-id="garden/water-the-plants"]').click();
  await page.getByRole('button', { name: 'Run on the PC', exact: true }).click();
  await expect(page.getByTestId('run-confirm')).toBeVisible();
}

async function openForgetConfirm(page: Page): Promise<void> {
  await open(page);
  await fakeHub(page, { offline: true });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Title').fill('Kept while the dialog is open');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: /Waiting/ }).click();
  await page.getByRole('button', { name: 'Disconnect and delete the data' }).click();
  await expect(page.getByTestId('forget-confirm')).toBeVisible();
}

const starts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __fakeHub: { testingStarts: unknown[] } }).__fakeHub.testingStarts);

// What is still there after a close request: the task page, or the waiting write that disconnecting would delete.
const stays = {
  task: async (page: Page) => {
    await expect(page.getByTestId('task-title')).toBeVisible();
    await expect(page.getByTestId('notice')).toHaveCount(0);
  },
  queue: (page: Page) => expect(page.getByTestId('queue-count')).toHaveText('1'),
};

for (const [name, show, id, still] of [
  ['the finish preview', openDonePreview, 'done-preview', stays.task],
  ['the run confirmation', openRunConfirm, 'run-confirm', stays.task],
  ['the disconnect confirmation', openForgetConfirm, 'forget-confirm', stays.queue],
] as const) {
  test(`${name} is a modal dialog that only a close request or its buttons close`, async ({ page }) => {
    await show(page);
    const dialog = page.getByTestId(id);
    // A native modal: the browser says so, and no hand-made role or focus trap is left.
    expect(await dialog.evaluate((el) => el instanceof HTMLDialogElement && el.matches(':modal'))).toBe(true);
    await expect(dialog).not.toHaveAttribute('role', /.+/);
    expect(await dialog.getAttribute('closedby')).toBe('closerequest');
    // The cancel button has the focus, not the button that confirms.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
    // A tap on the backdrop neither confirms nor discards.
    await page.mouse.click(2, 2);
    await expect(dialog).toBeVisible();
    // Esc is a close request: cancelled, nothing started or finished.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await starts(page)).toEqual([]);
    await still(page);
  });

  test(`${name} closes on a close request like the back gesture (requestClose)`, async ({ page }) => {
    await show(page);
    const dialog = page.getByTestId(id);
    await dialog.evaluate((el) => (el as HTMLDialogElement).requestClose());
    await expect(dialog).toHaveCount(0);
    expect(await starts(page)).toEqual([]);
    await still(page);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`${name} passes axe (${scheme})`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await show(page);
      await page.screenshot({ path: info.outputPath(`${id}-${scheme}.png`) });
      const axe = await new AxeBuilder({ page }).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    });
  }
}
