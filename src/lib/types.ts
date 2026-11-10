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

/** The operations this page sends. The engine checks every one of them. */
export type Op =
  | { op: 'new'; area: string; title: string; body?: string }
  | { op: 'set'; id: string; patch: { status: Status }; if_match?: string }
  | { op: 'answer'; id: string; question: string; option: number; if_match?: string }
  | { op: 'done'; id: string; confirm: string };

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
  | { ok: true; id: string | null }
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
}

/** `hello` of the hub: whether the engine is there, and its version. */
export interface HubHello {
  version: string;
  engineReady: boolean;
  engineProblem: string | null;
}
