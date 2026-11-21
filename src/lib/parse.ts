// The edge of the page: every document of the hub (and everything read back from the phone's storage) is untrusted
// until it went through here (MSEC-13). What does not have the expected shape is left out, never guessed; a
// document that is not the expected kind at all is an error the page shows (MOB-09), not an empty list.

import type {
  AreaInfo,
  DataClass,
  DonePreview,
  HubHello,
  NextPick,
  OpErrorCode,
  OpOutcome,
  MeetingBrief,
  MeetingDetail,
  MinuteLine,
  PathBrief,
  PathDetail,
  PathPoint,
  PathProgress,
  RoutineStarted,
  Question,
  Status,
  StatusCounts,
  TaskBrief,
  TaskDetail,
  TestingRun,
  RunBlock,
  RunVerdict,
  VaultView,
} from './types';
import { STATUSES } from './types';
import { LEVELS, type Right } from './rights';

/** The hub sent something this page cannot read. */
export class ShapeError extends Error {
  constructor(what: string) {
    super(`unexpected document: ${what}`);
    this.name = 'ShapeError';
  }
}

/** The longest text taken for one line (a title, an id); longer ones are cut, not refused. */
export const MAX_LINE = 500;
/** The longest body taken; the rest is dropped and the page says so. */
export const MAX_BODY = 64 * 1024;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max = MAX_LINE): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null;
}

function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** A day as the engine writes it (`YYYY-MM-DD`); anything else is no day. */
function day(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function status(value: unknown): Status | null {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value) ? (value as Status) : null;
}

const CLASSES: readonly DataClass[] = ['public', 'internal', 'private', 'unclassified'];

/** Fail closed: a class this page does not know is `unclassified`, which is never shown. */
export function dataClassOf(value: unknown): DataClass {
  return typeof value === 'string' && (CLASSES as readonly string[]).includes(value)
    ? (value as DataClass)
    : 'unclassified';
}

/** May data of this class be shown on the phone or kept on it? Only `public` and `internal` (MOB-02, MSEC-12). */
export function shownClass(dataClass: DataClass): boolean {
  return dataClass === 'public' || dataClass === 'internal';
}

/** An id of a task as the engine makes them: `area/slug`, printable, no path tricks. */
const ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function isTaskId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && ID.test(value) && !value.split('/').includes('..');
}

/** An area name as the engine makes them. */
export function isAreaName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,100}$/.test(value) && value !== '.' && value !== '..';
}

export function taskBrief(value: unknown): TaskBrief | null {
  if (!isObj(value)) return null;
  const id = value['id'];
  const area = value['area'];
  const title = str(value['title']);
  if (!isTaskId(id) || !isAreaName(area) || title === null) return null;
  // The id starts with its area: a task that claims another area than its id is not taken (it would slip past the
  // filter of the classes).
  if (!id.startsWith(`${area}/`)) return null;
  const questions = int(value['open_questions']);
  const step = int(value['repeat_step']);
  const repeat = routineWord(value['repeat']);
  const after = str(value['repeat_after'], 200);
  return {
    id,
    area,
    title,
    status: status(value['status']),
    prio: int(value['prio']),
    due: day(value['due']),
    remind: day(value['remind']),
    openQuestions: questions !== null && questions > 0 ? questions : 0,
    ...(repeat !== null ? { repeat } : {}),
    ...(step !== null && step >= 1 ? { repeatStep: step } : {}),
    ...(after !== null ? { repeatAfter: after } : {}),
    etag: str(value['etag'], 200),
  };
}

/** `repeat`: one interval or a ladder (`1w,4w,12w`), as the engine writes it; anything else is no routine. */
function routineWord(value: unknown): string | null {
  return typeof value === 'string' && /^\d{1,4}[dwmy](,\d{1,4}[dwmy]){0,11}$/.test(value) ? value : null;
}

