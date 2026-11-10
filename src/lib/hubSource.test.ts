import { describe, expect, it } from 'vitest';
import { HubSource } from './hubSource';
import { AnswerLost, HubRefused, Unpaired, Unreachable } from './source';

const TOKEN = 'ab'.repeat(32);

interface Call {
  url: string;
  init: RequestInit;
}

function hub(routes: Record<string, () => Response | Promise<Response>>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = url.split('?')[0] ?? url;
    const route = routes[path];
    if (!route) return new Response('{}', { status: 404 });
    return route();
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

const json = (doc: unknown, status = 200) => new Response(JSON.stringify(doc), { status, headers: { 'Content-Type': 'application/json' } });

const areas = () => json({ kind: 'tasks.areas', areas: [{ name: 'garden', data_class: 'public' }, { name: 'secret', data_class: 'private' }] });
const snapshot = () =>
  json({
    kind: 'tasks.snapshot',
    rev: 'r1',
    areas: [
      { name: 'garden', by_status: { open: 2, doing: 1 } },
      { name: 'secret', by_status: { open: 7 } },
    ],
    tasks: [
      { id: 'garden/a', area: 'garden', title: 'A', etag: 'e1' },
      { id: 'secret/b', area: 'secret', title: 'B' },
    ],
  });
const next = () =>
  json({
    kind: 'tasks.next',
    task: { id: 'secret/b', title: 'B', status: 'open', prio: 1 },
    alternatives: [{ id: 'garden/a', title: 'A', status: 'open', prio: 2 }],
  });
const vaultRoutes = { '/api/tasks/areas': areas, '/api/tasks/snapshot': snapshot, '/api/tasks/next': next };

describe('HubSource', () => {
  it('sends the session as a bearer token, without cookie, cache or referrer', async () => {
    const h = hub(vaultRoutes);
    await new HubSource(h.fetch, TOKEN).vault();
    for (const call of h.calls) {
      expect(new Headers(call.init.headers).get('Authorization')).toBe(`Bearer ${TOKEN}`);
      expect(call.init.credentials).toBe('omit');
      expect(call.init.cache).toBe('no-store');
      expect(call.init.referrerPolicy).toBe('no-referrer');
    }
  });

  it('reads the classes before the snapshot and shows only what may be shown (MOB-02)', async () => {
    const h = hub(vaultRoutes);
    const view = await new HubSource(h.fetch, TOKEN).vault();
    expect(h.calls.map((c) => c.url)).toEqual(['/api/tasks/areas', '/api/tasks/snapshot', '/api/tasks/next?n=10']);
    expect(view.tasks.map((t) => t.id)).toEqual(['garden/a']);
    expect(view.hiddenAreas).toBe(1);
  });

  it('counts and the next pick only of shown areas: a hidden area adds nothing (MOB-02, MOB-05)', async () => {
    const view = await new HubSource(hub(vaultRoutes).fetch, TOKEN).vault();
    expect(view.counts).toEqual({ open: 2, doing: 1 });
    expect(view.next.map((p) => p.id)).toEqual(['garden/a']);
  });

  it('calls a refused session unpaired', async () => {
    const h = hub({ '/api/tasks/areas': () => json({ error: { code: 'unauthorized' } }, 401) });
    await expect(new HubSource(h.fetch, TOKEN).vault()).rejects.toBeInstanceOf(Unpaired);
  });

  it('calls a failed fetch of a read unreachable', async () => {
    const failing = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    await expect(new HubSource(failing, TOKEN).hello()).rejects.toBeInstanceOf(Unreachable);
  });

  it('says what the hub refused, in its words', async () => {
    const h = hub({ '/api/tasks/areas': () => json({ error: { code: 'engine_unavailable', message: 'not ready' } }, 503) });
    const error = await new HubSource(h.fetch, TOKEN).vault().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HubRefused);
    expect(error).toMatchObject({ status: 503, code: 'engine_unavailable', message: 'not ready' });
  });

  it('sends one operation per request with its client_op_id', async () => {
    const h = hub({ '/api/tasks/ops': () => json({ kind: 'tasks.result', ok: true, results: [{ ok: true, id: 'garden/new' }] }) });
    const outcome = await new HubSource(h.fetch, TOKEN).write('op-12345678', { op: 'new', area: 'garden', title: 'N' });
    expect(outcome).toEqual({ ok: true, id: 'garden/new' });
    expect(JSON.parse(String(h.calls[0]?.init.body))).toEqual({ client_op_id: 'op-12345678', ops: [{ op: 'new', area: 'garden', title: 'N' }] });
    expect(h.calls[0]?.init.method).toBe('POST');
  });

  it("takes the engine's refusal of the whole request as its verdict, not as a failure of the hub", async () => {
    const h = hub({ '/api/tasks/ops': () => json({ error: { code: 'conflict', message: 'changed', retryable: false } }, 409) });
    expect(await new HubSource(h.fetch, TOKEN).write('op-12345678', { op: 'set', id: 'garden/a', patch: { status: 'doing' }, if_match: 'e1' })).toEqual({
      ok: false,
      code: 'conflict',
      message: 'changed',
      retryable: false,
    });
  });

  it("keeps the hub's own refusal of a write a refusal", async () => {
    const h = hub({ '/api/tasks/ops': () => json({ error: { code: 'bad_request', message: 'no' } }, 400) });
    await expect(new HubSource(h.fetch, TOKEN).write('op-12345678', { op: 'new', area: 'garden', title: 'N' })).rejects.toBeInstanceOf(HubRefused);
  });

  it('calls a write whose answer did not come back lost, never unreachable, while the phone is online', async () => {
    const failing = (async () => {
      throw new TypeError('network error');
    }) as typeof fetch;
    await expect(new HubSource(failing, TOKEN).write('op-12345678', { op: 'new', area: 'garden', title: 'N' })).rejects.toBeInstanceOf(AnswerLost);
  });

  it('keeps the slash of an id and escapes the rest', async () => {
    const h = hub({
      '/api/tasks/areas': areas,
      '/api/tasks/task': () => json({ kind: 'tasks.task', task: { id: 'garden/a', area: 'garden', title: 'A' }, body: '' }),
    });
    await new HubSource(h.fetch, TOKEN).task('garden/a');
    expect(h.calls[1]?.url).toBe('/api/tasks/task?id=garden/a');
  });
});
