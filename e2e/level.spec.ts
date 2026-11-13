import { expect, fakeHub, open, test } from './fixtures';

// The PC sets what a device may do (`tasks-hub devices level`); the page asks the hub at each load and offers only that.
test('a device lowered to read is offered no status, no finishing and no new task, and told why', async ({ page }) => {
  await open(page);
  await page.locator('[data-id="garden/water-the-plants"]').click();
  await expect(page.getByRole('button', { name: 'Set status', exact: true })).toBeVisible();

  await fakeHub(page, { deviceLevel: 'read' });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
  await expect(page.getByTestId('no-change')).toContainText('level read');
  await expect(page.getByRole('button', { name: 'Set status', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByTestId('no-create')).toBeVisible();
  await expect(page.locator('#cap-title')).toHaveCount(0);
});

test('a device at create may create, without photos or voice notes', async ({ page }) => {
  await open(page);
  await fakeHub(page, { deviceLevel: 'create' });
  await page.getByRole('button', { name: 'Reload', exact: true }).click();
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.locator('#cap-title')).toBeVisible();
  await expect(page.getByTestId('no-files')).toBeVisible();
  await expect(page.getByTestId('voice-start')).toHaveCount(0);
});