/** `/api/tasks/areas`: the areas with the class the hub gives them. */
export function areaClasses(doc: unknown): Map<string, DataClass> {
  if (!isObj(doc) || !Array.isArray(doc['areas'])) throw new ShapeError('areas');
  const classes = new Map<string, DataClass>();
  for (const entry of doc['areas']) {
    if (!isObj(entry) || !isAreaName(entry['name'])) continue;
    classes.set(entry['name'], dataClassOf(entry['data_class']));
  }
  return classes;
}

/**
 * The snapshot, cut to what this phone may show: areas whose class is `public` or `internal`, and their tasks. An
 * area the snapshot names but the class list does not is hidden (fail closed), and counted, so the page can say
 * that it shows a part (MUI-06).
 */
export function vaultView(doc: unknown, classes: Map<string, DataClass>, nextDoc?: unknown): VaultView {
  if (!isObj(doc) || doc['kind'] !== 'tasks.snapshot') throw new ShapeError('snapshot');
  const rev = str(doc['rev'], 200);
  if (rev === null || !Array.isArray(doc['tasks']) || !Array.isArray(doc['areas'])) throw new ShapeError('snapshot');
  const named = new Set<string>();
  const byArea = new Map<string, unknown>();
  for (const entry of doc['areas']) {
    if (!isObj(entry) || !isAreaName(entry['name'])) continue;
    named.add(entry['name']);
    byArea.set(entry['name'], entry['by_status']);
  }
  for (const name of classes.keys()) named.add(name);
  const areas: AreaInfo[] = [];
  let hiddenAreas = 0;
  for (const name of [...named].sort()) {
    const dataClass = classes.get(name) ?? 'unclassified';
    if (shownClass(dataClass)) areas.push({ name, dataClass });
    else hiddenAreas += 1;
  }
  const shown = new Set(areas.map((a) => a.name));
  const tasks: TaskBrief[] = [];
  for (const entry of doc['tasks']) {
    const brief = taskBrief(entry);
    if (brief && shown.has(brief.area)) tasks.push(brief);
  }
  // The engine counts per area; the page only adds up the areas it shows, so a hidden area adds nothing (MOB-02).
  const counts: StatusCounts = {};
  for (const name of shown) {
    const add = statusCounts(byArea.get(name));
    for (const s of STATUSES) if (add[s] !== undefined) counts[s] = (counts[s] ?? 0) + add[s];
  }
  const next = nextDoc === undefined ? [] : nextPicks(nextDoc, shown);
  return { rev, tasks, areas, hiddenAreas, counts, next };
}

/** The kind of the file `tasks-hub phone export` writes: the vault as a paired phone is given it, read only. */
export const PHONE_EXPORT_KIND = 'tasks.phone_export';

/** The largest export file the page reads (a vault of some thousand tasks is well below). */
export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

/**
 * An export file that holds an area of another class than `public` or `internal`, or one it does not name with its
 * class, or that does not say the hub cut it by the classes: the whole file is refused (fail closed, MOB-02). Nothing of
 * it is shown or kept.
 */
export class ExportClassError extends Error {
  constructor(what: string) {
    super(`export refused: ${what}`);
    this.name = 'ExportClassError';
  }
}

export interface PhoneExport {
  view: VaultView;
  /** When the hub wrote the file (ISO time): the "as of" of what it shows. */
  exportedAt: string;
}

/**
 * A `tasks.phone_export` (the third way to the vault, a file): the snapshot and the picks of `next` the hub cut for a
 * phone, with the class of every area it holds. Checked like a document of the hub (MSEC-13), and stricter: an area
 * that is not `public`/`internal`, or a task or area of the snapshot the class list does not name, refuses the whole
 * file instead of being hidden, since a file that holds it was not cut for a phone.
 */
