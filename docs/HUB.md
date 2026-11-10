# What the hub has to do for this page

The page is built here (`pnpm build` makes `dist/`); the hub of tasks-desktop serves it. These are the steps on the
hub's side, in the order they unlock things on the phone.

## 1. Serve the page under `/m/` (makes the page usable over the SSH tunnel) — done

Done in tasks-desktop (its `mobile.lock`, `tools/build-mobile.py`, `crates/tasks-hub/build.rs`) on appkit v0.40.0
(`GuardRules::with_installable_page("/m", "tasks-mobile-worker")`). What it does:

- Embed `dist/` of a pinned commit of tasks-mobile in the binary (like the desktop page, SRV-20), served under `/m/`.
  The page uses relative addresses, so it works below `/m/` as built.
- The policy of `/m/` is the shell policy plus `manifest-src 'self'; worker-src 'self'` and the Trusted Types policy
  `tasks-mobile-worker` next to `svelte-trusted-html`. The exact string the page is tested under is `tools/csp.mjs`.
- `manifest.webmanifest` as `application/manifest+json`, `sw.js` as `text/javascript`. The worker's scope is `/m/`;
  it does not need `Service-Worker-Allowed`.
- The routes the page uses: `GET /api/tasks/hello`, `/api/tasks/areas`, `/api/tasks/snapshot`, `/api/tasks/next`,
  `/api/tasks/task`, `/api/tasks/done_preview`; `POST /api/tasks/ops` (one operation per request), `POST /auth/exchange`.

## 2. Filter by class for the phone (MOB-02)

The hub sends a phone session only areas of `public` and `internal`, in the snapshot, the task, and every list. Today
the page drops the rest itself, after it crossed the tunnel: the tasks and areas, the picks of `next` (vault-wide,
the area is the start of the id) and the counts (it adds up `areas[].by_status` of the shown areas only).

## 3. Devices (MOB-03, MOB-04)

A key per paired phone, listed and revocable one by one on the PC; the rights of the device (read, create, change,
trigger) enforced by the hub per request. The page then keeps the device key instead of a session that ends with the
app.

## 4. Tailscale Serve (second way in)

The guard allows the tailnet origin (`https://<host>.<tailnet>.ts.net`) for device sessions only, with `Host` checked
exactly. Needs step 3.
