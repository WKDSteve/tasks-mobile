// A routine as the engine writes it (`repeat`, a ladder `1w,4w,12w`, `repeat_after`): what the page shows of it. The
// engine judges every value (MOB-05); this only reads what it wrote.

import type { TaskBrief } from './types';

/** The intervals of `repeat`: one (`8w`) or a ladder (`1w,4w,12w`), as written. */
export function intervalsOf(repeat: string | undefined): string[] {
  return repeat === undefined ? [] : repeat.split(',').filter((part) => part !== '');
}

/** The intervals as a person reads them: `1w, 4w, 12w`. */
export function everyOf(repeat: string | undefined): string {
  return intervalsOf(repeat).join(', ');
}

/** The round of a ladder the task is (`repeat_step`, 1 when absent) and how many it has; `null` for no ladder. */
export function roundOf(task: Pick<TaskBrief, 'repeat' | 'repeatStep'>): { step: number; of: number } | null {
  const of = intervalsOf(task.repeat).length;
  if (of < 2) return null;
  return { step: task.repeatStep ?? 1, of };
}

/**
 * What the routine waits for to be finished (`repeat_after` and no `due` yet): the finish writes its first due date.
 * `null` once it has a due date, or when it waits for nothing.
 */
export function waitsFor(task: Pick<TaskBrief, 'repeatAfter' | 'due'>): string | null {
  return task.repeatAfter !== undefined && task.due === null ? task.repeatAfter : null;
}
