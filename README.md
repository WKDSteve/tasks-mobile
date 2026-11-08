# tasks-mobile

The phone app of [tasks-desktop](https://github.com/WKDSteve/tasks-desktop): capture a task on the way and go through
the vault, as an installable web app (PWA). Android first; iOS later.

It is a client and nothing more. The rules of the tasks are the engine's ([tasks.nvim](https://github.com/WKDSteve/tasks.nvim)),
reached through the hub of tasks-desktop on your PC; this page shows what the hub sends and sends operations
(`tasks-export/1`, `tasks-ops/1`). There is no cloud and no second copy of the rules.

## State

**Not usable on a phone yet.** The page is built and tested, but the hub of tasks-desktop does not serve it yet: that
is the next step ([docs/HUB.md](docs/HUB.md) says what the hub has to do). Until then the page runs on a synthetic
vault in a browser (`pnpm dev`), which is how it is tested.

What is there:

- **List** of the open tasks of the areas that may be shown on a phone, with a filter by area and words.
- **Capture**: title, area, one sentence of context. Also as a **share target** on Android: share a link or a text
  from another app to tasks, and the form is filled (it never creates a task by itself).
- **A task**: its text, its status (set it), its open questions (answer them), and finishing it after the engine said
  what that sets off (a plan it closes, tasks it frees).
- **Offline**: the last list stays readable; what you create or change offline waits in a queue and is sent when the
  hub is reached again. Nothing is shown as done before the engine said so; a change the file moved on from is a
  conflict you see, never an overwrite.

What is not there (on purpose): editing the body, plans, anything with AI, deleting.

## Data classes

Only areas of the class `public` or `internal` (from the vault's `areas.json`, as the hub reads it) are shown on the
phone or kept on it. An area without a class, or `private`, stays on the PC; the page says how many areas it leaves
out. See [SECURITY.md](SECURITY.md).

## Use it (once the hub serves it)

[docs/USAGE.md](docs/USAGE.md): the SSH tunnel from the phone to the PC, pairing, installing the app on Android.

## Build and test

Needs Node 24 or newer, pnpm 10, and Chrome for the browser tests.

```
pnpm install --frozen-lockfile
pnpm check            # svelte-check and tsc
pnpm test             # unit tests (vitest)
pnpm e2e              # both builds, then the page in Chrome with a phone's screen, under the hub's CSP
python tools/check-control-chars.py
```

- `pnpm build` makes `dist/`, the page the hub will serve. It speaks to the hub only.
- `pnpm build:fake` / `pnpm dev` make the same page on a synthetic vault in memory (`src/lib/fakeSource.ts`), marked
  "Test data" on the page. It is never served to a phone; `e2e/bundle.spec.ts` checks that `dist/` holds none of it.

Rules: the ruleset `mobile` of [rules-vault](https://github.com/WKDSteve/rules-vault) (`rulesets/mobile`), together
with the web rules of `native`.

## License

MIT, see [LICENSE](LICENSE).
