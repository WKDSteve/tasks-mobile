import { describe, expect, it } from 'vitest';
import { changeOf, knownDays, knowsAll, localDay, mondayOf, parsePeriod, periodFrame, sumSpan } from './learn';
import type { LearnDay } from './types';

const day = (date: string, learned: number, seen = 0, xp = 0, doneH = 0): LearnDay => ({ date, learned, seen, xp, doneH, learning: learned + seen > 0 });

describe('periodFrame: the period and as many days of the one before', () => {
  it('today against yesterday; a week from Monday against the same weekdays of the week before', () => {
    expect(periodFrame('day', '2026-11-18')).toEqual({
      current: { since: '2026-11-18', until: '2026-11-18' },
      previous: { since: '2026-11-17', until: '2026-11-17' },
      ask: { since: '2026-11-17', until: '2026-11-18' },
    });
    expect(periodFrame('week', '2026-11-18')).toMatchObject({ current: { since: '2026-11-16', until: '2026-11-22' }, previous: { since: '2026-11-09', until: '2026-11-11' } });
    expect(periodFrame('week', '2026-11-16').previous).toEqual({ since: '2026-11-09', until: '2026-11-09' });
  });
  it('a month to the same day of the month before, to its end when shorter; a quarter, a year', () => {
    expect(periodFrame('month', '2026-03-31').previous).toEqual({ since: '2026-02-01', until: '2026-02-28' });
    expect(periodFrame('month', '2026-11-01').previous).toEqual({ since: '2026-10-01', until: '2026-10-01' });
    expect(periodFrame('quarter', '2026-11-22')).toMatchObject({ current: { since: '2026-10-01', until: '2026-12-31' }, previous: { since: '2026-07-01', until: '2026-08-22' } });
    expect(periodFrame('year', '2028-02-29').previous).toEqual({ since: '2027-01-01', until: '2027-02-28' });
    expect(periodFrame('week', '2027-01-01').previous).toEqual({ since: '2026-12-21', until: '2026-12-25' });
  });
});

describe('the sums of the series', () => {
  const days = [day('2026-11-10', 2, 0, 20, 1), day('2026-11-16', 3, 1, 35, 1.5), day('2026-11-17', 0, 0), day('2026-11-18', -1)];
  it('adds up the days of a span up to today, none before the series', () => {
    expect(sumSpan(days, { since: '2026-11-16', until: '2026-11-22' }, '2026-11-17', '2026-11-09')).toEqual({ learned: 3, seen: 1, xp: 35, doneH: 1.5, days: 1 });
    // a point opened again is a difference below 0, counted as the engine wrote it
    expect(sumSpan(days, { since: '2026-11-16', until: '2026-11-22' }, '2026-11-18', '2026-11-09')!.learned).toBe(2);
    expect(sumSpan(days, { since: '2026-11-01', until: '2026-11-08' }, '2026-11-18', '2026-11-09')).toBeNull();
    expect(sumSpan(days, { since: '2026-11-01', until: '2026-11-30' }, '2026-11-18', null)).toBeNull();
  });
  it('knows how many days of a span have begun since the series, and whether it knows all', () => {
    expect(knownDays({ since: '2026-11-16', until: '2026-11-22' }, '2026-11-18', '2026-11-09')).toBe(3);
    expect(knownDays({ since: '2026-11-09', until: '2026-11-15' }, '2026-11-18', '2026-11-12')).toBe(4);
    expect(knowsAll({ since: '2026-11-09', until: '2026-11-11' }, '2026-11-09')).toBe(true);
    expect(knowsAll({ since: '2026-11-09', until: '2026-11-11' }, '2026-11-10')).toBe(false);
    expect(knowsAll({ since: '2026-11-09', until: '2026-11-11' }, null)).toBe(false);
  });
  it('a change up, down or none, without a tail', () => {
    expect(changeOf(5, 3)).toEqual({ direction: 'up', by: 2 });
    expect(changeOf(0.1 + 0.2, 0.3)).toEqual({ direction: 'same', by: 0 });
    expect(changeOf(1, 2.5)).toEqual({ direction: 'down', by: 1.5 });
  });
});

describe('small things', () => {
  it('the Monday of a week, the day of the device, the remembered period', () => {
    expect(mondayOf('2026-11-22')).toBe('2026-11-16');
    expect(localDay(new Date(2026, 10, 18, 23, 30))).toBe('2026-11-18');
    expect(parsePeriod('year')).toBe('year');
    expect(parsePeriod('custom')).toBe('week');
    expect(parsePeriod(null)).toBe('week');
  });
});
