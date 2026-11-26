// The part of the contract `tasks-export/1` / `tasks-ops/1` that the phone shows and writes. The engine (tasks.nvim)
// is the only one that knows the rules of a task; this page never computes a status, an order or a count of its own
// (MOB-05): it shows what the hub sent, and it sends operations.
//
// These are the shapes after `parse.ts` checked them: a document of the hub is untrusted until then (MSEC-13).

export type Status = 'doing' | 'decision' | 'blocked' | 'open' | 'parked' | 'done';

export const STATUSES: readonly Status[] = ['doing', 'decision', 'blocked', 'open', 'parked', 'done'];

/** The statuses a phone may set with `set` (finishing goes through `done` and its preview). */
export const SETTABLE: readonly Status[] = ['open', 'doing', 'blocked', 'parked', 'decision'];

/** The class of an area. Only `public` and `internal` ever reach this page's screen or storage (MOB-02). */
export type DataClass = 'public' | 'internal' | 'private' | 'unclassified';

export interface AreaInfo {
  name: string;
  dataClass: DataClass;
}

/** One task of a list. */
export interface TaskBrief {
  id: string;
  area: string;
  title: string;
  status: Status | null;
  prio: number | null;
  due: string | null;
  remind: string | null;
  openQuestions: number;
  /** A routine (`repeat`): one interval (`8w`) or a ladder (`1w,4w,12w`), as the engine wrote it; absent: no routine. */
  repeat?: string;
  /** The round of a ladder this open task is (1-based); absent: not said (round 1). */
  repeatStep?: number;
  /** The task or path (or point of one) the routine waits for; with no `due` it has not started yet. */
  repeatAfter?: string;
  /** The version the engine read: every change sends it back (`if_match`), so a newer file is never overwritten. */
  etag: string | null;
}

/** How many open tasks the engine counted per status. */
export type StatusCounts = Partial<Record<Status, number>>;

/** A task the engine names as the next one to take (`tasks.next`), in the engine's order. */
export interface NextPick {
  id: string;
  area: string;
  title: string;
  status: Status | null;
  prio: number | null;
}

/** What the page shows of the vault. */
export interface VaultView {
  rev: string;
  /** Only tasks of shown areas. */
  tasks: TaskBrief[];
  /** The areas that may be shown here, by name. */
  areas: AreaInfo[];
  /** How many areas the hub named that this page does not show (no class, or a class that stays on the PC). */
  hiddenAreas: number;
  /** The engine's counts per status, added up over the shown areas only (`areas[].by_status` of the snapshot). */
  counts: StatusCounts;
  /** What the engine would take next, only the picks of shown areas. */
  next: NextPick[];
}

export interface QuestionOption {
  n: number;
  text: string;
  recommended: boolean;
  chosen: boolean;
}

export interface Question {
  n: number;
  key: string | null;
  title: string;
  answered: boolean;
  options: QuestionOption[];
}

export interface TaskDetail {
  task: TaskBrief;
  /** Untrusted text, shown as text only. */
  body: string;
  bodyTruncated: boolean;
  questions: Question[];
}

/** How a learning point is closed, or open again: what a phone may set (`node_set`; blocked is the PC's). */
export type PointState = 'open' | 'learned' | 'seen' | 'dropped';
export const POINT_STATES: readonly PointState[] = ['open', 'learned', 'seen', 'dropped'];

/** The progress of a path or a point, over its leaves (the engine counts; the page shows). */
export interface PathProgress {
  learned: number;
  seen: number;
  dropped: number;
  open: number;
  blocked: number;
  total: number;
}

/** A learning path as the list shows it (the hub's cut, `tasks.paths`). */
export interface PathBrief {
  id: string;
  area: string;
  title: string;
  status: string;
  summary: string;
  /** An emoji of the path; a file is never shown on the phone. */
  icon: string | null;
  progress: PathProgress;
  /** XP earned of the possible ones, when the path carries XP. */
  xp: { earned: number; possible: number } | null;
  /** The level reached, when the path has levels. */
  level: { level: number; name: string } | null;
  /** The version the page saw; a tick goes out with it (MOB-08). */
  etag: string | null;
}

