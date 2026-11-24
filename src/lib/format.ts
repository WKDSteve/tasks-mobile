// Numbers, sizes and dates a person reads, in the language of the page (`document.documentElement.lang`, which the app
// sets from `chooseLang`) and never put together by hand: `toFixed(1)` writes `3.4 MB` where German reads `3,4 MB`, and
// `toLocaleString()` without a language follows the browser, not the language chosen for the page. What the hub sends as
// an ISO string is only shown here, formatted after it is parsed; nothing is computed from it.

/** The language of the page, else German (the app's default). */
export function pageLang(): string {
  return (typeof document !== 'undefined' && document.documentElement.lang) || 'de';
}

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function numberFormat(lang: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `n|${lang}|${JSON.stringify(options)}`;
  let f = cache.get(key) as Intl.NumberFormat | undefined;
  if (!f) cache.set(key, (f = new Intl.NumberFormat(lang, options)));
  return f;
}
function dateFormat(lang: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `d|${lang}|${JSON.stringify(options)}`;
  let f = cache.get(key) as Intl.DateTimeFormat | undefined;
  if (!f) cache.set(key, (f = new Intl.DateTimeFormat(lang, options)));
  return f;
}

/** A size for people: `820 kB`, `3,4 MB` (a comma in German, a point in English). */
export function sizeText(bytes: number, lang: string = pageLang()): string {
  if (bytes < 1024 * 1024) {
    return numberFormat(lang, { style: 'unit', unit: 'kilobyte', maximumFractionDigits: 0 }).format(Math.max(1, Math.round(bytes / 1024)));
  }
  return numberFormat(lang, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(bytes / (1024 * 1024));
}

/** A moment (milliseconds) as date and time, short. */
export function dateTimeText(ms: number, lang: string = pageLang()): string {
  return dateFormat(lang, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));
}

/**
 * An ISO day (`2026-11-24`) as a date for people (`24.11.2026`). The day is taken as written (UTC midnight, shown in UTC),
 * so no time zone moves it; anything else than an ISO day comes back as it is.
 */
export function dayText(iso: string, lang: string = pageLang()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return dateFormat(lang, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

/** An ISO day as a short weekday with day and month (`Di., 24.11.`). */
export function weekdayText(iso: string, lang: string = pageLang()): string {
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return dateFormat(lang, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(date);
}