export function phoneExport(doc: unknown): PhoneExport {
  if (!isObj(doc) || doc['kind'] !== PHONE_EXPORT_KIND || doc['schema'] !== 1) throw new ShapeError('export');
  if (doc['classes_asked'] !== true) throw new ExportClassError('classes not asked');
  const at = str(doc['exported_at'], 40);
  if (at === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(at) || Number.isNaN(Date.parse(at))) {
    throw new ShapeError('export time');
  }
  if (!Array.isArray(doc['areas'])) throw new ShapeError('export areas');
  const classes = new Map<string, DataClass>();
  for (const entry of doc['areas']) {
    if (!isObj(entry) || !isAreaName(entry['name'])) throw new ExportClassError('an area without a name');
    const dataClass = dataClassOf(entry['data_class']);
    if (!shownClass(dataClass)) throw new ExportClassError(`area ${entry['name']} is ${dataClass}`);
    classes.set(entry['name'], dataClass);
  }
  const snapshot = doc['snapshot'];
  if (!isObj(snapshot) || !Array.isArray(snapshot['areas']) || !Array.isArray(snapshot['tasks'])) {
    throw new ShapeError('export snapshot');
  }
  for (const entry of snapshot['areas']) {
    if (isObj(entry) && typeof entry['name'] === 'string' && !classes.has(entry['name'])) {
      throw new ExportClassError('an area without a class');
    }
  }
  for (const entry of snapshot['tasks']) {
    if (isObj(entry) && typeof entry['area'] === 'string' && !classes.has(entry['area'])) {
      throw new ExportClassError('a task of an area without a class');
    }
  }
  const view = vaultView(snapshot, classes, doc['next']);
  return { view, exportedAt: new Date(at).toISOString() };
}

/** `by_status` of one area: a count is a whole number of at least 0 under a status word; anything else is left out. */
export function statusCounts(value: unknown): StatusCounts {
  const counts: StatusCounts = {};
  if (!isObj(value)) return counts;
  for (const s of STATUSES) {
    const n = int(value[s]);
    if (n !== null && n >= 0) counts[s] = n;
  }
  return counts;
}

/** The most picks of `tasks.next` the page keeps. */
export const MAX_NEXT = 5;

function nextPick(value: unknown): NextPick | null {
  if (!isObj(value)) return null;
  const id = value['id'];
  const title = str(value['title']);
  if (!isTaskId(id) || title === null) return null;
  return { id, area: id.slice(0, id.indexOf('/')), title, status: status(value['status']), prio: int(value['prio']) };
}

/**
 * `/api/tasks/next`: the engine's pick and its alternatives, in its order, only those of shown areas (the area is
 * the start of the id, the way the engine makes ids), each task once.
 */
export function nextPicks(doc: unknown, shown: ReadonlySet<string>): NextPick[] {
  if (!isObj(doc) || doc['kind'] !== 'tasks.next') throw new ShapeError('next');
  const raw = [doc['task'], ...(Array.isArray(doc['alternatives']) ? doc['alternatives'] : [])];
  const picks: NextPick[] = [];
  for (const entry of raw) {
    const pick = nextPick(entry);
    if (!pick || !shown.has(pick.area) || picks.some((p) => p.id === pick.id)) continue;
    picks.push(pick);
    if (picks.length === MAX_NEXT) break;
  }
  return picks;
}

function question(value: unknown): Question | null {
  if (!isObj(value)) return null;
  const n = int(value['n']);
  const title = str(value['title']);
  if (n === null || title === null || !Array.isArray(value['options'])) return null;
  const key = str(value['key'], 20);
  const options = value['options'].flatMap((o) => {
    if (!isObj(o)) return [];
    const on = int(o['n']);
    const text = str(o['text']);
    if (on === null || text === null) return [];
    return [{ n: on, text, recommended: o['recommended'] === true, chosen: o['chosen'] === true }];
  });
  return { n, key: key !== null && /^q\d+$/.test(key) ? key : null, title, answered: value['answered'] === true, options };
}

