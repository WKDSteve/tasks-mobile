// A synthetic vault in memory, behind the same interface as the hub (MTST-02). It is in the page only in the build
// `--mode fake` (browser tests, working on the page without a hub), never in the build a phone gets. It answers with
// raw documents of the hub's shape, which go through the same checks as the hub's (`parse.ts`), and it holds a
// hostile corpus (MTST-04): hidden characters, a link with a script scheme, an overlong title, an area that must
// stay on the PC, a task that claims a foreign area.
//
// The names are neutral (APP-01): nothing here is a real area or a real task.

import { areaClasses, deviceLevel, donePreview, hubHello, opOutcome, taskDetail, vaultView } from './parse';
import { AnswerLost, HubRefused, Unreachable, type DataSource } from './source';
import type { PushSubscriptionBody } from './push';
import type { Right } from './rights';
import type { DataClass, DonePreview, HubHello, Op, OpOutcome, TaskDetail, VaultView } from './types';

interface FakeTask {
  id: string;
  area: string;
  title: string;
  status: string;
  prio?: number;
  due?: string;
  body: string;
  etag: number;
  questions?: { key: string; title: string; options: { text: string; recommended?: boolean }[]; chosen?: number }[];
}

/** What a test can turn on, from the page's global `__fakeHub` (only in the fake build). */
export interface FakeControls {
  /** The hub cannot be reached. */
  offline: boolean;
  /** The next write is carried out but its answer is lost. */
  loseNextAnswer: boolean;
  /** Reads of one task wait until `releaseTasks()` (a slow tunnel). */
  holdTasks: boolean;
  releaseTasks(): void;
  /** Change a task as another program would: its version moves on. */
  touch(id: string): void;
  /** The writes the fake received, in order. */
  readonly writes: { clientOpId: string; op: Op }[];
  /** The files the fake took, by task: name, type and size. */
  readonly uploads: { id: string; name: string; type: string; size: number }[];
  /** The next upload is refused by the hub (a vault that changed while the file was on its way). */
  refuseNextUpload: boolean;
  /** The next upload is attached but its answer is lost. */
  loseNextUploadAnswer: boolean;
  /** The level the PC gave this device (`tasks-hub devices level`); `null`: a hub that does not tell it. */
  deviceLevel: Right | null;
}

const HEAD = {
  schema: 1,
  plugin: 'tasks.nvim',
  generated_at: '2026-01-01T00:00:00Z',
  vault: { id: 'fake' },
  engine: { version: '0.0.0-fake', git: 'fake', nvim: 'none' },
};

function initialTasks(): FakeTask[] {
  return [
    {
      id: 'garden/water-the-plants',
      area: 'garden',
      title: 'Water the plants',
      status: 'open',
      prio: 2,
      due: '2026-01-10',
      body: 'Twice a week.\n\nSee https://example.org/plants and javascript:alert(1) for details.',
      etag: 1,
    },
    {
      id: 'garden/choose-a-fence',
      area: 'garden',
      title: 'Choose a fence',
      status: 'decision',
      prio: 1,
      body: 'Two offers came in.',
      etag: 1,
      questions: [
        {
          key: 'q1',
          title: 'Which material?',
          options: [{ text: 'Wood', recommended: true }, { text: 'Metal' }],
        },
      ],
    },
    {
      id: 'kitchen/fix-the-tap',
      area: 'kitchen',
      title: 'Fix the tap',
      status: 'doing',
      prio: 3,
      body: 'Washer is worn.',
      etag: 1,
    },
    {
      // Hidden characters in a title (bidi override, zero width): shown, but made visible (MSEC-05).
      id: 'kitchen/hidden-characters',
      area: 'kitchen',
      title: 'Invoice \u202Etxt.exe\u202C \u200Bcheck',
      status: 'open',
      body: '<img src=x onerror=alert(1)> stays text.',
      etag: 1,
    },
    {
      id: 'kitchen/overlong-title',
      area: 'kitchen',
      title: 'Long '.repeat(400),
      status: 'parked',
      body: '',
      etag: 1,
    },
    {
      // An area of the class that never leaves the PC: neither shown nor kept (MOB-02).
      id: 'vault-secret/must-not-show',
      area: 'vault-secret',
      title: 'SECRET-MARKER must never reach the phone',
      status: 'open',
      body: 'SECRET-MARKER',
      etag: 1,
    },
    {
      // An area the hub names without a class: hidden too (fail closed).
      id: 'loose/without-class',
      area: 'loose',
      title: 'UNCLASSIFIED-MARKER',
      status: 'open',
      body: '',
      etag: 1,
    },
  ];
}

const CLASSES: Record<string, DataClass | undefined> = {
  garden: 'public',
  kitchen: 'internal',
  'vault-secret': 'private',
  loose: undefined,
};

function slugOf(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'task'
  );
}

