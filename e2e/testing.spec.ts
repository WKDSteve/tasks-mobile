import AxeBuilder from '@axe-core/playwright';
import { expect, fakeHub, open, test } from './fixtures';

// The test sheets of a task, run on the PC by the testing hub through the tasks hub: shown in the task, started only
// after a confirmation in a dialog and at the level `trigger`, then followed.
test('the sheets of a task are run on the PC after a confirmation, and the run is followed', async ({ page }) => {
  await open(page);
  await fakeHub(page, { deviceLevel: 'trigger' });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
  await page.locator('[data-id="garden/water-the-plants"]').click();
  await expect(page.getByTestId('sheets')).toContainText('watering.sheet.lua');

  await page.getByRole('button', { name: 'Run on the PC', exact: true }).click();
  await expect(page.getByTestId('run-confirm')).toBeVisible();
  // Cancelling starts nothing.
  await page.getByTestId('run-confirm').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Run on the PC', exact: true }).click();
  await page.getByTestId('run-confirm').getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByTestId('notice')).toHaveText('Run started on the PC.');
  await expect(page.getByTestId('run-state')).toHaveAttribute('data-verdict', 'green', { timeout: 10_000 });
  const starts = await page.evaluate(
    () => (window as unknown as { __fakeHub: { testingStarts: { id: string; confirm: string }[] } }).__fakeHub.testingStarts,
  );
  expect(starts).toEqual([{ id: 'garden/water-the-plants', confirm: 'fake-confirmation' }]);
});

test('below trigger the sheets are shown, with why they cannot be started here', async ({ page }) => {
  await open(page);
  await page.locator('[data-id="garden/water-the-plants"]').click();
  await expect(page.getByTestId('sheets')).toContainText('hoses.sheet.lua');
  await expect(page.getByTestId('no-trigger')).toContainText('level change');
  await expect(page.getByRole('button', { name: 'Run on the PC', exact: true })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`a run that wrote no task says so, with the word of the block (${scheme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page);
    await fakeHub(page, {
      deviceLevel: 'trigger',
      runEnd: { verdict: 'not_written', exit: 1, sheets_red: false, block: { written: false, outcome: 'missing' } },
    });
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
    await page.locator('[data-id="garden/water-the-plants"]').click();
    await page.getByRole('button', { name: 'Run on the PC', exact: true }).click();
    await page.getByTestId('run-confirm').getByRole('button', { name: 'Run', exact: true }).click();
    const state = page.getByTestId('run-state');
    await expect(state).toHaveAttribute('data-verdict', 'not_written', { timeout: 10_000 });
    await expect(state).toHaveText('Sheets green, task not written');
    await expect(page.getByTestId('run-block')).toHaveText('Not written into the task (missing).');
    await page.getByTestId('sheets').screenshot({ path: info.outputPath(`run-not-written-${scheme}.png`) });
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });
}
