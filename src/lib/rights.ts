// The levels of what a phone may do (MOB-03): read, create (a task, an answer to a question), change (a status,
// finishing) and trigger (a run of something; never offered by this page). The hub is where they are enforced, per
// device; until it knows devices (appkit, "Mobile Geräte-Pairing und Rechte-Stufen"), this list only decides what the
// page offers. It is not a protection: a session of the hub can do whatever the hub allows.

import type { Op } from './types';

export type Right = 'read' | 'create' | 'change' | 'trigger';

/** What a newly paired phone may do: read, create and change (decided 2026-11-08); triggering stays off. */
export const DEFAULT_RIGHTS: ReadonlySet<Right> = new Set<Right>(['read', 'create', 'change']);

/** The right an operation needs. */
export function rightFor(op: Op): Right {
  switch (op.op) {
    case 'new':
    case 'answer':
      return 'create';
    case 'set':
    case 'done':
      return 'change';
  }
}

export function allows(rights: ReadonlySet<Right>, op: Op): boolean {
  return rights.has('read') && rights.has(rightFor(op));
}
