import { readFileSync } from 'node:fs';
import { expect, open, test } from './fixtures';

// The third way to the vault: an export file of `tasks-hub phone export`, opened on the phone, read only. The example
// is synthetic; its time is set to now, as a kept list older than 14 days is not shown (MOB-08).
const example = JSON.parse(readFileSync(new URL('./phone-export.example.json', import.meta.url), 'utf8')) as Record<string, unknown>;

function exportFile(over: Record<string, unknown> = {}): { name: string; mimeType: string; buffer: Buffer } {
  const doc = { ...example, exported_at: new Date().toISOString(), ...over };
  return { name: 'tasks-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) };
}

test('an export file is shown with its time, and creating says it needs the PC', async ({ page }) => {
  await open(page, '/', 'start');
  await page.getByRole('button', { name: 'Waiting', exact: true }).click();
  await page.getByTestId('export-file').setInputFiles(exportFile());
  await expect(page.getByTestId('notice')).toHaveText('Export file opened: 2 tasks, read only.');
  await expect(page.getByTestId('from-file')).toContainText('From a file: as of');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.getByTestId('task-list').getByRole('button')).toHaveCount(2);
  await expect(page.locator('[data-id="orchard/prune-the-apple-trees"]')).toBeVisible();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByTestId('file-read-only')).toBeVisible();
});

test('an export file with an area of another class is refused whole', async ({ page }) => {
  await open(page, '/', 'start');
  await page.getByRole('button', { name: 'Waiting', exact: true }).click();
  const areas = [...(example['areas'] as unknown[]), { name: 'diary', data_class: 'private' }];
  await page.getByTestId('export-file').setInputFiles(exportFile({ areas }));
  await expect(page.getByTestId('notice')).toContainText('may not be on the phone');
  await expect(page.getByTestId('from-file')).toHaveCount(0);
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('[data-id="orchard/prune-the-apple-trees"]')).toHaveCount(0);
});
