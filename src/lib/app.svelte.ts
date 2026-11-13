// The state of the page and what the user can do. Everything outside the page (the hub, the phone's storage, the
// clock, the ids) comes in through `AppDeps`, so the tests run it without a browser (MTST-03).

import { assetName, checkAttachment, type AttachmentProblem, type AttachmentRef, type FileStore, type NewAttachment } from './attach';
import { checkDraft, emptyForm, formHolds, restoreDraft, type CaptureForm, type Draft, type DraftProblem, type KeptDraft } from './capture';
import { ExportClassError, MAX_EXPORT_BYTES, phoneExport, ShapeError } from './parse';
import { PUSH_KINDS, type PushAccess, type PushState } from './push';
import { filesOf, WriteQueue, type Pending, type QueueStore } from './queue';
import { allows, DEFAULT_RIGHTS, rightsOf, type Right } from './rights';
import { AnswerLost, HubRefused, Unpaired, Unreachable, type DataSource } from './source';
import type { KeptView } from './storage';
import { isFresh } from './storage';
import { localDay } from './today';
import type { CacheStore } from 'appkit-ui/cache';
import type { ConfirmRequest, DonePreview, Op, Status, TaskBrief, TaskDetail, TestingRun, VaultView } from './types';
import type { TextKey } from './i18n';
import type { Shared } from './share';

export type Screen = 'pair' | 'today' | 'list' | 'capture' | 'queue' | 'task';
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
  /** Where the files of a capture wait until they are sent (memory when not given). */
  fileStore?: FileStore;
  /** The draft of the capture form, kept across an end of the app (none: kept in memory only). */
  draftStore?: CacheStore<KeptDraft>;
  /** The files of the draft (apart from the queue's, whose start collects files no write names). */
  draftFiles?: FileStore;
  now(): Date;
  newId(): string;
  /** Timers for the next try while offline; without them (the tests that do not ask for it) no try is planned. */
  timer?: RetryTimer;
  /** Whether the page is shown; a page in the background asks nothing. */
  visible?(): boolean;
  /** Notices from the hub (Web Push); without it the page offers none. */
  push?: PushAccess;
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

/** How long the start waits for the browser to say whether notices are on. */
export const PUSH_READ_MS = 2_000;

/** What a start finds at the hub for this device. */
export type DeviceLogin = { kind: 'session'; token: string } | { kind: 'unpaired' } | { kind: 'refused' };

export interface DeviceAccess {
  /** Pair with a one-time code under a name; a first session token. */
  pair(code: string, name: string): Promise<string>;
  /** A session for the device kept here; throws when the hub cannot be reached (the device is kept then). */
  login(): Promise<DeviceLogin>;
  /** Forget the device on this phone (revoking it is the PC's). */
  forget(): Promise<void>;
  /** Sign one request for its confirmation (`x-device-confirm`); only after the person confirmed it on the page. */
  confirm: ConfirmRequest;
  /** Whether this device can confirm (it was paired with a confirmation key). */
  canConfirm(): Promise<boolean>;
}

/** How long the page waits between two looks at a run of the test sheets. */
export const RUN_POLL_MS = 3_000;

/** The name a phone is paired under when the person gives none. */
export const DEFAULT_DEVICE_NAME = 'Phone';

/** A message the page shows: a key of the dictionary and its values. */
export interface Notice {
  key: TextKey;
  params?: Record<string, string | number>;
  tone: 'info' | 'error';
  /** The queued write the notice speaks of ("waiting for the PC"): it follows that write until it is gone. */
  op?: string;
  /** The keys of the files of that write: once the task is made, the notice follows them until they are sent. */
  files?: string[];
}

