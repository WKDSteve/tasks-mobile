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

## Web platform

- Browser Support: Baseline Widely available (`.mwgrc`, `browserslist` in `package.json`). Zielgerät ist Android
  Chrome bzw. System WebView (installierte PWA). Neuere Features nur hinter Feature-Detection mit Fallback;
  Polyfills, wo noch genutzte Browser sie brauchen (lieber einer zu viel), laufen nur nach der Prüfung: dynamisch per `import()`, in einer `file://`-Seite mitgebündelt (rules-vault `BASE-02`). `build.target` in `vite.config.ts` (es2022) bleibt davon unberührt.
- Vor dem Schreiben oder Ändern von HTML, CSS oder Client-JS (`src/`, `public/`, `index.html`) den Skill
  `modern-web-guidance` nutzen (`search` → `retrieve` → prüfen). Nicht für Build-Config, CI oder `tools/`.
- Für offene Modernisierung: `npx -y modern-web-guidance@latest legacy-scan src --json`, jeden Fund gegen
  `keepWhen`/`dropWhen` prüfen. Neues muss unter der CSP aus `tools/csp.mjs` und Trusted Types laufen
  (siehe Fallen).
- Regeln: rules-vault Ruleset `web`, daneben die PWA-Regeln (`PWA-*`) aus Ruleset `mobile` (plus die App-Regeln
  `WEB-*` aus Ruleset `native`).
- Bestätigungen sind native `<dialog>`: `use:modal` aus `src/lib/modal.ts` (`showModal()`, `closedby` nie `any`), der Zustand
  folgt dem `close`-Event; keine eigene Fokusfalle, keine eigene Esc-Logik. Bekannter Fund (offen): `Queue.svelte` hat
  noch ein eigenes `div[role=alertdialog]` (`forget-confirm`).
- `legacy-scan` läuft über den Lockfile (exakte devDependency, es gilt die Quarantäne aus `pnpm-workspace.yaml`):
  `DISABLE_TELEMETRY=1 pnpm exec modern-web-guidance legacy-scan src --json`; die CI führt ihn als Hinweis aus.
  `.claude/settings.json` schaltet die Telemetrie ab und erlaubt nur `npx -y modern-web-guidance@latest *`.
