// What the phone keeps (MSEC-12: as little as works offline): the last vault it was shown, cut to the shown areas,
// and the queue of writes. Both in IndexedDB of this origin; both are read back as untrusted (MSEC-13) and both go
// when the phone is unpaired. The session token is not kept here: it lives in `sessionStorage` only (WEB-07).

import { indexedDbStore, type CacheStore } from 'appkit-ui/cache';
import { isAreaName, isTaskId } from './parse';
import type { QueueStore } from './queue';
import type { AreaInfo, Status, TaskBrief, VaultView } from './types';
import { STATUSES } from './types';

const DB = 'tasks-mobile';

export interface KeptView {
  view: VaultView;
  /** When the hub sent it (ISO time), shown as "as of". */
  at: string;
}

function brief(value: unknown): TaskBrief | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isTaskId(v['id']) || !isAreaName(v['area']) || typeof v['title'] !== 'string') return null;
  if (!v['id'].startsWith(`${v['area']}/`)) return null;
  const optDay = (x: unknown): string | null => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : null);
  return {
    id: v['id'],
    area: v['area'],
    title: v['title'].slice(0, 500),
    status: (STATUSES as readonly unknown[]).includes(v['status']) ? (v['status'] as Status) : null,
    prio: Number.isInteger(v['prio']) ? (v['prio'] as number) : null,
    due: optDay(v['due']),
    remind: optDay(v['remind']),
    openQuestions: Number.isInteger(v['openQuestions']) && (v['openQuestions'] as number) > 0 ? (v['openQuestions'] as number) : 0,
    etag: typeof v['etag'] === 'string' ? v['etag'].slice(0, 200) : null,
  };
}

/** A kept view read back: checked field by field; only areas of a shown class, and only their tasks. */
export function restoreView(raw: unknown): KeptView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const view = r['view'] as Record<string, unknown> | undefined;
  if (typeof r['at'] !== 'string' || typeof view !== 'object' || view === null) return null;
  if (typeof view['rev'] !== 'string' || !Array.isArray(view['tasks']) || !Array.isArray(view['areas'])) return null;
  const areas: AreaInfo[] = [];
  for (const a of view['areas']) {
    if (typeof a !== 'object' || a === null) continue;
    const { name, dataClass } = a as Record<string, unknown>;
    if (isAreaName(name) && (dataClass === 'public' || dataClass === 'internal')) areas.push({ name, dataClass });
  }
  const shown = new Set(areas.map((a) => a.name));
  const tasks = view['tasks'].map(brief).filter((t): t is TaskBrief => t !== null && shown.has(t.area));
  const hidden = Number.isInteger(view['hiddenAreas']) ? Math.max(0, view['hiddenAreas'] as number) : 0;
  return { at: r['at'], view: { rev: view['rev'].slice(0, 200), tasks, areas, hiddenAreas: hidden } };
}

function isKept(value: unknown): value is KeptView {
  return restoreView(value) !== null;
}

/** The kept view in IndexedDB; every failure is a miss (the page then shows "no copy"). */
export function viewStore(factory: IDBFactory | undefined): CacheStore<KeptView> {
  const store = indexedDbStore<KeptView>(factory, { db: `${DB}-view`, store: 'view', key: 'last', valid: isKept });
  return {
    load: async () => restoreView(await store.load()),
    save: (value) => store.save(value),
    clear: () => store.clear(),
  };
}

/** The queue in IndexedDB. */
export function queueStore(factory: IDBFactory | undefined): QueueStore {
  const store = indexedDbStore<unknown[]>(factory, {
    db: `${DB}-queue`,
    store: 'queue',
    key: 'items',
    valid: (v): v is unknown[] => Array.isArray(v),
  });
  return {
    load: () => store.load(),
    save: (items) => store.save(items),
    clear: () => store.clear(),
  };
}

/** Memory only (tests, and a phone whose storage refuses). */
export function memoryStore<T>(): CacheStore<T> & { value: T | null } {
  const box: CacheStore<T> & { value: T | null } = {
    value: null,
    load: async () => box.value,
    save: async (v) => {
      box.value = v;
    },
    clear: async () => {
      box.value = null;
    },
  };
  return box;
}

const TOKEN_KEY = 'tasks-mobile.session';

export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The session token of this tab (WEB-07): `sessionStorage` only, a token of the hub's shape only. */
export function readToken(storage: TokenStorage | undefined): string | null {
  try {
    const token = storage?.getItem(TOKEN_KEY) ?? null;
    return token !== null && /^[0-9a-f]{32,128}$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function writeToken(storage: TokenStorage | undefined, token: string | null): void {
  try {
    if (token === null) storage?.removeItem(TOKEN_KEY);
    else storage?.setItem(TOKEN_KEY, token);
  } catch {
    // a storage that refuses: the session lasts as long as the page
  }
}
