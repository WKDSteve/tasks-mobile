// The writes of the phone, kept until the hub said yes or no (MOB-07, MOB-08). The queue itself is the kit's
// (`appkit-ui/queue`): nothing is shown as done before the engine said so, a write whose answer was lost is `unknown`
// and never sent again by itself, a conflict keeps the hub's words and is never sent again, every change carries
// `if_match`, and the queue survives the end of the app (MUI-04).
//
// What only tasks has is here: a new task may carry files (a photo, a voice note). They wait in the `FileStore`, named
// by the `new` (`files`); once the engine made the task, each becomes an `upload` of its own in the place of the `new`,
// to the id the engine gave. A file that could not be sent stays visible in the queue; the task stays as it is.

import {
  WriteQueue as KitQueue,
  type FlushReport,
  type Pending as KitPending,
  type PendingState,
  type QueueStore,
  type SendOutcome,
} from 'appkit-ui/queue';
import { memoryFileStore, restoreRef, type AttachmentRef, type FileStore } from './attach';
import { isAreaName, isTaskId } from './parse';
import { AnswerLost, HubRefused, Unpaired, Unreachable, type DataSource } from './source';
import type { Op } from './types';
import { STATUSES } from './types';

export type { FlushReport, PendingState, QueueStore };

/** A new task with the files that are to follow it (kept in the `FileStore` already); `files` is never sent. */
export type NewOp = Extract<Op, { op: 'new' }> & { files?: AttachmentRef[] };

/** A file of a task the engine made, to send to the hub's upload route. */
export interface UploadOp {
  op: 'upload';
  id: string;
  file: AttachmentRef;
}

/** What the queue sends: an operation of the engine, or a file. */
export type QueueOp = Exclude<Op, { op: 'new' }> | NewOp | UploadOp;

/** A write in the queue; its `scope` is the area the write goes to (a new task) or is in (a change). */
export type Pending = KitPending<QueueOp>;