/** One point of the tree of a path (`tasks.path`, cut by the hub). Label, note and reason are untrusted text. */
export interface PathPoint {
  index: number;
  key: string;
  parent: number | null;
  depth: number;
  /** Its own mark (`state`) and, for a point with children, the one from its leaves (`derived`). */
  state: string;
  derived: string;
  children: number;
  label: string;
  note: string | null;
  reason: string | null;
  /** A web address only (`http`, `https`): the hub drops any other. */
  link: string | null;
  /** The task the point was made into. */
  promoted: string | null;
  xp: number | null;
}

export interface PathDetail {
  path: PathBrief;
  body: string;
  points: PathPoint[];
}

/** The next point to learn of a running path (the hub's cut, `tasks.learn_next`; the engine chose it). */
export interface LearnStep {
  path: string;
  area: string;
  /** The title of the path; label and stage are untrusted text too. */
  title: string;
  icon: string | null;
  /** The point to tick (`node_set`); null: the engine named none, the step can only be opened in its path. */
  key: string | null;
  label: string;
  stage: string;
  /** Planned hours, a span or one number. */
  hMin: number | null;
  hMax: number | null;
  xp: number | null;
  /** Under `{safety}`: closing it is confirmed first. */
  safety: boolean;
  /** A web address only. */
  link: string | null;
}

/** A day of the series of the learning figures: what changed that day (the engine's differences, may be below 0). */
export interface LearnDay {
  date: string;
  learned: number;
  seen: number;
  xp: number;
  doneH: number;
  /** A learning day: a point was learned or seen (the engine's word, `days`). */
  learning: boolean;
}

/** `tasks.learn_history` asked by day, as the hub cut it: its first day, the streak, the days. */
export interface LearnSeries {
  /** The first day of the series; null: no day written yet. */
  first: string | null;
  streak: { current: number; longest: number } | null;
  days: LearnDay[];
  partial: boolean;
}

/** A meeting as the phone shows it (the hub's cut, `tasks.meetings`): time, place, and how to join. */
export interface MeetingBrief {
  id: string;
  area: string;
  title: string;
  /** `planned`, `done` or `cancelled`. */
  status: string;
  /** `YYYY-MM-DD`, and `HH:MM` when it is not all day. */
  date: string;
  time: string | null;
  end: string | null;
  location: string | null;
  /** The address to join: only when the hub let it out (a public area, or the PC's choice for an internal one). */
  online: string | null;
  onlineService: string | null;
  icon: string | null;
}

/**
 * A contact as the phone shows it (the hub's cut, `tasks.contacts`): who the person is. The mail addresses and the
 * numbers are there only when the hub let them out (a public area, or the PC's choice for an internal one); the lists
 * are empty otherwise, and `data` says which of the two it is.
 */
export interface ContactBrief {
  id: string;
  area: string;
  name: string;
  org: string | null;
  role: string | null;
  tz: string | null;
  tags: string[];
  emails: string[];
  phones: string[];
  /** The hub gave this contact's addresses, numbers and notes (and takes writes for it). */
  data: boolean;
  /** The first paragraph of the text, only when `data`. */
  summary: string | null;
  /** The version the page read; a change of the contact names it (`if_match`). */
  etag: string | null;
}

export interface ContactDetail {
  contact: ContactBrief;
  /** The notes of the contact (`## Notizen`), only when `data`; empty otherwise. */
  notes: string;
  /** The meetings of the shown areas the contact was in. */
  history: { id: string; title: string; present: boolean }[];
}

/** The fields of the contact form: what a phone writes (`device_op_fields` of the hub says the same). */
export interface ContactFields {
  org?: string | null;
  role?: string | null;
  emails?: string[];
  phones?: string[];
  tz?: string | null;
  tags?: string[];
}

/** A line of the minutes, as the engine wrote it into `## Protokoll` (its time and its text). */
export interface MinuteLine {
  at: string;
  text: string;
}

export interface MeetingDetail {
  meeting: MeetingBrief;
  agenda: { n: number; text: string; ticked: boolean }[];
  minutes: MinuteLine[];
  followups: { n: number; text: string; ticked: boolean; task: string | null }[];
  /**
   * Who was asked to come, by name, and whether they are ticked present. Only when the hub let them out (a public area,
   * or the PC's choice for an internal one); never an address.
   */
  participants: Participant[];
}

/** A participant of a meeting as the phone shows it: the name and the tick, nothing else. */
export interface Participant {
  n: number;
  name: string;
  present: boolean;
}

/** What a line of the minutes written on the phone is: the engine writes it into its section too. */
export type CaptureKind = 'text' | 'task' | 'decision' | 'question';
export const CAPTURE_KINDS: readonly CaptureKind[] = ['text', 'task', 'decision', 'question'];