/** `/api/tasks/task`: one task with its body, only when its area may be shown. */
export function taskDetail(doc: unknown, classes: Map<string, DataClass>): TaskDetail {
  if (!isObj(doc) || doc['kind'] !== 'tasks.task') throw new ShapeError('task');
  const task = taskBrief(doc['task']);
  if (task === null) throw new ShapeError('task');
  if (!shownClass(classes.get(task.area) ?? 'unclassified')) throw new ShapeError('task of a hidden area');
  const rawBody = typeof doc['body'] === 'string' ? doc['body'] : '';
  const questions = Array.isArray(doc['questions'])
    ? doc['questions'].map(question).filter((q): q is Question => q !== null)
    : [];
  return {
    task,
    body: rawBody.slice(0, MAX_BODY),
    bodyTruncated: doc['body_truncated'] === true || rawBody.length > MAX_BODY,
    questions,
  };
}

/** The longest list of paths and of points of one path taken; the rest is dropped (the hub sends far fewer). */
export const MAX_PATHS = 200;
export const MAX_POINTS = 1000;

function count(value: unknown): number {
  const n = int(value);
  return n !== null && n >= 0 ? n : 0;
}

function progress(value: unknown): PathProgress {
  const p = isObj(value) ? value : {};
  return {
    learned: count(p['learned']),
    seen: count(p['seen']),
    dropped: count(p['dropped']),
    open: count(p['open']),
    blocked: count(p['blocked']),
    total: count(p['total']),
  };
}

/** A path of the list; null when it is no path of a shown area (the hub cut already; the page checks again). */
export function pathBrief(value: unknown, classes: Map<string, DataClass>): PathBrief | null {
  if (!isObj(value)) return null;
  const id = value['id'];
  const area = value['area'];
  const title = str(value['title']);
  if (!isTaskId(id) || !isAreaName(area) || id.split('/')[0] !== area || title === null) return null;
  if (!shownClass(classes.get(area) ?? 'unclassified')) return null;
  const icon = isObj(value['icon']) && value['icon']['kind'] === 'emoji' ? str(value['icon']['value'], 16) : null;
  const xp = isObj(value['xp']) ? { earned: count(value['xp']['earned']), possible: count(value['xp']['possible']) } : null;
  const level =
    isObj(value['level']) && int(value['level']['level']) !== null
      ? { level: count(value['level']['level']), name: str(value['level']['name'], 80) ?? '' }
      : null;
  return {
    id,
    area,
    title,
    status: str(value['status'], 20) ?? '',
    summary: str(value['summary']) ?? '',
    icon,
    progress: progress(value['progress']),
    xp: xp && xp.possible > 0 ? xp : null,
    level,
    etag: str(value['etag'], 200),
  };
}

/** `tasks.paths` as the hub cut it for this phone; `partial`: some could not be read on the PC. */
export function pathList(doc: unknown, classes: Map<string, DataClass>): { paths: PathBrief[]; partial: boolean } {
  if (!isObj(doc) || doc['kind'] !== 'tasks.paths' || !Array.isArray(doc['items'])) throw new ShapeError('paths');
  const paths = doc['items']
    .slice(0, MAX_PATHS)
    .map((item) => pathBrief(item, classes))
    .filter((p): p is PathBrief => p !== null);
  return { paths, partial: doc['partial'] === true };
}

/** A web address of a point, or null: the phone opens nothing else. */
function webLink(value: unknown): string | null {
  const link = str(value, 2000);
  return link !== null && (link.startsWith('https://') || link.startsWith('http://')) ? link : null;
}

