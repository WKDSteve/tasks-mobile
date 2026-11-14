# What the hub has to do for this page

The page is built here (`pnpm build` makes `dist/`); the hub of tasks-desktop serves it. These are the steps on the
hub's side, in the order they unlocked things on the phone. All of them are done in tasks-desktop; what is left is the
hand run on a real phone (task `tasks-mobil-handtest-am-android-geraet-ueber-ssh-tunnel-pair` in the tasks vault).

## 1. Serve the page under `/m/` (makes the page usable over the SSH tunnel) — done

Done in tasks-desktop (its `mobile.lock`, `tools/build-mobile.py`, `crates/tasks-hub/build.rs`) on appkit v0.40.0
(`GuardRules::with_installable_page("/m", "tasks-mobile-worker")`). What it does:

- Embed `dist/` of a pinned commit of tasks-mobile in the binary (like the desktop page, SRV-20), served under `/m/`.
  The page uses relative addresses, so it works below `/m/` as built.
- The policy of `/m/` is the shell policy plus `manifest-src 'self'; worker-src 'self'` and the Trusted Types policy
  `tasks-mobile-worker` next to `svelte-trusted-html`. For the voice note (appkit v0.45.0,
  `GuardRules::with_installable_microphone`) also `media-src 'self' blob:` and `microphone=(self)` in the
  `Permissions-Policy`; every other page of the hub keeps `microphone=()`. The exact strings the page is tested under
  are in `tools/csp.mjs`. A hub without the microphone still takes photos; recording then says why it cannot.
- `manifest.webmanifest` as `application/manifest+json`, `sw.js` as `text/javascript`. The worker's scope is `/m/`;
  it does not need `Service-Worker-Allowed`.
- The routes the page uses: `GET /api/tasks/hello`, `/api/tasks/areas`, `/api/tasks/snapshot`, `/api/tasks/next`,
  `/api/tasks/task`, `/api/tasks/done_preview`, `/api/tasks/device` (the level of this device now; a hub without it
  leaves the page at read, create and change), `/api/tasks/testing_sheets`, `/api/tasks/testing_run`;
  `POST /api/tasks/ops` (one operation per request), `POST /api/tasks/testing_start` (with `x-device-confirm`, the
  device's confirmation of that very request), `POST /api/tasks/upload?id=` (a file of a captured task, after the
  `new`; the body is the file, `X-Upload-Name` its name), `POST /auth/exchange`.

## 2. Filter by class for the phone (MOB-02) — done

The hub sends a device only areas of `public` and `internal`, in the snapshot, the task, and every list: the hub cuts,
never the phone (`crates/tasks-hub/src/server/device_cut.rs` in tasks-desktop). A task is copied field by field from
a list of fields that carry nothing of another task; a snapshot gets a `rev` of its own over what the phone is given.
The page still drops what is not of a released class (the tasks and areas, the picks of `next`, the counts) as a
second wall, and the export file (`tasks-hub phone export`) is cut by the same code.

## 3. Devices (MOB-03, MOB-04) — done

A key per paired phone (made by the page, not extractable), listed and revocable one by one on the PC
(`tasks-hub devices`, `devices revoke <id>`, `devices level <id> read|create|change|trigger`); the level is enforced by
the hub per request and read again at each call, so a change reaches the open sessions at once. A new phone starts at
`change`. `trigger` is only for asking the hub to run a task's test sheets (`testing_start`), each time with the
phone's confirmation key over that very request (appkit-ui `confirmHeader`, appkit v0.49.0).

## 4. Tailscale Serve (second way in) — done

With `TASKS_DESKTOP_TAILNET=<pc>.<tailnet>.ts.net` the guard allows that origin for device sessions only, with `Host`
checked exactly; `tasks-hub pair` then also prints the link `https://<pc>.<tailnet>.ts.net/m/#pair=<code>`. How to set
it up: [USAGE.md](USAGE.md).

## 5. Web Push (reminders and decisions) — done

The page subscribes a paired device with `appkit-hub::push` (`GET /api/push/key`, `POST /api/push/subscribe` with the
kinds `remind` and `decision`, `POST /api/push/unsubscribe`). The hub (`crates/tasks-hub/src/notices.rs`) sends
`remind` when the `remind:` day of a task comes and `decision` when a task starts to wait for the author's decision.
Only the kind and the id go out (PWA-06); the id only when the class of its area is released for devices.
