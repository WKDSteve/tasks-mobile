import AxeBuilder from '@axe-core/playwright';
import { expect, open, test } from './fixtures';

// The learning paths on the phone: the list of the shown areas (a path of a private area never reaches the page), one
// path as a tree, a point ticked as learned and another as looked at with a reason; the tree shows it once the engine
// said yes (MOB-07).
test('lists the learning paths, opens one and ticks its points', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Learn' }).click();
  const list = page.getByTestId('paths');
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list).toContainText('Rust lernen');
  await expect(list).toContainText('0 of 3 points');
  expect(await page.content()).not.toContain('SECRET-MARKER');
  await list.getByRole('button', { name: /Rust lernen/ }).click();

  await expect(page.getByTestId('path-title')).toContainText('Rust lernen');
  const book = page.locator('[data-point="book"]');
  await expect(book.getByRole('link', { name: 'The Book lesen' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(book).toContainText('Kapitel 1 bis 4');
  await book.getByRole('button', { name: 'Learned' }).click();
  await expect(book).toHaveAttribute('data-state', 'learned');

  const rustlings = page.locator('[data-point="rustlings"]');
  await rustlings.getByRole('button', { name: 'Looked at' }).click();
  const save = rustlings.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await rustlings.getByTestId('point-reason').fill('kenne ich schon');
  await save.click();
  await expect(rustlings).toHaveAttribute('data-state', 'seen');
  await expect(rustlings).toContainText('kenne ich schon');
  // Both leaves below "Grundlagen" are closed: so is the point above them.
  await expect(page.locator('[data-point="basics"]')).toHaveAttribute('data-state', 'learned');

  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});
