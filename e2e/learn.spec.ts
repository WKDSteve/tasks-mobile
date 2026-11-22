import AxeBuilder from '@axe-core/playwright';
import { expect, open, test } from './fixtures';

// The page Lernen on the phone (synthetic vault): the tile My learning with its period by radios (kept on the device),
// the figures against as many days of the period before in words with a mark, and the next step of the running path,
// ticked on the way: learned at once, seen with a reason; the tile counts it once the engine said yes (MOB-07). A
// path of a private area never reaches the page. axe in both themes.
test('the page Lernen: the period, the figures in words, a step ticked learned and one seen with a reason', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Learn' }).click();
  await expect(page.getByRole('heading', { name: 'Learn', level: 2 })).toBeVisible();
  const mine = page.getByRole('region', { name: 'My learning' });
  const period = mine.getByRole('group', { name: 'Period' });
  await expect(period.getByRole('radio')).toHaveCount(5);
  await expect(period.getByRole('radio', { name: 'Week' })).toBeChecked();
  expect(await page.content()).not.toContain('SECRET-MARKER');

  await period.getByRole('radio', { name: 'Today' }).check();
  const learned = mine.locator('[data-fig="learned"]');
  await expect(learned.locator('dd.big')).toHaveText('0');
  await expect(learned.locator('dd.cmp')).toContainText('same as yesterday');

  const steps = page.getByTestId('learn-steps');
  const step = steps.locator('li[data-step="garden/lernpfad-rust"]');
  await expect(step).toContainText('The Book lesen');
  await expect(step.getByRole('link', { name: 'The Book lesen' })).toHaveAttribute('rel', 'noopener noreferrer');
  await step.getByRole('button', { name: 'Learned: The Book lesen' }).click();
  // the next point of the path is next, and today counts the one ticked
  await expect(step).toContainText('Rustlings');
  await expect(learned.locator('dd.big')).toHaveText('1');
  await expect(learned.locator('dd.cmp')).toHaveText(/▲\s+\+1 vs yesterday/);
  await expect(learned.locator('dd.cmp [aria-hidden="true"]')).toHaveText('▲');

  await step.getByRole('button', { name: 'Seen: Rustlings' }).click();
  const save = step.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await step.getByLabel('Why only seen?').fill('kenne ich schon');
  await save.click();
  await expect(step).toContainText('Async verstehen');

  // a point under {safety}: a yes first, then the reason; Cancel leaves it open
  await expect(step).toContainText('Safety: confirm first');
  await step.getByRole('button', { name: 'Learned: Async verstehen' }).click();
  await expect(step.getByRole('group', { name: 'This point concerns safety. Mark it learned?' })).toBeVisible();
  await step.getByRole('button', { name: 'Cancel' }).click();
  await step.getByRole('button', { name: 'Seen: Async verstehen' }).click();
  await step.getByRole('button', { name: 'Yes, mark it' }).click();
  await step.getByLabel('Why only seen?').fill('nur gelesen');
  await step.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('learn-steps-none')).toBeVisible();
  // the figures stand in one live region that stays
  await expect(mine.getByTestId('learn-live')).toHaveAttribute('aria-live', 'polite');

  // kept on the device
  await page.reload();
  await page.getByRole('button', { name: 'Learn' }).click();
  await expect(page.getByRole('region', { name: 'My learning' }).getByRole('radio', { name: 'Today' })).toBeChecked();

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // the paths are one tap away
  await page.getByTestId('learn-all-paths').click();
  await expect(page.getByTestId('paths')).toContainText('Rust lernen');
});