const PAIR_CODE = /(?:^|[#&?])pair=([0-9a-f]{32,128})(?:&|$)/;

/** The code in a pasted link (`...#pair=<code>`) or the code itself; `null` when it is neither. */
export function pairingCodeOf(text: string): string | null {
  const t = text.trim();
  if (/^[0-9a-f]{32,128}$/.test(t)) return t;
  return PAIR_CODE.exec(t)?.[1] ?? null;
}

export class App {
  /** The page starts on "Today" (what is next, open questions, what is due, the counts). */
  screen = $state<Screen>('today');
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
  /** Why a file of the capture was not taken. */
  fileProblem = $state<AttachmentProblem | 'store' | null>(null);
  pending = $state<WriteQueue['items']>([]);
  /** Notices of the hub on this phone: not offered, off, on, or refused in the browser's settings. */
  pushState = $state<PushState>('unsupported');
  /** The capture form as it was left, until it is created or discarded (see `CaptureForm`). */
  form = $state<CaptureForm>(emptyForm());
  /** What this device may do, as the hub told it at the last load (`/api/tasks/device`); the page offers only that. */
  rights = $state<ReadonlySet<Right>>(DEFAULT_RIGHTS);
  /** The level the hub told, `null` before it told one (or a hub that does not tell it). */
  level = $state<Right | null>(null);
  /** Counts the writes of the task page the PC refused as a conflict: the page sets its choices back to the new state. */
  conflicts = $state(0);
  busy = $state(false);
  /**
   * What is shown came from an export file (`tasks-hub phone export`), not from the hub: read only. Creating and
   * changing need the hub; the page says so instead of queueing. The next answer of the hub takes its place.
   */
  fromFile = $state(false);
  /** The test sheets that name the opened task (`null`: not asked, or no way to the testing hub: `sheetsProblem`). */
  sheets = $state<string[] | null>(null);
  /** Why there are no sheets to show: the code of the hub (`testing_not_linked`, ...). */
  sheetsProblem = $state<string | null>(null);
  /** Where the run of the testing hub stands, as last asked. */
  testing = $state<TestingRun | null>(null);
  /** Whether this device can confirm a start (paired with a confirmation key). */
  confirmable = $state(false);

  readonly queue: WriteQueue;
  private token: string | null = null;
  private source: DataSource | null = null;

  constructor(private readonly deps: AppDeps) {
    this.queue = new WriteQueue(
      deps.queueStore,
      deps.newId,
      deps.now,
      () => {
        this.pending = this.queue.items.map((i) => ({ ...i }));
        this.followQueued();
      },
      deps.fileStore,
    );
  }

  /**
   * "Waiting for the PC" stays true only while the write waits: sent, it says "created"; not taken, it says so. A
   * write dropped by the person, or a queue deleted on unpairing, takes the notice with it (see `drop`, `forget`).
   */
  private followQueued(): void {
    const notice = this.notice;
    if (notice?.key !== 'capture.queued' || notice.op === undefined) return;
    const left = this.queue.items.find((i) => i.clientOpId === notice.op);
    if (left) {
      if (left.state !== 'waiting' && left.state !== 'sending') {
        this.notice = { key: 'capture.not_taken', params: notice.params, tone: 'error' };
      }
      return;
    }
    // The task is made; its files went in its place. "Created" only once none of them is left; one the hub did not
    // take is said, never hidden behind "created" (MOB-09).
    const files = this.uploadsOf(notice.files ?? []);
    if (files.length === 0) this.notice = { key: 'capture.created', params: notice.params, tone: 'info' };
    else if (files.some((i) => i.state !== 'waiting' && i.state !== 'sending')) {
      this.notice = { key: 'capture.files_wait', params: notice.params, tone: 'error' };
    }
  }

  /** The uploads in the queue of the files with these keys. */
  private uploadsOf(keys: readonly string[]): Pending[] {
    return this.queue.items.filter((i) => i.op.op === 'upload' && keys.includes(i.op.file.key));
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
    await this.restoreForm();
    let kept = await this.deps.viewStore.load();
    if (kept && !isFresh(kept, this.deps.now())) {
      // Too old to stand for the vault: gone, not shown (MOB-08, MSEC-12).
      await this.deps.viewStore.clear();
      kept = null;
    }
    if (kept) {
      this.view = kept.view;
      this.viewAt = kept.at;
      this.fromFile = kept.from === 'file';
    }
    await this.queue.load(kept ? new Set(kept.view.areas.map((a) => a.name)) : null);
    await this.readPush();
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
    // A phone that reads an export file is not paired by intent: it stays on what the file shows.
    if (!this.fromFile || result.kind === 'refused') this.screen = 'pair';
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
      this.screen = 'today';
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
    // the code goes with it: a phone gets no words of the engine (the hub cuts them), the page says the code in its own
    else if (error instanceof HubRefused) this.notice = { key: 'error.refused', params: { message: error.message, code: error.code }, tone: 'error' };
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
    // The app may be ended in the background: what is in the form is kept now.
    void this.keepForm();
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
      await this.readLevel(source);
      const report = await this.queue.flush(source);
      if (report.stopped === 'unpaired') {
        if (retry && (await this.renew())) return this.load(false);
        if (this.screen !== 'pair') this.unpaired();
        return;
      }
      const view = await source.vault();
      this.view = view;
      this.viewAt = this.deps.now().toISOString();
      this.fromFile = false;
      this.connection = 'live';
      // An error of the hub said before (`error.*`) is over once the hub answered in full. What a write came to (not
      // taken, a file that waits) stays until the person moves on: it is about the write, not about the hub.
      if (this.notice?.tone === 'error' && this.notice.key.startsWith('error.')) this.notice = null;
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

  /**
   * The level of this device as the hub says it now (the PC may have changed it). A hub that does not tell it, or an
   * answer that is no level, leaves what the page had: the hub judges every request anyway.
   */
  private async readLevel(source: DataSource): Promise<void> {
    try {
      const level = await source.level();
      this.level = level;
      this.rights = rightsOf(level);
    } catch (error) {
      if (!(error instanceof HubRefused) && !(error instanceof ShapeError)) throw error;
    }
  }

  /** May this device do that now? */
  may(right: Right): boolean {
    return this.rights.has(right);
  }

  /** The screen a task was opened from ("Today" or the list): "back" and a finish go there. */
  returnTo = $state<'today' | 'list'>('list');

  async openTask(brief: TaskBrief): Promise<void> {
    if (this.screen === 'today' || this.screen === 'list') this.returnTo = this.screen;
    this.opened = brief;
    this.detail = null;
    this.preview = null;
    this.screen = 'task';
    this.sheets = null;
    this.sheetsProblem = null;
    if (!this.source || this.connection === 'offline') return;
    try {
      this.detail = await this.source.task(brief.id);
    } catch (error) {
      this.failed(error);
      return;
    }
    await this.loadSheets(brief.id);
  }

  /** The test sheets of the task, and whether a run can be confirmed here; a hub without the way says why. */
  private async loadSheets(id: string): Promise<void> {
    const source = this.source;
    if (!source || this.connection !== 'live') return;
    try {
      this.confirmable = await this.deps.device.canConfirm();
      const sheets = await source.testingSheets(id);
      if (this.opened?.id !== id) return;
      this.sheets = sheets;
      if (sheets && sheets.length > 0) this.testing = await source.testingRun();
    } catch (error) {
      if (error instanceof HubRefused) this.sheetsProblem = error.code;
      else if (!(error instanceof Unreachable)) this.failed(error);
    }
  }

  /**
   * Start the test sheets of the task on the PC, after the person confirmed it in the dialog: the device signs exactly
   * this request. Sent once: a lost answer is said, never sent again by itself (MOB-07).
   */
  async startRun(task: TaskBrief): Promise<void> {
    const source = this.source;
    if (!source || this.connection !== 'live' || this.fromFile) {
      this.notice = { key: 'testing.offline', tone: 'info' };
      return;
    }
    if (!this.may('trigger') || !this.confirmable) {
      this.notice = { key: 'task.not_allowed', tone: 'error' };
      return;
    }
    this.busy = true;
    try {
      this.testing = await source.testingStart(task.id, this.deps.device.confirm);
      this.notice = { key: 'testing.started', tone: 'info' };
      this.followRun();
    } catch (error) {
      if (error instanceof AnswerLost) this.notice = { key: 'testing.lost', tone: 'error' };
      else if (error instanceof HubRefused) this.notice = { key: 'testing.refused', params: { code: error.code }, tone: 'error' };
      else this.failed(error);
    } finally {
      this.busy = false;
    }
  }

  /** Look at the run again (the button, and the timer while it runs). */
  async refreshRun(): Promise<void> {
    const source = this.source;
    if (!source || this.connection !== 'live') return;
    try {
      this.testing = await source.testingRun();
    } catch (error) {
      if (!(error instanceof HubRefused) && !(error instanceof Unreachable)) this.failed(error);
    }
  }

  private runHandle: unknown = null;

  /** While the run of the opened task runs and the page is in front, look again now and then. */
  private followRun(): void {
    const timer = this.deps.timer;
    if (!timer || this.runHandle !== null) return;
    const run = this.testing?.run;
    if (!run || !run.running) return;
    this.runHandle = timer.set(() => {
      this.runHandle = null;
      if (this.screen !== 'task' || !(this.deps.visible?.() ?? true)) return;
      void this.refreshRun().then(() => this.followRun());
    }, RUN_POLL_MS);
  }

  /** Queue a write and try to send it now; the list changes only with the hub's answer (MOB-07). */
  private async enqueue(op: Op, area: string, label: string, files: NewAttachment[] = []): Promise<Pending | null> {
    if (this.fromFile) {
      this.notice = { key: 'file.read_only', tone: 'info' };
      return null;
    }
    // A file of a new task is an upload, which changes the task: `change`.
    if (!allows(this.rights, op) || (files.length > 0 && !this.may('change'))) {
      this.notice = { key: 'task.not_allowed', tone: 'error' };
      return null;
    }
    if (this.queue.full) {
      this.notice = { key: 'queue.full', tone: 'error' };
      return null;
    }
    const refs = await this.keepFiles(files);
    if (refs === null) return null;
    let item: Pending;
    try {
      item = await this.queue.add(op, area, label, refs);
    } catch (error) {
      for (const ref of refs) await this.queue.fileStore.delete(ref.key);
      // A change without the version seen is never queued (MOB-08): the task is to be read again first.
      if (error instanceof Error && error.message === 'if_match required') this.notice = { key: 'task.no_version', tone: 'error' };
      else this.notice = { key: 'queue.full', tone: 'error' };
      return null;
    }
    if (this.source && this.connection !== 'offline') await this.refresh();
    return item;
  }

  /**
   * The files of a capture into the phone's store, each under a key of its own, before the write that names them is
   * queued; `null` (and nothing kept) when one cannot be kept.
   */
  private async keepFiles(files: NewAttachment[]): Promise<AttachmentRef[] | null> {
    const store = this.queue.fileStore;
    const at = this.deps.now();
    const refs: AttachmentRef[] = [];
    try {
      for (const [i, file] of files.entries()) {
        const ref: AttachmentRef = {
          key: this.deps.newId(),
          name: assetName(file.kind, file.blob.type, at, i + 1),
          type: file.blob.type.slice(0, 100),
          size: file.blob.size,
          kind: file.kind,
        };
        await store.put(ref.key, file.blob);
        refs.push(ref);
      }
      return refs;
    } catch {
      for (const ref of refs) await store.delete(ref.key);
      this.fileProblem = 'store';
      return null;
    }
  }

  /** Check a file the person picked or recorded against those of the capture so far; the problem, if any. */
  checkFile(file: NewAttachment, count: number): AttachmentProblem | null {
    const problem = checkAttachment(file, count);
    this.fileProblem = problem;
    return problem;
  }

  async capture(draft: Draft, files: NewAttachment[] = []): Promise<boolean> {
    const checked = checkDraft(draft, this.areas);
    if (!checked.ok) {
      this.problems = checked.problems;
      return false;
    }
    this.problems = [];
    // The files again, as the form may not have been the only way in.
    for (const [i, file] of files.entries()) if (this.checkFile(file, i) !== null) return false;
    this.fileProblem = null;
    this.busy = true;
    try {
      const item = await this.enqueue(checked.op, checked.op.area, checked.op.title, files);
      if (!item) return false;
      // Say what became of it: taken by the engine (gone from the queue), still waiting, or not taken.
      const left = this.queue.items.find((i) => i.clientOpId === item.clientOpId);
      const params = { title: checked.op.title };
      const keys = filesOf(item).map((f) => f.key);
      // Made, but a file of it still waits (no answer yet, or refused): it is under "Waiting".
      const filesLeft = !left && this.uploadsOf(keys).length > 0;
      if (filesLeft) this.notice = { key: 'capture.files_wait', params, tone: 'error' };
      else if (!left) this.notice = { key: 'capture.created', params, tone: 'info' };
      else if (left.state === 'waiting' || left.state === 'sending') {
        this.notice = { key: 'capture.queued', params, tone: 'info', op: item.clientOpId, files: keys };
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
      const item = await this.enqueue(op, task.area, task.title);
      await this.reopen();
      this.sayConflict(item);
    } finally {
      this.busy = false;
    }
  }

  /**
   * A write of the task page the PC refused because the file changed there: said on the page itself (not only under
   * "Waiting"), with the new state loaded and the choices set back to it.
   */
  private sayConflict(item: Pending | null): void {
    if (!item || this.queue.items.find((i) => i.clientOpId === item.clientOpId)?.state !== 'conflict') return;
    this.notice = { key: 'task.conflict', tone: 'error' };
    this.conflicts += 1;
  }

  async answer(task: TaskBrief, question: string, option: number): Promise<void> {
    const op: Op = { op: 'answer', id: task.id, question, option, ...(task.etag ? { if_match: task.etag } : {}) };
    this.busy = true;
    try {
      const item = await this.enqueue(op, task.area, task.title);
      await this.reopen();
      this.sayConflict(item);
    } finally {
      this.busy = false;
    }
  }

  /** Ask the engine what finishing would do; only with a connection (the preview is the engine's). */
  async askFinish(task: TaskBrief): Promise<void> {
    if (this.fromFile) {
      this.notice = { key: 'file.read_only', tone: 'info' };
      return;
    }
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
        this.screen = this.returnTo;
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

  /** Unpair this phone: the session, the copy, the queue and the notices go (MSEC-12). */
  async forget(): Promise<void> {
    if (this.pushState === 'on') await this.disablePush(false);
    await this.deps.device.forget();
    if (this.notice?.op !== undefined) this.notice = null;
    this.token = null;
    this.source = this.deps.fake ? this.deps.source(null) : null;
    await this.deps.viewStore.clear();
    await this.queue.clear();
    this.discardForm();
    this.view = null;
    this.viewAt = null;
    this.fromFile = false;
    this.rights = DEFAULT_RIGHTS;
    this.level = null;
    this.sheets = null;
    this.sheetsProblem = null;
    this.testing = null;
    this.confirmable = false;
    this.detail = null;
    this.opened = null;
    this.connection = 'offline';
    this.screen = this.deps.fake ? 'today' : 'pair';
  }

  /**
   * Open an export file (`tasks-hub phone export`, the third way): checked as strictly as a document of the hub, and
   * refused whole when it holds anything of another class (MOB-02). Shown read only, with the time of the file, and kept
   * like a list of the hub (the same 14 days, MOB-08), until the hub answers. False when it was not taken.
   */
  async openExport(file: Blob): Promise<boolean> {
    if (file.size > MAX_EXPORT_BYTES) {
      this.notice = { key: 'file.too_big', tone: 'error' };
      return false;
    }
    let taken;
    try {
      taken = phoneExport(JSON.parse(await file.text()));
    } catch (error) {
      this.notice = { key: error instanceof ExportClassError ? 'file.classes' : 'file.bad', tone: 'error' };
      return false;
    }
    const kept: KeptView = { view: taken.view, at: taken.exportedAt, from: 'file' };
    if (!isFresh(kept, this.deps.now())) {
      // Written later than the phone's now (more than the few minutes `isFresh` allows): the clock of one of them is off.
      const ahead = Date.parse(taken.exportedAt) > this.deps.now().getTime();
      this.notice = { key: ahead ? 'file.future' : 'file.old', tone: 'error' };
      return false;
    }
    this.view = taken.view;
    this.viewAt = taken.exportedAt;
    this.fromFile = true;
    this.detail = null;
    this.opened = null;
    this.screen = 'today';
    this.notice = { key: 'file.opened', params: { n: taken.view.tasks.length }, tone: 'info' };
    await this.deps.viewStore.save(kept);
    return true;
  }

  /**
   * A share of another app fills the form; what was typed there already is not taken away (the shared title goes to
   * the context then).
   */
  takeShare(shared: Shared): void {
    this.shared = shared;
    this.applyShare(shared);
    this.screen = 'capture';
  }

  /** A share of this start (laid over a draft read back later, so the share is not lost under it). */
  private shared: Shared | null = null;

  private applyShare(shared: Shared): void {
    const form = this.form;
    const lines = (...parts: string[]) => parts.map((p) => p.trim()).filter((p) => p !== '').join('\n');
    if (form.title.trim() === '') form.title = shared.title;
    else form.context = lines(form.context, shared.title);
    form.context = lines(form.context, shared.context);
    form.fromShare = true;
  }

  /** Empty the form, the previews of its files given back, and the kept draft with it. */
  discardForm(): void {
    for (const file of this.form.files) if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(file.url);
    this.form = emptyForm();
    this.fileProblem = null;
    // In the same line as the keeps: a keep on its way is not written after the draft was taken away.
    this.keeping = this.keeping.then(() => this.forgetKeptForm()).catch(() => {});
  }

  private async forgetKeptForm(): Promise<void> {
    await this.deps.draftStore?.clear();
    await this.deps.draftFiles?.clear();
  }

  private keeping: Promise<void> = Promise.resolve();

  /** Settles when every keep and forget asked for so far is done (tests, and before the page is torn down). */
  get kept(): Promise<void> {
    return this.keeping;
  }

  /**
   * Keep the form so that it outlives an end of the app (Android ends a page in the background): its text and its
   * files. One keep after the other; an empty form keeps nothing.
   */
  keepForm(): Promise<void> {
    this.keeping = this.keeping.then(() => this.keepFormNow()).catch(() => {});
    return this.keeping;
  }

  private async keepFormNow(): Promise<void> {
    const store = this.deps.draftStore;
    const files = this.deps.draftFiles;
    if (!store || !files) return;
    const form = this.form;
    if (!formHolds(form)) {
      await store.clear();
      await files.clear();
      return;
    }
    for (const file of form.files) {
      if (file.key) continue;
      const key = this.deps.newId();
      await files.put(key, file.blob);
      file.key = key;
    }
    const named = new Set(form.files.map((f) => f.key));
    for (const key of await files.keys()) if (!named.has(key)) await files.delete(key);
    await store.save({
      area: form.area,
      title: form.title,
      context: form.context,
      fromShare: form.fromShare,
      files: form.files.flatMap((f) => (f.key ? [{ key: f.key, kind: f.kind }] : [])),
    });
  }

  /** The draft kept at the last end of the app, back in the form (a share of this start laid over it). */
  private async restoreForm(): Promise<void> {
    const store = this.deps.draftStore;
    const files = this.deps.draftFiles;
    if (!store || !files) return;
    let kept: KeptDraft | null = null;
    try {
      kept = restoreDraft(await store.load());
    } catch {
      kept = null;
    }
    if (!kept) return;
    const picked: CaptureForm['files'] = [];
    for (const [i, f] of kept.files.entries()) {
      const blob = await files.get(f.key).catch(() => null);
      if (blob) picked.push({ id: i + 1, blob, kind: f.kind, url: URL.createObjectURL(blob), key: f.key });
    }
    this.form = { area: kept.area, title: kept.title, context: kept.context, fromShare: kept.fromShare, files: picked };
    if (this.shared) this.applyShare(this.shared);
  }

  /** What the browser says about notices of this page (no question asked). */
  private async readPush(): Promise<void> {
    const push = this.deps.push;
    if (!push?.supported()) {
      this.pushState = 'unsupported';
      return;
    }
    if (push.permission() === 'denied') {
      this.pushState = 'denied';
      return;
    }
    try {
      // The start does not wait long on the browser: unanswered, notices count as off.
      const late = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), PUSH_READ_MS));
      this.pushState = (await Promise.race([push.subscribed(), late])) ? 'on' : 'off';
    } catch {
      this.pushState = 'off';
    }
  }

  /**
   * Turn notices on: the browser asks for the permission now (on the button, never at the start), then the hub keeps
   * the subscription for reminders and decisions. Needs the hub: the key is the hub's.
   */
  async enablePush(): Promise<void> {
    const push = this.deps.push;
    if (!push?.supported()) return;
    if (!this.source || this.connection !== 'live') {
      this.notice = { key: 'push.offline', tone: 'info' };
      return;
    }
    this.busy = true;
    try {
      const key = await this.source.pushKey();
      const sub = await push.subscribe(key);
      if (!sub) {
        this.pushState = push.permission() === 'denied' ? 'denied' : 'off';
        this.notice = { key: 'push.refused', tone: 'error' };
        return;
      }
      try {
        await this.source.pushSubscribe({ ...sub, kinds: [...PUSH_KINDS] });
      } catch (error) {
        // The hub did not keep it: no subscription of the browser is left behind that nobody sends to.
        await push.unsubscribe().catch(() => {});
        throw error;
      }
      this.pushState = 'on';
      this.notice = { key: 'push.on', tone: 'info' };
    } catch (error) {
      if (error instanceof HubRefused && (error.status === 404 || error.status === 403)) {
        this.notice = { key: 'push.hub_none', tone: 'error' };
      } else {
        this.failed(error);
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * Turn notices off: the browser lets go of its subscription (a push service then tells the hub it is gone), and the
   * hub forgets it at once when it can be reached.
   */
  async disablePush(say = true): Promise<void> {
    const push = this.deps.push;
    if (!push) return;
    try {
      await push.unsubscribe();
    } catch {
      // Nothing to let go of.
    }
    this.pushState = push.permission() === 'denied' ? 'denied' : 'off';
    if (this.source && this.connection === 'live') {
      try {
        await this.source.pushUnsubscribe();
      } catch {
        // The browser's subscription is gone: the hub forgets it on the next notice (the push service says 410).
      }
    }
    if (say) this.notice = { key: 'push.off', tone: 'info' };
  }

  /** A tapped notice opens its task; a task that is no longer in the list is said, not guessed. */
  async openById(id: string): Promise<void> {
    const brief = this.view?.tasks.find((t) => t.id === id);
    if (!brief) {
      this.notice = { key: 'push.task_gone', tone: 'info' };
      return;
    }
    await this.openTask(brief);
  }

  /** The phone's day, against which a `due:` or `remind:` day has come or not. */
  get day(): string {
    return localDay(this.deps.now());
  }

  get paired(): boolean {
    return this.deps.fake || this.token !== null;
  }
}
