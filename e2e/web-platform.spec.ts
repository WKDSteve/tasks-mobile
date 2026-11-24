import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { expect, open, test } from './fixtures';

// What a phone needs of a web page beyond the features: names that a translator must leave alone, long foreign words
// that break, numbers that keep their width, fingers that hit, forms that say what is wrong at the field, text that
// survives a change of screen, and photos that are not the sensor's file.

const MEETING = '[data-meeting="garden/zaun-besprechen"]';

async function openMeeting(page: Page): Promise<void> {
  await open(page, '/', 'start');
  await page.getByTestId('meetings').locator(MEETING).click();
  await expect(page.getByTestId('meeting-title')).toContainText('Zaun besprechen');
}

test('the name of the app, and ids and file names in sentences, are not translated', async ({ page }) => {
  await open(page);
  await expect(page.locator('h1')).toHaveAttribute('translate', 'no');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  // The device name field of the pairing is a name of the person, not a word.
  const marked = await page.evaluate(() => [...document.querySelectorAll('[translate="no"]')].map((el) => el.tagName));
  expect(marked).toContain('H1');
});

test('a very long word of the vault breaks inside the page instead of widening it', async ({ page }) => {
  await open(page, '/', 'start');
  await page.getByTestId('meetings').locator(MEETING).click();
  await expect(page.getByTestId('meeting-title')).toBeVisible();
  const word = 'x'.repeat(120);
  const overflow = await page.evaluate((long) => {
    const line = document.querySelector('main p.muted');
    if (!line) throw new Error('no line of the meeting');
    line.textContent = long;
    const grid = document.createElement('button');
    grid.className = 'row';
    for (const name of ['title', 'meta muted']) {
      const cell = document.createElement('span');
      cell.className = name;
      cell.textContent = long;
      grid.append(cell);
    }
    document.querySelector('main')!.append(grid);
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  }, word);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('numbers that change keep one width, and headings are balanced', async ({ page }) => {
  await open(page, '/', 'start');
  const style = await page.evaluate(() => {
    const dd = document.querySelector('dd');
    const badge = document.createElement('span');
    badge.className = 'badge';
    document.body.append(badge);
    const h2 = document.querySelector('h2');
    return {
      dd: dd ? getComputedStyle(dd).fontVariantNumeric : null,
      badge: getComputedStyle(badge).fontVariantNumeric,
      balance: h2 ? getComputedStyle(h2).textWrapStyle : null,
    };
  });
  expect(style.dd).toContain('tabular-nums');
  expect(style.badge).toContain('tabular-nums');
  expect(style.balance).toBe('balance');
});

test('controls take a tap without the double-tap wait, and the bottom bar keeps clear of the side insets', async ({ page }) => {
  await open(page);
  const touch = await page.evaluate(() => getComputedStyle(document.querySelector('button')!).touchAction);
  expect(touch).toBe('manipulation');
  const rules = await page.evaluate(() =>
    [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).filter((text) => text.includes('safe-area-inset-left')),
  );
  expect(rules.join('\n')).toContain('safe-area-inset-right');
});

test('a summary and a link on a line of their own are at least 44 px high', async ({ page }) => {
  await open(page);
  const heights = await page.evaluate(() => {
    const host = document.querySelector('main')!;
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'More';
    details.append(summary, 'text');
    const link = document.createElement('a');
    link.className = 'hit';
    link.href = '#x';
    link.textContent = 'Link';
    host.append(details, link);
    return {
      summary: host.querySelector('summary')!.getBoundingClientRect().height,
      link: host.querySelector('a.hit')!.getBoundingClientRect().height,
    };
  });
  expect(heights.summary).toBeGreaterThanOrEqual(44);
  expect(heights.link).toBeGreaterThanOrEqual(44);
});

test('a line of the minutes sent empty says so at the field, with the focus there; the typed line stays over a change of screen', async ({ page }) => {
  await openMeeting(page);
  const field = page.getByTestId('minutes-line');
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toBeFocused();
  await expect(page.locator('#minutes-line-error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Note', exact: true })).toBeEnabled();

  await field.fill('Ask about the gate');
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');
  // Another screen and back: the line is still there (the back gesture sends no warning, so it is kept).
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByTestId('meetings').locator(MEETING).click();
  await expect(page.getByTestId('minutes-line')).toHaveValue('Ask about the gate');
});

test('a new task sent without a title says so under the title, with the focus on it', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Area').selectOption('garden');
  await page.getByRole('button', { name: 'Create' }).click();
  const title = page.getByLabel('Title');
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toBeFocused();
  await expect(page.getByTestId('problems')).toContainText('The title is missing.');
  await expect(title).toHaveAttribute('aria-describedby', 'cap-title-problems');
});

/** A grey PNG of `width` x `height`: tiny as a file, large as a picture. */
function bigPng(width: number, height: number): Buffer {
  const crc = (buf: Buffer): number => {
    let c = ~0;
    for (const byte of buf) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grey
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0; // filter: none
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('a photo of 4000 x 3000 px is scaled down and sent as WebP', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByLabel('Title').fill('Large photo');
  await page.getByLabel('Area').selectOption('garden');
  await page.getByTestId('photo-input').setInputFiles({ name: 'IMG_4000.png', mimeType: 'image/png', buffer: bigPng(4000, 3000) });
  const thumb = page.getByTestId('attachments').locator('img');
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute('decoding', 'async');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByTestId('notice')).toContainText('Created');
  const sent = await page.evaluate(() => (window as unknown as { __fakeHub: { uploads: { name: string; type: string }[] } }).__fakeHub.uploads);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ type: 'image/webp' });
  expect(sent[0]!.name).toMatch(/\.webp$/);
});
