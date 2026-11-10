// The start view "Today": what the engine would take next, the tasks that wait for an answer, the tasks whose day
// has come, and the counts per status. The page sorts and computes nothing of its own here (MOB-05): the picks and
// the counts are the engine's; whether a `due:` or `remind:` day has come is for the reader to say (the contract
// gives the date only), so that is the one comparison made here, against the phone's own day.

import type { Status, StatusCounts, TaskBrief, VaultView } from './types';
import { STATUSES } from './types';

/** The phone's day as the engine writes days (`YYYY-MM-DD`), in local time. */
export function localDay(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A task whose `due:` or `remind:` day is today or earlier, and which of the two it is. */
export interface DueTask {
  task: TaskBrief;
  /** The earlier of the two days that has come. */
  day: string;
  why: 'due' | 'remind';
}

/** The tasks of the list whose day has come, the earliest first; the engine's order among equal days. */
export function dueTasks(tasks: readonly TaskBrief[], today: string): DueTask[] {
  const found: DueTask[] = [];
  for (const task of tasks) {
    const days: DueTask[] = [];
    if (task.due !== null && task.due <= today) days.push({ task, day: task.due, why: 'due' });
    if (task.remind !== null && task.remind <= today) days.push({ task, day: task.remind, why: 'remind' });
    days.sort((a, b) => a.day.localeCompare(b.day));
    if (days[0]) found.push(days[0]);
  }
  // A stable sort keeps the engine's order among tasks of the same day.
  return found.sort((a, b) => a.day.localeCompare(b.day));
}

/** The tasks that wait for an answer to a question, in the engine's order. */
export function questionTasks(tasks: readonly TaskBrief[]): TaskBrief[] {
  return tasks.filter((t) => t.openQuestions > 0);
}

/** The counts to show, in the order of the statuses; a status the engine did not count is left out. */
export function countRows(counts: StatusCounts): { status: Status; n: number }[] {
  return STATUSES.flatMap((status) => (counts[status] === undefined ? [] : [{ status, n: counts[status] }]));
}

/** Everything the view shows, from one vault view and the day. */
export function todayOf(view: VaultView | null, today: string) {
  const tasks = view?.tasks ?? [];
  return {
    next: view?.next ?? [],
    questions: questionTasks(tasks),
    due: dueTasks(tasks, today),
    counts: countRows(view?.counts ?? {}),
  };
}