export class FakeSource implements DataSource, FakeControls {
  readonly kind = 'fake' as const;
  offline = false;
  deviceLevel: Right | null = 'change';
  loseNextAnswer = false;
  holdTasks = false;
  private held: (() => void)[] = [];

  releaseTasks(): void {
    this.holdTasks = false;
    for (const go of this.held.splice(0)) go();
  }
  readonly writes: { clientOpId: string; op: Op }[] = [];
  readonly uploads: { id: string; name: string; type: string; size: number }[] = [];
  refuseNextUpload = false;
  loseNextUploadAnswer = false;
  /** The subscription the fake hub keeps for this device (Web Push), or `null`. */
  pushed: PushSubscriptionBody | null = null;
  private tasks = initialTasks();
  private rev = 1;
  private seen = new Map<string, OpOutcome>();

  private classes(): Map<string, DataClass> {
    return areaClasses(this.areasDoc());
  }

  private areasDoc(): unknown {
    return {
      ...HEAD,
      kind: 'tasks.areas',
      areas: Object.entries(CLASSES).map(([name, cls]) => (cls ? { name, data_class: cls } : { name })),
    };
  }

  private reachable(): void {
    if (this.offline) throw new Unreachable();
  }

  async pushKey(): Promise<string> {
    this.reachable();
    // A P-256 point in the shape of the hub's key; the fake sends no notices.
    return `B${'A'.repeat(86)}`;
  }

  async pushSubscribe(body: PushSubscriptionBody): Promise<void> {
    this.reachable();
    this.pushed = { ...body, kinds: [...body.kinds] };
  }

  async pushUnsubscribe(): Promise<void> {
    this.reachable();
    this.pushed = null;
  }

  private entry(t: FakeTask): Record<string, unknown> {
    const open = (t.questions ?? []).filter((q) => q.chosen === undefined).length;
    return {
      id: t.id,
      area: t.area,
      title: t.title,
      status: t.status,
      ...(t.prio !== undefined ? { prio: t.prio } : {}),
      ...(t.due !== undefined ? { due: t.due } : {}),
      ...(open > 0 ? { open_questions: open } : {}),
      etag: `e${t.etag}`,
    };
  }

  touch(id: string): void {
    const t = this.tasks.find((x) => x.id === id);
    if (t) {
      t.etag += 1;
      this.rev += 1;
    }
  }

  async hello(): Promise<HubHello> {
    this.reachable();
    return hubHello({ ...HEAD, kind: 'tasks.hello', version: 'fake', engine: { ready: true, problem: null } });
  }

  async level(): Promise<Right> {
    this.reachable();
    if (this.deviceLevel === null) throw new HubRefused(403, 'not_for_devices', 'this route is not released for devices');
    return deviceLevel({ ...HEAD, kind: 'tasks.device', level: this.deviceLevel });
  }

  async vault(): Promise<VaultView> {
    this.reachable();
    const open = this.tasks.filter((t) => t.status !== 'done');
    const doc = {
      ...HEAD,
      kind: 'tasks.snapshot',
      rev: `r${this.rev}`,
      digest: 'fake',
      areas: Object.keys(CLASSES).map((name) => {
        const mine = open.filter((t) => t.area === name);
        const byStatus: Record<string, number> = {};
        for (const t of mine) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
        return { name, open: mine.length, by_status: byStatus };
      }),
      // One entry claims an area its id does not start with: it is dropped by the check, not shown.
      tasks: [...open.map((t) => this.entry(t)), { id: 'vault-secret/claims-garden', area: 'garden', title: 'SECRET-MARKER' }],
    };
    return vaultView(doc, this.classes(), this.nextDoc(open));
  }

