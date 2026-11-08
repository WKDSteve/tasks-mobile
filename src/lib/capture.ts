// Capturing a task on the way: the form is checked here, the engine checks the task (MOB-05). What is refused is
// said in a word the page shows next to the field, never dropped in silence (MOB-09).

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
