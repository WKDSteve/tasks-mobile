// The service worker of tasks-mobile: it keeps the page itself (its HTML, script, style, icons) so the app opens
// without a connection. It keeps nothing of the vault (PWA-02): the routes of the hub (`/api/`, `/auth/`) are never
// answered from here and never stored, and nothing outside the scope of this worker is touched. The copy of the vault
// is the page's own (IndexedDB, only the classes that may stay on the phone).
//
// Network first: a newer page is taken as soon as the hub serves it; the kept one is only the fallback offline.

const CACHE = 'tasks-mobile-shell-v1';

/** @param {URL} url */
function isShell(url) {
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin) return false;
  if (!url.pathname.startsWith(scope.pathname)) return false;
  // Belt and braces: the hub's routes are not below the page's path, but if one ever were, it is not the shell.
  return !/\/(api|auth)\//.test(url.pathname);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Notices of the hub (Web Push). The hub sends the kind and at most the id of a task of a released area (PWA-06), never
// its title or text: the notice says only what kind of thing waits, the task is read over the paired way when it is
// tapped. Anything else that arrives is not shown. Same checks as `readNotice` in `src/lib/push.ts`.
const KINDS = ['remind', 'decision'];
const TASK_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const WORDS = {
  de: {
    remind: 'Eine Erinnerung ist fällig.',
    decision: 'Eine Task wartet auf deine Entscheidung.',
  },
  en: {
    remind: 'A reminder is due.',
    decision: 'A task waits for your decision.',
  },
};

/** @param {unknown} data */
function readNotice(data) {
  if (typeof data !== 'object' || data === null) return null;
  const kind = /** @type {{kind?: unknown}} */ (data).kind;
  const id = /** @type {{id?: unknown}} */ (data).id;
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return null;
  if (id !== null && id !== undefined) {
    if (typeof id !== 'string' || id.length > 200 || !TASK_ID.test(id) || id.split('/').includes('..')) return null;
  }
  return { kind, id: typeof id === 'string' ? id : null };
}

self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    data = null;
  }
  const notice = readNotice(data);
  if (!notice) return;
  const lang = (self.navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
  event.waitUntil(
    self.registration.showNotification('tasks', {
      body: WORDS[lang][notice.kind],
      icon: new URL('icons/icon-192.png', self.registration.scope).href,
      badge: new URL('icons/icon-monochrome-192.png', self.registration.scope).href,
      // One notice per task and kind: a second one replaces the first.
      tag: `${notice.kind}:${notice.id ?? ''}`,
      data: { id: notice.id },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const id = readNotice({ kind: KINDS[0], id: event.notification.data && event.notification.data.id })?.id ?? null;
  const target = new URL(self.registration.scope);
  if (id !== null) target.searchParams.set('task', id);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      if (open) {
        if (id !== null) open.postMessage({ open: id });
        return open.focus();
      }
      return self.clients.openWindow(target.href);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (!isShell(url)) return;
  // The share target opens the page with the shared text in the query: the page is the same, the query is not kept.
  const key = new Request(url.origin + url.pathname);
  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(key, copy));
        }
        return response;
      })
      .catch(() => caches.match(key).then((hit) => hit ?? Response.error())),
  );
});
