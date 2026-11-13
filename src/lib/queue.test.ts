import { describe, expect, it } from 'vitest';
import { memoryFileStore, type AttachmentRef } from './attach';
import { filesOf, restore, WriteQueue, type Pending, type QueueOp, type QueueStore } from './queue';
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

function source(answers: ((op: QueueOp) => OpOutcome | Error)[]): DataSource & { calls: string[] } {
  const calls: string[] = [];
  return {
    kind: 'fake',
    calls,
    hello: async () => ({ version: '', engineReady: true, engineProblem: null }),
    level: async () => 'change' as const,
    vault: async () => ({ rev: 'r', tasks: [], areas: [], hiddenAreas: 0, counts: {}, next: [] }),
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
    pushKey: async () => 'unused',
    pushSubscribe: async () => {},
    pushUnsubscribe: async () => {},
    upload: async (id, file, name) => {
      calls.push(`upload ${id} ${name} ${file.size}`);
      const next = answers.shift();
      if (!next) throw new Error('no answer left');
      const answer = next({ op: 'upload', id, file: { key: 'k0000000', name, type: file.type, size: file.size, kind: 'photo' } });
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

  it('queues a change only with the version that was seen (MOB-08)', async () => {
    const q = new WriteQueue(memory(), ids, clock);
    await expect(q.add({ op: 'set', id: 'garden/a', patch: { status: 'doing' } }, 'garden', 'A')).rejects.toThrow('if_match required');
    expect(q.items).toEqual([]);
    await q.add({ op: 'set', id: 'garden/a', patch: { status: 'doing' }, if_match: 'e1' }, 'garden', 'A');
    expect(q.items).toHaveLength(1);
  });

  it('never sends the files of a new task with it: they follow as uploads', async () => {
    const files = memoryFileStore();
    await files.put('file-0001', new Blob(['abc']));
    const q = new WriteQueue(memory(), ids, clock, () => {}, files);
    await q.add(NEW, 'garden', 'A', [{ key: 'file-0001', name: 'p.jpg', type: 'image/jpeg', size: 3, kind: 'photo' }]);
    const seen: QueueOp[] = [];
    await q.flush(source([(op) => (seen.push(op), { ok: true, id: 'garden/a' }), () => ({ ok: true, id: 'garden/a' })]));
    expect(seen[0]).toEqual(NEW);
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

  it('does not send a write that was dropped, or cleared, while an earlier one was on its way', async () => {
    for (const how of ['drop', 'clear'] as const) {
      const q = new WriteQueue(memory(), ids, clock);
      await q.add(NEW, 'garden', 'A');
      const second = await q.add({ op: 'new', area: 'garden', title: 'B' }, 'garden', 'B');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const sent: string[] = [];
      const slow: DataSource = {
        ...source([]),
        write: async (id) => {
          sent.push(id);
          await gate;
          return { ok: true, id: 'garden/x' };
        },
      };
      const run = q.flush(slow);
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      if (how === 'drop') await q.drop(second.clientOpId);
      else await q.clear();
      release();
      await run;
      expect(sent, how).toHaveLength(1);
      expect(sent, how).not.toContain(second.clientOpId);
    }
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

  it('takes over an entry kept before the kit queue: area and files beside the write', () => {
    const photo = { key: 'file-0001', name: 'p.jpg', type: 'image/jpeg', size: 3, kind: 'photo' };
    const [item] = restore([{ ...good, files: [photo] }], null);
    expect(item).toMatchObject({ scope: 'garden', op: { op: 'new', files: [photo] } });
    expect(item).not.toHaveProperty('area');
    expect(item).not.toHaveProperty('files');
    // The kit's own shape reads back as it is.
    expect(restore([{ ...good, area: undefined, scope: 'garden' }], null)).toHaveLength(1);
  });

  it('drops a kept change without the version that was seen (MOB-08)', () => {
    const set = { op: 'set', id: 'garden/a', patch: { status: 'doing' } };
    expect(restore([{ ...good, op: set }], null)).toEqual([]);
    expect(restore([{ ...good, op: { ...set, if_match: 'e1' } }], null)).toHaveLength(1);
  });

  it('drops writes of an area that may no longer be shown', () => {
    expect(restore([good], new Set(['kitchen']))).toEqual([]);
  });
});

describe('files of a new task', () => {
  const photo: AttachmentRef = { key: 'file-0001', name: 'photo-2026-01-01-1200.jpg', type: 'image/jpeg', size: 3, kind: 'photo' };
  const voice: AttachmentRef = { key: 'file-0002', name: 'voice-2026-01-01-1200.webm', type: 'audio/webm', size: 4, kind: 'voice' };

  async function queueWithFiles() {
    const files = memoryFileStore();
    await files.put(photo.key, new Blob(['abc'], { type: 'image/jpeg' }));
    await files.put(voice.key, new Blob(['abcd'], { type: 'audio/webm' }));
    const store = memory();
    const q = new WriteQueue(store, ids, clock, () => {}, files);
    await q.add(NEW, 'garden', 'A', [photo, voice]);
    return { q, files, store };
  }

  it('sends the files after the new task, to the id the engine gave, and lets them go when taken', async () => {
    const { q, files } = await queueWithFiles();
    const src = source([() => ({ ok: true, id: 'garden/a' }), () => ({ ok: true, id: 'garden/a' }), () => ({ ok: true, id: 'garden/a' })]);
    expect(await q.flush(src)).toEqual({ sent: 3, stopped: null });
    expect(src.calls.slice(1)).toEqual(['upload garden/a photo-2026-01-01-1200.jpg 3', 'upload garden/a voice-2026-01-01-1200.webm 4']);
    expect(q.items).toEqual([]);
    expect(files.files.size).toBe(0);
  });

  it('never sends a file before the task is made: offline both wait, the file with the task', async () => {
    const { q, files, store } = await queueWithFiles();
    await q.flush(source([() => new Unreachable()]));
    expect(q.items).toHaveLength(1);
    expect(filesOf(q.items[0]!).map((f) => f.key)).toEqual([photo.key, voice.key]);
    expect(filesOf(store.saved![0]!)).toHaveLength(2);
    expect(files.files.size).toBe(2);
  });

  it('keeps the task when a file is refused, and the file waits visibly with the words of the hub', async () => {
    const { q, files } = await queueWithFiles();
    const src = source([
      () => ({ ok: true, id: 'garden/a' }),
      () => new HubRefused(409, 'vault_changed', 'another vault was chosen'),
      () => ({ ok: true, id: 'garden/a' }),
    ]);
    await q.flush(src);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ state: 'refused', code: 'vault_changed', op: { op: 'upload', id: 'garden/a', file: photo } });
    expect([...files.files.keys()]).toEqual([photo.key]);
    // Sent again on request, then gone with its file.
    await q.retry(q.items[0]!.clientOpId);
    await q.flush(source([() => ({ ok: true, id: 'garden/a' })]));
    expect(q.items).toEqual([]);
    expect(files.files.size).toBe(0);
  });

  it('a file whose answer was lost is never sent again by itself', async () => {
    const { q } = await queueWithFiles();
    await q.flush(source([() => ({ ok: true, id: 'garden/a' }), () => new AnswerLost(), () => ({ ok: true, id: 'garden/a' })]));
    expect(q.items.map((i) => i.state)).toEqual(['unknown']);
    const again = source([]);
    await q.flush(again);
    expect(again.calls).toEqual([]);
  });

  it('a file the engine says it has already (exists, sent again after a lost answer) counts as arrived', async () => {
    const { q, files } = await queueWithFiles();
    const src = source([
      () => ({ ok: true, id: 'garden/a' }),
      () => ({ ok: false, code: 'exists', message: 'attach: the task has an asset of this name already', retryable: false }),
      () => ({ ok: true, id: 'garden/a' }),
    ]);
    expect(await q.flush(src)).toEqual({ sent: 3, stopped: null });
    expect(q.items).toEqual([]);
    expect(files.files.size).toBe(0);
  });

  it('a file that is gone from the phone is refused, not sent empty', async () => {
    const { q, files } = await queueWithFiles();
    files.files.delete(photo.key);
    const src = source([() => ({ ok: true, id: 'garden/a' }), () => ({ ok: true, id: 'garden/a' })]);
    await q.flush(src);
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ state: 'refused', code: 'file_gone' });
    expect(src.calls.some((c) => c.includes(photo.name))).toBe(false);
  });

  it('without the id of the engine, a file has no task to go to', async () => {
    const { q, files } = await queueWithFiles();
    await q.flush(source([() => ({ ok: true, id: null })]));
    expect(q.items.map((i) => [i.state, i.code])).toEqual([['refused', 'no_id'], ['refused', 'no_id']]);
    expect(files.files.size).toBe(0);
  });

  it('dropping a new task drops its files; unpairing deletes every file (MSEC-12)', async () => {
    const { q, files } = await queueWithFiles();
    await q.drop(q.items[0]!.clientOpId);
    expect(files.files.size).toBe(0);
    const second = await queueWithFiles();
    await second.q.clear();
    expect(second.files.files.size).toBe(0);
  });

  it('reads files back only as they were written, and collects files no write names (MSEC-13)', async () => {
    const { store, files } = await queueWithFiles();
    await files.put('orphan-0001', new Blob(['x']));
    const raw = store.saved as unknown as Record<string, unknown>[];
    ((raw[0]!['op'] as Record<string, unknown>)['files'] as unknown[]).push({ key: '../x', name: 'a', type: 'text/html', size: 1, kind: 'photo' });
    const q = new WriteQueue(store, ids, clock, () => {}, files);
    await q.load(new Set(['garden']));
    expect(filesOf(q.items[0]!).map((f) => f.key)).toEqual([photo.key, voice.key]);
    expect([...files.files.keys()].sort()).toEqual([photo.key, voice.key]);
    // An area that may not be shown any more takes its files with it.
    const hidden = new WriteQueue(store, ids, clock, () => {}, files);
    await hidden.load(new Set(['kitchen']));
    expect(hidden.items).toEqual([]);
    expect(files.files.size).toBe(0);
  });

  it('the page is told only of what was settled: an entry the check drops never shows under Waiting', async () => {
    const store = memory();
    const upload = { clientOpId: 'id-00000009', op: { op: 'upload', id: 'secret/x', file: photo }, area: 'garden', label: 'A', queuedAt: '2026-01-01T00:00:00Z', state: 'waiting' };
    const good = { clientOpId: 'id-00000010', op: NEW, area: 'garden', label: 'A', queuedAt: '2026-01-01T00:00:00Z', state: 'waiting' };
    store.saved = [upload, good] as unknown as Pending[];
    const seen: string[][] = [];
    const q: WriteQueue = new WriteQueue(store, ids, clock, () => seen.push(q.items.map((i) => i.clientOpId)), memoryFileStore());
    await q.load(null);
    expect(seen).toEqual([['id-00000010']]);
    expect(q.items.map((i) => i.clientOpId)).toEqual(['id-00000010']);
  });

  it('an upload read back must go to a task of its own area', () => {
    const item = {
      clientOpId: 'id-00000001',
      op: { op: 'upload', id: 'secret/x', file: photo },
      area: 'garden',
      label: 'A',
      queuedAt: '2026-01-01T00:00:00Z',
      state: 'waiting',
    };
    expect(restore([item], null)).toEqual([]);
    expect(restore([{ ...item, op: { ...item.op, id: 'garden/x' } }], null)).toHaveLength(1);
  });
});
