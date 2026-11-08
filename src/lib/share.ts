// The share target (Android): another app hands a title, a text and a link to the page as `?share_title=..&share_text=..
// &share_url=..` (see `public/manifest.webmanifest`). Whatever comes that way is hostile (MSEC-07): it only fills the form,
// it never writes by itself, hidden characters and controls are dropped, the lengths are cut, a link is taken only with
// `http:` or `https:`. The parameters leave the address bar at once, so they are not kept in the history.

import { MAX_CONTEXT, MAX_TITLE } from './capture';

/** The names of `share_target.params` in the manifest. The browser replaces the query of the action, so the names of
 * their own are what tells a share. */
export const SHARE_KEYS = ['share_title', 'share_text', 'share_url'] as const;

export interface Shared {
  title: string;
  context: string;
}

const STRIP = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;

function clean(text: string | null, max: number): string {
  if (text === null) return '';
  return [...text.slice(0, max * 4).replace(/\r\n?/g, '\n').replace(STRIP, '').replace(/\t/g, ' ')]
    .slice(0, max)
    .join('')
    .trim();
}

/** A link from outside, only when it is a web address; else nothing. */
export function safeLink(raw: string | null): string | null {
  if (raw === null) return null;
  const text = clean(raw, 2000);
  if (text === '' || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    return url.href;
  } catch {
    return null;
  }
}

/** The shared parts of the address, as a draft for the form; `null` when the page was not opened as a share. */
export function readShare(search: string): Shared | null {
  const params = new URLSearchParams(search);
  if (!SHARE_KEYS.some((key) => params.has(key))) return null;
  const rawTitle = clean(params.get('share_title'), MAX_TITLE * 2);
  const rawText = clean(params.get('share_text'), MAX_CONTEXT);
  const link = safeLink(params.get('share_url'));
  // A share often has no title (a browser shares the page text and the link): then the first line of the text is it.
  let title = rawTitle.split('\n')[0] ?? '';
  let rest = rawText;
  if (title === '') {
    const [first = '', ...more] = rawText.split('\n');
    title = first;
    rest = more.join('\n');
  }
  // A link that the text holds already is not repeated.
  const parts = [rest.trim(), link !== null && !rest.includes(link) ? link : ''].filter((p) => p !== '');
  return { title: [...title].slice(0, MAX_TITLE).join('').trim(), context: [...parts.join('\n')].slice(0, MAX_CONTEXT).join('') };
}

/** The address without the share parameters (for `history.replaceState`). */
export function withoutShare(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  for (const key of SHARE_KEYS) params.delete(key);
  const rest = params.toString();
  return `${pathname}${rest === '' ? '' : `?${rest}`}${hash}`;
}
