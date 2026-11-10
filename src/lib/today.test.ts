import { describe, expect, it } from 'vitest';
import { countRows, dueTasks, localDay, questionTasks, todayOf } from './today';
import type { TaskBrief } from './types';

function task(id: string, extra: Partial<TaskBrief> = {}): TaskBrief {
  return {
    id,
    area: id.split('/')[0]!,
    title: id,
    status: 'open',
    prio: null,
    due: null,
    remind: null,
    openQuestions: 0,
    etag: null,
    ...extra,
  };
}

describe('the today view', () => {
  it('names the day in local time, as the engine writes days', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('takes the tasks whose due or remind day has come, the earliest first, the engine order among equals', () => {
    const tasks = [
      task('a/later', { due: '2026-01-11' }),
      task('a/today', { due: '2026-01-10' }),
      task('a/remind', { remind: '2026-01-02', due: '2026-01-20' }),
      task('a/also-today', { remind: '2026-01-10' }),
      task('a/none'),
    ];
    expect(dueTasks(tasks, '2026-01-10').map((d) => [d.task.id, d.day, d.why])).toEqual([
      ['a/remind', '2026-01-02', 'remind'],
      ['a/today', '2026-01-10', 'due'],
      ['a/also-today', '2026-01-10', 'remind'],
    ]);
  });

  it('names a task with both days once, by the earlier one', () => {
    const due = dueTasks([task('a/x', { due: '2026-01-01', remind: '2026-01-03' })], '2026-01-10');
    expect(due).toHaveLength(1);
    expect(due[0]?.why).toBe('due');
  });

  it('takes the tasks with open questions in the engine order', () => {
    const tasks = [task('a/one', { openQuestions: 2 }), task('a/two'), task('a/three', { openQuestions: 1 })];
    expect(questionTasks(tasks).map((t) => t.id)).toEqual(['a/one', 'a/three']);
  });

  it('shows the counts in the order of the statuses and only those the engine counted', () => {
    expect(countRows({ parked: 4, open: 0, doing: 2 })).toEqual([
      { status: 'doing', n: 2 },
      { status: 'open', n: 0 },
      { status: 'parked', n: 4 },
    ]);
  });

  it('is empty without a vault', () => {
    expect(todayOf(null, '2026-01-10')).toEqual({ next: [], questions: [], due: [], counts: [] });
  });
});
