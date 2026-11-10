// The writes of the phone, kept until the hub said yes or no (MOB-07, MOB-08). Nothing here is shown as done before
// the engine said so: the list shows the vault as the hub sent it, and the queue beside it as "waiting".
//
// A write is sent once. When its answer is lost it is `unknown` and is never sent again by itself (a second `new`
// would make a second task); the user looks and decides. A refusal of the engine (a conflict: the file changed since
// it was read) stays in the queue with its words until the user drops it: the newer version is never overwritten.
//
// The queue survives the end of the app (MUI-04): it is kept in the phone's storage after every change. A write
// that was being sent when the app was ended is `unknown` after the restart.
//
// A new task may carry files (a photo, a voice note). They wait in the `FileStore`; once the engine made the task,
// each becomes an `upload` of its own in the place of the `new`, to the id the engine gave. A file that could not be
// sent stays visible in the queue; the task stays as it is.

import { memoryFileStore, restoreRef, type AttachmentRef, type FileStore } from './attach';
import { isAreaName, isTaskId } from './parse';
import { AnswerLost, HubRefused, Unpaired, Unreachable, type DataSource } from './source';
import type { Op, OpErrorCode } from './types';
import { STATUSES } from './types';

export type PendingState = 'waiting' | 'sending' | 'unknown' | 'conflict' | 'refused';

/** A file of a task the engine made, to send to the hub's upload route. */
export interface UploadOp {
  op: 'upload';
  id: string;
  file: AttachmentRef;
}

/** What the queue sends: an operation of the engine, or a file. */
export type QueueOp = Op | UploadOp;

export interface Pending {
  clientOpId: string;
  op: QueueOp;
  /** The files of a new task, sent after it was made. */
  files?: AttachmentRef[];
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

function validOp(value: unknown): value is QueueOp {
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
    case 'upload':
      return isTaskId(op['id']) && restoreRef(op['file']) !== null;
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
    const op = e['op'];
    // Only a new task carries files; a file that does not read back is dropped (its blob is collected on load).
    const files = op.op === 'new' && Array.isArray(e['files'])
      ? e['files'].map(restoreRef).filter((f): f is AttachmentRef => f !== null)
      : [];
    if (op.op === 'upload' && !op.id.startsWith(`${e['area']}/`)) continue;
    items.push({
      clientOpId: e['clientOpId'],
      op: op.op === 'upload' ? { op: 'upload', id: op.id, file: restoreRef(op.file)! } : op,
      ...(files.length > 0 ? { files } : {}),
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
    /** Where the files of the writes wait. */
    readonly fileStore: FileStore = memoryFileStore(),
  ) {}

  async load(shownAreas: ReadonlySet<string> | null): Promise<void> {
    this.items = restore(await this.store.load(), shownAreas);
    this.changed();
    // A file no write names any more (dropped, sent, or of an area that is not shown now) does not stay (MSEC-12).
    const named = new Set(this.items.flatMap(keysOf));
    for (const key of await this.fileStore.keys()) if (!named.has(key)) await this.fileStore.delete(key);
  }

  private async persist(): Promise<void> {
    this.changed();
    await this.store.save(this.items.map((item) => ({ ...item })));
  }

  get full(): boolean {
    return this.items.length >= MAX_ITEMS;
  }

  /** Put a write into the queue; a new task with the files that are to follow it (kept in the `FileStore` already). */
  async add(op: Op, area: string, label: string, files: AttachmentRef[] = []): Promise<Pending> {
    if (this.full) throw new Error('queue full');
    const item: Pending = {
      clientOpId: this.newId(),
      op,
      ...(op.op === 'new' && files.length > 0 ? { files } : {}),
      area,
      label,
      queuedAt: this.now().toISOString(),
      state: 'waiting',
    };
    this.items.push(item);
    await this.persist();
    return item;
  }

  /** The files of a new task become uploads to the id the engine gave, in its place in the queue. */
  private followers(item: Pending, id: string | null): Pending[] {
    return (item.files ?? []).map((file) => ({
      clientOpId: this.newId(),
      op: { op: 'upload', id: id ?? `${item.area}/unknown`, file },
      area: item.area,
      label: item.label,
      queuedAt: this.now().toISOString(),
      // Without the id the engine gave, a file has no task to go to.
      ...(id !== null && id.startsWith(`${item.area}/`)
        ? { state: 'waiting' as const }
        : { state: 'refused' as const, code: 'no_id', message: 'the engine named no task for the file' }),
    }));
  }

  /** Send one file: it is read from the phone's store first; a file that is gone is refused, never sent empty. */
  private async upload(source: DataSource, op: UploadOp) {
    const blob = await this.fileStore.get(op.file.key);
    if (!blob) throw new HubRefused(0, 'file_gone', 'the file is no longer on this phone');
    return source.upload(op.id, blob, op.file.name);
  }

  /**
   * Send what waits, one after the other, in the order it was queued; the uploads a new task leaves in its place
   * follow in the same run. Only one run at a time.
   */
  async flush(source: DataSource): Promise<FlushReport> {
    if (this.flushing) return { sent: 0, stopped: null };
    this.flushing = true;
    let sent = 0;
    const tried = new Set<Pending>();
    try {
      for (;;) {
        // The first that waits and was not tried in this run; dropped or cleared ones are not in `items` any more.
        const item = this.items.find((i) => i.state === 'waiting' && !tried.has(i));
        if (!item) break;
        tried.add(item);
        item.state = 'sending';
        await this.persist();
        try {
          const op = item.op;
          const outcome = op.op === 'upload' ? await this.upload(source, op) : await source.write(item.clientOpId, op);
          if (outcome.ok) {
            const at = this.items.indexOf(item);
            const follow = op.op === 'new' ? this.followers(item, outcome.id) : [];
            if (at >= 0) this.items.splice(at, 1, ...follow);
            if (op.op === 'upload') await this.fileStore.delete(op.file.key);
            for (const f of follow) if (f.state === 'refused' && f.op.op === 'upload') await this.fileStore.delete(f.op.file.key);
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

  /** The user drops a write (it arrived after all, or it is not wanted any more); its files go with it. */
  async drop(clientOpId: string): Promise<void> {
    const gone = this.items.filter((i) => i.clientOpId === clientOpId && i.state !== 'sending');
    if (gone.length === 0) return;
    this.items = this.items.filter((i) => !gone.includes(i));
    await this.persist();
    for (const key of gone.flatMap(keysOf)) await this.fileStore.delete(key);
  }

  /** Forget everything (the phone is unpaired: MSEC-12). */
  async clear(): Promise<void> {
    this.items = [];
    this.changed();
    await this.store.clear();
    await this.fileStore.clear();
  }
}

/** The keys of the files a write names. */
function keysOf(item: Pending): string[] {
  if (item.op.op === 'upload') return [item.op.file.key];
  return (item.files ?? []).map((f) => f.key);
}