function validOp(value: unknown): value is QueueOp {
  if (typeof value !== 'object' || value === null) return false;
  const op = value as Record<string, unknown>;
  const ifMatch = op['if_match'] === undefined || typeof op['if_match'] === 'string';
  switch (op['op']) {
    case 'new':
      return (
        isAreaName(op['area']) &&
        typeof op['title'] === 'string' &&
        (op['body'] === undefined || typeof op['body'] === 'string') &&
        (op['files'] === undefined || Array.isArray(op['files']))
      );
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

/** A change of a task is queued only with the version the person saw (MOB-08); a new task and finishing need none. */
function needsIfMatch(op: QueueOp): boolean {
  return op.op === 'set' || op.op === 'answer';
}

function ifMatchOf(op: QueueOp): string | undefined {
  return op.op === 'set' || op.op === 'answer' ? op.if_match : undefined;
}

/**
 * An entry kept before the queue was the kit's: the area was `area`, the files of a new task beside the write. Taken
 * over in the kit's shape, then checked like any other (MSEC-13).
 */
function migrate(entry: unknown): unknown {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return entry;
  const e = { ...(entry as Record<string, unknown>) };
  if (e['scope'] === undefined && 'area' in e) e['scope'] = e['area'];
  delete e['area'];
  const op = e['op'];
  if ('files' in e) {
    if (typeof op === 'object' && op !== null && (op as Record<string, unknown>)['op'] === 'new')
      e['op'] = { ...(op as Record<string, unknown>), files: e['files'] };
    delete e['files'];
  }
  return e;
}

/** The checked items in the shape this page uses: files and uploads rebuilt from what reads back, nothing else. */
function settle(items: Pending[]): Pending[] {
  const out: Pending[] = [];
  for (const item of items) {
    // The kit checked the shape; the area of a write is an area name, and an upload goes to a task of its own area.
    if (!isAreaName(item.scope)) continue;
    const op = item.op;
    if (op.op === 'upload') {
      if (!op.id.startsWith(`${item.scope}/`)) continue;
      out.push({ ...item, op: { op: 'upload', id: op.id, file: restoreRef(op.file)! } });
    } else if (op.op === 'new') {
      // A file that does not read back is dropped (its blob is collected on load).
      const files = (op.files ?? []).map(restoreRef).filter((f): f is AttachmentRef => f !== null);
      const { files: _kept, ...rest } = op;
      out.push({ ...item, op: files.length > 0 ? { ...rest, files } : rest });
    } else {
      out.push(item);
    }
  }
  return out;
}

/** What was read back from the phone's storage, checked like a document of the hub (MSEC-13). */
export function restore(raw: unknown, shownAreas: ReadonlySet<string> | null): Pending[] {
  const kit = new KitQueue<QueueOp>({
    store: { load: async () => null, save: async () => {}, clear: async () => {} },
    validOp,
    needsIfMatch,
    ifMatchOf,
    newId: () => '',
    now: () => new Date(0),
  });
  return settle(kit.restore(Array.isArray(raw) ? raw.map(migrate) : raw, shownAreas));
}

/** The files a new write names (to be sent after it). */
export function filesOf(item: Pending): AttachmentRef[] {
  return item.op.op === 'new' ? (item.op.files ?? []) : [];
}

/** The keys of the files a write names. */
function keysOf(item: Pending): string[] {
  if (item.op.op === 'upload') return [item.op.file.key];
  return filesOf(item).map((f) => f.key);
}

/** The hub's answer, or what went wrong on the way, as the kit's queue reads it. */
function outcomeOf(error: unknown): SendOutcome {
  if (error instanceof Unreachable) return { kind: 'unreachable' };
  if (error instanceof Unpaired) return { kind: 'unpaired' };
  if (error instanceof HubRefused && (error.status === 429 || error.status === 503)) return { kind: 'busy' };
  if (error instanceof HubRefused) return { kind: 'refused', code: error.code, message: error.message };
  if (error instanceof AnswerLost) return { kind: 'lost' };
  // Anything else (a reply this page cannot read): the write may have arrived.
  return { kind: 'lost' };
}

export class WriteQueue {
  private readonly kit: KitQueue<QueueOp>;

  constructor(
    store: QueueStore,
    private readonly newId: () => string,
    private readonly now: () => Date,
    /** Called after every change of `items` (the page redraws). */
    changed: () => void = () => {},
    /** Where the files of the writes wait. */
    readonly fileStore: FileStore = memoryFileStore(),
  ) {
    this.kit = new KitQueue<QueueOp>({
      // What is read back is taken over (an entry of the old queue), checked and settled on the way in, before the kit
      // sets its items and the page is told: the page never sees an entry that `settle` would drop.
      store: { load: async () => restore(await store.load(), null), save: (items) => store.save(items), clear: () => store.clear() },
      validOp,
      needsIfMatch,
      ifMatchOf,
      newId,
      now,
      changed,
    });
  }

  get items(): Pending[] {
    return this.kit.items;
  }

  get full(): boolean {
    return this.kit.full;
  }

  async load(shownAreas: ReadonlySet<string> | null): Promise<void> {
    await this.kit.load(shownAreas);
    // A file no write names any more (dropped, sent, or of an area that is not shown now) does not stay (MSEC-12).
    const named = new Set(this.kit.items.flatMap(keysOf));
    for (const key of await this.fileStore.keys()) if (!named.has(key)) await this.fileStore.delete(key);
  }

  /**
   * Put a write into the queue; a new task with the files that are to follow it (kept in the `FileStore` already). A
   * change without `if_match` is refused (`if_match required`): offline, a change is only kept with the version seen.
   */
  async add(op: Op, area: string, label: string, files: AttachmentRef[] = []): Promise<Pending> {
    const queued: QueueOp = op.op === 'new' && files.length > 0 ? { ...op, files } : op;
    return this.kit.add(queued, area, label);
  }

  /** The files of a new task become uploads to the id the engine gave, in its place in the queue. */
  private followers(item: Pending, id: string | null): Pending[] {
    return filesOf(item).map((file) => ({
      clientOpId: this.newId(),
      op: { op: 'upload', id: id ?? `${item.scope}/unknown`, file },
      scope: item.scope,
      label: item.label,
      queuedAt: this.now().toISOString(),
      // Without the id the engine gave, a file has no task to go to.
      ...(id !== null && id.startsWith(`${item.scope}/`)
        ? { state: 'waiting' as const }
        : { state: 'refused' as const, code: 'no_id', message: 'the engine named no task for the file' }),
    }));
  }

  /** Send one write: a file is read from the phone's store first; a file that is gone is refused, never sent empty. */
  private async sendOne(source: DataSource, clientOpId: string, op: QueueOp): Promise<SendOutcome> {
    let outcome;
    try {
      if (op.op === 'upload') {
        const blob = await this.fileStore.get(op.file.key);
        if (!blob) return { kind: 'refused', code: 'file_gone', message: 'the file is no longer on this phone' };
        outcome = await source.upload(op.id, blob, op.file.name);
      } else if (op.op === 'new') {
        const { files: _files, ...sent } = op;
        outcome = await source.write(clientOpId, sent);
      } else {
        outcome = await source.write(clientOpId, op);
      }
    } catch (error) {
      return outcomeOf(error);
    }
    // A file the task has under its name already arrived with an earlier try whose answer was lost: the hub sends uploads
    // with `exact` (tasks.nvim b32f653), so the engine says `exists` instead of attaching it a second time.
    if (!outcome.ok && op.op === 'upload' && outcome.code === 'exists') {
      await this.fileStore.delete(op.file.key);
      return { kind: 'done' };
    }
    if (!outcome.ok) {
      return outcome.code === 'conflict'
        ? { kind: 'conflict', message: outcome.message }
        : { kind: 'refused', code: outcome.code, message: outcome.message };
    }
    if (op.op === 'upload') await this.fileStore.delete(op.file.key);
    if (op.op === 'new') {
      // The files follow in the place of the new task (the kit takes the task out after this); the same run sends them.
      const at = this.kit.items.findIndex((i) => i.clientOpId === clientOpId);
      const item = this.kit.items[at];
      if (item) {
        const follow = this.followers(item, outcome.id);
        this.kit.items.splice(at + 1, 0, ...follow);
        for (const f of follow) if (f.state === 'refused' && f.op.op === 'upload') await this.fileStore.delete(f.op.file.key);
      }
    }
    return { kind: 'done' };
  }

  /**
   * Send what waits, one after the other, in the order it was queued; the uploads a new task leaves in its place
   * follow in the same run. Only one run at a time.
   */
  flush(source: DataSource): Promise<FlushReport> {
    return this.kit.flush((clientOpId, op) => this.sendOne(source, clientOpId, op));
  }

  /** The user looked and wants an `unknown` or refused write sent again (same id: a hub that tells a repeat can). */
  retry(clientOpId: string): Promise<void> {
    return this.kit.retry(clientOpId);
  }

  /** The user drops a write (it arrived after all, or it is not wanted any more); its files go with it. */
  async drop(clientOpId: string): Promise<void> {
    const keys = this.kit.items.filter((i) => i.clientOpId === clientOpId).flatMap(keysOf);
    await this.kit.drop(clientOpId);
    if (this.kit.items.some((i) => i.clientOpId === clientOpId)) return; // being sent: it stays, and so do its files
    for (const key of keys) await this.fileStore.delete(key);
  }

  /** Forget everything (the phone is unpaired: MSEC-12). */
  async clear(): Promise<void> {
    await this.kit.clear();
    await this.fileStore.clear();
  }
}
