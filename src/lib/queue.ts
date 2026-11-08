// The writes of the phone, kept until the hub said yes or no (MOB-07, MOB-08). Nothing here is shown as done before
// the engine said so: the list shows the vault as the hub sent it, and the queue beside it as "waiting".
//
// A write is sent once. When its answer is lost it is `unknown` and is never sent again by itself (a second `new`
// would make a second task); the user looks and decides. A refusal of the engine (a conflict: the file changed since
// it was read) stays in the queue with its words until the user drops it: the newer version is never overwritten.
//
// The queue survives the end of the app (MUI-04): it is kept in the phone's storage after every change. A write
// that was being sent when the app was ended is `unknown` after the restart.

import { isAreaName, isTaskId } from './parse';
import { AnswerLost, HubRefused, Unpaired, Unreachable, type DataSource } from './source';
import type { Op, OpErrorCode } from './types';
import { STATUSES } from './types';

export type PendingState = 'waiting' | 'sending' | 'unknown' | 'conflict' | 'refused';

export interface Pending {
  clientOpId: string;
  op: Op;
  /** The area the write goes to (a new task) or is in (a change): only shown areas are ever queued. */
  area: string;
  /** What the list shows for it: the title of the task. */
  label: string;
  queuedAt: string;
  state: PendingState;
  /** The engine's or the hub's words, for `conflict` and `refused`. */
  message?: string;
  code?: OpErrorCode | string;
}

/** Where the queue is kept (IndexedDB in the page, memory in the tests). */
export interface QueueStore {
  load(): Promise<unknown>;
  save(items: Pending[]): Promise<void>;
  clear(): Promise<void>;
}

export interface FlushReport {
  sent: number;
  /** Why the run stopped before the end, if it did. */
  stopped: 'unreachable' | 'unpaired' | 'busy' | null;
}

const MAX_ITEMS = 200;

function validOp(value: unknown): value is Op {
  if (typeof value !== 'object' || value === null) return false;
  const op = value as Record<string, unknown>;
  const ifMatch = op['if_match'] === undefined || typeof op['if_match'] === 'string';
  switch (op['op']) {
    case 'new':
      return isAreaName(op['area']) && typeof op['title'] === 'string' && (op['body'] === undefined || typeof op['body'] === 'string');
    case 'set': {
      const patch = op['patch'] as Record<string, unknown> | undefined;
      return isTaskId(op['id']) && typeof patch === 'object' && patch !== null && (STATUSES as readonly unknown[]).includes(patch['status']) && ifMatch;
    }
    case 'answer':
      return isTaskId(op['id']) && typeof op['question'] === 'string' && Number.isInteger(op['option']) && ifMatch;
    case 'done':
      return isTaskId(op['id']) && typeof op['confirm'] === 'string';
    default:
      return false;
  }
}

/** What was read back from the phone's storage, checked like a document of the hub (MSEC-13). */
export function restore(raw: unknown, shownAreas: ReadonlySet<string> | null): Pending[] {
  if (!Array.isArray(raw)) return [];
  const states: readonly PendingState[] = ['waiting', 'sending', 'unknown', 'conflict', 'refused'];
  const items: Pending[] = [];
  for (const entry of raw.slice(0, MAX_ITEMS)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e['clientOpId'] !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(e['clientOpId'])) continue;
    if (!validOp(e['op']) || !isAreaName(e['area']) || typeof e['label'] !== 'string') continue;
    if (typeof e['queuedAt'] !== 'string' || !(states as readonly unknown[]).includes(e['state'])) continue;
    // An area that may no longer be shown here takes its writes with it (the class changed on the PC).
    if (shownAreas !== null && !shownAreas.has(e['area'])) continue;
    const state = e['state'] as PendingState;
    items.push({
      clientOpId: e['clientOpId'],
      op: e['op'],
      area: e['area'],
      label: e['label'].slice(0, 500),
      queuedAt: e['queuedAt'],
      // Ended while it was being sent: it may have arrived.
      state: state === 'sending' ? 'unknown' : state,
      ...(typeof e['message'] === 'string' ? { message: e['message'].slice(0, 500) } : {}),
      ...(typeof e['code'] === 'string' ? { code: e['code'].slice(0, 48) } : {}),
    });
  }
  return items;
}

