# cultists (ng) — Phase 1

Phase 1 deliverable of the new-generation engine rebuild described in
`.hermes/plans/cultists-ng-engine-rebuild.md`: a Windows 95-styled desktop
shell and window kernel, independent from the existing engine at the
project root.

## What's here

- `index.html` / `style.css` — Win95-styled desktop, taskbar and window
  chrome, visually borrowed from `../css/win95.css` so it looks like the old
  engine.
- `engine.js` — composition root: boots `EventBus`, `WindowManager`,
  `WindowDefinitionStore` and `DesktopShell`.
- `core/EventBus.js` — publish/subscribe hub.
- `core/WindowManager.js` — sole owner of open windows and their geometry
  (position, size, focus/z-order, minimized/maximized). Deliberately
  DOM-independent so it can be probed headlessly.
- `core/WindowDefinitionStore.js` — loads static window definitions from
  `data/windows/*.json`.
- `desktop/DesktopShell.js`, `Taskbar.js`, `DesktopIcon.js`, `WindowFrame.js`,
  `PointerInteraction.js` — presentation layer: renders windows/taskbar/icon
  placeholders and forwards drag/resize gestures into `WindowManager`.
- `data/` — `engine.json`, `desktop-icons.json` and one minimal custom
  window example (`windows/example.json`).
- `dev-server.js` — local static server bound to `127.0.0.1`, with a small
  read/write JSON API scoped to `ng/data/`.
- `probes/window-manager-probe.mjs` — deterministic, DOM-independent probe
  covering the Phase 1 acceptance criteria (focus/z-index, drag, resize
  clamp, listener cleanup on close, geometry save at x/y = 0).

## Relationship to the project root

`ng/` is a temporary, fully independent entry point; it does not modify or
replace the existing root `index.html`/`js/`/`css/`/`data/` engine. Only
once `ng/` and its first batch of adapted content reach release quality
(Phase 9 of the plan) will it be moved to the project root to become the
new primary entry point, replacing the current engine — that migration is a
deliberate one-time step, not something later phases do incrementally.

## Explicitly out of scope for Phase 1

Activity runtime, developer mode, editors, data structures, public
variables, save system and desktop icon persistence are later phases; they
are not implemented here yet.

## Running

```bash
cd ng
node dev-server.js
# open http://127.0.0.1:8000/
```

## Verifying

```bash
cd ng
node --check engine.js core/*.js desktop/*.js dev-server.js
node probes/window-manager-probe.mjs
python3 -c "import json,glob; [json.load(open(f)) for f in glob.glob('data/**/*.json', recursive=True)]"
```
