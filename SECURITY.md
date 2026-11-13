# Security of tasks-mobile

What the page protects, how, and what it does not protect. Rules: `rulesets/mobile` of rules-vault (IDs in brackets).

## The way to the vault

The hub of tasks-desktop binds `127.0.0.1` only and stays that way (MOB-01). The phone reaches it through a tunnel:
today an SSH tunnel with the same port on both ends, so the phone's browser speaks to `http://127.0.0.1:PORT`, which is
the origin the hub allows. Later also Tailscale Serve; that needs the hub to know the tailnet origin and per-device
keys first (appkit, plan "Mobile Basis").

## Device key and session (MOB-04, PWA-03)

- Pairing happens once, with the one-time code of `tasks-hub open` (`#pair=<code>`, in the fragment, taken out of the
  address at once; or pasted into the field). The page makes an ECDSA P-256 key pair that WebCrypto keeps
  non-extractable and sends the public half with the code and a name (`appkit-ui/device`, hub side `devices.rs` of
  appkit). It keeps the device id and the key pair in IndexedDB of its origin: a script of the page can sign with the
  key, nobody can read it out or copy it.
- Every start signs a challenge of the hub together with the origin and gets a fresh session; a hub that restarted is
  answered the same way, without the pairing screen. The session token lives in memory only, never in storage, a
  cookie, the address or a log.
- The PC revokes a device (control secret); the page then shows the pairing screen and says the device was
  disconnected. "Disconnect and delete the data" on the phone forgets the key there; the PC keeps the device in its
  list until it is revoked there.
- A hub that does not know devices yet takes the code the old way (`/auth/exchange`): the session then ends with the
  page.
- Every request carries the token as a bearer header; no cookie, no cache, no referrer.

## Data classes (MOB-02, MSEC-12)

- The page shows and keeps only areas whose class is `public` or `internal`. An area without a class, an unknown class
  word and `private` are left out (fail closed); a task that claims a shown area but whose id belongs to another one is
  dropped.
- **The hub does not filter for the phone yet.** Until it does (appkit, "Mobile Datenklassen fail closed"), the
  documents of hidden areas still travel through the tunnel to the page and are dropped there. The page never shows or
  stores them, but they cross the wire.
- What is kept on the phone: the last list (shown areas only), the queue of writes and the draft of the capture form
  (its text and files, until it is created or discarded), in IndexedDB of the page's origin. All are read back as
  untrusted and checked field by field (MSEC-13). "Disconnect and delete the data" removes the device key, the list,
  the queue and the draft.
- The service worker keeps the page itself (HTML, script, style, icons), never a route of the hub (PWA-02).
- Notifications (Web Push from the hub): the message carries the kind (`remind`, `decision`) and at most the id of a
  task of a released area, never its title or text (PWA-06); the push service of the browser is somebody else's server.
  The worker shows only a fixed sentence per kind and drops anything else that arrives; a tap opens the page with
  `?task=<id>`, checked like any id and taken out of the address. Unpairing unsubscribes.

## Text from the vault and from other apps

- Text of a task is shown as text only, never as HTML; hidden characters (bidi controls, zero width) are shown as
  `⟦U+XXXX⟧` (MSEC-05). Links in a body are not made clickable.
- A share from another app only fills the form: controls and hidden characters are dropped, lengths are cut, a link
  is taken only as `http:`/`https:` without user info, and the parameters leave the address at once (MSEC-07).

## Writes

- One operation per request with its own `client_op_id`; a change carries the version it was made on (`if_match`).
  A conflict is shown, never overwritten (MOB-07).
- A write whose answer was lost is never sent again by itself (a second `new` would make a second task); the page
  asks (MOB-09).
- The rights a phone has (read, create, change; never trigger) decide what the page offers. They are **not a
  protection** yet: the hub knows the device of a session, but does not hold it to rights per device yet; a session
  can do what the hub allows any session (MOB-03, next step in appkit).

## The page

- Served under the hub's policy: `default-src 'none'`, scripts and styles from the origin only, no inline, Trusted
  Types required. Under `/m/` only, the hub adds three things for this page (appkit's
  `GuardRules::with_installable_page`): `manifest-src 'self'`, `worker-src 'self'`, and the Trusted Types policy
  `tasks-mobile-worker`, which turns exactly one string into a script URL, the address of the service worker
  (`src/lib/worker.ts`). The desktop page keeps its policy. See [docs/HUB.md](docs/HUB.md).
- The browser tests run the page under exactly that policy and fail on any console error or warning (MTST-06).
- No tracking, no analytics, no third-party SDK, no request to any other host (MSEC-09).

## Reporting

Open an issue at https://github.com/WKDSteve/tasks-mobile/issues; for something that should not be public, say so in
the issue without details and ask for a private channel.
