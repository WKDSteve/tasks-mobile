import { describe, expect, it } from 'vitest';
import { allows, DEFAULT_RIGHTS, rightFor, type Right } from './rights';

describe('rights', () => {
  it('needs create for a new task and an answer, change for a status and finishing', () => {
    expect(rightFor({ op: 'new', area: 'a', title: 't' })).toBe('create');
    expect(rightFor({ op: 'answer', id: 'a/b', question: 'q1', option: 1 })).toBe('create');
    expect(rightFor({ op: 'set', id: 'a/b', patch: { status: 'doing' } })).toBe('change');
    expect(rightFor({ op: 'done', id: 'a/b', confirm: 'c' })).toBe('change');
  });

  it('gives a new phone read, create and change, never trigger', () => {
    expect([...DEFAULT_RIGHTS].sort()).toEqual(['change', 'create', 'read']);
  });

  it('refuses without the right, and without read', () => {
    const readCreate = new Set<Right>(['read', 'create']);
    expect(allows(readCreate, { op: 'set', id: 'a/b', patch: { status: 'doing' } })).toBe(false);
    expect(allows(readCreate, { op: 'new', area: 'a', title: 't' })).toBe(true);
    expect(allows(new Set<Right>(['create']), { op: 'new', area: 'a', title: 't' })).toBe(false);
  });
});
