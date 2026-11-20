import AxeBuilder from '@axe-core/playwright';
import { expect, open, test } from './fixtures';

// The meetings on the phone: Today names the coming ones of the shown areas (a meeting of a private area never reaches
// the page), one opens with Join where the hub let the address out, and a line of the minutes is written through the
// queue and shown once the engine wrote it (MOB-07).
test('Today names the coming meetings; one is opened, joined and a task is written into its minutes', async ({ page }) => {
  await open(page, '/', 'start');
  const block = page.getByTestId('meetings');
  await expect(block.locator('[data-meeting="kitchen/einkauf-planen"]')).toBeVisible();
  await expect(block.locator('[data-meeting="garden/zaun-besprechen"]')).toBeVisible();
  expect(await page.content()).not.toContain('SECRET-MARKER');

  await block.locator('[data-meeting="garden/zaun-besprechen"]').click();
  await expect(page.getByTestId('meeting-title')).toContainText('Zaun besprechen');
  await expect(page.getByTestId('join')).toHaveAttribute('href', 'https://meet.jit.si/zaun');
  await expect(page.getByTestId('join')).toHaveAttribute('rel', 'noopener noreferrer');

  await page.getByTestId('minutes-line').fill('Angebot einholen');
  await page.getByRole('button', { name: 'Task', exact: true }).click();
  await expect(page.getByTestId('minutes')).toContainText('Aufgabe: Angebot einholen');
  await expect(page.getByTestId('minutes-line')).toHaveValue('');

  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
