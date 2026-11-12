import { describe, expect, it } from 'vitest';
import { App, pairingCodeOf, type AppDeps, type DeviceAccess, type DeviceLogin } from './app.svelte';
import { FakeSource } from './fakeSource';
import { memoryFileStore } from './attach';
import { memoryStore } from './storage';
import type { KeptView } from './storage';
import { HubRefused, Unpaired, type DataSource } from './source';
import type { PushAccess } from './push';

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
      upload: (id, file, name) => gate(() => fake.upload(id, file, name)),
      pushKey: () => gate(() => fake.pushKey()),
      pushSubscribe: (body) => gate(() => fake.pushSubscribe(body)),
      pushUnsubscribe: () => gate(() => fake.pushUnsubscribe()),
    };
  };
}

let n = 0;
function deps(fake: FakeSource, over: Partial<AppDeps> = {}): AppDeps & { views: ReturnType<typeof memoryStore<KeptView>> } {
  const views = memoryStore<KeptView>();
  const queue = memoryStore<unknown[]>();
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

  it('starts on Today with the engine picks and counts of the shown areas, and keeps them for offline', async () => {
    const fake = new FakeSource();
    const d = deps(fake);
    const app = new App(d);
    await app.start(null);
    expect(app.screen).toBe('today');
    // The fake engine names the task of the area that stays on the PC first: it is not there.
    expect(app.view?.next[0]?.id).toBe('garden/water-the-plants');
    expect(app.view?.next.some((p) => p.area === 'vault-secret')).toBe(false);
    expect(app.view?.counts).toEqual({ open: 2, decision: 1, doing: 1, parked: 1 });
    expect(d.views.value?.view.counts).toEqual(app.view?.counts);
    expect(d.views.value?.view.next).toEqual(app.view?.next);
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

  it('sends no change of a task whose version it does not know, and says so (MOB-08)', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    const task = { ...app.view!.tasks.find((t) => t.id === 'kitchen/fix-the-tap')!, etag: null };
    await app.openTask(task);
    await app.setStatus(task, 'blocked');
    expect(fake.writes).toEqual([]);
    expect(app.queue.items).toEqual([]);
    expect(app.notice).toMatchObject({ key: 'task.no_version', tone: 'error' });
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

  it('goes back to the list after finishing and says so, without asking the engine for the finished task', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    const task = app.view!.tasks.find((t) => t.id === 'kitchen/fix-the-tap')!;
    app.screen = 'list';
    await app.openTask(task);
    await app.askFinish(task);
    await app.finish(task);
    expect(app.notice).toEqual({ key: 'task.done_ok', params: { title: task.title }, tone: 'info' });
    expect(app.screen).toBe('list');
    expect(app.opened).toBeNull();
  });

  it('goes back to Today after finishing a task opened there', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    const task = app.view!.tasks.find((t) => t.id === 'kitchen/fix-the-tap')!;
    await app.openTask(task);
    await app.askFinish(task);
    await app.finish(task);
    expect(app.screen).toBe('today');
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

  it('"waiting for the PC" turns into "created" once the write is sent', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    fake.offline = true;
    await app.refresh();
    await app.capture({ area: 'garden', title: 'Sent later', context: '' });
    expect(app.notice).toMatchObject({ key: 'capture.queued' });
    fake.offline = false;
    await app.refresh();
    expect(app.pending).toHaveLength(0);
    expect(app.notice).toMatchObject({ key: 'capture.created', params: { title: 'Sent later' }, tone: 'info' });
  });

  it('"waiting for the PC" goes with the write when it is dropped or the phone is unpaired', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    fake.offline = true;
    await app.refresh();
    await app.capture({ area: 'garden', title: 'Dropped', context: '' });
    await app.drop(app.pending[0]!.clientOpId);
    expect(app.pending).toHaveLength(0);
    expect(app.notice).toBeNull();
    await app.capture({ area: 'garden', title: 'Unpaired', context: '' });
    expect(app.notice).toMatchObject({ key: 'capture.queued' });
    await app.forget();
    expect(app.notice).toBeNull();
  });

  it('another notice is not touched when the queue changes', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    fake.offline = true;
    await app.refresh();
    await app.capture({ area: 'garden', title: 'Waits', context: '' });
    app.notice = { key: 'task.done_offline', tone: 'info' };
    fake.offline = false;
    await app.refresh();
    expect(app.notice).toMatchObject({ key: 'task.done_offline' });
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

describe('the capture form lives in the app, not in the view', () => {
  const note = { id: 1, blob: new Blob(['abc'], { type: 'audio/webm' }), kind: 'voice' as const, url: 'blob:x' };

  it('keeps what was typed and chosen while another view is shown', async () => {
    const app = new App(deps(new FakeSource()));
    await app.start(null);
    app.screen = 'capture';
    app.form.title = 'Half typed';
    app.form.files = [note];
    app.screen = 'list';
    app.screen = 'capture';
    expect(app.form).toMatchObject({ title: 'Half typed', files: [{ id: 1, kind: 'voice' }] });
  });

  it('a share fills the form and takes nothing away that was typed', async () => {
    const app = new App(deps(new FakeSource()));
    await app.start(null);
    app.takeShare({ title: 'An article', context: 'https://example.org/a' });
    expect(app.screen).toBe('capture');
    expect(app.form).toMatchObject({ title: 'An article', context: 'https://example.org/a', fromShare: true });
    app.form.title = 'Mine';
    app.form.context = 'my words';
    app.takeShare({ title: 'Second', context: 'more' });
    expect(app.form).toMatchObject({ title: 'Mine', context: 'my words\nSecond\nmore' });
  });

  it('discarding empties the form; unpairing does too (MSEC-12)', async () => {
    const app = new App(deps(new FakeSource()));
    await app.start(null);
    app.form.title = 'Gone';
    app.form.files = [note];
    app.discardForm();
    expect(app.form).toEqual({ area: '', title: '', context: '', fromShare: false, files: [] });
    app.form.files = [note];
    await app.forget();
    expect(app.form.files).toEqual([]);
  });
});

describe('the kept list (MOB-08)', () => {
  it('shows a kept list offline, with its time, while it is young enough', async () => {
    const fake = new FakeSource();
    fake.offline = true;
    const d = deps(fake);
    d.views.value = { at: '2025-12-25T00:00:00Z', view: { rev: 'r', tasks: [], areas: [{ name: 'garden', dataClass: 'public' }], hiddenAreas: 0, counts: {}, next: [] } };
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
      d.views.value = { at, view: { rev: 'r', tasks: [], areas: [], hiddenAreas: 0, counts: {}, next: [] } };
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
    expect(first.screen).toBe('today');
    expect(first.connection).toBe('live');
    // The app is closed and opened again: no pairing screen, a session from the device key.
    const again = new App(deps(fake, { fake: false, device }));
    await again.start(null);
    expect(again.screen).toBe('today');
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
    d.views.value = { at: '2025-12-31T00:00:00Z', view: { rev: 'r', tasks: [], areas: [{ name: 'garden', dataClass: 'public' }], hiddenAreas: 0, counts: {}, next: [] } };
    const app = new App(d);
    await app.start(null);
    expect(app.screen).toBe('today');
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
    expect(app.screen).toBe('today');
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

/** Timers by hand: what is set waits until the test runs it. */
function manualTimer() {
  const set: { run: () => void; ms: number; handle: number }[] = [];
  let next = 0;
  return {
    set,
    timer: {
      set(run: () => void, ms: number) {
        next += 1;
        set.push({ run, ms, handle: next });
        return next;
      },
      clear(handle: unknown) {
        const i = set.findIndex((s) => s.handle === handle);
        if (i >= 0) set.splice(i, 1);
      },
    },
    /** Runs the one timer that is set, and the refresh it starts. */
    async fire(app: App): Promise<number> {
      expect(set).toHaveLength(1);
      const { run, ms } = set.shift()!;
      run();
      await app.refresh();
      return ms;
    },
  };
}

describe('a conflict on the task page', () => {
  it('is said on the page, with the new state loaded and the choices set back', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    const brief = app.view!.tasks.find((t) => t.id === 'garden/water-the-plants')!;
    await app.openTask(brief);
    fake.touch('garden/water-the-plants');
    await app.setStatus(brief, 'doing');
    expect(app.notice).toMatchObject({ key: 'task.conflict', tone: 'error' });
    expect(app.conflicts).toBe(1);
    expect(app.pending[0]?.state).toBe('conflict');
    expect(app.detail?.task.status).toBe(brief.status);
  });

  it('a write that is taken says nothing of a conflict', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake));
    await app.start(null);
    const brief = app.view!.tasks.find((t) => t.id === 'garden/water-the-plants')!;
    await app.openTask(brief);
    await app.setStatus(brief, 'doing');
    expect(app.notice?.key).not.toBe('task.conflict');
    expect(app.conflicts).toBe(0);
  });
});

describe('tries again while offline in front', () => {
  it('asks again with growing waits and becomes live without a change of view', async () => {
    const fake = new FakeSource();
    const clock = manualTimer();
    const app = new App(deps(fake, { timer: clock.timer, visible: () => true }));
    await app.start(null);
    expect(clock.set).toHaveLength(0);
    fake.offline = true;
    await app.refresh();
    expect(app.connection).toBe('offline');
    expect(await clock.fire(app)).toBe(5_000);
    expect(await clock.fire(app)).toBe(15_000);
    expect(await clock.fire(app)).toBe(60_000);
    expect(await clock.fire(app)).toBe(60_000);
    fake.offline = false;
    expect(await clock.fire(app)).toBe(60_000);
    expect(app.connection).toBe('live');
    expect(clock.set).toHaveLength(0);
    // Offline again later: the waits start over.
    fake.offline = true;
    await app.refresh();
    expect(clock.set.map((s) => s.ms)).toEqual([5_000]);
  });

  it('sets one try at a time, also when several runs end offline', async () => {
    const fake = new FakeSource();
    const clock = manualTimer();
    const app = new App(deps(fake, { timer: clock.timer, visible: () => true }));
    await app.start(null);
    fake.offline = true;
    await app.refresh();
    await app.refresh();
    await app.refresh();
    expect(clock.set).toHaveLength(1);
  });

  it('asks nothing in the background, and plans again when the page is back', async () => {
    const fake = new FakeSource();
    const clock = manualTimer();
    let shown = true;
    const app = new App(deps(fake, { timer: clock.timer, visible: () => shown }));
    await app.start(null);
    fake.offline = true;
    await app.refresh();
    expect(clock.set).toHaveLength(1);
    shown = false;
    app.pause();
    expect(clock.set).toHaveLength(0);
    await app.refresh();
    expect(clock.set).toHaveLength(0);
    shown = true;
    await app.refresh();
    expect(clock.set).toHaveLength(1);
  });

  it('a phone that started offline (login still to make) tries too, and offers the button', async () => {
    const fake = new FakeSource();
    const clock = manualTimer();
    const device = fakeDevice(true);
    device.offline = true;
    const app = new App(deps(fake, { fake: false, device, source: sourceFor(fake, new Set()), timer: clock.timer, visible: () => true }));
    await app.start(null);
    expect(app.connection).toBe('offline');
    expect(app.paired).toBe(false);
    expect(app.canRetry).toBe(true);
    expect(clock.set).toHaveLength(1);
    device.offline = false;
    await clock.fire(app);
    expect(app.connection).toBe('live');
  });

  it('no tries on the pairing screen', async () => {
    const fake = new FakeSource();
    const clock = manualTimer();
    const app = new App(deps(fake, { fake: false, device: fakeDevice(false), source: sourceFor(fake, new Set()), timer: clock.timer, visible: () => true }));
    await app.start(null);
    expect(app.screen).toBe('pair');
    await app.refresh();
    expect(clock.set).toHaveLength(0);
    expect(app.canRetry).toBe(false);
  });
});

describe('capture with files', () => {
  const photo = () => new Blob(['png!'], { type: 'image/png' });

  it('makes the task, then sends the file to it, and keeps no file after', async () => {
    const fake = new FakeSource();
    const files = memoryFileStore();
    const app = new App(deps(fake, { fileStore: files }));
    await app.start(null);
    expect(await app.capture({ area: 'garden', title: 'With photo', context: '' }, [{ blob: photo(), kind: 'photo' }])).toBe(true);
    expect(fake.writes.map((w) => w.op.op)).toEqual(['new']);
    expect(fake.uploads).toEqual([{ id: 'garden/with-photo', name: expect.stringMatching(/^photo-\d{4}-\d{2}-\d{2}-\d{4}\.png$/), type: 'image/png', size: 4 }]);
    expect(app.notice).toMatchObject({ key: 'capture.created' });
    expect(files.files.size).toBe(0);
  });

  it('says so when the task is made but a file waits', async () => {
    const fake = new FakeSource();
    fake.refuseNextUpload = true;
    const app = new App(deps(fake, { fileStore: memoryFileStore() }));
    await app.start(null);
    await app.capture({ area: 'garden', title: 'Refused file', context: '' }, [{ blob: photo(), kind: 'photo' }]);
    expect(app.notice).toMatchObject({ key: 'capture.files_wait', tone: 'error' });
    expect(app.pending.map((p) => [p.op.op, p.state])).toEqual([['upload', 'refused']]);
    expect(app.view?.tasks.some((t) => t.id === 'garden/refused-file')).toBe(true);
  });

  it('captured offline: once the task is made but its file is refused, the notice says so, not "created" (MOB-09)', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake, { fileStore: memoryFileStore() }));
    await app.start(null);
    fake.offline = true;
    await app.refresh();
    await app.capture({ area: 'garden', title: 'Later file', context: '' }, [{ blob: photo(), kind: 'photo' }]);
    expect(app.notice).toMatchObject({ key: 'capture.queued' });
    fake.offline = false;
    fake.refuseNextUpload = true;
    await app.refresh();
    expect(app.notice).toMatchObject({ key: 'capture.files_wait', tone: 'error' });
    // Sent again and taken: now it is created.
    await app.retry(app.pending[0]!.clientOpId);
    expect(app.pending).toEqual([]);
  });

  it('a file sent again after a lost answer arrives once: the engine says exists, the phone counts it as arrived', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake, { fileStore: memoryFileStore() }));
    await app.start(null);
    fake.loseNextUploadAnswer = true;
    await app.capture({ area: 'garden', title: 'Twice', context: '' }, [{ blob: photo(), kind: 'photo' }]);
    expect(app.pending.map((p) => [p.op.op, p.state])).toEqual([['upload', 'unknown']]);
    await app.retry(app.pending[0]!.clientOpId);
    expect(app.pending).toEqual([]);
    expect(fake.uploads).toHaveLength(1);
  });

  it('captured offline with a file that is taken: the notice ends on "created"', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake, { fileStore: memoryFileStore() }));
    await app.start(null);
    fake.offline = true;
    await app.refresh();
    await app.capture({ area: 'garden', title: 'Fine file', context: '' }, [{ blob: photo(), kind: 'photo' }]);
    fake.offline = false;
    await app.refresh();
    expect(app.notice).toMatchObject({ key: 'capture.created' });
    expect(fake.uploads.map((u) => u.id)).toEqual(['garden/fine-file']);
  });

  it('creates nothing when a file cannot be kept on the phone (storage full)', async () => {
    const fake = new FakeSource();
    const files = memoryFileStore();
    files.put = async () => {
      throw new Error('QuotaExceededError');
    };
    const app = new App(deps(fake, { fileStore: files }));
    await app.start(null);
    expect(await app.capture({ area: 'garden', title: 'No room', context: '' }, [{ blob: photo(), kind: 'photo' }])).toBe(false);
    expect(app.fileProblem).toBe('store');
    expect(fake.writes).toEqual([]);
    expect(app.pending).toEqual([]);
  });

  it('refuses a file beyond the limits before anything is kept', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake, { fileStore: memoryFileStore() }));
    await app.start(null);
    const html = new Blob(['<b>'], { type: 'text/html' });
    expect(await app.capture({ area: 'garden', title: 'Bad file', context: '' }, [{ blob: html, kind: 'photo' }])).toBe(false);
    expect(app.fileProblem).toBe('wrong_type');
    expect(fake.writes).toEqual([]);
  });
});

