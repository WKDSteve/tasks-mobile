import { describe, expect, it } from 'vitest';
import { areaClasses, dataClassOf, deviceLevel, donePreview, ExportClassError, isTaskId, MAX_NEXT, nextPicks, opOutcome, phoneExport, ShapeError, statusCounts, taskBrief, taskDetail, vaultView } from './parse';

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

describe('the today view: counts and picks of the engine (MOB-05), only of shown areas (MOB-02)', () => {
  const doc = {
    kind: 'tasks.snapshot',
    rev: 'r1',
    areas: [
      { name: 'garden', by_status: { open: 2, decision: 1 } },
      { name: 'kitchen', by_status: { open: 1, doing: 1 } },
      { name: 'secret', by_status: { open: 50 } },
      { name: 'loose', by_status: { open: 9 } },
    ],
    tasks: [],
  };

  it('adds up the counts of the shown areas only', () => {
    expect(vaultView(doc, classes).counts).toEqual({ open: 3, decision: 1, doing: 1 });
  });

  it('leaves out a count that is no whole number of at least 0, or under a word that is no status', () => {
    expect(statusCounts({ open: -1, doing: 2.5, parked: '3', blocked: 0, later: 4 })).toEqual({ blocked: 0 });
    expect(statusCounts('x')).toEqual({});
  });

  it('keeps the engine order of next, drops picks of hidden areas, bad ids and repeats', () => {
    const next = {
      kind: 'tasks.next',
      task: { id: 'secret/x', title: 'SECRET' },
      alternatives: [
        { id: 'kitchen/b', title: 'B', status: 'doing', prio: 2 },
        { id: '../evil', title: 'E' },
        { id: 'garden/a', title: 'A', status: 'open' },
        { id: 'kitchen/b', title: 'B again' },
        { id: 'loose/l', title: 'L' },
      ],
    };
    expect(nextPicks(next, new Set(['garden', 'kitchen']))).toEqual([
      { id: 'kitchen/b', area: 'kitchen', title: 'B', status: 'doing', prio: 2 },
      { id: 'garden/a', area: 'garden', title: 'A', status: 'open', prio: null },
    ]);
  });

  it('keeps at most MAX_NEXT picks', () => {
    const alternatives = Array.from({ length: 9 }, (_, i) => ({ id: `garden/t${i}`, title: `T${i}` }));
    expect(nextPicks({ kind: 'tasks.next', alternatives }, new Set(['garden']))).toHaveLength(MAX_NEXT);
  });

  it('refuses a next document of another kind (MOB-09)', () => {
    expect(() => nextPicks({ kind: 'tasks.error' }, new Set())).toThrow(ShapeError);
    expect(() => vaultView(doc, classes, null)).toThrow(ShapeError);
  });
});

describe('an export file of the hub (the third way, read only)', () => {
  function exportDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      kind: 'tasks.phone_export',
      schema: 1,
      classes_asked: true,
      exported_at: '2026-11-13T10:00:00Z',
      areas: [
        { name: 'garden', data_class: 'public' },
        { name: 'kitchen', data_class: 'internal' },
      ],
      snapshot: {
        kind: 'tasks.snapshot',
        rev: 'sha256:1',
        areas: [
          { name: 'garden', by_status: { open: 1 } },
          { name: 'kitchen', by_status: { doing: 1 } },
        ],
        tasks: [
          { id: 'garden/a', area: 'garden', title: 'A', status: 'open' },
          { id: 'kitchen/b', area: 'kitchen', title: 'B', status: 'doing' },
        ],
      },
      next: { kind: 'tasks.next', task: { id: 'kitchen/b', title: 'B' }, alternatives: [{ id: 'garden/a', title: 'A' }] },
      ...over,
    };
  }

  it('reads the tasks, the picks and the time of the file', () => {
    const taken = phoneExport(exportDoc());
    expect(taken.exportedAt).toBe('2026-11-13T10:00:00.000Z');
    expect(taken.view.tasks.map((t) => t.id)).toEqual(['garden/a', 'kitchen/b']);
    expect(taken.view.areas).toEqual([
      { name: 'garden', dataClass: 'public' },
      { name: 'kitchen', dataClass: 'internal' },
    ]);
    expect(taken.view.next.map((p) => p.id)).toEqual(['kitchen/b', 'garden/a']);
    expect(taken.view.hiddenAreas).toBe(0);
  });

  it('refuses a file that does not say the hub cut it by the classes', () => {
    expect(() => phoneExport(exportDoc({ classes_asked: undefined }))).toThrow(ExportClassError);
    expect(() => phoneExport(exportDoc({ classes_asked: 'yes' }))).toThrow(ExportClassError);
  });

  it('refuses the whole file for one area of another class, or one of no known class (fail closed)', () => {
    for (const dataClass of ['private', 'unclassified', 'secret', undefined]) {
      const areas = [{ name: 'garden', data_class: 'public' }, { name: 'vault', data_class: dataClass }];
      expect(() => phoneExport(exportDoc({ areas }))).toThrow(ExportClassError);
    }
  });

  it('refuses a snapshot that holds an area or a task the class list does not name', () => {
    const base = exportDoc();
    const snap = base['snapshot'] as Record<string, unknown[]>;
    const withArea = { ...snap, areas: [...snap['areas']!, { name: 'secret' }] };
    expect(() => phoneExport(exportDoc({ snapshot: withArea }))).toThrow(ExportClassError);
    const withTask = { ...snap, tasks: [...snap['tasks']!, { id: 'secret/x', area: 'secret', title: 'X' }] };
    expect(() => phoneExport(exportDoc({ snapshot: withTask }))).toThrow(ExportClassError);
  });

  it('refuses another kind, schema or time as no export at all', () => {
    expect(() => phoneExport(exportDoc({ kind: 'tasks.snapshot' }))).toThrow(ShapeError);
    expect(() => phoneExport(exportDoc({ schema: 2 }))).toThrow(ShapeError);
    expect(() => phoneExport(exportDoc({ exported_at: 'yesterday' }))).toThrow(ShapeError);
    expect(() => phoneExport(exportDoc({ snapshot: null }))).toThrow(ShapeError);
    expect(() => phoneExport(null)).toThrow(ShapeError);
  });
});

describe('the level of the device', () => {
  it('reads a level the hub names, and nothing else', () => {
    expect(deviceLevel({ kind: 'tasks.device', schema: 1, level: 'create' })).toBe('create');
    for (const doc of [{ kind: 'tasks.device', level: 'admin' }, { kind: 'tasks.device' }, { kind: 'tasks.hello', level: 'read' }, null]) {
      expect(() => deviceLevel(doc)).toThrow(ShapeError);
    }
  });
});
