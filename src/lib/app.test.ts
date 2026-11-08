import { describe, expect, it } from 'vitest';
import { App, pairingCodeOf, type AppDeps, type DeviceAccess, type DeviceLogin } from './app.svelte';
import { FakeSource } from './fakeSource';
import { memoryStore } from './storage';
import type { KeptView } from './storage';
import type { Pending } from './queue';
import { Unpaired, type DataSource } from './source';

const GOOD_CODE = 'b'.repeat(32);

/** A device as appkit-ui/device is to the page: paired once, a session for every login, refused when revoked. */
interface FakeDevice extends DeviceAccess {
  paired: boolean;
  revoked: boolean;
  offline: boolean;
  logins: number;
  names: string[];
}

function fakeDevice(paired = false): FakeDevice {
  const d: FakeDevice = {
    paired,
    revoked: false,
    offline: false,
    logins: 0,
    names: [],
    async pair(code, name) {
      if (code !== GOOD_CODE) throw new Error('code expired');
      d.paired = true;
      d.names.push(name);
      return 'p'.repeat(64);
    },
    async login(): Promise<DeviceLogin> {
      if (d.offline) throw new TypeError('Failed to fetch');
      d.logins += 1;
      if (!d.paired) return { kind: 'unpaired' };
      if (d.revoked) {
        d.paired = false;
        return { kind: 'refused' };
      }
      return { kind: 'session', token: String(d.logins).padStart(64, '0') };
    },
    async forget() {
      d.paired = false;
    },
  };
  return d;
}

/** The fake hub behind a session token: a token in `dead` is refused (the hub restarted). */
function sourceFor(fake: FakeSource, dead: Set<string | null>): (token: string | null) => DataSource {
  return (token) => {
    const gate = <T>(work: () => Promise<T>): Promise<T> => (dead.has(token) ? Promise.reject(new Unpaired()) : work());
    return {
      kind: 'hub',
      hello: () => gate(() => fake.hello()),
      vault: () => gate(() => fake.vault()),
      task: (id) => gate(() => fake.task(id)),
      write: (id, op) => gate(() => fake.write(id, op)),
      donePreview: (id) => gate(() => fake.donePreview(id)),
    };
  };
}

let n = 0;
function deps(fake: FakeSource, over: Partial<AppDeps> = {}): AppDeps & { views: ReturnType<typeof memoryStore<KeptView>> } {
  const views = memoryStore<KeptView>();
  const queue = memoryStore<Pending[]>();
  return {
    source: () => fake,
    device: fakeDevice(),
    fake: true,
    viewStore: views,
    queueStore: { load: () => queue.load(), save: (v) => queue.save(v), clear: () => queue.clear() },
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

describe('the kept list (MOB-08)', () => {
  it('shows a kept list offline, with its time, while it is young enough', async () => {
    const fake = new FakeSource();
    fake.offline = true;
    const d = deps(fake);
    d.views.value = { at: '2025-12-25T00:00:00Z', view: { rev: 'r', tasks: [], areas: [{ name: 'garden', dataClass: 'public' }], hiddenAreas: 0 } };
    const app = new App(d);
    await app.start(null);
    expect(app.connection).toBe('offline');
    expect(app.viewAt).toBe('2025-12-25T00:00:00Z');
    expect(app.view?.areas).toHaveLength(1);
  });

  it('deletes a kept list that is too old, or from the future, instead of showing it', async () => {
    for (const at of ['2025-12-01T00:00:00Z', '2026-02-01T00:00:00Z', 'yesterday']) {
      const fake = new FakeSource();
      fake.offline = true;
      const d = deps(fake);
      d.views.value = { at, view: { rev: 'r', tasks: [], areas: [], hiddenAreas: 0 } };
      const app = new App(d);
      await app.start(null);
      expect(app.view, at).toBeNull();
      expect(d.views.value, at).toBeNull();
    }
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

  it('asks for pairing once; after that a start signs in by itself, without a code', async () => {
    const device = fakeDevice();
    const fake = new FakeSource();
    const first = new App(deps(fake, { fake: false, device }));
    await first.start(null);
    expect(first.screen).toBe('pair');
    expect(await first.pair(GOOD_CODE, '  Fairphone  ')).toBe(true);
    expect(device.names).toEqual(['Fairphone']);
    expect(first.screen).toBe('list');
    expect(first.connection).toBe('live');
    // The app is closed and opened again: no pairing screen, a session from the device key.
    const again = new App(deps(fake, { fake: false, device }));
    await again.start(null);
    expect(again.screen).toBe('list');
    expect(again.connection).toBe('live');
    expect(device.logins).toBe(2);
  });

  it('pairs under a default name when none is given', async () => {
    const device = fakeDevice();
    const app = new App(deps(new FakeSource(), { fake: false, device }));
    await app.pair(GOOD_CODE, '   ');
    expect(device.names).toEqual(['Phone']);
  });

  it('asks for pairing again, and says why, when the PC revoked the device', async () => {
    const device = fakeDevice(true);
    device.revoked = true;
    const app = new App(deps(new FakeSource(), { fake: false, device }));
    await app.start(null);
    expect(app.screen).toBe('pair');
    expect(app.notice).toMatchObject({ key: 'pair.revoked' });
  });

  it('starts offline with the kept list when the hub is not there, and signs in on the next refresh', async () => {
    const device = fakeDevice(true);
    device.offline = true;
    const d = deps(new FakeSource(), { fake: false, device });
    d.views.value = { at: '2025-12-31T00:00:00Z', view: { rev: 'r', tasks: [], areas: [{ name: 'garden', dataClass: 'public' }], hiddenAreas: 0 } };
    const app = new App(d);
    await app.start(null);
    expect(app.screen).toBe('list');
    expect(app.connection).toBe('offline');
    expect(app.view?.areas).toHaveLength(1);
    device.offline = false;
    await app.refresh();
    expect(app.connection).toBe('live');
  });

  it('opens a new session by itself when the hub restarted (its session is gone), without the pairing screen', async () => {
    const device = fakeDevice(true);
    const dead = new Set<string | null>();
    const fake = new FakeSource();
    const app = new App(deps(fake, { fake: false, device, source: sourceFor(fake, dead) }));
    await app.start(null);
    expect(app.connection).toBe('live');
    dead.add(String(device.logins).padStart(64, '0'));
    await app.refresh();
    expect(app.screen).toBe('list');
    expect(app.connection).toBe('live');
    expect(device.logins).toBe(2);
  });

  it('asks for pairing when the hub refuses the session and the device too', async () => {
    const device = fakeDevice(true);
    const dead = new Set<string | null>();
    const fake = new FakeSource();
    const app = new App(deps(fake, { fake: false, device, source: sourceFor(fake, dead) }));
    await app.start(null);
    dead.add(String(device.logins).padStart(64, '0'));
    device.revoked = true;
    await app.refresh();
    expect(app.screen).toBe('pair');
    expect(app.notice).toMatchObject({ key: 'pair.revoked' });
  });

  it('says that a code was refused', async () => {
    const app = new App(deps(new FakeSource(), { fake: false, device: fakeDevice() }));
    await app.start('c'.repeat(32));
    expect(app.screen).toBe('pair');
    expect(app.notice).toMatchObject({ key: 'pair.failed', params: { message: 'code expired' } });
  });

  it('forgets the device key on this phone when it is disconnected', async () => {
    const device = fakeDevice(true);
    const app = new App(deps(new FakeSource(), { fake: false, device }));
    await app.start(null);
    await app.forget();
    expect(device.paired).toBe(false);
    expect(app.screen).toBe('pair');
  });
});
