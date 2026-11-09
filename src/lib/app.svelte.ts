// The state of the page and what the user can do. Everything outside the page (the hub, the phone's storage, the
// clock, the ids) comes in through `AppDeps`, so the tests run it without a browser (MTST-03).

import { checkDraft, type Draft, type DraftProblem } from './capture';
import { ShapeError } from './parse';
import { WriteQueue, type Pending, type QueueStore } from './queue';
import { allows, DEFAULT_RIGHTS, type Right } from './rights';
import { HubRefused, Unpaired, Unreachable, type DataSource } from './source';
import type { KeptView } from './storage';
import { isFresh } from './storage';
import type { CacheStore } from 'appkit-ui/cache';
import type { DonePreview, Op, Status, TaskBrief, TaskDetail, VaultView } from './types';
import type { TextKey } from './i18n';

export type Screen = 'pair' | 'list' | 'capture' | 'queue' | 'task';
export type Connection = 'checking' | 'live' | 'offline';

export interface AppDeps {
  /** The source for a session token (`null` in the fake build, which needs none). */
  source(token: string | null): DataSource;
  /** This phone at the hub (`appkit-ui/device`): paired once with a key of its own, logged in on every start. */
  device: DeviceAccess;
  /** `true` in the fake build: no pairing, the synthetic vault. */
  fake: boolean;
  viewStore: CacheStore<KeptView>;
  queueStore: QueueStore;
  now(): Date;
  newId(): string;
  /** Timers for the next try while offline; without them (the tests that do not ask for it) no try is planned. */
  timer?: RetryTimer;
  /** Whether the page is shown; a page in the background asks nothing. */
  visible?(): boolean;
}

