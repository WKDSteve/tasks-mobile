# tasks-mobile (PWA zu tasks-desktop)

Handy-Client von tasks-desktop: Svelte 5, TypeScript, Vite, pnpm. Die Seite rechnet keine Regeln der Tasks
(MOB-05); sie zeigt, was der Hub schickt, und schickt Operationen. Regelwerk: `rules-vault/rulesets/mobile`
(`regeln/MOBILE.md`, `regeln/ANDROID.md`, Gate `gates/REVIEW.md`) plus die WEB-Regeln aus `rulesets/native`.
Backlog und Plan: `tasks-vault/tasks-desktop` (Plan `tasks-mobil-unterwegs-erfassen-und-durchgehen`).

## Bauen und prüfen (vor "fertig")

```
pnpm install --frozen-lockfile
pnpm check && pnpm test && pnpm e2e
python tools/check-control-chars.py
node --check public/sw.js
```

- `pnpm e2e` baut beide Varianten (`dist/` für den Hub, `dist-fake/` mit synthetischem Vault) und testet die
  Fake-Seite in Chrome (Handy-Viewport) unter der CSP aus `tools/csp.mjs`. Jede Konsolen-Meldung (Fehler oder
  Warnung) lässt einen Test scheitern.
- Ein Fix ohne Test, der ohne den Fix rot wird, gilt nicht als fertig.

## Fallen

- **Unsichtbare Zeichen in der Quelle.** Das Schreibwerkzeug macht aus `\u200B` usw. in einem geschriebenen Text
  echte Zeichen. Nach jedem Schreiben von Regex/Strings mit solchen Escapes `python tools/check-control-chars.py`
  laufen lassen; Escapes mit `python tools/escape-hidden.py <datei>` wiederherstellen.
- **Trusted Types.** Jede Script-URL-Senke (`serviceWorker.register`, `new Worker`) braucht die Policy
  `tasks-mobile-worker` aus `src/lib/worker.ts`; eine neue Senke heißt: Policy bewusst erweitern, CSP in
  `tools/csp.mjs` und `docs/HUB.md` mitziehen.
- **Datenklassen.** Nur `public`/`internal` wird gezeigt oder gespeichert. Neuer Lesepfad = durch `parse.ts`
  (`shownClass`), neuer Speicher = beim Zurücklesen prüfen (`restore*`).
- Svelte-5-Fallen (`$effect` trackt alles, was gelesen wird; Unit-Tests sehen keine `$effect`): siehe
  Web-Vorlage der nvim-Config.