function pathPoint(value: unknown): PathPoint | null {
  if (!isObj(value)) return null;
  const index = int(value['index']);
  const key = str(value['key'], 64);
  if (index === null || key === null || key === '') return null;
  const promoted = value['promoted'];
  return {
    index,
    key,
    parent: int(value['parent']),
    depth: count(value['depth']),
    state: str(value['state'], 20) ?? 'open',
    derived: str(value['derived'], 20) ?? str(value['state'], 20) ?? 'open',
    children: count(value['children']),
    label: str(value['label'], 1000) ?? key,
    note: str(value['note'], 4000),
    reason: str(value['reason']),
    link: webLink(value['link']),
    promoted: isTaskId(promoted) ? promoted : null,
    xp: int(value['xp']),
  };
}

/** `tasks.path` as the hub cut it; a path of an area this phone does not show is refused. */
export function pathDetail(doc: unknown, classes: Map<string, DataClass>): PathDetail {
  if (!isObj(doc) || doc['kind'] !== 'tasks.path') throw new ShapeError('path');
  const path = pathBrief(doc['path'], classes);
  if (path === null) throw new ShapeError('path of a hidden area');
  const points = Array.isArray(doc['nodes'])
    ? doc['nodes']
        .slice(0, MAX_POINTS)
        .map(pathPoint)
        .filter((p): p is PathPoint => p !== null)
    : [];
  const rawBody = typeof doc['body'] === 'string' ? doc['body'] : '';
  return { path, body: rawBody.slice(0, MAX_BODY), points };
}

/** The longest list of meetings taken (the hub sends one page of at most 100). */
export const MAX_MEETINGS = 100;

/** A meeting of the list; null when it is no meeting of a shown area (the hub cut already; the page checks again). */
export function meetingBrief(value: unknown, classes: Map<string, DataClass>): MeetingBrief | null {
  if (!isObj(value)) return null;
  const id = value['id'];
  const area = value['area'];
  const title = str(value['title']);
  const date = day(value['date']);
  if (!isTaskId(id) || !isAreaName(area) || id.split('/')[0] !== area || title === null || date === null) return null;
  if (!shownClass(classes.get(area) ?? 'unclassified')) return null;
  const time = typeof value['time'] === 'string' && /^\d{2}:\d{2}$/.test(value['time']) ? value['time'] : null;
  const online = webLink(value['online']);
  return {
    id,
    area,
    title,
    status: str(value['status'], 20) ?? 'planned',
    date,
    time,
    end: str(value['end'], 20),
    location: str(value['location'], 200),
    online,
    onlineService: online ? str(value['online_service'], 20) : null,
    icon: isObj(value['icon']) && value['icon']['kind'] === 'emoji' ? str(value['icon']['value'], 16) : null,
  };
}

/** `tasks.meetings` as the hub cut it, in the order of their time; `partial`: the window held more. */
export function meetingList(doc: unknown, classes: Map<string, DataClass>): { meetings: MeetingBrief[]; partial: boolean } {
  if (!isObj(doc) || doc['kind'] !== 'tasks.meetings' || !Array.isArray(doc['items'])) throw new ShapeError('meetings');
  const meetings = doc['items']
    .slice(0, MAX_MEETINGS)
    .map((item) => meetingBrief(item, classes))
    .filter((m): m is MeetingBrief => m !== null)
    .sort((a, b) => `${a.date} ${a.time ?? ''}`.localeCompare(`${b.date} ${b.time ?? ''}`));
  return { meetings, partial: doc['partial'] === true };
}

/** The lines of `## Protokoll` (or `## Minutes`) of a body, as the engine writes them: `- HH:MM text`. */
export function minutesOf(body: string): MinuteLine[] {
  const lines = body.split(/\r?\n/);
  const at = lines.findIndex((l) => /^## (Protokoll|Minutes)\s*$/.test(l));
  if (at < 0) return [];
  const out: MinuteLine[] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^## /.test(line)) break;
    const m = /^- (\d{2}:\d{2}) (.+)$/.exec(line.trim());
    if (m) out.push({ at: m[1] ?? '', text: (m[2] ?? '').slice(0, MAX_LINE) });
  }
  return out;
}

