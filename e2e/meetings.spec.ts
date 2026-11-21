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

/** The smallest PNG: one pixel. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5ad6f0b0000000049454e44ae426082',
  'hex',
);

type FakeUpload = { id: string; name: string; kind?: string };

async function openFence(page: import('@playwright/test').Page): Promise<void> {
  await open(page, '/', 'start');
  await page.getByTestId('meetings').locator('[data-meeting="garden/zaun-besprechen"]').click();
  await expect(page.getByTestId('meeting-title')).toContainText('Zaun besprechen');
}

// A photo from the camera and a voice note go into the minutes: the file to the meeting (as an image or an audio file),
// then the line that names it; the minutes show it by the name of its file once the engine wrote it (MOB-07).
test('a photo and a voice note of a meeting go into its minutes', async ({ page }) => {
  await openFence(page);
  await expect(page.getByTestId('meeting-photo-input')).toHaveAttribute('capture', 'environment');
  await page.getByTestId('meeting-photo-input').setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('minutes')).toContainText(/Photo: photo-\d{4}-\d{2}-\d{2}-\d{4}-[A-Za-z0-9]{6}\.png/);
  await page.getByTestId('meeting-voice').click();
  await expect(page.getByTestId('meeting-voice-stop')).toContainText('Stop recording');
  await page.waitForTimeout(1200);
  await page.getByTestId('meeting-voice-stop').click();
  await expect(page.getByTestId('minutes')).toContainText(/Voice note: voice-.*\.webm/);
  const sent = await page.evaluate(() => (window as unknown as { __fakeHub: { uploads: FakeUpload[] } }).__fakeHub.uploads);
  expect(sent.map((u) => [u.id, u.kind])).toEqual([
    ['garden/zaun-besprechen', 'image'],
    ['garden/zaun-besprechen', 'audio'],
  ]);
  // The link to the file is the engine's: the page shows the name, never a path of the vault as a link.
  await expect(page.getByTestId('minutes').locator('a')).toHaveCount(0);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
});

// The participants of a public meeting are names only (no address); a tick goes through the queue and shows once the
// hub answered. The internal meeting gives none here (the PC did not release them).
test('a participant of a meeting is ticked present by name', async ({ page }) => {
  await openFence(page);
  const people = page.getByTestId('participants');
  await expect(people).toContainText('Anna Berger');
  expect(await page.content()).not.toContain('anna@example.org');
  const anna = page.getByRole('checkbox', { name: 'Anna Berger present' });
  await expect(anna).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Ben Huber present' })).toBeChecked();
  // The box shows what the hub said, not the click: it is ticked once the engine wrote it.
  await anna.click();
  await expect(anna).toBeChecked();
  const writes = await page.evaluate(() => (window as unknown as { __fakeHub: { writes: { op: unknown }[] } }).__fakeHub.writes.map((w) => w.op));
  expect(writes).toEqual([{ op: 'meeting_attend', id: 'garden/zaun-besprechen', name: 'Anna Berger', present: true }]);
  await page.getByRole('button', { name: '← Meetings' }).click();
  await page.locator('[data-meeting="kitchen/einkauf-planen"]').first().click();
  await expect(page.getByTestId('meeting-title')).toContainText('Einkauf planen');
  await expect(page.getByTestId('participants')).toHaveCount(0);
});

// A tapped notice of the scheduler (`meeting`, `meeting_end`) opens the page on the meeting, and the id leaves the
// address (PWA-06); an id that is no meeting of the page opens nothing.
test('a tapped notice of a meeting opens the meeting, and the id leaves the address', async ({ page }) => {
  await open(page, '/?meeting=garden%2Fzaun-besprechen', 'start');
  await expect(page.getByTestId('meeting-title')).toContainText('Zaun besprechen');
  expect(new URL(page.url()).search).toBe('');
  await open(page, '/?meeting=vault-secret%2Fgeheim', 'start');
  expect(new URL(page.url()).search).toBe('');
  await expect(page.getByTestId('notice')).toContainText('meeting of the notification');
  expect(await page.content()).not.toContain('SECRET-MARKER');
});
