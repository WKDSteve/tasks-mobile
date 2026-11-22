// The tile "My learning" of the page Lernen: the window a period means on a day (today, this week, month, quarter or
// year as the calendar has them) and the days of the period before that compare with it (as many days: Monday to
// Wednesday against Monday to Wednesday of the week before), and the sums of the series over them. Every figure is
// the engine's (`tasks.learn_history` by day: what changed each day); the page only adds up the days a period holds
// (MOB-05: no rule of the tasks here). The same windows as the overview of tasks-desktop (`ui/src/lib/learnPeriod.ts`).

import type { LearnDay } from './types';

export const LEARN_PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type LearnPeriod = (typeof LEARN_PERIODS)[number];

/** Days from `since` to `until`, both included (`YYYY-MM-DD`). */
export interface Span {
  since: string;
  until: string;
}

export interface PeriodFrame {
  /** The period from its first to its last day (the last may lie after today). */
  current: Span;
  /** As many days of the period before. */
  previous: Span;
  /** What the hub is asked for, by day: from the first day of the period before up to today. */
  ask: Span;
}

/** The sums of the days of a span. */
export interface Figures {
  learned: number;
  seen: number;
  xp: number;
  doneH: number;
  days: number;
}

const DAY_MS = 86_400_000;
const parse = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const min = (a: string, b: string): string => (a <= b ? a : b);
const max = (a: string, b: string): string => (a >= b ? a : b);

export function addDays(day: string, n: number): string {
  return iso(parse(day) + n * DAY_MS);
}

/** The first day of the month of `day`, moved by `months`. */
export function addMonths(day: string, months: number): string {
  const d = new Date(parse(day));
  return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

const lastOfMonth = (monthStart: string): string => addDays(addMonths(monthStart, 1), -1);

/** The Monday of the week of `day`. */
export function mondayOf(day: string): string {
  const back = (new Date(parse(day)).getUTCDay() + 6) % 7;
  return addDays(day, -back);
}

/** The same day of the month in the month starting `monthStart`, or its last day when it is shorter. */
function sameDayIn(monthStart: string, day: string): string {
  return min(addDays(monthStart, Number(day.slice(8, 10)) - 1), lastOfMonth(monthStart));
}

/** A day of this device's clock as `YYYY-MM-DD`. */
export function localDay(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The window of a period on `today` and as many days of the period before. */
export function periodFrame(period: LearnPeriod, today: string): PeriodFrame {
  let current: Span;
  let previous: Span;
  switch (period) {
    case 'day':
      current = { since: today, until: today };
      previous = { since: addDays(today, -1), until: addDays(today, -1) };
      break;
    case 'week': {
      const monday = mondayOf(today);
      current = { since: monday, until: addDays(monday, 6) };
      previous = { since: addDays(monday, -7), until: addDays(today, -7) };
      break;
    }
    case 'month': {
      const first = addMonths(today, 0);
      const before = addMonths(today, -1);
      current = { since: first, until: lastOfMonth(first) };
      previous = { since: before, until: sameDayIn(before, today) };
      break;
    }
    case 'quarter': {
      const first = addMonths(today, -((Number(today.slice(5, 7)) - 1) % 3));
      current = { since: first, until: addDays(addMonths(first, 3), -1) };
      previous = { since: addMonths(first, -3), until: sameDayIn(addMonths(today, -3), today) };
      break;
    }
    case 'year': {
      const year = Number(today.slice(0, 4));
      current = { since: `${year}-01-01`, until: `${year}-12-31` };
      previous = { since: `${year - 1}-01-01`, until: sameDayIn(addMonths(today, -12), today) };
      break;
    }
  }
  return { current, previous, ask: { since: previous.since, until: today } };
}

/** Does the series know every day of a span (its first day on or before the span's)? */
export function knowsAll(span: Span, first: string | null): boolean {
  return first !== null && first <= span.since;
}

/** The sums of the days of `span` up to `today` the series knows; null when it knows none of them. */
export function sumSpan(days: readonly LearnDay[], span: Span, today: string, first: string | null): Figures | null {
  if (first === null || first > span.until || span.since > today) return null;
  const from = max(span.since, first);
  const to = min(span.until, today);
  const out: Figures = { learned: 0, seen: 0, xp: 0, doneH: 0, days: 0 };
  for (const d of days) {
    if (d.date < from || d.date > to) continue;
    out.learned += d.learned;
    out.seen += d.seen;
    out.xp += d.xp;
    out.doneH += d.doneH;
    if (d.learning) out.days += 1;
  }
  out.doneH = Math.round(out.doneH * 100) / 100;
  return out;
}

/** The days of a span that have begun and that the series knows: what "2 of 3" learning days is out of. */
export function knownDays(span: Span, today: string, first: string | null): number {
  if (first === null) return 0;
  const from = max(span.since, first);
  const to = min(span.until, today);
  return to < from ? 0 : Math.round((parse(to) - parse(from)) / DAY_MS) + 1;
}

/** A figure against the period before: up, down or the same, and by how much (two decimals). */
export function changeOf(now: number, before: number): { direction: 'up' | 'down' | 'same'; by: number } {
  const by = Math.round((now - before) * 100) / 100;
  return { direction: by > 0 ? 'up' : by < 0 ? 'down' : 'same', by: Math.abs(by) };
}

/** The remembered period (per device); anything else is the week. */
export function parsePeriod(raw: string | null): LearnPeriod {
  return (LEARN_PERIODS as readonly string[]).includes(raw ?? '') ? (raw as LearnPeriod) : 'week';
}
