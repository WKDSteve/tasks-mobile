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

  it('takes back counts and picks only as the parser would, and nothing of a hidden area', () => {
    const kept = restoreView({
      at: '2026-01-01T00:00:00Z',
      view: {
        ...view,
        counts: { open: 3, doing: -1, parked: 1.5, nonsense: 4 },
        next: [
          { id: 'secret/b', area: 'secret', title: 'B' },
          { id: 'garden/a', area: 'secret', title: 'claims another area' },
          { id: 'garden/a', area: 'garden', title: 'A', status: 'open', prio: 1 },
        ],
      },
    });
    expect(kept?.view.counts).toEqual({ open: 3 });
    expect(kept?.view.next).toEqual([{ id: 'garden/a', area: 'garden', title: 'A', status: 'open', prio: 1 }]);
  });

  it('a copy kept before counts and picks existed shows none of them', () => {
    const kept = restoreView({ at: '2026-01-01T00:00:00Z', view });
    expect(kept?.view.counts).toEqual({});
    expect(kept?.view.next).toEqual([]);
  });

  it('is a miss for anything else', () => {
    expect(restoreView(null)).toBeNull();
    expect(restoreView({ view })).toBeNull();
    expect(restoreView({ at: 'x', view: { ...view, tasks: 'no' } })).toBeNull();
  });
});