/** `tasks.meeting` as the hub cut it; a meeting of an area this phone does not show is refused. */
export function meetingDetail(doc: unknown, classes: Map<string, DataClass>): MeetingDetail {
  if (!isObj(doc) || doc['kind'] !== 'tasks.meeting') throw new ShapeError('meeting');
  const meeting = meetingBrief(doc['meeting'], classes);
  if (meeting === null) throw new ShapeError('meeting of a hidden area');
  const items = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
  return {
    meeting,
    agenda: items(doc['agenda'])
      .map((a) => ({ n: count(a['n']), text: str(a['text']) ?? '', ticked: a['ticked'] === true }))
      .filter((a) => a.text !== ''),
    minutes: minutesOf(typeof doc['body'] === 'string' ? doc['body'].slice(0, MAX_BODY) : ''),
    followups: items(doc['followups'])
      .map((f) => ({
        n: count(f['n']),
        text: str(f['text']) ?? '',
        ticked: f['ticked'] === true,
        task: isTaskId(f['task']) ? (f['task'] as string) : null,
      }))
      .filter((f) => f.text !== ''),
    // The name and the tick only: an address the hub let through for a public area stays out of the page.
    participants: items(doc['participants'])
      .slice(0, MAX_PARTICIPANTS)
      .map((p) => ({ n: count(p['n']), name: str(p['name'], 200) ?? '', present: p['present'] === true }))
      .filter((p) => p.name !== '' && p.n > 0),
  };
}

/** The most participants shown. */
export const MAX_PARTICIPANTS = 200;

/** A line of the minutes for the eye: a photo or a voice note the engine wrote as a link shows its name, not the link. */
export function minuteShown(text: string): { kind: 'text' | 'photo' | 'audio'; text: string } {
  const photo = /^!\[([^\]]*)\]\(assets\/[^)\s]+\)$/.exec(text);
  if (photo) return { kind: 'photo', text: photo[1] ?? '' };
  const audio = /^\[Audio: ([^\]]*)\]\(assets\/[^)\s]+\)$/.exec(text);
  if (audio) return { kind: 'audio', text: audio[1] ?? '' };
  return { kind: 'text', text };
}

export const OP_ERROR_CODES: readonly OpErrorCode[] = [
  'invalid_argument',
  'not_found',
  'conflict',
  'exists',
  'forbidden',
  'locked',
  'lock_stuck',
  'unsupported_schema',
  'payload_too_large',
  'rollback_incomplete',
  'io',
  'internal',
];

/** A word of the engine this page does not know counts as `internal` (the contract says so). */
function errorCode(value: unknown): OpErrorCode {
  return typeof value === 'string' && (OP_ERROR_CODES as readonly string[]).includes(value)
    ? (value as OpErrorCode)
    : 'internal';
}

/** `routines_started` of a finished write: the routines that waited for it and got their first due date. */
function routinesStarted(value: unknown): RoutineStarted[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((entry) => {
    if (!isObj(entry)) return [];
    const due = day(entry['due']);
    const after = str(entry['after'], 200);
    return isTaskId(entry['id']) && due !== null && after !== null ? [{ id: entry['id'], due, after }] : [];
  });
}

/** `/api/tasks/ops` with one operation: what the engine said to it. */
export function opOutcome(doc: unknown): OpOutcome {
  if (!isObj(doc) || doc['kind'] !== 'tasks.result' || !Array.isArray(doc['results'])) throw new ShapeError('result');
  const entry = doc['results'][0];
  if (!isObj(entry)) throw new ShapeError('result');
  if (entry['ok'] === true && doc['ok'] === true) {
    const started = routinesStarted(entry['routines_started']);
    return { ok: true, id: isTaskId(entry['id']) ? entry['id'] : null, ...(started.length > 0 ? { routinesStarted: started } : {}) };
  }
  const error = isObj(entry['error']) ? entry['error'] : {};
  return {
    ok: false,
    code: errorCode(error['code']),
    message: str(error['message']) ?? '',
    retryable: error['retryable'] === true,
  };
}

