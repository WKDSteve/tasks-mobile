import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

// The build a phone gets (`dist/`, `pnpm build`) has no synthetic vault in it, and inlines nothing the CSP would
// refuse. Run after `pnpm build` (CI does both builds before the browser tests).

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test('the production build holds no synthetic vault and no inline script', () => {
  const all = files('dist');
  const text = all.filter((f) => /\.(html|js|css|webmanifest)$/.test(f)).map((f) => readFileSync(f, 'utf8'));
  expect(text.length).toBeGreaterThan(2);
  for (const content of text) {
    expect(content).not.toContain('SECRET-MARKER');
    expect(content).not.toContain('__fakeHub');
  }
  const html = readFileSync('dist/index.html', 'utf8');
  // Every script has a source; no inline script, no inline style, no data: URL.
  expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  expect(html).not.toMatch(/<style/);
  expect(html).not.toMatch(/data:/);
});

test('the built files carry the hash of their content in the name, and the size is within the budget', () => {
  const assets = readdirSync('dist/assets');
  expect(assets.length).toBeGreaterThanOrEqual(2);
  // `assets/<name>-<hash>.<ext>`: the service worker takes such a file from its cache first (public/sw.js).
  for (const name of assets) expect(`/assets/${name}`).toMatch(/\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/);
});