describe('notices of the hub', () => {
  function browser(over: Partial<{ supported: boolean; permission: NotificationPermission; grant: boolean }> = {}) {
    const state = { subscribed: false, permission: over.permission ?? ('default' as NotificationPermission), asked: 0 };
    const push: PushAccess = {
      supported: () => over.supported ?? true,
      permission: () => state.permission,
      subscribed: async () => state.subscribed,
      subscribe: async () => {
        state.asked += 1;
        state.permission = over.grant === false ? 'denied' : 'granted';
        if (over.grant === false) return null;
        state.subscribed = true;
        return { endpoint: 'https://push.example.org/x', p256dh: 'p', auth: 'a' };
      },
      unsubscribe: async () => {
        state.subscribed = false;
      },
    };
    return { push, state };
  }

  it('asks nothing at the start, and subscribes for reminders and decisions on the button', async () => {
    const fake = new FakeSource();
    const b = browser();
    const app = new App(deps(fake, { push: b.push }));
    await app.start(null);
    expect(app.pushState).toBe('off');
    expect(b.state.asked).toBe(0);
    await app.enablePush();
    expect(app.pushState).toBe('on');
    expect(fake.pushed).toEqual({ endpoint: 'https://push.example.org/x', p256dh: 'p', auth: 'a', kinds: ['remind', 'decision'] });
    await app.disablePush();
    expect(app.pushState).toBe('off');
    expect(fake.pushed).toBeNull();
    expect(b.state.subscribed).toBe(false);
  });

  it('a refused permission turns nothing on, and the hub keeps nothing', async () => {
    const fake = new FakeSource();
    const app = new App(deps(fake, { push: browser({ grant: false }).push }));
    await app.start(null);
    await app.enablePush();
    expect(app.pushState).toBe('denied');
    expect(app.notice).toMatchObject({ key: 'push.refused' });
    expect(fake.pushed).toBeNull();
  });

  it('a hub that sends no notices: said, and no subscription of the browser is left behind', async () => {
    const fake = new FakeSource();
    fake.pushSubscribe = async () => {
      throw new HubRefused(404, 'no_devices', 'this hub keeps no devices');
    };
    const b = browser();
    const app = new App(deps(fake, { push: b.push }));
    await app.start(null);
    await app.enablePush();
    expect(app.notice).toMatchObject({ key: 'push.hub_none' });
    expect(app.pushState).toBe('off');
    expect(b.state.subscribed).toBe(false);
  });

  it('offers nothing where the browser cannot, and turning on needs the PC', async () => {
    const none = new App(deps(new FakeSource(), { push: browser({ supported: false }).push }));
    await none.start(null);
    expect(none.pushState).toBe('unsupported');
    const fake = new FakeSource();
    const app = new App(deps(fake, { push: browser().push }));
    await app.start(null);
    fake.offline = true;
    await app.refresh();
    await app.enablePush();
    expect(app.notice).toMatchObject({ key: 'push.offline' });
    expect(app.pushState).toBe('off');
  });

  it('unpairing turns notices off (MSEC-12)', async () => {
    const fake = new FakeSource();
    const b = browser();
    const app = new App(deps(fake, { push: b.push }));
    await app.start(null);
    await app.enablePush();
    await app.forget();
    expect(b.state.subscribed).toBe(false);
    expect(fake.pushed).toBeNull();
  });

  it('a tapped notice opens its task; a task not in the list is said', async () => {
    const app = new App(deps(new FakeSource()));
    await app.start(null);
    await app.openById('garden/water-the-plants');
    expect(app.screen).toBe('task');
    expect(app.opened?.id).toBe('garden/water-the-plants');
    app.screen = 'today';
    await app.openById('garden/gone-long-ago');
    expect(app.screen).toBe('today');
    expect(app.notice).toMatchObject({ key: 'push.task_gone' });
  });
});

describe('notices do not hold up the start', () => {
  it('a browser that never says whether it is subscribed: the start goes on, notices count as off', async () => {
    const push: PushAccess = {
      supported: () => true,
      permission: () => 'default',
      subscribed: () => new Promise<boolean>(() => {}),
      subscribe: async () => null,
      unsubscribe: async () => {},
    };
    const app = new App(deps(new FakeSource(), { push }));
    await app.start(null);
    expect(app.pushState).toBe('off');
    expect(app.view).not.toBeNull();
  }, 5_000);
});