/** `/api/tasks/done_preview`. */
export function donePreview(doc: unknown): DonePreview {
  if (!isObj(doc) || doc['kind'] !== 'tasks.donepreview') throw new ShapeError('done preview');
  const freed = Array.isArray(doc['freed']) ? doc['freed'].filter(isTaskId) : [];
  const next = isObj(doc['next_round']) ? day(doc['next_round']['due']) : null;
  return {
    already: doc['already'] === true,
    confirm: str(doc['confirm'], 200),
    closesPlan: str(doc['closes_plan'], 200),
    closesProject: str(doc['closes_project'], 200),
    freed,
    nextDue: next,
    endsRoutine: doc['ends_routine'] === true,
  };
}

/** `/api/tasks/device`: the level this device has now; anything else is no level (the page keeps what it had). */
export function deviceLevel(doc: unknown): Right {
  if (!isObj(doc) || doc['kind'] !== 'tasks.device') throw new ShapeError('device');
  const level = doc['level'];
  if (typeof level !== 'string' || !(LEVELS as readonly string[]).includes(level)) throw new ShapeError('device level');
  return level as Right;
}

/**
 * `/api/tasks/testing_sheets`: the names of the sheets that name the task `id` (only for that id); `null` when the PC is
 * not paired with testing (`linked: false`), which is the usual case and nothing to show.
 */
export function testingSheets(doc: unknown, id: string): string[] | null {
  if (!isObj(doc) || doc['kind'] !== 'tasks.testing_sheets' || doc['id'] !== id || !Array.isArray(doc['sheets'])) {
    throw new ShapeError('testing sheets');
  }
  if (doc['linked'] === false) return null;
  return doc['sheets']
    .map((s) => str(s, 200))
    .filter((s): s is string => s !== null && s !== '')
    .slice(0, 50);
}

const VERDICTS: readonly RunVerdict[] = ['green', 'red', 'not_written', 'refused', 'failed', 'stopped'];

/** A plain word of the hub (a verdict or an outcome this page may not know): lowercase letters and `_`, short. */
function word(v: unknown): string | null {
  return typeof v === 'string' && /^[a-z_]{1,32}$/.test(v) ? v : null;
}

function runBlock(v: unknown): RunBlock | null {
  if (!isObj(v) || typeof v['written'] !== 'boolean') return null;
  const outcome = word(v['outcome']);
  return outcome === null ? null : { written: v['written'], outcome };
}

/** `/api/tasks/testing_run` (and the answer of a start): where the run stands; a field of the wrong type is left out. */
export function testingRun(doc: unknown): TestingRun {
  if (!isObj(doc) || doc['kind'] !== 'tasks.testing_run') throw new ShapeError('testing run');
  const available = doc['available'] === true;
  const run = doc['run'];
  if (!isObj(run)) return { available, run: null };
  const running = run['running'] === true;
  if (run['what'] === 'task' && isTaskId(run['task'])) {
    const said = word(run['verdict']);
    const verdict = said !== null && (VERDICTS as readonly string[]).includes(said) ? (said as RunVerdict) : null;
    return {
      available,
      run: {
        what: 'task',
        task: run['task'],
        running,
        verdict,
        word: verdict === null ? said : null,
        exit: int(run['exit']),
        block: runBlock(run['block']),
        sheetsRed: typeof run['sheets_red'] === 'boolean' ? run['sheets_red'] : null,
      },
    };
  }
  return { available, run: { what: 'other', running } };
}

/** `hello` of the hub. */
export function hubHello(doc: unknown): HubHello {
  if (!isObj(doc) || !isObj(doc['engine'])) throw new ShapeError('hello');
  return {
    version: str(doc['version'], 100) ?? '',
    engineReady: doc['engine']['ready'] === true,
    engineProblem: str(doc['engine']['problem']),
  };
}
