import { describe, expect, it } from 'vitest';
import { everyOf, intervalsOf, roundOf, waitsFor } from './routine';

describe('a routine as the engine wrote it', () => {
  it('splits a ladder into its intervals and says the round of it', () => {
    expect(intervalsOf('1w,4w,12w')).toEqual(['1w', '4w', '12w']);
    expect(intervalsOf(undefined)).toEqual([]);
    expect(everyOf('1w,4w,12w')).toBe('1w, 4w, 12w');
    expect(roundOf({ repeat: '1w,4w,12w', repeatStep: 2 })).toEqual({ step: 2, of: 3 });
    // No step is round 1; a single interval is no ladder, so it has no round to say.
    expect(roundOf({ repeat: '1w,4w' })).toEqual({ step: 1, of: 2 });
    expect(roundOf({ repeat: '8w', repeatStep: 1 })).toBeNull();
    expect(roundOf({})).toBeNull();
  });

  it('waits only while it has a reference and no due date', () => {
    expect(waitsFor({ repeatAfter: 'garden/p', due: null })).toBe('garden/p');
    expect(waitsFor({ repeatAfter: 'garden/p', due: '2026-03-01' })).toBeNull();
    expect(waitsFor({ due: null })).toBeNull();
  });
});
