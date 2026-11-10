import { expect, fakeHub, open, test } from './fixtures';
import type { Page } from '@playwright/test';

// A capture with a photo or a voice note: shown before the task is made, kept with it offline, sent to the id the
// engine gave, and a file the hub refused waits visibly (the task stays).

/** The smallest PNG: one pixel. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5ad6f0b0000000049454e44ae426082',
  'hex',
);

async function uploads(page: Page): Promise<{ id: string; name: string; type: string; size: number }[]> {
  return page.evaluate(() => (window as unknown as { __fakeHub: { uploads: { id: string; name: string; type: string; size: number }[] } }).__fakeHub.uploads);
}

async function newCapture(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Area').selectOption('garden');
}

async function addPhoto(page: Page, name = 'IMG_0001.png', buffer = PNG): Promise<void> {
  await page.getByTestId('photo-input').setInputFiles({ name, mimeType: 'image/png', buffer });
}

test('a photo is shown before the task is made, and sent to the task the engine made', async ({ page }) => {
  await open(page);
  await newCapture(page, 'Photo of the fence');
  await addPhoto(page);
  await expect(page.getByTestId('attachments').locator('img')).toBeVisible();
  // The preview is a blob of the page, under the hub's policy.
  expect(await page.getByTestId('attachments').locator('img').getAttribute('src')).toMatch(/^blob:/);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('notice')).toContainText('Created: “Photo of the fence”');
  const sent = await uploads(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ id: 'garden/photo-of-the-fence', type: 'image/png', size: PNG.length });
  // The name is the page's own, not the phone's file name.
  expect(sent[0]!.name).toMatch(/^photo-\d{4}-\d{2}-\d{2}-\d{4}\.png$/);
  await expect(page.getByTestId('attachments')).toHaveCount(0);
});

test('a voice note is recorded only on the button, can be heard before, and is sent with the task (AND-01)', async ({ page }) => {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const original = md.getUserMedia.bind(md);
    (window as unknown as { __micAsked: number }).__micAsked = 0;
    md.getUserMedia = (c) => {
      (window as unknown as { __micAsked: number }).__micAsked += 1;
      return original(c);
    };
  });
  await open(page);
  await newCapture(page, 'Voice about the tap');
  expect(await page.evaluate(() => (window as unknown as { __micAsked: number }).__micAsked)).toBe(0);
  await page.getByTestId('voice-start').click();
  await expect(page.getByTestId('voice-stop')).toContainText('Stop recording');
  await page.waitForTimeout(1500);
  await page.getByTestId('voice-stop').click();
  await expect(page.getByTestId('attachments').locator('audio')).toBeVisible();
  expect(await page.getByTestId('attachments').locator('audio').getAttribute('src')).toMatch(/^blob:/);
  expect(await page.evaluate(() => (window as unknown as { __micAsked: number }).__micAsked)).toBe(1);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('notice')).toContainText('Created');
  const sent = await uploads(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.id).toBe('garden/voice-about-the-tap');
  expect(sent[0]!.name).toMatch(/^voice-.*\.webm$/);
  expect(sent[0]!.size).toBeGreaterThan(0);
});

test('offline the file waits with the task and is sent after it (MOB-08)', async ({ page }) => {
  await open(page);
  await fakeHub(page, { offline: true });
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'offline');
  await newCapture(page, 'Seeds offline');
  await addPhoto(page);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('queue-count')).toHaveText('1');
  await page.getByRole('button', { name: /Waiting/ }).click();
  await expect(page.getByTestId('queue')).toContainText('New: Seeds offline, with 1 attachments');
  expect(await uploads(page)).toEqual([]);
  await fakeHub(page, { offline: false });
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  expect((await uploads(page)).map((u) => u.id)).toEqual(['garden/seeds-offline']);
  // The file is gone from the phone once it was taken.
  const kept = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('tasks-mobile-files', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('files');
        req.onsuccess = () => {
          const count = req.result.transaction('files', 'readonly').objectStore('files').count();
          count.onsuccess = () => resolve(count.result);
        };
      }),
  );
  expect(kept).toBe(0);
});

test('a file the hub refused waits visibly; the task stays and the file can be sent again', async ({ page }) => {
  await open(page);
  await page.evaluate(() => ((window as unknown as { __fakeHub: { refuseNextUpload: boolean } }).__fakeHub.refuseNextUpload = true));
  await newCapture(page, 'Refused photo');
  await addPhoto(page);
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('notice')).toContainText('An attachment has not reached the PC yet');
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page.locator('[data-id="garden/refused-photo"]')).toBeVisible();
  await page.getByRole('button', { name: /Waiting/ }).click();
  await expect(page.getByTestId('queue').locator('li[data-state="refused"]')).toContainText('Refused photo: attachment photo-');
  await page.getByRole('button', { name: 'Send again' }).click();
  await expect(page.getByText('Nothing waits.')).toBeVisible();
  expect((await uploads(page)).map((u) => u.id)).toEqual(['garden/refused-photo']);
});

test('names the limits of the files and takes none beyond them', async ({ page }) => {
  await open(page);
  await newCapture(page, 'Too much');
  await addPhoto(page, 'big.png', Buffer.alloc(25 * 1024 * 1024 + 1, 1));
  await expect(page.getByTestId('file-problem')).toContainText('The file is too large (at most 25.0 MB).');
  await expect(page.getByTestId('attachments')).toHaveCount(0);
  await page.getByTestId('photo-input').setInputFiles({ name: 'page.html', mimeType: 'text/html', buffer: Buffer.from('<b>x</b>') });
  await expect(page.getByTestId('file-problem')).toContainText('Photos and voice notes only.');
  for (let i = 0; i < 3; i += 1) await addPhoto(page, `p${i}.png`);
  await expect(page.getByTestId('attachments').locator('li')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Photo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove attachment' }).first().click();
  await expect(page.getByTestId('attachments').locator('li')).toHaveCount(2);
});
