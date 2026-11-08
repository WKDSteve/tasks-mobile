import { describe, expect, it } from 'vitest';
import { readToken, restoreView, writeToken, type TokenStorage } from './storage';

function storage(): TokenStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

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

describe('the session token (WEB-07)', () => {
  it('keeps a token of the hub shape and refuses anything else', () => {
    const s = storage();
    writeToken(s, 'ab'.repeat(32));
    expect(readToken(s)).toBe('ab'.repeat(32));
    s.data.set('tasks-mobile.session', 'not a token');
    expect(readToken(s)).toBeNull();
    writeToken(s, null);
    expect(s.data.size).toBe(0);
  });

  it('survives a storage that throws', () => {
    const broken: TokenStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readToken(broken)).toBeNull();
    expect(() => writeToken(broken, 'ab'.repeat(32))).not.toThrow();
  });
});
