import { test as base, expect, type Page } from '@playwright/test';

// Every test fails when the page wrote an error to the console or threw (MTST-06): a refused CSP, a Trusted Types
// violation and a failed request all show up there first.
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    const problems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    await use(page);
    expect(problems, 'console of the page').toEqual([]);
  },
});

export { expect };

/** The page, started and connected to the synthetic vault. */
export async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
}

/** Control the synthetic hub of the page (only in the fake build). */
export async function fakeHub(page: Page, change: { offline?: boolean; loseNextAnswer?: boolean; touch?: string }): Promise<void> {
  await page.evaluate((c) => {
    const hub = (window as unknown as { __fakeHub: { offline: boolean; loseNextAnswer: boolean; touch(id: string): void } }).__fakeHub;
    if (c.offline !== undefined) hub.offline = c.offline;
    if (c.loseNextAnswer !== undefined) hub.loseNextAnswer = c.loseNextAnswer;
    if (c.touch !== undefined) hub.touch(c.touch);
  }, change);
}
