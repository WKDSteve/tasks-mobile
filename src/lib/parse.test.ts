import { describe, expect, it } from 'vitest';
import { areaClasses, dataClassOf, donePreview, isTaskId, opOutcome, ShapeError, taskBrief, taskDetail, vaultView } from './parse';

const classes = new Map([
  ['garden', 'public' as const],
  ['kitchen', 'internal' as const],
  ['secret', 'private' as const],
  ['loose', 'unclassified' as const],
]);

function snapshot(tasks: unknown[], areas = ['garden', 'kitchen', 'secret', 'loose', 'unnamed']): unknown {
  return { kind: 'tasks.snapshot', rev: 'r1', areas: areas.map((name) => ({ name, open: 1 })), tasks };
}

describe('data classes (MOB-02, fail closed)', () => {
  it('shows only public and internal areas and their tasks', () => {
    const view = vaultView(
      snapshot([
        { id: 'garden/a', area: 'garden', title: 'A' },
        { id: 'kitchen/b', area: 'kitchen', title: 'B' },
        { id: 'secret/c', area: 'secret', title: 'C' },
        { id: 'loose/d', area: 'loose', title: 'D' },
        { id: 'unnamed/e', area: 'unnamed', title: 'E' },
      ]),
      classes,
    );
    expect(view.tasks.map((t) => t.id)).toEqual(['garden/a', 'kitchen/b']);
    expect(view.areas.map((a) => a.name)).toEqual(['garden', 'kitchen']);
    // secret, loose and the area without any class entry
    expect(view.hiddenAreas).toBe(3);
  });

  it('takes an unknown class word as unclassified', () => {
    expect(dataClassOf('PUBLIC')).toBe('unclassified');
    expect(dataClassOf(undefined)).toBe('unclassified');
    expect(dataClassOf('internal')).toBe('internal');
  });

  it('drops a task that claims a shown area its id does not belong to', () => {
    const view = vaultView(snapshot([{ id: 'secret/x', area: 'garden', title: 'smuggled' }]), classes);
    expect(view.tasks).toEqual([]);
  });

  it('refuses the detail of a task of a hidden area', () => {
    const doc = { kind: 'tasks.task', task: { id: 'secret/c', area: 'secret', title: 'C' }, body: 'x' };
    expect(() => taskDetail(doc, classes)).toThrow(ShapeError);
  });

  it('reads the classes the hub gives and ignores entries that are not areas', () => {
    const map = areaClasses({ areas: [{ name: 'garden', data_class: 'public' }, { name: '../x', data_class: 'public' }, 'junk'] });
    expect([...map.entries()]).toEqual([['garden', 'public']]);
  });
});

describe('shape checks at the edge (MSEC-13)', () => {
  it('refuses a document of another kind instead of showing an empty list (MOB-09)', () => {
    expect(() => vaultView({ kind: 'tasks.error', code: 'internal' }, classes)).toThrow(ShapeError);
    expect(() => vaultView(null, classes)).toThrow(ShapeError);
  });

  it('refuses ids with path tricks', () => {
    expect(isTaskId('garden/a')).toBe(true);
    expect(isTaskId('garden/../secret')).toBe(false);
    expect(isTaskId('../secret/a')).toBe(false);
    expect(isTaskId('garden/a/b')).toBe(false);
    expect(isTaskId('garden/a b')).toBe(false);
    expect(isTaskId('x'.repeat(300) + '/a')).toBe(false);
  });

  it('cuts an overlong title and drops fields of the wrong type', () => {
    const brief = taskBrief({ id: 'garden/a', area: 'garden', title: 'x'.repeat(5000), prio: '1', due: 'tomorrow', status: 'weird' });
    expect(brief?.title.length).toBe(500);
    expect(brief?.prio).toBeNull();
    expect(brief?.due).toBeNull();
    expect(brief?.status).toBeNull();
  });

  it('reads the verdict of the engine on a write, and an unknown error word as internal', () => {
    expect(opOutcome({ kind: 'tasks.result', ok: true, results: [{ ok: true, id: 'garden/new' }] })).toEqual({ ok: true, id: 'garden/new' });
    expect(
      opOutcome({ kind: 'tasks.result', ok: false, results: [{ ok: false, error: { code: 'conflict', message: 'm', retryable: false } }] }),
    ).toEqual({ ok: false, code: 'conflict', message: 'm', retryable: false });
    expect(opOutcome({ kind: 'tasks.result', ok: false, results: [{ ok: false, error: { code: 'new_word' } }] })).toMatchObject({
      ok: false,
      code: 'internal',
    });
  });

  it('takes a result as ok only when the request and the entry both say so', () => {
    expect(opOutcome({ kind: 'tasks.result', ok: false, results: [{ ok: true }] }).ok).toBe(false);
  });

  it('reads a done preview and keeps only ids among the freed', () => {
    const p = donePreview({ kind: 'tasks.donepreview', confirm: 'c1', freed: ['garden/a', '../x', 3], next_round: { due: '2026-02-01' } });
    expect(p).toEqual({ already: false, confirm: 'c1', closesPlan: null, closesProject: null, freed: ['garden/a'], nextDue: '2026-02-01' });
  });
});
