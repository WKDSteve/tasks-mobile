// The size of what a phone loads at the start (the page, its script, its style), checked in the CI: the phone loads it
// over a tunnel, so growth is a decision, not an accident. The budget is the size measured on 2026-11-24 plus 10 % (what a build gave, not a guess);
// a change that outgrows it raises the numbers here on purpose (and says why in its commit), or cuts something.
//
//   node tools/check-bundle-size.mjs [dist-dir]      checks (exit 1 over the budget)
//   node tools/check-bundle-size.mjs --measure       prints the sizes, to set a new budget

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Measured 2026-11-24 (`--measure`, with the service worker, which is also a script of the start): 256,938 B raw and
 * 77,211 B gzip, in html, css, the script of the page and `sw.js`. Plus 10 %, rounded up.
 */
export const BUDGET = { rawBytes: 283_000, gzipBytes: 85_000 };

const START = new Set(['.html', '.js', '.css']);

/** The files of `dir` that a phone loads at the start, with their raw and gzip sizes. */
export function measure(dir) {
  const files = [];
  const walk = (folder) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (START.has(extname(name))) {
        const bytes = readFileSync(path);
        files.push({ path: path.slice(dir.length + 1), raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length });
      }
    }
  };
  walk(dir);
  return files;
}

/** The totals, and whether they are within `budget`. */
export function judge(files, budget = BUDGET) {
  const raw = files.reduce((n, f) => n + f.raw, 0);
  const gzip = files.reduce((n, f) => n + f.gzip, 0);
  return { raw, gzip, ok: raw <= budget.rawBytes && gzip <= budget.gzipBytes };
}

if (process.argv[1]?.endsWith('check-bundle-size.mjs')) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? 'dist';
  const files = measure(dir);
  if (files.length === 0) {
    console.error(`no start files in ${dir}: build first (pnpm build)`);
    process.exit(2);
  }
  const total = judge(files);
  for (const f of files) console.log(`${f.path.padEnd(32)} ${String(f.raw).padStart(8)} B  ${String(f.gzip).padStart(7)} B gzip`);
  console.log(`${'total'.padEnd(32)} ${String(total.raw).padStart(8)} B  ${String(total.gzip).padStart(7)} B gzip   budget ${BUDGET.rawBytes} / ${BUDGET.gzipBytes}`);
  if (!args.includes('--measure') && !total.ok) {
    console.error('over the budget: cut something, or raise BUDGET in tools/check-bundle-size.mjs and say why');
    process.exit(1);
  }
}
