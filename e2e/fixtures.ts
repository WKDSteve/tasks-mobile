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

/**
 * The page, started and connected to the synthetic vault, on the list (`screen: 'list'`, the default) or where it
 * starts by itself ("Today", `screen: 'start'`).
 */
export async function open(page: Page, path = '/', screen: 'list' | 'start' = 'list'): Promise<void> {
  await page.goto(path);
  await expect(page.getByTestId('connection')).toHaveAttribute('data-state', 'live');
  if (screen === 'list') await page.getByRole('button', { name: 'List', exact: true }).click();
}

/** Control the synthetic hub of the page (only in the fake build). */
export async function fakeHub(
  page: Page,
  change: { offline?: boolean; loseNextAnswer?: boolean; loseNextUploadAnswer?: boolean; touch?: string; holdTasks?: boolean; releaseTasks?: boolean; deviceLevel?: string | null },
): Promise<void> {
  await page.evaluate((c) => {
    const hub = (
      window as unknown as {
        __fakeHub: { offline: boolean; loseNextAnswer: boolean; loseNextUploadAnswer: boolean; holdTasks: boolean; deviceLevel: string | null; touch(id: string): void; releaseTasks(): void };
      }
    ).__fakeHub;
    if (c.offline !== undefined) hub.offline = c.offline;
    if (c.loseNextAnswer !== undefined) hub.loseNextAnswer = c.loseNextAnswer;
    if (c.loseNextUploadAnswer !== undefined) hub.loseNextUploadAnswer = c.loseNextUploadAnswer;
    if (c.touch !== undefined) hub.touch(c.touch);
    if (c.holdTasks !== undefined) hub.holdTasks = c.holdTasks;
    if (c.releaseTasks) hub.releaseTasks();
    if (c.deviceLevel !== undefined) hub.deviceLevel = c.deviceLevel;
  }, change);
}
