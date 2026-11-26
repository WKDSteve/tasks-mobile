// The exercise block under a learning point (tasks.nvim `tasks_nvim.exercise`, rule LP-21): the note of a point (its
// `> ` lines joined by newlines) holds up to four labelled parts, `**Aufgabe:**`, `**Fertig, wenn:**`, `**Nachweis:**`
// and `**Ergebnis:**`. The page only takes the note apart to show it (the same reading as tasks-desktop's
// `ui/src/lib/exercise.ts`); whether a point may be learned is the engine's (`learned` without a result is refused
// there, MOB-05): `needsResult` is the same question asked early, so that the page asks for the proof instead of
// queueing a tick the engine would refuse.

export type ExerciseKey = 'aufgabe' | 'fertig' | 'nachweis' | 'ergebnis';

const LABELS: Record<ExerciseKey, string> = {
  aufgabe: 'Aufgabe',
  fertig: 'Fertig, wenn',
  nachweis: 'Nachweis',
  ergebnis: 'Ergebnis',
};

const KEY_OF = new Map<string, ExerciseKey>(Object.entries(LABELS).map(([key, label]) => [label.toLowerCase(), key as ExerciseKey]));

// `**Label:** rest` (the label may hold a comma and spaces: `Fertig, wenn`)
const LABEL_LINE = /^\s*\*\*([^*]*?):\*\*[ \t]*(.*?)\s*$/;

export type ExerciseParts = Partial<Record<ExerciseKey, string>>;

/**
 * The parts of a note: each present label with its text (the lines of a part joined by one space; an empty part is
 * `''`). Text before the first label and parts with an unknown label are no part of the block.
 */
export function parseExercise(note: string | null | undefined): ExerciseParts {
  const parts: ExerciseParts = {};
  if (!note) return parts;
  let current: ExerciseKey | undefined;
  for (const line of note.replace(/\r\n?/g, '\n').split('\n')) {
    const found = LABEL_LINE.exec(line);
    if (found) {
      current = KEY_OF.get(found[1]!.trim().toLowerCase());
      if (current) parts[current] = parts[current] === undefined ? found[2]! : `${parts[current]} ${found[2]!}`;
    } else if (current) {
      const text = line.trim();
      if (text !== '') parts[current] = `${parts[current] ?? ''} ${text}`.trim();
    }
  }
  for (const key of Object.keys(parts) as ExerciseKey[]) parts[key] = parts[key]!.trim();
  return parts;
}

/**
 * Whether the note carries an exercise block: a part `Aufgabe`, even an empty one (as the engine's `has_block`, which is
 * also what lets the engine write a result into the note).
 */
export function hasBlock(note: string | null | undefined): boolean {
  return parseExercise(note).aufgabe !== undefined;
}

/** Whether learning the point needs a result: its block names a `Nachweis` and the `Ergebnis` is empty or missing. */
export function needsResult(note: string | null | undefined): boolean {
  const parts = parseExercise(note);
  return !!parts.nachweis && !parts.ergebnis;
}

/** A piece of a part as the page draws it: plain text, code (`` `x` ``) or strong text (`**x**`). Never HTML. */
export interface Span {
  kind: 'text' | 'code' | 'strong';
  text: string;
}

// Code first (its text is kept as written), then strong text; an unclosed mark stays text.
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*/g;

/**
 * The text of a part in pieces for the eye: inline code as code and `**strong**` as strong text, so that no `**` and no
 * backtick is left in what is read. Everything is text (drawn by Svelte as text, never as HTML).
 */
export function spans(text: string): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1] });
    else out.push({ kind: 'strong', text: m[2]! });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

/** The longest result the page sends (the engine checks the text; this keeps a queued write small). */
export const RESULT_MAX = 2000;
