import { describe, expect, it } from 'vitest';
import { restore, WriteQueue, type Pending, type QueueStore } from './queue';
import { AnswerLost, HubRefused, Unpaired, Unreachable, type DataSource } from './source';
import type { Op, OpOutcome } from './types';

function memory(): QueueStore & { saved: Pending[] | null } {
  const box = {
    saved: null as Pending[] | null,
    load: async () => box.saved,
    save: async (items: Pending[]) => {
      box.saved = JSON.parse(JSON.stringify(items)) as Pending[];
    },
    clear: async () => {
      box.saved = null;
    },
  };
  return box;
}

function source(answers: ((op: Op) => OpOutcome | Error)[]): DataSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    kind: 'fake',
    calls,
    hello: async () => ({ version: '', engineReady: true, engineProblem: null }),
    vault: async () => ({ rev: 'r', tasks: [], areas: [], hiddenAreas: 0 }),
    task: async () => {
      throw new Error('unused');
    },
    donePreview: async () => {
      throw new Error('unused');
    },
    write: async (id, op) => {
      calls.push(id);
      const next = answers.shift();
      if (!next) throw new Error('no answer left');
      const answer = next(op);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

let n = 0;
const ids = () => `id-0000000${(n += 1)}`;
const clock = () => new Date('2026-01-01T00:00:00Z');
const NEW: Op = { op: 'new', area: 'garden', title: 'A' };

describe('WriteQueue', () => {
  it('sends in order and removes what the engine took', async () => {
    const q = new WriteQueue(memory(), ids, clock);
    await q.add(NEW, 'garden', 'A');
    await q.add({ op: 'new', area: 'garden', title: 'B' }, 'garden', 'B');
    const src = source([() => ({ ok: true, id: 'garden/a' }), () => ({ ok: true, id: 'garden/b' })]);
    expect(await q.flush(src)).toEqual({ sent: 2, stopped: null });
    expect(q.items).toEqual([]);
    expect(src.calls).toHaveLength(2);
  });

  it('keeps a write offline and stops (MOB-08)', async () => {
    const store = memory();
    const q = new WriteQueue(store, ids, clock);
    await q.add(NEW, 'garden', 'A');
    expect(await q.flush(source([() => new Unreachable()]))).toEqual({ sent: 0, stopped: 'unreachable' });
    expect(q.items[0]?.state).toBe('waiting');
    expect(store.saved?.[0]?.state).toBe('waiting');
  });

  it('marks a conflict and never sends it again by itself (MOB-07)', async () => {
    const q = new WriteQueue(memory(), ids, clock);
    await q.add({ op: 'set', id: 'garden/a', patch: { status: 'doing' }, if_match: 'e1' }, 'garden', 'A');
    await q.flush(source([() => ({ ok: false, code: 'conflict', message: 'changed', retryable: false })]));
    expect(q.items[0]).toMatchObject({ state: 'conflict', code: 'conflict', message: 'changed' });
    const second = source([]);
    await q.flush(second);
    expect(second.calls).toEqual([]);
    // A conflict is dropped, not retried.
    await q.retry(q.items[0]!.clientOpId);
    expect(q.items[0]?.state).toBe('conflict');
  });

  it('marks a lost answer unknown and sends it again only when asked, with the same id', async () => {
    const q = new WriteQueue(memory(), ids, clock);
    const item = await q.add(NEW, 'garden', 'A');
    await q.flush(source([() => new AnswerLost()]));
    expect(q.items[0]?.state).toBe('unknown');
    const quiet = source([]);
    await q.flush(quiet);
    expect(quiet.calls).toEqual([]);
    await q.retry(item.clientOpId);
    const again = source([() => ({ ok: true, id: 'garden/a' })]);
    await q.flush(again);
    expect(again.calls).toEqual([item.clientOpId]);
    expect(q.items).toEqual([]);
  });

  it('stops on a lost session and on a busy hub, keeping the write', async () => {
    const q = new WriteQueue(memory(), ids, clock);
    await q.add(NEW, 'garden', 'A');
    expect((await q.flush(source([() => new Unpaired()]))).stopped).toBe('unpaired');
    expect((await q.flush(source([() => new HubRefused(429, 'rate_limited', 'slow')]))).stopped).toBe('busy');
    expect(q.items[0]?.state).toBe('waiting');
  });

  it('says what the hub refused', async () => {
    const q = new WriteQueue(memory(), ids, clock);
    await q.add(NEW, 'garden', 'A');
    await q.flush(source([() => new HubRefused(400, 'bad_request', 'no')]));
    expect(q.items[0]).toMatchObject({ state: 'refused', code: 'bad_request', message: 'no' });
  });

  it('runs one flush at a time', async () => {
    const q = new WriteQueue(memory(), ids, clock);
    await q.add(NEW, 'garden', 'A');
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: DataSource = {
      ...source([]),
      write: async () => {
        await gate;
        return { ok: true, id: 'garden/a' };
      },
    };
    const first = q.flush(slow);
    expect(await q.flush(slow)).toEqual({ sent: 0, stopped: null });
    release();
    expect((await first).sent).toBe(1);
  });

  it('survives the end of the app: kept after every change, sending becomes unknown (MUI-04)', async () => {
    const store = memory();
    const q = new WriteQueue(store, ids, clock);
    await q.add(NEW, 'garden', 'A');
    store.saved![0]!.state = 'sending';
    const after = new WriteQueue(store, ids, clock);
    await after.load(null);
    expect(after.items[0]?.state).toBe('unknown');
  });

  it('forgets everything on clear (MSEC-12)', async () => {
    const store = memory();
    const q = new WriteQueue(store, ids, clock);
    await q.add(NEW, 'garden', 'A');
    await q.clear();
    expect(q.items).toEqual([]);
    expect(store.saved).toBeNull();
  });
});

describe('restore (MSEC-13: what was kept is untrusted)', () => {
  const good = { clientOpId: 'abcdefgh-1', op: NEW, area: 'garden', label: 'A', queuedAt: '2026-01-01', state: 'waiting' };

  it('takes a good entry', () => {
    expect(restore([good], null)).toHaveLength(1);
  });

  it('drops entries of the wrong shape', () => {
    expect(restore('junk', null)).toEqual([]);
    expect(restore([{ ...good, clientOpId: 'x' }], null)).toEqual([]);
    expect(restore([{ ...good, op: { op: 'delete', id: 'garden/a' } }], null)).toEqual([]);
    expect(restore([{ ...good, op: { op: 'set', id: '../x', patch: { status: 'open' } } }], null)).toEqual([]);
    expect(restore([{ ...good, op: { op: 'set', id: 'garden/a', patch: { status: 'gone' } } }], null)).toEqual([]);
    expect(restore([{ ...good, state: 'done' }], null)).toEqual([]);
    expect(restore([{ ...good, area: '..' }], null)).toEqual([]);
  });

  it('drops writes of an area that may no longer be shown', () => {
    expect(restore([good], new Set(['kitchen']))).toEqual([]);
  });
});
