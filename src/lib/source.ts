// Where the vault comes from (MOB-06). The page speaks only this interface; behind it is the hub (over an SSH
// tunnel today, over Tailscale Serve later, `docs/USAGE.md`) or, in the browser tests, a synthetic vault in memory.
// No implementation computes a rule of the tasks: the engine behind the hub does (MOB-05).

import type { DonePreview, HubHello, Op, OpOutcome, TaskDetail, VaultView } from './types';

/** The hub could not be reached at all (no tunnel, no network): the page is offline, the write waits. */
export class Unreachable extends Error {
  constructor(cause?: unknown) {
    super('hub not reachable', { cause });
    this.name = 'Unreachable';
  }
}

/** The hub refused the session (401): the phone has to pair again. */
export class Unpaired extends Error {
  constructor() {
    super('not paired');
    this.name = 'Unpaired';
  }
}

/** The hub answered with an error of its own (not the engine's verdict on a write). */
export class HubRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HubRefused';
  }
}

/**
 * A write went out but no answer came back: the hub may have written it or not. The page never sends such a write
 * again by itself (a second `new` would make a second task); the user decides (MOB-07, MOB-09).
 */
export class AnswerLost extends Error {
  constructor(cause?: unknown) {
    super('the answer to a write was lost', { cause });
    this.name = 'AnswerLost';
  }
}

export interface DataSource {
  /** `hub` or `fake`: the page names it, so a test page is never mistaken for the real vault. */
  readonly kind: 'hub' | 'fake';
  hello(): Promise<HubHello>;
  /** The vault, cut to the areas this phone may show. */
  vault(): Promise<VaultView>;
  task(id: string): Promise<TaskDetail>;
  /** One operation, one request: its own `client_op_id`, so the hub can tell a repeat. */
  write(clientOpId: string, op: Op): Promise<OpOutcome>;
  donePreview(id: string): Promise<DonePreview>;
}
