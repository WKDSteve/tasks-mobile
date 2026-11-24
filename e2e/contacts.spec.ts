import AxeBuilder from '@axe-core/playwright';
import { expect, open, test } from './fixtures';

// The contacts on the phone: the areas it shows (a contact of a private area never reaches the page), one contact with
// its numbers as `tel:` and its addresses as `mailto:` links where the hub gave them, none where it did not, and the
// form that writes a new contact and a change through the queue (MOB-07). No address and no number is in a notice.
test('the contacts: a public one is called and mailed, an internal one has no data, a private one is not there', async ({ page }) => {
  await open(page, '/', 'start');
  await page.getByTestId('open-contacts').click();
  const list = page.getByTestId('contacts');
  await expect(list.locator('[data-contact="garden/anna-berger"]')).toBeVisible();
  await expect(list.locator('[data-contact="kitchen/ben-huber"]')).toBeVisible();
  const html = await page.content();
  for (const word of ['SECRET-MARKER', 'example.org', '1234567']) expect(html, word).not.toContain(word);

  await page.getByTestId('contacts-search').fill('zaun');
  await expect(list.locator('[data-contact]')).toHaveCount(1);
  await page.getByTestId('contacts-search').fill('');

  await list.locator('[data-contact="garden/anna-berger"]').click();
  await expect(page.getByTestId('contact-name')).toContainText('Anna Berger');
  await expect(page.getByTestId('tel')).toHaveAttribute('href', 'tel:+491701234567');
  await expect(page.getByTestId('mailto')).toHaveAttribute('href', 'mailto:anna@example.org');
  await expect(page.getByText('Liefert Holz.')).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);

  await page.getByRole('button', { name: /Contacts/ }).first().click();
  await list.locator('[data-contact="kitchen/ben-huber"]').click();
  await expect(page.getByTestId('contact-name')).toContainText('Ben Huber');
  await expect(page.getByTestId('reach')).toHaveCount(0);
  expect(await page.content()).not.toContain('ben@example.org');
});

test('a contact is made and changed through the form; a bad address is a problem of the field', async ({ page }) => {
  await open(page, '/', 'start');
  await page.getByTestId('open-contacts').click();
  await page.getByTestId('contact-new').click();
  await page.getByTestId('contact-area').selectOption('garden');
  await page.getByTestId('contact-field-name').fill('Cora Roth');
  await page.getByTestId('contact-field-emails').fill('not-an-address');
  await page.getByTestId('contact-save').click();
  await expect(page.getByTestId('contact-problems')).toContainText('An address is not one.');
  expect(await page.getByTestId('contact-problems').innerText()).not.toContain('not-an-address');
  await page.getByTestId('contact-field-emails').fill('cora@example.org');
  await page.getByTestId('contact-field-phones').fill('+49 30 998877');
  await page.getByTestId('contact-save').click();
  const list = page.getByTestId('contacts');
  await expect(list.locator('[data-contact="garden/cora-roth"]')).toBeVisible();

  await list.locator('[data-contact="garden/cora-roth"]').click();
  await expect(page.getByTestId('mailto')).toHaveAttribute('href', 'mailto:cora@example.org');
  await page.getByTestId('contact-edit').click();
  await page.getByTestId('contact-field-emails').fill('cora@example.com');
  await page.getByTestId('contact-save').click();
  await expect(page.getByTestId('mailto')).toHaveAttribute('href', 'mailto:cora@example.com');
  // The notice (if any) names no address and no number.
  const notice = page.getByTestId('notice');
  if ((await notice.count()) > 0) expect(await notice.innerText()).not.toMatch(/example|998877/);
});
