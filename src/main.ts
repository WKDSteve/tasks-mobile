import { mount } from 'svelte';
import { ApiError, HubClient } from 'appkit-ui/client';
import { deviceLogin, indexedDbDeviceStore, pairDevice, type DeviceDeps } from 'appkit-ui/device';
import { takePairingCode } from 'appkit-ui/pair';
import App from './App.svelte';
import { App as AppState, type AppDeps, type DeviceAccess } from './lib/app.svelte';
import { HubSource } from './lib/hubSource';
import { readShare, withoutShare } from './lib/share';
import type { DataSource } from './lib/source';
import { memoryStore, queueStore, viewStore } from './lib/storage';
import { workerUrl } from './lib/worker';
import './app.css';

/**
 * This phone at the hub: a device key (appkit-ui/device) when the hub keeps devices; a hub that does not know them yet
 * (404 on the pairing route) takes the code the old way, for a session that ends with the page.
 */
function deviceAccess(db: IDBFactory | undefined): DeviceAccess {
  const store = indexedDbDeviceStore(db, 'tasks-mobile-device');
  const deps: DeviceDeps = {
    fetchFn: window.fetch.bind(window),
    subtle: window.crypto.subtle,
    store,
    origin: window.location.origin,
  };
  return {
    pair: async (code, name) => {
      try {
        return await pairDevice(deps, code, name);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return new HubClient(window.fetch.bind(window), '/api/tasks').exchange(code);
        }
        throw error;
      }
    },
    login: () => deviceLogin(deps),
    forget: () => store.clear(),
  };
}

function indexedDb(): IDBFactory | undefined {
  try {
    return window.indexedDB;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  // What came in through the address leaves it at once: the pairing code (WEB-06) and a share (MSEC-07).
  const pairingCode = takePairingCode(window.location, window.history);
  const shared = readShare(window.location.search);
  if (shared) {
    window.history.replaceState(null, '', withoutShare(window.location.pathname, window.location.search, window.location.hash));
  }

  let makeSource: (token: string | null) => DataSource;
  if (__FAKE__) {
    // Only in the build `--mode fake`; the production build has no synthetic vault in it (e2e/bundle.spec.ts).
    const { FakeSource } = await import('./lib/fakeSource');
    const fake = new FakeSource();
    (window as unknown as { __fakeHub: unknown }).__fakeHub = fake;
    makeSource = () => fake;
  } else {
    makeSource = (token) => new HubSource(window.fetch.bind(window), token ?? '');
  }

  const db = indexedDb();
  const deps: AppDeps = {
    source: makeSource,
    device: deviceAccess(db),
    fake: __FAKE__,
    viewStore: db ? viewStore(db) : memoryStore(),
    queueStore: db ? queueStore(db) : memoryStore(),
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
  };
  const state = new AppState(deps);
  const target = document.getElementById('app');
  if (!target) return;
  mount(App, { target, props: { app: state, shared, storageMissing: db === undefined } });
  await state.start(pairingCode);

  // Back online, or back to the app: send what waits and read again.
  window.addEventListener('online', () => void state.refresh());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void state.refresh();
  });

  if ('serviceWorker' in navigator) {
    try {
      const url = workerUrl((window as unknown as { trustedTypes?: Parameters<typeof workerUrl>[0] }).trustedTypes);
      navigator.serviceWorker.register(url, { scope: './' }).catch(() => {
        // Without a worker the page works online; offline it does not open. Nothing to tell beyond that.
      });
    } catch {
      // A policy of that name exists already, or the CSP does not allow it (a hub that does not know this page yet).
    }
  }
}

void main();