/** A line of the minutes that is a file of the meeting: a photo or a voice note, uploaded before the line is written. */
export type MediaCaptureKind = 'photo' | 'audio';
export const MEDIA_CAPTURE_KINDS: readonly MediaCaptureKind[] = ['photo', 'audio'];

/** The folder a file of a meeting is uploaded into (`kind` of the hub's upload route). */
export type UploadKind = 'image' | 'audio';

/** The operations this page sends. The engine checks every one of them. */
export type Op =
  | { op: 'new'; area: string; title: string; body?: string }
  | { op: 'set'; id: string; patch: { status: Status }; if_match?: string }
  | { op: 'answer'; id: string; question: string; option: number; if_match?: string }
  | { op: 'done'; id: string; confirm: string }
  | { op: 'node_set'; id: string; point: string; state: PointState; reason?: string; ack?: true; result?: string; if_match?: string }
  | { op: 'meeting_capture'; id: string; entry: { kind: CaptureKind; text: string; at?: string } }
  | { op: 'meeting_capture'; id: string; entry: { kind: MediaCaptureKind; asset: string; at?: string } }
  | { op: 'meeting_attend'; id: string; name: string; present: boolean }
  | { op: 'contact_new'; area: string; name: string; fields?: ContactFields }
  | { op: 'contact_set'; id: string; patch: ContactFields & { name?: string }; if_match?: string };

export type OpErrorCode =
  | 'invalid_argument'
  | 'not_found'
  | 'conflict'
  | 'exists'
  | 'forbidden'
  | 'locked'
  | 'lock_stuck'
  | 'unsupported_schema'
  | 'payload_too_large'
  | 'rollback_incomplete'
  | 'io'
  | 'internal';

/** What the engine said to one write. */
export type OpOutcome =
  | { ok: true; id: string | null; routinesStarted?: RoutineStarted[] }
  | { ok: false; code: OpErrorCode; message: string; retryable: boolean };

/** What finishing a task would do, and the word that confirms exactly that. */
export interface DonePreview {
  /** The task is finished already: nothing to confirm. */
  already: boolean;
  /** Missing when the engine offers no finish (then the page offers none either). */
  confirm: string | null;
  /** The plan and the project this finish would close. */
  closesPlan: string | null;
  closesProject: string | null;
  /** Open tasks that wait on nothing but this one. */
  freed: string[];
  /** A routine: the due date of the round the finish starts. */
  nextDue: string | null;
  /** The task is the last round of a ladder: the finish starts no next round, the routine ends. */
  endsRoutine: boolean;
}

/** A routine the finish started: it waited for what was finished and now has its first due date. */
export interface RoutineStarted {
  id: string;
  due: string;
  after: string;
}

/** `hello` of the hub: whether the engine is there, and its version. */
export interface HubHello {
  version: string;
  engineReady: boolean;
  engineProblem: string | null;
  /** What the engine can (`paths`, `learn_next`, `learn_history`, ...); null: the hub did not say. */
  capabilities: string[] | null;
}

/** How a run of the test sheets ended, as the testing hub says it. */
export type RunVerdict = 'green' | 'red' | 'not_written' | 'refused' | 'failed' | 'stopped';

/** What came of writing the block of the run into the task (`changed`, `unchanged`, `failed`, ...: the hub's word). */
export interface RunBlock {
  written: boolean;
  outcome: string;
}

/** Where the run of the testing hub stands (through the tasks hub, `/api/tasks/testing_run`). */
export interface TestingRun {
  /** Whether the testing hub can run anything (its engine is there). */
  available: boolean;
  /** The run of a task this phone may see; another run only as `other`; `null`: no run yet. */
  run:
    | null
    | { what: 'other'; running: boolean }
    | {
        what: 'task';
        task: string;
        running: boolean;
        /** A verdict this page knows; `word` holds one it does not know (never shown as green). */
        verdict: RunVerdict | null;
        word: string | null;
        exit: number | null;
        /** What came of the block in the task; `null`: none, or a testing hub that does not say. */
        block: RunBlock | null;
        /** Whether the sheets were red; `null`: not said. */
        sheetsRed: boolean | null;
      };
}

/** Signs one request for its confirmation on this device (`x-device-confirm`), after the person confirmed it. */
export type ConfirmRequest = (method: string, pathAndQuery: string, body: string) => Promise<string>;
