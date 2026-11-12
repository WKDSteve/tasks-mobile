// The service worker (`public/sw.js`) is a plain script of the browser; it runs here in a sandbox with a fake `self`.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { PUSH_KINDS } from '../src/lib/push';

/** The service worker in a sandbox: its listeners, and what it showed and opened. */
function worker(lang = 'de-AT', clients: { url: string; posted: unknown[]; focused: boolean }[] = []) {
  const listeners = new Map<string, (event: unknown) => void>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const self = {
    navigator: { language: lang },
    registration: {
      scope: 'https://pc.example.ts.net/m/',
      showNotification: async (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => {},
      matchAll: async () =>
        clients.map((c) => ({
          url: c.url,
          postMessage: (m: unknown) => c.posted.push(m),
          focus: async () => {
            c.focused = true;
          },
        })),
      openWindow: async (url: string) => {
        opened.push(url);
      },
    },
    addEventListener: (type: string, run: (event: unknown) => void) => listeners.set(type, run),
    skipWaiting: () => {},
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL, caches: {}, fetch, Request, Response });
  const waits: Promise<unknown>[] = [];
  const fire = async (type: string, event: Record<string, unknown>) => {
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { fire, shown, opened };
}

const pushEvent = (data: unknown) => ({ data: { json: () => (typeof data === 'string' ? JSON.parse(data) : data) } });

describe('the service worker shows a notice', () => {
  it('names only the kind, never a title of a task; one notice per task and kind', async () => {
    const w = worker();
    await w.fire('push', pushEvent({ kind: 'remind', id: 'garden/water-the-plants' }));
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.title).toBe('tasks');
    expect(w.shown[0]!.options).toMatchObject({ body: 'Eine Erinnerung ist fällig.', tag: 'remind:garden/water-the-plants', data: { id: 'garden/water-the-plants' } });
    const en = worker('en-GB');
    await en.fire('push', pushEvent({ kind: 'decision', id: null }));
    expect(en.shown[0]!.options['body']).toBe('A task waits for your decision.');
  });

  it('shows nothing for a notice that is not of this app', async () => {
    const w = worker();
    for (const bad of [{ kind: 'ci_red', id: null }, { kind: 'remind', id: '../../etc' }, { title: 'Secret' }, null])
      await w.fire('push', pushEvent(bad));
    await w.fire('push', { data: { json: () => { throw new SyntaxError('x'); } } });
    await w.fire('push', { data: null });
    expect(w.shown).toEqual([]);
  });

  it('a tap opens the page on the task, or tells an open page to show it', async () => {
    const w = worker();
    const close = { closed: false };
    const notification = (id: unknown) => ({ data: { id }, close: () => (close.closed = true) });
    await w.fire('notificationclick', { notification: notification('garden/water-the-plants') });
    expect(close.closed).toBe(true);
    expect(w.opened).toEqual(['https://pc.example.ts.net/m/?task=garden%2Fwater-the-plants']);
    const page = { url: 'https://pc.example.ts.net/m/', posted: [] as unknown[], focused: false };
    const open = worker('de', [page]);
    await open.fire('notificationclick', { notification: notification('garden/water-the-plants') });
    expect(page).toMatchObject({ posted: [{ open: 'garden/water-the-plants' }], focused: true });
    // A bad id opens the page without a task.
    const bad = worker();
    await bad.fire('notificationclick', { notification: notification('../x') });
    expect(bad.opened).toEqual(['https://pc.example.ts.net/m/']);
  });

  it('the worker knows the same kinds as the page', () => {
    expect(readFileSync('public/sw.js', 'utf8')).toContain(`const KINDS = [${PUSH_KINDS.map((k) => `'${k}'`).join(', ')}];`);
  });
});
