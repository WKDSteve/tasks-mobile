import { describe, expect, it } from 'vitest';
import { restoreView } from './storage';

describe('the kept view (MSEC-13)', () => {
  const view = {
    rev: 'r1',
    areas: [
      { name: 'garden', dataClass: 'public' },
      { name: 'secret', dataClass: 'private' },
    ],
    tasks: [
      { id: 'garden/a', area: 'garden', title: 'A', status: 'open', prio: 1, due: null, remind: null, openQuestions: 0, etag: 'e1' },
      { id: 'secret/b', area: 'secret', title: 'B', status: 'open', openQuestions: 0 },
      { id: 'garden/../x', area: 'garden', title: 'C' },
    ],
    hiddenAreas: 1,
  };

  it('takes back only areas that may stay on the phone, and their good tasks', () => {
    const kept = restoreView({ at: '2026-01-01T00:00:00Z', view });
    expect(kept?.view.areas.map((a) => a.name)).toEqual(['garden']);
    expect(kept?.view.tasks.map((t) => t.id)).toEqual(['garden/a']);
  });

  it('is a miss for anything else', () => {
    expect(restoreView(null)).toBeNull();
    expect(restoreView({ view })).toBeNull();
    expect(restoreView({ at: 'x', view: { ...view, tasks: 'no' } })).toBeNull();
  });
});
