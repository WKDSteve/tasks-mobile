// What the phone keeps (MSEC-12: as little as works offline): the last vault it was shown, cut to the shown areas,
// and the queue of writes. Both in IndexedDB of this origin; both are read back as untrusted (MSEC-13) and both go
// when the phone is unpaired. The session token is not kept at all: it lives in memory only (PWA-03); the device key
// (appkit-ui/device) opens a new session on every start.

import { indexedDbStore, type CacheStore } from 'appkit-ui/cache';
import { isAreaName, isTaskId, MAX_NEXT, statusCounts } from './parse';
import type { QueueStore } from './queue';
import type { AreaInfo, NextPick, Status, TaskBrief, VaultView } from './types';
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
  // A copy kept before the counts and the picks were kept has neither: then the view shows none, never a guess.
  const counts = statusCounts(view['counts']);
  const next = (Array.isArray(view['next']) ? view['next'] : []).flatMap((p) => {
    const pick = restorePick(p);
    return pick && shown.has(pick.area) ? [pick] : [];
  }).slice(0, MAX_NEXT);
  return { at: r['at'], view: { rev: view['rev'].slice(0, 200), tasks, areas, hiddenAreas: hidden, counts, next } };
}

function restorePick(value: unknown): NextPick | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isTaskId(v['id']) || typeof v['title'] !== 'string' || v['area'] !== v['id'].slice(0, v['id'].indexOf('/'))) return null;
  return {
    id: v['id'],
    area: v['area'],
    title: v['title'].slice(0, 500),
    status: (STATUSES as readonly unknown[]).includes(v['status']) ? (v['status'] as Status) : null,
    prio: Number.isInteger(v['prio']) ? (v['prio'] as number) : null,
  };
}

/** How long a kept list is shown without the hub (MOB-08): after that it is deleted, not shown as if it still held. */
export const MAX_KEPT_MS = 14 * 24 * 60 * 60 * 1000;

/** Is the kept list young enough to show? A time that cannot be read, or one in the future, is not. */
export function isFresh(kept: KeptView, now: Date): boolean {
  const at = Date.parse(kept.at);
  if (Number.isNaN(at)) return false;
  const age = now.getTime() - at;
  return age >= -5 * 60 * 1000 && age <= MAX_KEPT_MS;
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
