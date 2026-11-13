// Capturing a task on the way: the form is checked here, the engine checks the task (MOB-05). What is refused is
// said in a word the page shows next to the field, never dropped in silence (MOB-09).

import type { AttachmentKind } from './attach';
import type { Op } from './types';

export const MAX_TITLE = 200;
export const MAX_CONTEXT = 2000;

/** C0 controls except line feed, DEL, C1, and the characters that hide or reorder text. */
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/u;

export interface Draft {
  area: string;
  title: string;
  context: string;
}

/** A file chosen in the form, before the task is made. */
export interface PickedFile {
  id: number;
  blob: Blob;
  kind: AttachmentKind;
  /** A `blob:` address of this page for the preview; given back when the file leaves the form. */
  url: string;
  /** Where the blob is kept in the draft's file store, once the draft was kept. */
  key?: string;
}

/**
 * The capture form as it was left. It lives in the state of the app, not in the form: looking at another view (Today,
 * the list, Waiting) does not take a typed title, a chosen photo or a voice note away; only creating or discarding does.
 */
export interface CaptureForm extends Draft {
  /** Filled from a share of another app (said above the form). */
  fromShare: boolean;
  files: PickedFile[];
}

/** A file of the kept draft: its blob lies in the draft's file store under `key`. */
export interface KeptDraftFile {
  key: string;
  kind: AttachmentKind;
}

/** The draft as the phone keeps it (text and the keys of its files); read back as untrusted (MSEC-13). */
export interface KeptDraft {
  area: string;
  title: string;
  context: string;
  fromShare: boolean;
  files: KeptDraftFile[];
}

const KEY = /^[A-Za-z0-9-]{8,64}$/;

/** A kept draft read back: every field checked and cut to what the form takes; `null` for anything else. */
export function restoreDraft(raw: unknown): KeptDraft | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? [...v].slice(0, max).join('') : null);
  const title = text(r['title'], 400);
  const context = text(r['context'], 4000);
  const area = text(r['area'], 100);
  if (title === null || context === null || area === null) return null;
  const files: KeptDraftFile[] = [];
  for (const f of Array.isArray(r['files']) ? r['files'].slice(0, 3) : []) {
    if (typeof f !== 'object' || f === null) continue;
    const { key, kind } = f as Record<string, unknown>;
    if (typeof key === 'string' && KEY.test(key) && (kind === 'photo' || kind === 'voice')) files.push({ key, kind });
  }
  return { area: /^[A-Za-z0-9._-]*$/.test(area) ? area : '', title, context, fromShare: r['fromShare'] === true, files };
}

export function emptyForm(): CaptureForm {
  return { area: '', title: '', context: '', fromShare: false, files: [] };
}

/** Is there anything in the form that would be lost by discarding it? */
export function formHolds(form: CaptureForm): boolean {
  return form.title.trim() !== '' || form.context.trim() !== '' || form.files.length > 0;
}

export type DraftProblem = 'title_empty' | 'title_long' | 'title_lines' | 'hidden_chars' | 'context_long' | 'area_unknown';

export type DraftCheck = { ok: true; op: Extract<Op, { op: 'new' }> } | { ok: false; problems: DraftProblem[] };

/** Check a draft against the areas this phone may write to; the operation when it is good. */
export function checkDraft(draft: Draft, areas: readonly string[]): DraftCheck {
  const problems: DraftProblem[] = [];
  const title = draft.title.trim();
  const context = draft.context.trim();
  if (title === '') problems.push('title_empty');
  if ([...title].length > MAX_TITLE) problems.push('title_long');
  if (/[\r\n]/.test(title)) problems.push('title_lines');
  if (CONTROL.test(title) || CONTROL.test(context.replace(/\t/g, ' '))) problems.push('hidden_chars');
  if ([...context].length > MAX_CONTEXT) problems.push('context_long');
  if (!areas.includes(draft.area)) problems.push('area_unknown');
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, op: context === '' ? { op: 'new', area: draft.area, title } : { op: 'new', area: draft.area, title, body: context } };
}