export class WriteQueue {
  items: Pending[] = [];
  private flushing = false;

  constructor(
    private readonly store: QueueStore,
    private readonly newId: () => string,
    private readonly now: () => Date,
    /** Called after every change of `items` (the page redraws). */
    private readonly changed: () => void = () => {},
  ) {}

  async load(shownAreas: ReadonlySet<string> | null): Promise<void> {
    this.items = restore(await this.store.load(), shownAreas);
    this.changed();
  }

  private async persist(): Promise<void> {
    this.changed();
    await this.store.save(this.items.map((item) => ({ ...item })));
  }

  get full(): boolean {
    return this.items.length >= MAX_ITEMS;
  }

  /** Put a write into the queue. */
  async add(op: Op, area: string, label: string): Promise<Pending> {
    if (this.full) throw new Error('queue full');
    const item: Pending = { clientOpId: this.newId(), op, area, label, queuedAt: this.now().toISOString(), state: 'waiting' };
    this.items.push(item);
    await this.persist();
    return item;
  }

  /** Send what waits, one after the other, in the order it was queued. Only one run at a time. */
  async flush(source: DataSource): Promise<FlushReport> {
    if (this.flushing) return { sent: 0, stopped: null };
    this.flushing = true;
    let sent = 0;
    try {
      for (const item of this.items.filter((i) => i.state === 'waiting')) {
        // Dropped or cleared while an earlier write was on its way: it is not sent.
        if (!this.items.includes(item) || item.state !== 'waiting') continue;
        item.state = 'sending';
        await this.persist();
        try {
          const outcome = await source.write(item.clientOpId, item.op);
          if (outcome.ok) {
            this.items = this.items.filter((i) => i !== item);
            sent += 1;
          } else {
            item.state = outcome.code === 'conflict' ? 'conflict' : 'refused';
            item.code = outcome.code;
            item.message = outcome.message;
          }
          await this.persist();
        } catch (error) {
          if (error instanceof Unreachable) {
            item.state = 'waiting';
            await this.persist();
            return { sent, stopped: 'unreachable' };
          }
          if (error instanceof Unpaired) {
            item.state = 'waiting';
            await this.persist();
            return { sent, stopped: 'unpaired' };
          }
          if (error instanceof HubRefused && (error.status === 429 || error.status === 503)) {
            item.state = 'waiting';
            await this.persist();
            return { sent, stopped: 'busy' };
          }
          if (error instanceof HubRefused) {
            item.state = 'refused';
            item.code = error.code;
            item.message = error.message;
          } else if (error instanceof AnswerLost) {
            item.state = 'unknown';
          } else {
            // Anything else (a reply this page cannot read): the write may have arrived.
            item.state = 'unknown';
            item.message = error instanceof Error ? error.message.slice(0, 500) : '';
          }
          await this.persist();
        }
      }
      return { sent, stopped: null };
    } finally {
      this.flushing = false;
    }
  }

  /**
   * The user looked and wants an `unknown` or refused write sent again (same id: a hub that tells a repeat can). A
   * conflict is not sent again: it carries the old version and would be refused again; the user drops it and
   * acts on the new version.
   */
  async retry(clientOpId: string): Promise<void> {
    const item = this.items.find((i) => i.clientOpId === clientOpId);
    if (!item || (item.state !== 'unknown' && item.state !== 'refused')) return;
    item.state = 'waiting';
    delete item.message;
    delete item.code;
    await this.persist();
  }

  /** The user drops a write (it arrived after all, or it is not wanted any more). */
  async drop(clientOpId: string): Promise<void> {
    const before = this.items.length;
    this.items = this.items.filter((i) => i.clientOpId !== clientOpId || i.state === 'sending');
    if (this.items.length !== before) await this.persist();
  }

  /** Forget everything (the phone is unpaired: MSEC-12). */
  async clear(): Promise<void> {
    this.items = [];
    this.changed();
    await this.store.clear();
  }
}
