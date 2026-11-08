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
