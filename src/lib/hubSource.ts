// The hub of tasks-desktop as the data source. The transport (the bearer token, no cookie, no cache, no referrer) is
// the kit's `HubClient`; this file maps the routes and turns every failure into one of the errors of `source.ts`.

import { HubClient } from 'appkit-ui/client';
import { areaClasses, donePreview, hubHello, OP_ERROR_CODES, opOutcome, taskDetail, vaultView } from './parse';
import { pushKey, type PushSubscriptionBody } from './push';
import { AnswerLost, HubRefused, Unpaired, Unreachable, type DataSource } from './source';
import type { DataClass, DonePreview, HubHello, Op, OpErrorCode, OpOutcome, TaskDetail, VaultView } from './types';

/** How long a read may take before the page calls the hub unreachable (MSEC-08). */
export const READ_TIMEOUT_MS = 15_000;
/** How long a write may take; after that its fate is unknown (`AnswerLost`). */
export const WRITE_TIMEOUT_MS = 30_000;
/** How long a file may take on its way (a voice note over a slow tunnel); after that its fate is unknown. */
export const UPLOAD_TIMEOUT_MS = 120_000;
/** How many alternatives the page asks `next` for (the hub allows 0 to 10). */
export const NEXT_ASKED = 10;

function idParam(id: string): string {
  return encodeURIComponent(id).replace(/%2F/gi, '/');
}

/** The engine's refusal in the hub's error body, or `null` when the body is the hub's own (`bad_request`, ...). */
async function engineVerdict(response: Response): Promise<OpOutcome | null> {
  let doc: unknown;
  try {
    doc = await response.clone().json();
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) return null;
  const error = (doc as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const { code, message, retryable } = error as { code?: unknown; message?: unknown; retryable?: unknown };
  if (typeof code !== 'string' || !(OP_ERROR_CODES as readonly string[]).includes(code)) return null;
  return {
    ok: false,
    code: code as OpErrorCode,
    message: typeof message === 'string' ? message.slice(0, 500) : '',
    retryable: retryable === true,
  };
}

export class HubSource implements DataSource {
  readonly kind = 'hub' as const;
  private readonly client: HubClient;
  /** The classes of the areas, from the last `vault()`; a task of an area not in it is not shown. */
  private classes = new Map<string, DataClass>();

  constructor(fetchFn: typeof fetch, token: string, base = '') {
    this.client = new HubClient(fetchFn, '/api/tasks', base);
    this.client.setToken(token);
  }

  private async read(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.client.request(path, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
    } catch (error) {
      throw new Unreachable(error);
    }
    return this.body(response);
  }

  private async body(response: Response): Promise<unknown> {
    if (response.status === 401) throw new Unpaired();
    if (!response.ok) {
      let code = 'http_error';
      let message = `HTTP ${response.status}`;
      try {
        const doc = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
        if (typeof doc.error?.code === 'string') code = doc.error.code;
        if (typeof doc.error?.message === 'string') message = doc.error.message.slice(0, 500);
      } catch {
        // not the hub's JSON: keep the status
      }
      throw new HubRefused(response.status, code, message);
    }
    return response.json();
  }

  async hello(): Promise<HubHello> {
    return hubHello(await this.read('/api/tasks/hello'));
  }

  async vault(): Promise<VaultView> {
    // The classes first: the snapshot is cut by them, and without them nothing is shown (fail closed).
    this.classes = areaClasses(await this.read('/api/tasks/areas'));
    const snapshot = await this.read('/api/tasks/snapshot');
    // More picks than are shown: those of hidden areas are dropped on the page (`nextPicks`).
    const next = await this.read(`/api/tasks/next?n=${NEXT_ASKED}`);
    return vaultView(snapshot, this.classes, next);
  }

  async task(id: string): Promise<TaskDetail> {
    if (this.classes.size === 0) this.classes = areaClasses(await this.read('/api/tasks/areas'));
    return taskDetail(await this.read(`/api/tasks/task?id=${idParam(id)}`), this.classes);
  }

  async write(clientOpId: string, op: Op): Promise<OpOutcome> {
    let response: Response;
    try {
      response = await this.client.request('/api/tasks/ops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_op_id: clientOpId, ops: [op] }),
        signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
      });
    } catch (error) {
      // A request that never left (no route to the hub) and one whose answer was lost look the same to `fetch`.
      // Only the first may be sent again; `navigator.onLine` false means it never left.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Unreachable(error);
      throw new AnswerLost(error);
    }
    // The engine's refusal of the whole request comes as `{error: {code, message, retryable}}` with 400/403/404/409
    // (`tasks-hub/src/server/answer.rs`); that is its verdict on the write, not a failure of the hub.
    if ([400, 403, 404, 409].includes(response.status)) {
      const verdict = await engineVerdict(response);
      if (verdict) return verdict;
    }
    return opOutcome(await this.body(response));
  }

  async upload(id: string, file: Blob, name: string): Promise<OpOutcome> {
    let response: Response;
    try {
      // `exact=1`: a name the task has already is `exists`, not a second file with a counter (a file sent again after its
      // answer was lost arrives once); the desktop page keeps the counter.
      response = await this.client.request(`/api/tasks/upload?id=${idParam(id)}&exact=1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Name': encodeURIComponent(name) },
        body: file,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      // As for a write: only a file that never left may be sent again by itself.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Unreachable(error);
      throw new AnswerLost(error);
    }
    // The engine's verdict on the attach comes as a result (200) or as its refusal in the hub's error body.
    if ([400, 403, 404, 409].includes(response.status)) {
      const verdict = await engineVerdict(response);
      if (verdict) return verdict;
    }
    return opOutcome(await this.body(response));
  }

  async pushKey(): Promise<string> {
    return pushKey(await this.read('/api/push/key'));
  }

  /** A change of the subscription is said again on the next turn-on; a lost answer is a failure the page says. */
  private async pushPost(path: string, body: unknown): Promise<void> {
    let response: Response;
    try {
      response = await this.client.request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Unreachable(error);
    }
    await this.body(response);
  }

  pushSubscribe(body: PushSubscriptionBody): Promise<void> {
    return this.pushPost('/api/push/subscribe', body);
  }

  pushUnsubscribe(): Promise<void> {
    return this.pushPost('/api/push/unsubscribe', {});
  }

  async donePreview(id: string): Promise<DonePreview> {
    return donePreview(await this.read(`/api/tasks/done_preview?id=${idParam(id)}`));
  }
}
