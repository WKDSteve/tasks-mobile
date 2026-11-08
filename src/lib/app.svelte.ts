// The state of the page and what the user can do. Everything outside the page (the hub, the phone's storage, the
// clock, the ids) comes in through `AppDeps`, so the tests run it without a browser (MTST-03).

import { checkDraft, type Draft, type DraftProblem } from './capture';
import { ShapeError } from './parse';
import { WriteQueue, type QueueStore } from './queue';
import { allows, DEFAULT_RIGHTS, type Right } from './rights';
import { HubRefused, Unpaired, Unreachable, type DataSource } from './source';
import type { KeptView, TokenStorage } from './storage';
import { readToken, writeToken } from './storage';
import type { CacheStore } from 'appkit-ui/cache';
import type { DonePreview, Op, Status, TaskBrief, TaskDetail, VaultView } from './types';
import type { TextKey } from './i18n';

export type Screen = 'pair' | 'list' | 'capture' | 'queue' | 'task';
export type Connection = 'checking' | 'live' | 'offline';

export interface AppDeps {
  /** The source for a session token (`null` in the fake build, which needs none). */
  source(token: string | null): DataSource;
  /** Trade a pairing code for a session token (the hub's `/auth/exchange`). */
  exchange(code: string): Promise<string>;
  /** `true` in the fake build: no pairing, the synthetic vault. */
  fake: boolean;
  viewStore: CacheStore<KeptView>;
  queueStore: QueueStore;
  session: TokenStorage | undefined;
  now(): Date;
  newId(): string;
}

/** A message the page shows: a key of the dictionary and its values. */
export interface Notice {
  key: TextKey;
  params?: Record<string, string | number>;
  tone: 'info' | 'error';
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
    });
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
    const kept = await this.deps.viewStore.load();
    if (kept) {
      this.view = kept.view;
      this.viewAt = kept.at;
    }
    await this.queue.load(kept ? new Set(kept.view.areas.map((a) => a.name)) : null);
    if (this.deps.fake) {
      this.connect(null);
    } else if (pairingCode !== null) {
      await this.pair(pairingCode);
      return;
    } else {
      const token = readToken(this.deps.session);
      if (token === null) {
        this.screen = 'pair';
        this.connection = 'offline';
        return;
      }
      this.connect(token);
    }
    await this.refresh();
  }

  private connect(token: string | null): void {
    this.token = token;
    this.source = this.deps.source(token);
  }

  /** Trade a code for a session and load the vault. */
  async pair(code: string): Promise<boolean> {
    const clean = pairingCodeOf(code);
    if (clean === null) {
      this.notice = { key: 'pair.bad', tone: 'error' };
      this.screen = 'pair';
      return false;
    }
    try {
      const token = await this.deps.exchange(clean);
      writeToken(this.deps.session, token);
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

  /** The session is gone: back to pairing, nothing waiting is lost. */
  private unpaired(): void {
    this.token = null;
    this.source = null;
    writeToken(this.deps.session, null);
    this.connection = 'offline';
    this.screen = 'pair';
    this.notice = { key: 'pair.lost', tone: 'error' };
  }

  /** Say what went wrong (MOB-09): never an empty list in place of an error. */
  private failed(error: unknown): void {
    if (error instanceof Unpaired) return this.unpaired();
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
      }
    })();
    return this.running;
  }

  private async load(): Promise<void> {
    const source = this.source;
    if (!source) return;
    this.connection = 'checking';
    try {
      const hello = await source.hello();
      this.engineProblem = hello.engineReady ? null : (hello.engineProblem ?? '?');
      const report = await this.queue.flush(source);
      if (report.stopped === 'unpaired') return this.unpaired();
      const view = await source.vault();
      this.view = view;
      this.viewAt = this.deps.now().toISOString();
      this.connection = 'live';
      await this.deps.viewStore.save({ view, at: this.viewAt });
    } catch (error) {
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
  private async enqueue(op: Op, area: string, label: string): Promise<boolean> {
    if (!allows(this.rights, op)) {
      this.notice = { key: 'task.not_allowed', tone: 'error' };
      return false;
    }
    if (this.queue.full) {
      this.notice = { key: 'queue.full', tone: 'error' };
      return false;
    }
    await this.queue.add(op, area, label);
    if (this.source && this.connection !== 'offline') await this.refresh();
    return true;
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
      const queued = await this.enqueue(checked.op, checked.op.area, checked.op.title);
      if (queued) this.notice = { key: 'capture.queued', params: { title: checked.op.title }, tone: 'info' };
      return queued;
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
      await this.enqueue({ op: 'done', id: task.id, confirm }, task.area, task.title);
      await this.reopen();
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
    await this.queue.drop(clientOpId);
  }

  /** Unpair this phone: the session, the copy and the queue go (MSEC-12). */
  async forget(): Promise<void> {
    writeToken(this.deps.session, null);
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
