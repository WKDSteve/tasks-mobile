import { describe, expect, it } from 'vitest';
import { App, pairingCodeOf, type AppDeps } from './app.svelte';
import { FakeSource } from './fakeSource';
import { memoryStore } from './storage';
import type { KeptView, TokenStorage } from './storage';
import type { Pending } from './queue';

function session(): TokenStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

let n = 0;
function deps(fake: FakeSource, over: Partial<AppDeps> = {}): AppDeps & { views: ReturnType<typeof memoryStore<KeptView>> } {
  const views = memoryStore<KeptView>();
  const queue = memoryStore<Pending[]>();
  return {
    source: () => fake,
    exchange: async () => 'cd'.repeat(32),
    fake: true,
    viewStore: views,
    queueStore: { load: () => queue.load(), save: (v) => queue.save(v), clear: () => queue.clear() },
    session: session(),
    now: () => new Date('2026-01-01T00:00:00Z'),
    newId: () => `id-${String((n += 1)).padStart(8, '0')}`,
    views,
    ...over,
  };
}

describe('App on the synthetic vault', () => {
  it('shows only the areas that may leave the PC, and says that it is a part (MOB-02, MUI-06)', async () => {
    const fake = new FakeSource();
    const d = deps(fake);
    const app = new App(d);
    await app.start(null);
    expect(app.connection).toBe('live');
    expect(app.view?.areas.map((a) => a.name)).toEqual(['garden', 'kitchen']);
    expect(app.view?.hiddenAreas).toBe(2);
    expect(JSON.stringify(app.view)).not.toContain('SECRET-MARKER');
    expect(JSON.stringify(app.view)).not.toContain('UNCLASSIFIED-MARKER');
    // What is kept on the phone holds none of it either.
    expect(JSON.stringify(d.views.value)).not.toContain('SECRET-MARKER');
  });

  it('creates a task through the queue, and the list shows it only after the engine said yes (MOB-07)', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    expect(await app.capture({ area: 'garden', title: 'Buy seeds', context: '' })).toBe(true);
    expect(app.view?.tasks.some((t) => t.id === 'garden/buy-seeds')).toBe(true);
    expect(app.pending).toEqual([]);
    expect(fake.writes).toHaveLength(1);
  });

  it('keeps a capture offline and sends it on the next refresh (MOB-08)', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    fake.offline = true;
    await app.refresh();
    expect(app.connection).toBe('offline');
    await app.capture({ area: 'kitchen', title: 'Call the plumber', context: 'tomorrow' });
    expect(app.pending.map((p) => p.state)).toEqual(['waiting']);
    expect(app.view?.tasks.some((t) => t.title === 'Call the plumber')).toBe(false);
    fake.offline = false;
    await app.refresh();
    expect(app.pending).toEqual([]);
    expect(app.view?.tasks.some((t) => t.title === 'Call the plumber')).toBe(true);
  });

  it('shows a conflict instead of overwriting a newer version (definition of done of the plan)', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    const task = app.view!.tasks.find((t) => t.id === 'garden/water-the-plants')!;
    fake.touch(task.id);
    await app.setStatus(task, 'doing');
    expect(app.pending[0]).toMatchObject({ state: 'conflict' });
    const now = await fake.task(task.id);
    expect(now.task.status).toBe('open');
  });

  it('sets a status with the version it read', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    const task = app.view!.tasks.find((t) => t.id === 'kitchen/fix-the-tap')!;
    await app.openTask(task);
    await app.setStatus(task, 'blocked');
    expect(fake.writes[0]?.op).toEqual({ op: 'set', id: task.id, patch: { status: 'blocked' }, if_match: 'e1' });
    expect(app.detail?.task.status).toBe('blocked');
  });

  it('answers a question', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    const task = app.view!.tasks.find((t) => t.id === 'garden/choose-a-fence')!;
    await app.openTask(task);
    await app.answer(task, 'q1', 1);
    expect(app.detail?.questions[0]?.answered).toBe(true);
    expect(app.view?.tasks.find((t) => t.id === task.id)?.openQuestions).toBe(0);
  });

  it('finishes only after the preview, with its confirm word, and not offline', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    const task = app.view!.tasks.find((t) => t.id === 'kitchen/fix-the-tap')!;
    await app.finish(task);
    expect(fake.writes).toEqual([]);
    await app.askFinish(task);
    expect(app.preview?.freed).toEqual(['garden/water-the-plants']);
    await app.finish(task);
    expect(fake.writes[0]?.op).toEqual({ op: 'done', id: task.id, confirm: 'done:kitchen/fix-the-tap:e1' });
    expect(app.view?.tasks.some((t) => t.id === task.id)).toBe(false);

    fake.offline = true;
    await app.refresh();
    await app.askFinish(app.view!.tasks[0]!);
    expect(app.preview).toBeNull();
    expect(app.notice?.key).toBe('task.done_offline');
  });

  it('never sends a write again by itself when its answer was lost', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    fake.loseNextAnswer = true;
    await app.capture({ area: 'garden', title: 'Once only', context: '' });
    expect(app.pending[0]?.state).toBe('unknown');
    await app.refresh();
    await app.refresh();
    expect(fake.writes).toHaveLength(1);
  });

  it('says what became of a capture: created, waiting, or not taken', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    await app.capture({ area: 'garden', title: 'Taken at once', context: '' });
    expect(app.notice).toMatchObject({ key: 'capture.created', tone: 'info' });
    fake.offline = true;
    await app.refresh();
    await app.capture({ area: 'garden', title: 'Offline', context: '' });
    expect(app.notice).toMatchObject({ key: 'capture.queued', tone: 'info' });
    fake.offline = false;
    await app.refresh();
    fake.loseNextAnswer = true;
    await app.capture({ area: 'garden', title: 'Lost', context: '' });
    expect(app.notice).toMatchObject({ key: 'capture.not_taken', tone: 'error' });
  });

  it('clears an error once the hub answered in full', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    await app.capture({ area: 'garden', title: 'x', context: '' });
    await app.answer(app.view!.tasks.find((t) => t.id === 'garden/choose-a-fence')!, 'q1', 1);
    app.notice = { key: 'error.shape', tone: 'error' };
    await app.refresh();
    expect(app.notice).toBeNull();
    app.notice = { key: 'capture.created', params: { title: 'x' }, tone: 'info' };
    await app.refresh();
    expect(app.notice?.key).toBe('capture.created');
  });

  it('refuses a capture with problems, and names them', async () => {
    const app = new App(deps(new FakeSource()));
    await app.start(null);
    expect(await app.capture({ area: 'vault-secret', title: '', context: '' })).toBe(false);
    expect(app.problems).toEqual(['title_empty', 'area_unknown']);
  });

  it('forgets the copy, the queue and the session when unpaired (MSEC-12)', async () => {
    const fake = new FakeSource();
    const d = deps(fake);
    const app = new App(d);
    await app.start(null);
    fake.offline = true;
    await app.capture({ area: 'garden', title: 'Pending', context: '' });
    await app.forget();
    expect(d.views.value).toBeNull();
    expect(app.pending).toEqual([]);
    expect(app.view).toBeNull();
  });
});

