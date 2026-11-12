// Notices from the hub (Web Push, `appkit-hub::push`): a reminder that is due, a task that waits for a decision. The
// hub sends only the kind and the id of a task of a released area (PWA-06); the phone fetches the rest over its paired
// way when the notice is tapped. The service worker (`public/sw.js`) shows the notice; this file subscribes and
// unsubscribes. Permission is asked only when the person turns notices on (AND-01), never at the start.

import { isTaskId } from './parse';

/** The kinds of notices tasks-mobile subscribes to. The hub sends exactly these words. */
export const PUSH_KINDS = ['remind', 'decision'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** What the page says about notices. */
export type PushState = 'unsupported' | 'off' | 'on' | 'denied';

/** A subscription of the browser, as the hub takes it (`POST /api/push/subscribe`). */
export interface PushSubscriptionBody {
  endpoint: string;
  p256dh: string;
  auth: string;
  kinds: string[];
}

/** The browser's side: the push manager of the service worker and the permission. Faked in the tests. */
export interface PushAccess {
  /** Can this browser get notices at all (a service worker, a push manager, notifications)? */
  supported(): boolean;
  permission(): NotificationPermission;
  /** Is there a subscription of this page already? */
  subscribed(): Promise<boolean>;
  /** Ask for the permission (once, on the button) and subscribe with the hub's key; `null` when it was refused. */
  subscribe(key: string): Promise<{ endpoint: string; p256dh: string; auth: string } | null>;
  /** Let go of the subscription of the browser. */
  unsubscribe(): Promise<void>;
}

/** The key of the hub (`GET /api/push/key`): base64url of an uncompressed P-256 point. */
export function pushKey(doc: unknown): string {
  const key = typeof doc === 'object' && doc !== null ? (doc as { key?: unknown }).key : undefined;
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{80,100}$/.test(key)) throw new Error('push key');
  return key;
}

/** A notice as the worker reads it: a kind of this app and, at most, the id of a task; anything else is not shown. */
export function readNotice(data: unknown): { kind: PushKind; id: string | null } | null {
  if (typeof data !== 'object' || data === null) return null;
  const { kind, id } = data as { kind?: unknown; id?: unknown };
  if (!(PUSH_KINDS as readonly unknown[]).includes(kind)) return null;
  if (id !== null && id !== undefined && !isTaskId(id)) return null;
  return { kind: kind as PushKind, id: typeof id === 'string' ? id : null };
}

/** The id of a task the address asks to open (`?task=<area>/<slug>`, from a tapped notice), or `null`. */
export function taskFromAddress(search: string): string | null {
  const id = new URLSearchParams(search).get('task');
  return id !== null && isTaskId(id) ? id : null;
}

/** The address without `?task=`, so a reload does not open the task again. */
export function withoutTask(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search);
  params.delete('task');
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}

function b64url(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  let text = '';
  for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const text = atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** The browser's push manager behind `PushAccess` (the page's service worker must be registered). */
export function browserPush(nav: Navigator, notification: typeof Notification | undefined): PushAccess {
  // The worker of this page, if one is registered. Not `serviceWorker.ready`: it never settles without a worker (a
  // registration the CSP refused, say), and the start of the page must not wait on it.
  const registration = async (): Promise<ServiceWorkerRegistration | undefined> =>
    'serviceWorker' in nav ? nav.serviceWorker.getRegistration() : undefined;
  return {
    supported: () => 'serviceWorker' in nav && notification !== undefined && typeof PushManager !== 'undefined',
    permission: () => notification?.permission ?? 'denied',
    subscribed: async () => ((await (await registration())?.pushManager.getSubscription()) ?? null) !== null,
    subscribe: async (key) => {
      if (!notification) return null;
      const reg = await registration();
      if (!reg) throw new Error('no service worker');
      if ((await notification.requestPermission()) !== 'granted') return null;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      return { endpoint: sub.endpoint, p256dh: b64url(sub.getKey('p256dh')), auth: b64url(sub.getKey('auth')) };
    },
    unsubscribe: async () => {
      const sub = await (await registration())?.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    },
  };
}
