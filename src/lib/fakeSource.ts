// A synthetic vault in memory, behind the same interface as the hub (MTST-02). It is in the page only in the build
// `--mode fake` (browser tests, working on the page without a hub), never in the build a phone gets. It answers with
// raw documents of the hub's shape, which go through the same checks as the hub's (`parse.ts`), and it holds a
// hostile corpus (MTST-04): hidden characters, a link with a script scheme, an overlong title, an area that must
// stay on the PC, a task that claims a foreign area.
//
// The names are neutral (APP-01): nothing here is a real area or a real task.

import { areaClasses, deviceLevel, donePreview, hubHello, learnSeries, learnSteps, meetingDetail, meetingList, testingRun, testingSheets, opOutcome, pathDetail, pathList, taskDetail, vaultView } from './parse';
import { AnswerLost, HubRefused, Unreachable, type DataSource } from './source';
import type { PushSubscriptionBody } from './push';
import type { Right } from './rights';
import type { ConfirmRequest, DataClass, DonePreview, HubHello, LearnSeries, LearnStep, MeetingBrief, MeetingDetail, Op, OpOutcome, PathBrief, PathDetail, TaskDetail, TestingRun, UploadKind, VaultView } from './types';

interface FakeTask {
  id: string;
  area: string;
  title: string;
  status: string;
  prio?: number;
  due?: string;
  /** A routine: one interval or a ladder (`1w,4w,12w`), its round, and what it waits for (no `due` yet). */
  repeat?: string;
  repeatStep?: number;
  repeatAfter?: string;
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
  readonly uploads: { id: string; name: string; type: string; size: number; kind?: UploadKind }[];
  /** The next upload is refused by the hub (a vault that changed while the file was on its way). */
  refuseNextUpload: boolean;
  /** The next upload is attached but its answer is lost. */
  loseNextUploadAnswer: boolean;
  /** The level the PC gave this device (`tasks-hub devices level`); `null`: a hub that does not tell it. */
  deviceLevel: Right | null;
  /** Whether this hub is paired with the testing hub (`tasks-hub testing link`). */
  testingLinked: boolean;
  /** The runs started, by task, each with the confirmation it carried. */
  readonly testingStarts: { id: string; confirm: string }[];
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
      // A ladder in its second round of three.
      id: 'kitchen/descale-the-kettle',
      area: 'kitchen',
      title: 'Descale the kettle',
      status: 'open',
      due: '2026-03-01',
      repeat: '1w,4w,12w',
      repeatStep: 2,
      body: '',
      etag: 1,
    },
    {
      // The last round of a ladder: finishing it ends the routine.
      id: 'kitchen/descale-the-boiler',
      area: 'kitchen',
      title: 'Descale the boiler',
      status: 'open',
      due: '2026-03-02',
      repeat: '1w,4w',
      repeatStep: 2,
      body: '',
      etag: 1,
    },
    {
      // A routine that waits for a finish: no due date until `kitchen/fix-the-tap` is finished.
      id: 'kitchen/check-the-seals',
      area: 'kitchen',
      title: 'Check the seals',
      status: 'open',
      repeat: '2w',
      repeatAfter: 'kitchen/fix-the-tap',
      body: '',
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

/** A learning point of the fake vault: `parent` is the index (1-based) of the point above it. */
interface FakePoint {
  key: string;
  label: string;
  parent?: number;
  link?: string;
  note?: string;
  state: string;
  reason?: string;
  /** Under `{safety}`: closed only with `ack` (the engine's rule). */
  safety?: true;
}

interface FakePath {
  id: string;
  area: string;
  title: string;
  etag: number;
  points: FakePoint[];
}

function initialPaths(): FakePath[] {
  return [
    {
      id: 'garden/lernpfad-rust',
      area: 'garden',
      title: 'Rust lernen',
      etag: 1,
      points: [
        { key: 'basics', label: 'Grundlagen', state: 'open' },
        { key: 'book', label: 'The Book lesen', parent: 1, link: 'https://doc.rust-lang.org/book/', note: 'Kapitel 1 bis 4', state: 'open' },
        { key: 'rustlings', label: 'Rustlings', parent: 1, state: 'open' },
        { key: 'async', label: 'Async verstehen', state: 'open', safety: true },
      ],
    },
  ];
}

const CLOSED = new Set(['learned', 'seen', 'dropped']);

/** A day `n` days from today, as the fake vault's series keeps it. */
function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** What the fake vault learned on the days before today: two points eight days ago, one three and two days ago. */
function initialLearnLog(): Map<string, { learned: number; seen: number; xp: number; doneH: number }> {
  return new Map([
    [dayFrom(-8), { learned: 2, seen: 0, xp: 20, doneH: 1 }],
    [dayFrom(-3), { learned: 1, seen: 1, xp: 15, doneH: 0.5 }],
    [dayFrom(-2), { learned: 1, seen: 0, xp: 10, doneH: 0.5 }],
  ]);
}

/** A meeting of the fake vault, `inDays` from today; its minutes are lines `HH:MM text`. */
interface FakeMeeting {
  id: string;
  area: string;
  title: string;
  inDays: number;
  time: string;
  location?: string;
  online?: string;
  agenda: string[];
  minutes: string[];
  /** Who was asked to come and whether they are ticked; the hub gives them for a public area only (here: garden). */
  people?: { name: string; email?: string; present: boolean }[];
}

function initialMeetings(): FakeMeeting[] {
  return [
    {
      id: 'kitchen/einkauf-planen',
      area: 'kitchen',
      title: 'Einkauf planen',
      inDays: 0,
      time: '18:00',
      location: 'Küche',
      agenda: ['Vorräte', 'Wochenplan'],
      minutes: ['17:55 Liste liegt bereit'],
    },
    {
      id: 'garden/zaun-besprechen',
      area: 'garden',
      title: 'Zaun besprechen',
      inDays: 2,
      time: '10:00',
      online: 'https://meet.jit.si/zaun',
      agenda: ['Holz oder Metall'],
      minutes: [],
      people: [
        { name: 'Anna Berger', email: 'anna@example.org', present: false },
        { name: 'Ben Huber', present: true },
      ],
    },
  ];
}

/** The local day `days` from now, `YYYY-MM-DD`. */
function dayFrom(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
  testingLinked = true;
  readonly testingStarts: { id: string; confirm: string }[] = [];
  /** The sheets that name a task, as a testing hub would find them. */
  private readonly sheets: Record<string, string[]> = { 'garden/water-the-plants': ['watering.sheet.lua', 'hoses.sheet.lua'] };
  private run: TestingRun['run'] = null;
  /** How the next run ends, in the words of the hub (`verdict`, `exit`, `block`, `sheets_red`). */
  runEnd: Record<string, unknown> = { verdict: 'green', exit: 0 };
  /** The ids of the task details read. */
  taskReads: string[] = [];
  loseNextAnswer = false;
  holdTasks = false;
  private held: (() => void)[] = [];

  releaseTasks(): void {
    this.holdTasks = false;
    for (const go of this.held.splice(0)) go();
  }
  readonly writes: { clientOpId: string; op: Op }[] = [];
  readonly uploads: { id: string; name: string; type: string; size: number; kind?: UploadKind }[] = [];
  refuseNextUpload = false;
  loseNextUploadAnswer = false;
  /** The subscription the fake hub keeps for this device (Web Push), or `null`. */
  pushed: PushSubscriptionBody | null = null;
  private tasks = initialTasks();
  private learning = initialPaths();
  /**
   * The series of the learning figures of the fake vault, by day (what changed that day): a few days of learning before
   * today, and every point ticked here counted today, as the engine's series would after its next record.
   */
  private learnLog = initialLearnLog();
  /** Whether this fake hub has the reads of the page Lernen (a test takes them away to see the page without them). */
  learnRoutes = true;
  private gatherings = initialMeetings();
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
      ...(t.repeat !== undefined ? { repeat: t.repeat } : {}),
      ...(t.repeatStep !== undefined ? { repeat_step: t.repeatStep } : {}),
      ...(t.repeatAfter !== undefined ? { repeat_after: t.repeatAfter } : {}),
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
    return hubHello({
      ...HEAD,
      kind: 'tasks.hello',
      version: 'fake',
      engine: { ready: true, problem: null, capabilities: ['paths', 'path', ...(this.learnRoutes ? ['learn_next', 'learn_history'] : [])] },
    });
  }

  async level(): Promise<Right> {
    this.reachable();
    if (this.deviceLevel === null) throw new HubRefused(403, 'not_for_devices', 'this route is not released for devices');
    return deviceLevel({ ...HEAD, kind: 'tasks.device', level: this.deviceLevel });
  }

  private testing(): void {
    this.reachable();
    if (!this.testingLinked) throw new HubRefused(409, 'testing_not_linked', 'this hub is not paired with the testing hub');
  }

  async testingSheets(id: string): Promise<string[] | null> {
    this.reachable();
    // As the hub: no testing is no error, only `linked: false`.
    const doc = { kind: 'tasks.testing_sheets', schema: 1, id, linked: this.testingLinked, sheets: this.testingLinked ? (this.sheets[id] ?? []) : [] };
    return testingSheets(doc, id);
  }

  async testingRun(): Promise<TestingRun> {
    this.testing();
    // A run has ended green by the next look (the synthetic testing hub is quick).
    const run = this.run;
    if (run?.what === 'task' && run.running) {
      this.run = testingRun({
        kind: 'tasks.testing_run',
        schema: 1,
        available: true,
        run: { what: 'task', task: run.task, running: false, ...this.runEnd },
      }).run;
    }
    return { available: true, run: this.run };
  }

  async testingStart(id: string, confirm: ConfirmRequest): Promise<TestingRun> {
    this.testing();
    const header = await confirm('POST', '/api/tasks/testing_start', JSON.stringify({ id }));
    if (this.deviceLevel !== 'trigger') throw new HubRefused(403, 'level_too_low', 'this device may not do this');
    if (!(this.sheets[id]?.length)) throw new HubRefused(404, 'no_sheet', 'no sheet names this task');
    if (this.run?.what === 'task' && this.run.running) throw new HubRefused(409, 'busy', 'a run is under way');
    this.testingStarts.push({ id, confirm: header });
    const started = testingRun({
      kind: 'tasks.testing_run',
      schema: 1,
      available: true,
      run: { what: 'task', task: id, running: true, verdict: null, exit: null },
    });
    this.run = started.run;
    return started;
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
    this.taskReads.push(id);
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

  /** The leaves below point `index` (1-based), or the point itself when it has none. */
  private leaves(p: FakePath, index: number): FakePoint[] {
    const kids = p.points.map((pt, i) => ({ pt, i: i + 1 })).filter((x) => x.pt.parent === index);
    const self = p.points[index - 1];
    if (kids.length === 0) return self ? [self] : [];
    return kids.flatMap((k) => this.leaves(p, k.i));
  }

  private progressOf(points: FakePoint[]): Record<string, number> {
    const n = (s: string) => points.filter((x) => x.state === s).length;
    return { learned: n('learned'), seen: n('seen'), dropped: n('dropped'), open: n('open'), blocked: 0, total: points.length };
  }

  private pathEntry(p: FakePath): Record<string, unknown> {
    const leaves = p.points.filter((_, i) => !p.points.some((x) => x.parent === i + 1));
    return {
      id: p.id,
      area: p.area,
      slug: p.id.split('/')[1],
      title: p.title,
      status: 'doing',
      summary: 'Ein Lernpfad des Test-Vaults',
      icon: { kind: 'emoji', value: '🦀' },
      progress: this.progressOf(leaves),
      etag: `e${p.etag}`,
    };
  }

  async paths(): Promise<{ paths: PathBrief[]; partial: boolean }> {
    this.reachable();
    const doc = {
      ...HEAD,
      kind: 'tasks.paths',
      items: [...this.learning.map((p) => this.pathEntry(p)), { id: 'vault-secret/lernpfad', area: 'vault-secret', title: 'SECRET-MARKER' }],
      partial: false,
    };
    return pathList(doc, this.classes());
  }

  private meetingEntry(m: FakeMeeting): Record<string, unknown> {
    return {
      id: m.id,
      area: m.area,
      slug: m.id.split('/')[1],
      title: m.title,
      status: 'planned',
      date: dayFrom(m.inDays),
      time: m.time,
      ...(m.location ? { location: m.location } : {}),
      ...(m.online ? { online: m.online, online_service: 'jitsi' } : {}),
      etag: 'e1',
    };
  }

  /** The window is the hub's to apply; the fake vault's meetings lie around the day of the real clock, whatever the page's is. */
  async meetings(_since: string, _until: string): Promise<{ meetings: MeetingBrief[]; partial: boolean }> {
    this.reachable();
    const doc = {
      ...HEAD,
      kind: 'tasks.meetings',
      items: [
        ...this.gatherings.map((m) => this.meetingEntry(m)),
        { id: 'vault-secret/geheim', area: 'vault-secret', title: 'SECRET-MARKER', date: dayFrom(1), time: '09:00' },
      ],
      partial: false,
    };
    return meetingList(doc, this.classes());
  }

  async meeting(id: string): Promise<MeetingDetail> {
    this.reachable();
    const m = this.gatherings.find((x) => x.id === id);
    if (!m) throw new HubRefused(404, 'not_found', `no such meeting: ${id}`);
    const body = `Kurz.\n\n## Protokoll\n\n${m.minutes.map((l) => `- ${l}`).join('\n')}\n`;
    return meetingDetail(
      {
        ...HEAD,
        kind: 'tasks.meeting',
        meeting: this.meetingEntry(m),
        body,
        agenda: m.agenda.map((text, i) => ({ n: i + 1, text, ticked: false })),
        followups: [],
        // As the hub cuts it: the people of a public area, an internal one only when the PC released them (not here).
        participants: CLASSES[m.area] === 'public' ? (m.people ?? []).map((x, i) => ({ n: i + 1, ...x })) : [],
      },
      this.classes(),
    );
  }

  async learnNext(): Promise<{ steps: LearnStep[]; partial: boolean }> {
    this.reachable();
    if (!this.learnRoutes) throw new HubRefused(403, 'not_for_devices', 'this route is not released for devices');
    const items = this.learning.flatMap((p) => {
      const leaves = p.points.filter((_, i) => !p.points.some((x) => x.parent === i + 1));
      const next = leaves.find((x) => !CLOSED.has(x.state));
      if (!next) return [];
      const stage = next.parent !== undefined ? p.points[next.parent - 1]!.label : '';
      return [
        {
          path: p.id,
          area: p.area,
          title: p.title,
          stage: 'doing',
          icon: { kind: 'emoji', value: '🦀' },
          points: [
            {
              index: p.points.indexOf(next) + 1,
              key: next.key,
              label: next.label,
              stage_index: 0,
              stage_label: stage,
              xp: 10,
              ...(next.link ? { link: next.link } : {}),
              ...(next.safety ? { safety: true } : {}),
            },
          ],
        },
      ];
    });
    const doc = {
      ...HEAD,
      kind: 'tasks.learn_next',
      items: [...items, { path: 'vault-secret/lernpfad', area: 'vault-secret', title: 'SECRET-MARKER', points: [{ index: 1, key: 'x', label: 'SECRET-MARKER' }] }],
      partial: false,
    };
    return learnSteps(doc, this.classes());
  }

  async learnHistory(since: string, until: string): Promise<LearnSeries> {
    this.reachable();
    if (!this.learnRoutes) throw new HubRefused(403, 'not_for_devices', 'this route is not released for devices');
    const first = dayFrom(-20);
    const points: Record<string, unknown>[] = [];
    for (let d = since < first ? first : since; d <= until; d = nextDay(d)) {
      const f = this.learnLog.get(d) ?? { learned: 0, seen: 0, xp: 0, doneH: 0 };
      points.push({ date: d, learned: f.learned, seen: f.seen, dropped: 0, xp: f.xp, done_h: f.doneH, days: f.learned + f.seen > 0 ? 1 : 0, paths: [] });
    }
    // The streak as the engine counts it: learning days in a row up to today, or up to yesterday while today has none.
    const learns = (d: string) => {
      const f = this.learnLog.get(d);
      return f !== undefined && f.learned + f.seen > 0;
    };
    const back = learns(dayFrom(0)) ? 0 : 1;
    let current = 0;
    while (current < 400 && learns(dayFrom(-back - current))) current += 1;
    let longest = 0;
    for (let run = 0, n = -60; n <= 0; n += 1) {
      run = learns(dayFrom(n)) ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    const doc = { ...HEAD, kind: 'tasks.learn_history', since, until, step: 'day', first, streak: { current, longest }, points, paths: [], partial: false };
    return learnSeries(doc);
  }

  async path(id: string): Promise<PathDetail> {
    this.reachable();
    const p = this.learning.find((x) => x.id === id);
    if (!p) throw new HubRefused(404, 'not_found', `no such path: ${id}`);
    const nodes = p.points.map((pt, i) => {
      const index = i + 1;
      const below = this.leaves(p, index);
      const children = p.points.filter((x) => x.parent === index).length;
      let depth = 0;
      for (let up = pt.parent; up !== undefined; up = p.points[up - 1]?.parent) depth += 1;
      return {
        index,
        key: pt.key,
        ...(pt.parent !== undefined ? { parent: pt.parent } : {}),
        depth,
        state: pt.state,
        derived: children > 0 ? (below.every((x) => CLOSED.has(x.state)) ? 'learned' : 'open') : pt.state,
        children,
        label: pt.label,
        progress: this.progressOf(below),
        ...(pt.link ? { link: pt.link } : {}),
        ...(pt.note ? { note: pt.note } : {}),
        ...(pt.reason ? { reason: pt.reason } : {}),
      };
    });
    return pathDetail({ ...HEAD, kind: 'tasks.path', path: this.pathEntry(p), body: 'Vom Einstieg bis Async.', nodes }, this.classes());
  }

  /** A tick of today in the series: learned and seen count up, opening one again counts it down (a difference). */
  private countToday(was: string, now: string): void {
    const today = dayFrom(0);
    const f = this.learnLog.get(today) ?? { learned: 0, seen: 0, xp: 0, doneH: 0 };
    const step = (state: string, by: number) => {
      if (state === 'learned') {
        f.learned += by;
        f.xp += 10 * by;
      } else if (state === 'seen') {
        f.seen += by;
        f.xp += 5 * by;
      }
    };
    step(was, -1);
    step(now, 1);
    this.learnLog.set(today, f);
  }

  private result(ok: boolean, id: string | null, error?: { code: string; message: string }, started: unknown[] = []): unknown {
    return {
      ...HEAD,
      kind: 'tasks.result',
      digest: 'fake',
      dry_run: false,
      ok,
      results: [
        {
          n: 1,
          op: 'x',
          ok,
          ...(id ? { id } : {}),
          ...(started.length > 0 ? { routines_started: started } : {}),
          ...(error ? { error: { ...error, retryable: false } } : {}),
        },
      ],
    };
  }

  private apply(op: Op): unknown {
    if (op.op === 'meeting_capture') {
      const m = this.gatherings.find((x) => x.id === op.id);
      if (!m) return this.result(false, null, { code: 'not_found', message: 'no such meeting' });
      const at = op.entry.at ?? '12:00';
      if ('asset' in op.entry) {
        // Like the engine: the file must be there, and the line is a link to it.
        const asset = op.entry.asset;
        if (!this.uploads.some((u) => u.id === m.id && `${u.kind === 'image' ? 'assets/images' : 'assets/audio'}/${u.name}` === asset))
          return this.result(false, m.id, { code: 'invalid_argument', message: `the meeting has no asset ${asset}` });
        const name = asset.split('/').pop() ?? asset;
        m.minutes.push(op.entry.kind === 'photo' ? `${at} ![${name}](${asset})` : `${at} [Audio: ${name}](${asset})`);
        return this.result(true, m.id);
      }
      const words: Record<string, string> = { task: 'Aufgabe: ', decision: 'Beschluss: ', question: 'Frage: ', text: '' };
      m.minutes.push(`${at} ${words[op.entry.kind] ?? ''}${op.entry.text}`);
      return this.result(true, m.id);
    }
    if (op.op === 'meeting_attend') {
      const m = this.gatherings.find((x) => x.id === op.id);
      // Like the hub: the people of an area that is not public are not for this phone.
      if (!m || CLASSES[m.area] !== 'public') return this.result(false, null, { code: 'not_found', message: 'no such meeting' });
      const person = m.people?.find((x) => x.name === op.name);
      if (!person) return this.result(false, m.id, { code: 'not_found', message: 'no such participant' });
      person.present = op.present;
      return this.result(true, m.id);
    }
    if (op.op === 'node_set') {
      const p = this.learning.find((x) => x.id === op.id);
      const pt = p?.points.find((x) => x.key === op.point);
      if (!p || !pt) return this.result(false, null, { code: 'not_found', message: 'no such point' });
      if (op.if_match !== undefined && op.if_match !== `e${p.etag}`)
        return this.result(false, p.id, { code: 'conflict', message: 'the file changed since it was read' });
      if ((op.state === 'seen' || op.state === 'dropped') && !op.reason)
        return this.result(false, p.id, { code: 'invalid_argument', message: 'node_set: seen and dropped need a reason' });
      if (pt.safety && (op.state === 'learned' || op.state === 'seen') && op.ack !== true)
        return this.result(false, p.id, { code: 'invalid_argument', message: 'node_set: a {safety} point needs ack' });
      const was = pt.state;
      pt.state = op.state;
      this.countToday(was, op.state);
      if (op.reason) pt.reason = op.reason;
      else delete pt.reason;
      p.etag += 1;
      return this.result(true, p.id);
    }
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
      // The routines that waited for this finish get their first due date, like the engine's `routines_started`.
      const started = this.tasks.filter((x) => x.repeatAfter === t.id && x.due === undefined);
      for (const r of started) {
        r.due = dayFrom(14);
        r.etag += 1;
      }
      return this.result(true, t.id, undefined, started.map((r) => ({ id: r.id, due: r.due, after: t.id })));
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

  async upload(id: string, file: Blob, name: string, kind?: UploadKind): Promise<OpOutcome> {
    this.reachable();
    if (this.refuseNextUpload) {
      this.refuseNextUpload = false;
      throw new HubRefused(409, 'vault_changed', 'another vault was chosen while the file was on its way: nothing was attached');
    }
    // Like the hub: a phone attaches to a meeting only an image or an audio file (tasks-desktop, upload.rs).
    const meeting = this.gatherings.find((x) => x.id === id);
    if (meeting) {
      if (kind !== 'image' && kind !== 'audio') throw new HubRefused(403, 'not_for_devices', 'a phone attaches only to a task');
      if (this.uploads.some((u) => u.id === id && u.name === name && u.kind === kind))
        return opOutcome(this.result(false, id, { code: 'exists', message: 'attach: the task has an asset of this name already' }));
      this.uploads.push({ id, name, type: file.type, size: file.size, kind });
      const done = opOutcome(this.result(true, id));
      if (this.loseNextUploadAnswer) {
        this.loseNextUploadAnswer = false;
        throw new AnswerLost();
      }
      return done;
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
      // A ladder: the last round starts no next one (`ends_routine`), any other round names the due date of the next.
      ...(t.repeat !== undefined && t.repeat.split(',').length === (t.repeatStep ?? 1) ? { ends_routine: true } : {}),
      ...(t.repeat !== undefined && t.due !== undefined && t.repeat.split(',').length !== (t.repeatStep ?? 1)
        ? { next_round: { due: dayFrom(7) } }
        : {}),
    });
  }
}