export interface RetryTimer {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/**
 * The waits before each new try while the page is offline in front: a tunnel that comes back changes nothing the page
 * would hear of (no `online`, no `visibilitychange`), so it asks again by itself, less often the longer it lasts.
 */
export const RETRY_MS = [5_000, 15_000, 60_000];

/** What a start finds at the hub for this device. */
export type DeviceLogin = { kind: 'session'; token: string } | { kind: 'unpaired' } | { kind: 'refused' };

export interface DeviceAccess {
  /** Pair with a one-time code under a name; a first session token. */
  pair(code: string, name: string): Promise<string>;
  /** A session for the device kept here; throws when the hub cannot be reached (the device is kept then). */
  login(): Promise<DeviceLogin>;
  /** Forget the device on this phone (revoking it is the PC's). */
  forget(): Promise<void>;
}

/** The name a phone is paired under when the person gives none. */
export const DEFAULT_DEVICE_NAME = 'Phone';

/** A message the page shows: a key of the dictionary and its values. */
export interface Notice {
  key: TextKey;
  params?: Record<string, string | number>;
  tone: 'info' | 'error';
  /** The queued write the notice speaks of ("waiting for the PC"): it follows that write until it is gone. */
  op?: string;
}

const PAIR_CODE = /(?:^|[#&?])pair=([0-9a-f]{32,128})(?:&|$)/;

/** The code in a pasted link (`...#pair=<code>`) or the code itself; `null` when it is neither. */
export function pairingCodeOf(text: string): string | null {
  const t = text.trim();
  if (/^[0-9a-f]{32,128}$/.test(t)) return t;
  return PAIR_CODE.exec(t)?.[1] ?? null;
}

export class App {
  screen = $state<Screen>('list');
  connection = $state<Connection>('checking');
  view = $state<VaultView | null>(null);
  viewAt = $state<string | null>(null);
  detail = $state<TaskDetail | null>(null);
  /** The task opened from the list, shown while its detail loads or when it cannot load. */
  opened = $state<TaskBrief | null>(null);
  preview = $state<DonePreview | null>(null);
  notice = $state<Notice | null>(null);
  engineProblem = $state<string | null>(null);
  problems = $state<DraftProblem[]>([]);
  pending = $state<WriteQueue['items']>([]);
  rights: ReadonlySet<Right> = DEFAULT_RIGHTS;
  busy = $state(false);

  readonly queue: WriteQueue;
  private token: string | null = null;
  private source: DataSource | null = null;

  constructor(private readonly deps: AppDeps) {
    this.queue = new WriteQueue(deps.queueStore, deps.newId, deps.now, () => {
      this.pending = this.queue.items.map((i) => ({ ...i }));
      this.followQueued();
    });
  }

  /**
   * "Waiting for the PC" stays true only while the write waits: sent, it says "created"; not taken, it says so. A
   * write dropped by the person, or a queue deleted on unpairing, takes the notice with it (see `drop`, `forget`).
   */
  private followQueued(): void {
    const notice = this.notice;
    if (notice?.key !== 'capture.queued' || notice.op === undefined) return;
    const left = this.queue.items.find((i) => i.clientOpId === notice.op);
    if (!left) this.notice = { key: 'capture.created', params: notice.params, tone: 'info' };
    else if (left.state !== 'waiting' && left.state !== 'sending') {
      this.notice = { key: 'capture.not_taken', params: notice.params, tone: 'error' };
    }
  }

  get kind(): 'hub' | 'fake' {
    return this.deps.fake ? 'fake' : 'hub';
  }

  /** The areas new tasks may go to. */
  get areas(): string[] {
    return this.view?.areas.map((a) => a.name) ?? [];
  }

  /**
   * Start: the copy kept on the phone first (so the page is useful offline at once), then the hub. `pairingCode` is
   * the code taken out of the address (`takePairingCode`), if the page was opened with one.
   */
  async start(pairingCode: string | null): Promise<void> {
    let kept = await this.deps.viewStore.load();
    if (kept && !isFresh(kept, this.deps.now())) {
      // Too old to stand for the vault: gone, not shown (MOB-08, MSEC-12).
      await this.deps.viewStore.clear();
      kept = null;
    }
    if (kept) {
      this.view = kept.view;
      this.viewAt = kept.at;
    }
    await this.queue.load(kept ? new Set(kept.view.areas.map((a) => a.name)) : null);
    if (this.deps.fake) {
      this.connect(null);
    } else if (pairingCode !== null) {
      await this.pair(pairingCode, DEFAULT_DEVICE_NAME);
      return;
    } else if (!(await this.login())) {
      // No hub at the start: the device waits for its login, and the next try is planned like after any run.
      this.planRetry();
      return;
    }
    await this.refresh();
  }

  /**
   * A session for the device kept on this phone, without a code. False when there is none: no device (the pairing
   * screen), a device the hub refused (revoked: the pairing screen, and said so), or no hub to ask (offline, with
   * the kept list; the next refresh asks again).
   */
  private async login(): Promise<boolean> {
    let result: DeviceLogin;
    try {
      result = await this.deps.device.login();
    } catch {
      this.connection = 'offline';
      this.loginPending = true;
      return false;
    }
    this.loginPending = false;
    if (result.kind === 'session') {
      this.connect(result.token);
      return true;
    }
    this.token = null;
    this.source = null;
    this.connection = 'offline';
    this.screen = 'pair';
    this.notice = result.kind === 'refused' ? { key: 'pair.revoked', tone: 'error' } : null;
    return false;
  }

  /** The device is kept but no session was opened yet (the hub was not reached at the start). */
  private loginPending = false;

  private connect(token: string | null): void {
    this.token = token;
    this.source = this.deps.source(token);
  }

  /** Pair this phone with a code (once), and load the vault. */
  async pair(code: string, name: string = DEFAULT_DEVICE_NAME): Promise<boolean> {
    const clean = pairingCodeOf(code);
    if (clean === null) {
      this.notice = { key: 'pair.bad', tone: 'error' };
      this.screen = 'pair';
      return false;
    }
    try {
      const token = await this.deps.device.pair(clean, name.trim() === '' ? DEFAULT_DEVICE_NAME : name.trim());
      this.connect(token);
      this.notice = null;
      this.screen = 'list';
      await this.refresh();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.notice = { key: 'pair.failed', params: { message }, tone: 'error' };
      this.screen = 'pair';
      return false;
    }
  }

  /** The session is gone (the hub restarted, or the device was revoked): back to pairing, nothing waiting is lost. */
  private unpaired(): void {
    this.token = null;
    this.source = null;
    this.connection = 'offline';
    this.screen = 'pair';
    this.notice = { key: 'pair.lost', tone: 'error' };
  }

  /** Say what went wrong (MOB-09): never an empty list in place of an error. */
  private failed(error: unknown): void {
    // A refused session outside a refresh: the refresh opens a new one for the device, or asks for pairing.
    if (error instanceof Unpaired) {
      void this.refresh();
      return;
    }
    if (error instanceof Unreachable) {
      this.connection = 'offline';
      return;
    }
    if (error instanceof ShapeError) this.notice = { key: 'error.shape', tone: 'error' };
    else if (error instanceof HubRefused) this.notice = { key: 'error.refused', params: { message: error.message }, tone: 'error' };
    else this.notice = { key: 'error.refused', params: { message: error instanceof Error ? error.message : String(error) }, tone: 'error' };
  }

  private running: Promise<void> | null = null;
  private again = false;

  /**
   * Load the vault from the hub; send what waits first, so the list shows the hub's answer to it. One run at a time
   * (WEB-08): a call during a run makes one more run after it, never a second one beside it.
   */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.load();
        } while (this.again);
      } finally {
        this.running = null;
        this.planRetry();
      }
    })();
    return this.running;
  }

  private retryHandle: unknown = null;
  private retries = 0;

  /** Whether there is a hub to ask again: a session, or a device whose login is still to be made. */
  get canRetry(): boolean {
    return this.paired || this.loginPending;
  }

  /** After a run: offline in front, the next try is set (one at a time); live, the waits start over. */
  private planRetry(): void {
    const timer = this.deps.timer;
    if (!timer) return;
    if (this.connection !== 'offline' || !this.canRetry) {
      this.retries = 0;
      this.stopRetry();
      return;
    }
    if (this.retryHandle !== null || !(this.deps.visible?.() ?? true)) return;
    const ms = RETRY_MS[Math.min(this.retries, RETRY_MS.length - 1)]!;
    this.retries += 1;
    this.retryHandle = timer.set(() => {
      this.retryHandle = null;
      if (this.deps.visible?.() ?? true) void this.refresh();
    }, ms);
  }

  private stopRetry(): void {
    if (this.retryHandle !== null) this.deps.timer?.clear(this.retryHandle);
    this.retryHandle = null;
  }

  /** The page went to the background: no tries until it is back (then `refresh` plans again). */
  pause(): void {
    this.stopRetry();
  }

  /** A new session for the device after the hub refused the old one (it restarted); false: pair again. */
  private async renew(): Promise<boolean> {
    this.token = null;
    this.source = null;
    if (this.deps.fake) return false;
    const ok = await this.login();
    if (!ok && this.screen === 'pair' && this.notice === null) this.notice = { key: 'pair.lost', tone: 'error' };
    return ok;
  }

  private async load(retry = true): Promise<void> {
    if (!this.source && this.loginPending && !(await this.login())) return;
    const source = this.source;
    if (!source) return;
    this.connection = 'checking';
    try {
      const hello = await source.hello();
      this.engineProblem = hello.engineReady ? null : (hello.engineProblem ?? '?');
      const report = await this.queue.flush(source);
      if (report.stopped === 'unpaired') {
        if (retry && (await this.renew())) return this.load(false);
        if (this.screen !== 'pair') this.unpaired();
        return;
      }
      const view = await source.vault();
      this.view = view;
      this.viewAt = this.deps.now().toISOString();
      this.connection = 'live';
      // An error said before is over once the hub answered in full; a word of information stays.
      if (this.notice?.tone === 'error') this.notice = null;
      await this.deps.viewStore.save({ view, at: this.viewAt });
    } catch (error) {
      if (error instanceof Unpaired) {
        if (retry && (await this.renew())) return this.load(false);
        if (this.screen !== 'pair') this.unpaired();
        return;
      }
      this.failed(error);
      if (this.connection === 'checking') this.connection = 'offline';
    }
  }

  async openTask(brief: TaskBrief): Promise<void> {
    this.opened = brief;
    this.detail = null;
    this.preview = null;
    this.screen = 'task';
    if (!this.source || this.connection === 'offline') return;
    try {
      this.detail = await this.source.task(brief.id);
    } catch (error) {
      this.failed(error);
    }
  }

  /** Queue a write and try to send it now; the list changes only with the hub's answer (MOB-07). */
  private async enqueue(op: Op, area: string, label: string): Promise<Pending | null> {
    if (!allows(this.rights, op)) {
      this.notice = { key: 'task.not_allowed', tone: 'error' };
      return null;
    }
    if (this.queue.full) {
      this.notice = { key: 'queue.full', tone: 'error' };
      return null;
    }
    const item = await this.queue.add(op, area, label);
    if (this.source && this.connection !== 'offline') await this.refresh();
    return item;
  }

  async capture(draft: Draft): Promise<boolean> {
    const checked = checkDraft(draft, this.areas);
    if (!checked.ok) {
      this.problems = checked.problems;
      return false;
    }
    this.problems = [];
    this.busy = true;
    try {
      const item = await this.enqueue(checked.op, checked.op.area, checked.op.title);
      if (!item) return false;
      // Say what became of it: taken by the engine (gone from the queue), still waiting, or not taken.
      const left = this.queue.items.find((i) => i.clientOpId === item.clientOpId);
      const params = { title: checked.op.title };
      if (!left) this.notice = { key: 'capture.created', params, tone: 'info' };
      else if (left.state === 'waiting' || left.state === 'sending') {
        this.notice = { key: 'capture.queued', params, tone: 'info', op: item.clientOpId };
      }
      else this.notice = { key: 'capture.not_taken', params, tone: 'error' };
      return true;
    } finally {
      this.busy = false;
    }
  }

  private async reopen(): Promise<void> {
    const brief = this.opened;
    if (!brief || !this.source || this.connection !== 'live') return;
    const fresh = this.view?.tasks.find((t) => t.id === brief.id);
    // A task that left the list (finished) is shown from what was opened; its detail is read again either way.
    this.opened = fresh ?? brief;
    try {
      this.detail = await this.source.task(brief.id);
    } catch (error) {
      this.failed(error);
    }
  }

  async setStatus(task: TaskBrief, status: Status): Promise<void> {
    const op: Op = { op: 'set', id: task.id, patch: { status }, ...(task.etag ? { if_match: task.etag } : {}) };
    this.busy = true;
    try {
      await this.enqueue(op, task.area, task.title);
      await this.reopen();
    } finally {
      this.busy = false;
    }
  }

  async answer(task: TaskBrief, question: string, option: number): Promise<void> {
    const op: Op = { op: 'answer', id: task.id, question, option, ...(task.etag ? { if_match: task.etag } : {}) };
    this.busy = true;
    try {
      await this.enqueue(op, task.area, task.title);
      await this.reopen();
    } finally {
      this.busy = false;
    }
  }

  /** Ask the engine what finishing would do; only with a connection (the preview is the engine's). */
  async askFinish(task: TaskBrief): Promise<void> {
    if (!this.source || this.connection !== 'live') {
      this.notice = { key: 'task.done_offline', tone: 'info' };
      return;
    }
    try {
      this.preview = await this.source.donePreview(task.id);
    } catch (error) {
      this.failed(error);
    }
  }

  async finish(task: TaskBrief): Promise<void> {
    const confirm = this.preview?.confirm;
    this.preview = null;
    if (!confirm) return;
    this.busy = true;
    try {
      const item = await this.enqueue({ op: 'done', id: task.id, confirm }, task.area, task.title);
      if (item && !this.queue.items.some((i) => i.clientOpId === item.clientOpId)) {
        // Taken by the engine: a finished task is no task to read any more ("no such task"), so back to the list.
        this.opened = null;
        this.detail = null;
        this.screen = 'list';
        this.notice = { key: 'task.done_ok', params: { title: task.title }, tone: 'info' };
      } else {
        await this.reopen();
      }
    } finally {
      this.busy = false;
    }
  }

  async sendNow(): Promise<void> {
    await this.refresh();
  }

  async retry(clientOpId: string): Promise<void> {
    await this.queue.retry(clientOpId);
    await this.refresh();
  }

  async drop(clientOpId: string): Promise<void> {
    if (this.notice?.op === clientOpId) this.notice = null;
    await this.queue.drop(clientOpId);
  }

  /** Unpair this phone: the session, the copy and the queue go (MSEC-12). */
  async forget(): Promise<void> {
    await this.deps.device.forget();
    if (this.notice?.op !== undefined) this.notice = null;
    this.token = null;
    this.source = this.deps.fake ? this.deps.source(null) : null;
    await this.deps.viewStore.clear();
    await this.queue.clear();
    this.view = null;
    this.viewAt = null;
    this.detail = null;
    this.opened = null;
    this.connection = 'offline';
    this.screen = this.deps.fake ? 'list' : 'pair';
  }

  get paired(): boolean {
    return this.deps.fake || this.token !== null;
  }
}
