# Security of tasks-mobile

What the page protects, how, and what it does not protect. Rules: `rulesets/mobile` of rules-vault (IDs in brackets).

## The way to the vault

The hub of tasks-desktop binds `127.0.0.1` only and stays that way (MOB-01). The phone reaches it through a tunnel:
today an SSH tunnel with the same port on both ends, so the phone's browser speaks to `http://127.0.0.1:PORT`, which is
the origin the hub allows. Later also Tailscale Serve; that needs the hub to know the tailnet origin and per-device
keys first (appkit, plan "Mobile Basis").

## Session

- Pairing with the one-time code of `tasks-hub open` (`#pair=<code>`, in the fragment, taken out of the address at
  once; or pasted into the field). The code is traded for a session token.
- The token lives in `sessionStorage` of the tab only, never in IndexedDB, a cookie, the address or a log (WEB-07).
  Closing the app ends the session; pair again. A per-device key that can be revoked one by one (MOB-04) is the
  hub's next step, not this page's.
- Every request carries the token as a bearer header; no cookie, no cache, no referrer.

## Data classes (MOB-02, MSEC-12)

- The page shows and keeps only areas whose class is `public` or `internal`. An area without a class, an unknown class
  word and `private` are left out (fail closed); a task that claims a shown area but whose id belongs to another one is
  dropped.
- **The hub does not filter for the phone yet.** Until it does (appkit, "Mobile Datenklassen fail closed"), the
  documents of hidden areas still travel through the tunnel to the page and are dropped there. The page never shows or
  stores them, but they cross the wire.
- What is kept on the phone: the last list (shown areas only) and the queue of writes, in IndexedDB of the page's
  origin. Both are read back as untrusted and checked field by field (MSEC-13). "Disconnect and delete the data"
  removes the session, the list and the queue.
- The service worker keeps the page itself (HTML, script, style, icons), never a route of the hub (PWA-02).

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
  protection** yet: the hub does not know devices, so a session can do what the hub allows any session. The levels
  per device are enforced by the hub once appkit has them (MOB-03).

## The page

- Served under the hub's policy: `default-src 'none'`, scripts and styles from the origin only, no inline, Trusted
  Types required. The page needs three additions the hub has to make for it: `manifest-src 'self'`,
  `worker-src 'self'`, and the Trusted Types policy `tasks-mobile-worker`, which turns exactly one string into a
  script URL, the address of the service worker (`src/lib/worker.ts`). See [docs/HUB.md](docs/HUB.md).
- The browser tests run the page under exactly that policy and fail on any console error or warning (MTST-06).
- No tracking, no analytics, no third-party SDK, no request to any other host (MSEC-09).

## Reporting

Open an issue at https://github.com/WKDSteve/tasks-mobile/issues; for something that should not be public, say so in
the issue without details and ask for a private channel.