  /**
   * Like the engine's `next`: the pick and its alternatives over the whole vault, by prio here (the fake's own
   * order). The task of the area that stays on the PC comes first, so the page has to drop it.
   */
  private nextDoc(open: FakeTask[]): unknown {
    const ranked = open
      .filter((t) => t.status === 'open' || t.status === 'doing')
      .sort((a, b) => (a.prio ?? 9) - (b.prio ?? 9) || a.id.localeCompare(b.id));
    const secret = ranked.filter((t) => t.area === 'vault-secret');
    const rest = ranked.filter((t) => t.area !== 'vault-secret');
    const [first, ...alternatives] = [...secret, ...rest].map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      ...(t.prio !== undefined ? { prio: t.prio } : {}),
    }));
    return { ...HEAD, kind: 'tasks.next', digest: 'fake', ...(first ? { task: first } : {}), alternatives };
  }

  async task(id: string): Promise<TaskDetail> {
    this.reachable();
    if (this.holdTasks) await new Promise<void>((go) => this.held.push(go));
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error('not found');
    // Like the engine: a finished task is not served as a task any more.
    if (t.status === 'done') throw new HubRefused(404, 'not_found', `no such task: ${id}`);
    const doc = {
      ...HEAD,
      kind: 'tasks.task',
      rev: `r${this.rev}`,
      digest: 'fake',
      task: this.entry(t),
      body: t.body,
      body_truncated: false,
      steps: [],
      questions: (t.questions ?? []).map((q, i) => ({
        n: i + 1,
        key: q.key,
        title: q.title,
        text: '',
        answered: q.chosen !== undefined,
        options: q.options.map((o, j) => ({
          n: j + 1,
          text: o.text,
          recommended: o.recommended === true,
          chosen: q.chosen === j + 1,
        })),
      })),
    };
    return taskDetail(doc, this.classes());
  }

  private result(ok: boolean, id: string | null, error?: { code: string; message: string }): unknown {
    return {
      ...HEAD,
      kind: 'tasks.result',
      digest: 'fake',
      dry_run: false,
      ok,
      results: [{ n: 1, op: 'x', ok, ...(id ? { id } : {}), ...(error ? { error: { ...error, retryable: false } } : {}) }],
    };
  }

  private apply(op: Op): unknown {
    if (op.op === 'new') {
      if (CLASSES[op.area] !== 'public' && CLASSES[op.area] !== 'internal')
        return this.result(false, null, { code: 'forbidden', message: 'area not open to this device' });
      let id = `${op.area}/${slugOf(op.title)}`;
      for (let n = 2; this.tasks.some((t) => t.id === id); n += 1) id = `${op.area}/${slugOf(op.title)}-${n}`;
      this.tasks.push({ id, area: op.area, title: op.title, status: 'open', body: op.body ?? '', etag: 1 });
      return this.result(true, id);
    }
    const t = this.tasks.find((x) => x.id === op.id);
    if (!t) return this.result(false, null, { code: 'not_found', message: 'no such task' });
    if (op.op === 'done') {
      if (op.confirm !== `done:${t.id}:e${t.etag}`)
        return this.result(false, t.id, { code: 'conflict', message: 'the task changed since the preview' });
      t.status = 'done';
      t.etag += 1;
      return this.result(true, t.id);
    }
    if (op.if_match !== undefined && op.if_match !== `e${t.etag}`)
      return this.result(false, t.id, { code: 'conflict', message: 'the file changed since it was read' });
    if (op.op === 'set') t.status = op.patch.status;
    if (op.op === 'answer') {
      const q = (t.questions ?? []).find((x) => x.key === op.question);
      if (!q || op.option < 1 || op.option > q.options.length)
        return this.result(false, t.id, { code: 'invalid_argument', message: 'no such option' });
      q.chosen = op.option;
    }
    t.etag += 1;
    return this.result(true, t.id);
  }

  async write(clientOpId: string, op: Op): Promise<OpOutcome> {
    this.reachable();
    this.writes.push({ clientOpId, op });
    // The same `client_op_id` twice gets the first answer again, like a hub that tells a repeat.
    const before = this.seen.get(clientOpId);
    if (before) return before;
    const outcome = opOutcome(this.apply(op));
    this.seen.set(clientOpId, outcome);
    if (outcome.ok) this.rev += 1;
    if (this.loseNextAnswer) {
      this.loseNextAnswer = false;
      throw new AnswerLost();
    }
    return outcome;
  }

  async upload(id: string, file: Blob, name: string): Promise<OpOutcome> {
    this.reachable();
    if (this.refuseNextUpload) {
      this.refuseNextUpload = false;
      throw new HubRefused(409, 'vault_changed', 'another vault was chosen while the file was on its way: nothing was attached');
    }
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return opOutcome(this.result(false, null, { code: 'not_found', message: 'no such task' }));
    // Like the hub for an upload with `exact=1`, as this page sends it (tasks.nvim b32f653): a name the task has already is `exists`,
    // nothing is attached a second time.
    if (this.uploads.some((u) => u.id === id && u.name === name))
      return opOutcome(this.result(false, id, { code: 'exists', message: 'attach: the task has an asset of this name already' }));
    this.uploads.push({ id, name, type: file.type, size: file.size });
    t.etag += 1;
    this.rev += 1;
    const outcome = opOutcome(this.result(true, id));
    if (this.loseNextAnswer || this.loseNextUploadAnswer) {
      this.loseNextAnswer = false;
      this.loseNextUploadAnswer = false;
      throw new AnswerLost();
    }
    return outcome;
  }

  async donePreview(id: string): Promise<DonePreview> {
    this.reachable();
    const t = this.tasks.find((x) => x.id === id);
    if (!t) throw new Error('not found');
    return donePreview({
      ...HEAD,
      kind: 'tasks.donepreview',
      digest: 'fake',
      id,
      to: 'Backlog',
      ...(t.status === 'done' ? { already: true } : { confirm: `done:${t.id}:e${t.etag}` }),
      ...(t.id === 'kitchen/fix-the-tap' ? { freed: ['garden/water-the-plants'] } : {}),
    });
  }
}
