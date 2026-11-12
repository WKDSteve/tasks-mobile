import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

// Two builds of the same page:
//
// * `vite build` (production): the page the hub serves under its own origin. It speaks to the hub only
//   (`src/lib/hubSource.ts`); the synthetic vault is not in the bundle (`__FAKE__` is false, so the
//   bundler drops the branch, and e2e/bundle.spec.ts checks that).
// * `vite build --mode fake` / `vite --mode fake`: the same page on a synthetic vault in memory, for the
//   browser tests and for working on the page without a hub. Never served to a phone.
//
// Nothing is inlined: the CSP of the hub allows 'self' only (no data: URL, no inline script or style).
export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  base: './',
  define: {
    __FAKE__: JSON.stringify(mode === 'fake'),
    __VERSION__: JSON.stringify(process.env['npm_package_version'] ?? '0.0.0'),
  },
  build: {
    outDir: mode === 'fake' ? 'dist-fake' : 'dist',
    target: 'es2022',
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    sourcemap: false,
    // A phone loads the page over a tunnel: the budget is checked by tools/check-bundle-size.mjs, this is
    // only the warning of the bundler.
    chunkSizeWarningLimit: 200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
}));
