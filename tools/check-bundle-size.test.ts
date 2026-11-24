import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script of the tools folder, without types
import { BUDGET, judge } from './check-bundle-size.mjs';

describe('the size budget of the start', () => {
  it('passes at the budget and fails one byte over it, raw or gzip', () => {
    expect(judge([{ path: 'a.js', raw: BUDGET.rawBytes, gzip: BUDGET.gzipBytes }]).ok).toBe(true);
    expect(judge([{ path: 'a.js', raw: BUDGET.rawBytes + 1, gzip: 1 }]).ok).toBe(false);
    expect(judge([{ path: 'a.js', raw: 1, gzip: BUDGET.gzipBytes + 1 }]).ok).toBe(false);
  });

  it('adds the files up', () => {
    expect(judge([{ path: 'a', raw: 3, gzip: 1 }, { path: 'b', raw: 4, gzip: 2 }], { rawBytes: 7, gzipBytes: 3 })).toEqual({ raw: 7, gzip: 3, ok: true });
  });
});
