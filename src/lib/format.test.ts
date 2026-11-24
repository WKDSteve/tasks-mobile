import { describe, expect, it } from 'vitest';
import { dayText, sizeText, weekdayText } from './format';

const plain = (s: string): string => s.replace(/\s/g, ' ');

describe('sizes in the language of the page', () => {
  it('a comma in German, a point in English', () => {
    expect(plain(sizeText(3.4 * 1024 * 1024, 'de'))).toBe('3,4 MB');
    expect(plain(sizeText(3.4 * 1024 * 1024, 'en'))).toBe('3.4 MB');
  });
  it('kilobytes round to whole numbers and are never below 1', () => {
    expect(plain(sizeText(820 * 1024, 'en'))).toBe('820 kB');
    expect(plain(sizeText(10, 'en'))).toBe('1 kB');
  });
});

describe('days from the hub, shown', () => {
  it('an ISO day is written the way the language writes dates, and no time zone moves it', () => {
    expect(dayText('2026-11-24', 'de')).toBe('24.11.2026');
    expect(dayText('2026-11-24', 'en')).toBe('Nov 24, 2026');
  });
  it('what is no ISO day is left as it is', () => {
    expect(dayText('next week', 'de')).toBe('next week');
    expect(dayText('2026-13-45', 'de')).toBe('2026-13-45');
  });
  it('a short weekday with day and month', () => {
    expect(weekdayText('2026-11-24', 'en')).toMatch(/^Tue/);
  });
});