describe('pairing', () => {
  it('reads the code from a link or as it is', () => {
    const code = 'a'.repeat(32);
    expect(pairingCodeOf(code)).toBe(code);
    expect(pairingCodeOf(`http://127.0.0.1:7777/m/#pair=${code}`)).toBe(code);
    expect(pairingCodeOf(`  http://127.0.0.1:7777/m/#x=1&pair=${code}  `)).toBe(code);
    expect(pairingCodeOf('pair=xyz')).toBeNull();
    expect(pairingCodeOf(`#pair=${code}zz`)).toBeNull();
  });

  it('asks for pairing without a session, and keeps the token of a pairing in the tab only', async () => {
    const s = session();
    const app = new App(deps(new FakeSource(), { fake: false, session: s }));
    await app.start(null);
    expect(app.screen).toBe('pair');
    expect(await app.pair('b'.repeat(32))).toBe(true);
    expect(s.data.get('tasks-mobile.session')).toBe('cd'.repeat(32));
    expect(app.screen).toBe('list');
    expect(app.connection).toBe('live');
  });

  it('says that a code was refused', async () => {
    const app = new App(
      deps(new FakeSource(), {
        fake: false,
        exchange: async () => {
          throw new Error('code expired');
        },
      }),
    );
    await app.start('c'.repeat(32));
    expect(app.screen).toBe('pair');
    expect(app.notice).toMatchObject({ key: 'pair.failed', params: { message: 'code expired' } });
  });
});
