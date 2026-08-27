# AGENTS.md

This file orients coding agents (and humans) working on this repository. Read
it before making changes — it captures architecture, conventions, and gotchas
discovered across prior sessions that are easy to miss from the code alone.

## What this project is

- **English name**: surrendered by cultists
- **Chinese name**: 完蛋，我被邪教徒包围了！
- A **Windows-95-styled, data-driven web game engine** implemented in plain
  ES6 modules (no build step, no bundler, no framework, no `package.json`).
  It powers a keyword-collection / dialogue / interactive-fiction desktop
  simulator (day = hospital-intern HIS system, night = dorm social app),
  similar in spirit to *主播女孩重度依赖*.
- Everything renders inside a single `index.html` that simulates a Win95
  desktop: desktop icons, a taskbar with a Start menu, and draggable/
  z-stacked app windows.

## Running it locally

There is no build step. Because the engine `fetch()`s JSON from `data/` at
runtime, the browser's same-origin policy requires serving over HTTP(S) —
you cannot double-click `index.html` directly.

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Validating changes

There is **no test framework, linter, or bundler** configured. Validation is:

1. `node --check <file>.js` on every JS file you touch (syntax only).
2. JSON-validate every data file you touch, e.g.
   `python3 -m json.tool data/zh-hans/foo.json > /dev/null`.
3. Manual code review / tracing — there is no automated test suite, so be
   careful with logic changes and reason through event flows by hand.
4. This sandbox's Playwright browser tool has historically failed to launch
   ("Transport closed") — do not assume live browser testing is available;
   fall back to static analysis and careful manual tracing.

## Architecture: singleton + event bus

Every core module in `js/core/` is a **class exported alongside a singleton
instance**, e.g.:

```js
class KeywordManager { ... }
export const keywordManager = new KeywordManager();
export default KeywordManager;
```

Modules communicate through a single shared **pub/sub event bus**
(`js/core/EventBus.js`), not through direct method calls on each other where
avoidable. Follow this pattern for any new global/cross-cutting state.

### Core singletons (`js/core/`)

| Module | Responsibility |
|---|---|
| `EventBus.js` | Global pub/sub bus every other singleton communicates through. |
| `DataLoader.js` | Fetches + caches JSON from the **language-scoped** data folder (`data/<lang>/`). `setLanguage(lang)` clears the cache and repoints the base path. |
| `I18n.js` | Loads `data/languages.json` (available languages) and `data/strings.<lang>.json` (UI chrome strings, e.g. `data/strings.zh_hans.json`). `i18n.t(key, fallback)` looks up a string. |
| `KeywordManager.js` | Central keyword registry (loads `keywords.json`), highlight rendering/click-to-collect, and the Notebook's backing store. `definitionsWithSource(ids, source)` is the standard way apps register keywords they reveal. |
| `ItemManager.js` | Inventory singleton (loads `items.json`). `use()` applies `useEffect` and emits `item:used`; `inspect()` reveals `revealKeywordIds` via KeywordManager. |
| `ScheduleData.js` | Resolves per-day-phase content files (`data/zh-hans/dayNNa.json` / `dayNNb.json`) via `data/zh-hans/days.json`'s `totalDays`. `isFinalPhase(day, phase)` flags the last authored night. |
| `DialogueEffects.js` | Shared `applyDialogueOnShow(node)` helper — applies a dialogue node's optional `onShow: { grantItems, removeItems, ending }` side effects. Used by both HISApp and SocialApp so dialogue-driven item grants/endings aren't duplicated. |
| `EndingManager.js` | Loads `endings.json`. Resolves all 4 ending trigger types (event/dialogue via `trigger(id)`, item-use via `item:used` + `useEffect.ending`, stat-threshold via `gamestate:changed` + `statTriggers`, time/final-day via `resolveFinalEnding()` + `finalConditions`/`defaultEndingId`). First ending wins (`isEnded` latches true). Emits `ending:triggered`. |
| `GameState.js` | Player stats (energy/mental/physical/satiety/day/phase). Satiety is clamped to **0–255** (not 100) so gluttony-threshold endings are reachable. |
| `DayNightSystem.js` | `toggle()` advances day/night; checks `scheduleData.isFinalPhase()` first and calls `endingManager.resolveFinalEnding()` instead of advancing once the last phase is reached. |
| `DialogueProgress.js` | Tracks which dialogue nodes/options have been seen, for branching dialogue persistence. |
| `SettingsManager.js` | Player-configurable prefs (BGM volume, notebook sort mode, phase-change confirmation, language), persisted to `localStorage`, broadcast via `settings:changed`. |
| `AudioManager.js` | BGM playback, volume driven by `SettingsManager`. |
| `ConfirmDialog.js` | `confirmDialog(message, opts)` — a Win95-window-styled replacement for `window.confirm()`; returns a Promise\<boolean\>. |
| `Window.js` / `WindowManager.js` | Window chrome (drag/resize/minimize/close/`moveTo`) and the window system (create/focus/z-order/`windowSnapshot()`/`moveWindow()`). `windowSnapshot()` is what SaveManager persists. |
| `SaveManager.js` | Encodes/decodes the entire game state (stats, items, keywords, dialogue progress, **open windows + their position/z-order**) into a short opaque string written to `location.search`. Format is versioned (`SAVE_FORMAT_VERSION`); bumping the format is a breaking change for existing save links. |

### Apps (`js/apps/*.js`) + Desktop chrome (`js/desktop/*.js`)

- Each app exports a `launchXApp()` function that builds its DOM and calls
  `windowManager.createWindow({ appId, title, icon, content, ... })`.
- **All apps are always visible** on the desktop and in the Start menu, and
  are always launchable regardless of day/night phase — HIS and Social
  instead vary *content* by day/phase via `ScheduleData`, not visibility.
- `Desktop.js` / `Taskbar.js` render from a single `APP_REGISTRY` array
  defined in `js/main.js`; `label`/`icon` fields may be plain strings or
  zero-arg functions (used for the day/night-dependent phase-toggle icon).
- `MainMenu.js` — retro CRT-terminal-styled boot/login overlay (`#main-menu`
  in `index.html`), shown only when `location.search` is empty. Offers
  "new game" or "load save" (paste a save string). Uses `.crt-screen` /
  `.crt-*` classes from `css/mainmenu.css`.
- `EndingScreen.js` — reuses the same `.crt-screen` chrome, shown whenever
  `endingManager` fires `ending:triggered`. Its "返回主菜单" button reloads
  to `location.pathname` (drops the search string) to return to MainMenu.
- `NotificationBanner.js` — auto-dismissing toast, used for
  day/night-phase-change announcements and the "welcome back" message shown
  when booting with an existing save string.

`js/main.js` is the composition root: it builds `APP_REGISTRY`, preloads all
core singletons (`i18n`, `itemManager`, `scheduleData`, `endingManager`,
`saveManager`), decides MainMenu-vs-welcome-back based on `location.search`,
and wires the Desktop/Taskbar/NotificationBanner/EndingScreen together.

## Data-driven content (`data/`)

**Everything content-related lives in `data/`, not in code.** Two tiers:

- `data/languages.json`, `data/strings.<lang>.json` — i18n for **UI chrome**
  (buttons, toasts, menu labels). Looked up via `i18n.t(key, fallback)`.
- `data/<lang>/*.json` (currently only `data/zh-hans/`) — all **game
  content**, loaded through `DataLoader` (which is language-scoped; never
  hardcode a `data/zh-hans/...` path in JS — call
  `dataLoader.loadJSON("foo.json")` and let `DataLoader`/`I18n` resolve the
  language-specific folder).

Key files inside `data/zh-hans/`:

| File | Purpose |
|---|---|
| `days.json` | `{ "totalDays": N }` — drives `ScheduleData`'s day-phase cycling. |
| `day01a.json` … `dayNNb.json` | Per-day-phase content (`a` = day, `b` = night): `patients`/`contacts` arrays, each with a `dialogueTree` (nodes with `text`, `[[keywordId]]` inline highlight markers, `options[]`, optional `onShow: {grantItems, removeItems, ending}`), plus optional `recordTemplateId` for HIS patients. |
| `keywords.json` | Central keyword registry: `{ id, label, category, definition, ... }`. All apps reference keywords by id via `keywordIds`/`keywordId` fields; never inline-define a keyword elsewhere. |
| `items.json` | Inventory item defs: `consumable`, `usable`, `inspectText`, `revealKeywordIds`, `useCondition.requires`, `useEffect.{grant,remove,ending,stat deltas}`. |
| `endings.json` | `endings[]` (id/title/icon/text), `statTriggers[]` (stat/op/value/endingId), `finalConditions[]` (condition/endingId, checked in order on the final night), `defaultEndingId` (fallback). |
| `medical_records.json`, `medicines.json` | HIS record templates (fill-in-the-blank slots) and prescribable medicine list. |
| `chatgtp_qa.json` | Keyword-combination → answer map for the ChatGTP app; each entry has `revealKeywordIds` for keywords the answer teaches. |

**Dialogue node schema** (used by both HIS patients and Social contacts):
```jsonc
{
  "speaker": "npc" | "player",
  "text": "...[[keywordId]] inline highlight marker...",
  "options": [{ "label": "...", "next": "nodeId" }],
  "onShow": { "grantItems": [{"itemId":"x","count":1}], "removeItems": [...], "ending": "endingId" }
}
```
`onShow` effects are applied via `DialogueEffects.applyDialogueOnShow(node)`
right after the node's line renders; if this causes `endingManager.isEnded`
to become true, the app stops rendering further options (freezes the
conversation — an ending screen takes over).

## Adding new languages

1. Add an entry to `data/languages.json.languages[]`.
2. Create `data/strings.<code>.json` (UI chrome strings) — copy
   `strings.zh_hans.json` as a template and translate every key.
3. Create a full `data/<code>/` folder mirroring `data/zh-hans/*.json`
   (all content files, including `days.json` and every `dayNNx.json`).
4. The Settings app already lists all `languages.json` entries and calls
   `dataLoader.setLanguage()` + `i18n.setLanguage()` + reloads the page on
   change — no code changes needed for the picker itself.

## Save-string format (important, easy to break)

`SaveManager.js` serializes the *entire* game state (stats, inventory,
collected keywords, dialogue progress, and now open-window
position/z-order) into a compact binary blob, base64url-encodes it, and
writes it as `location.search`. Loading re-derives everything from that
string; there is no server-side or file-based save.

- The format is intentionally **not human-readable** (packed bytes /
  bit-packed fixed-width fields, not JSON) — see the design notes at the
  top of `SaveManager.js` before changing the encoding.
- `SAVE_FORMAT_VERSION` must be bumped whenever the byte layout changes;
  treat this as a breaking change for any save links already shared.
- `WINDOW_APP_IDS` is a fixed ordered list used to encode `appId` as a small
  index — if you add a new app that should be save-restorable, add its id
  here (appending, not reordering, to avoid corrupting old saves further
  than the version bump already implies).

## Conventions worth following

- New global/cross-cutting modules: singleton class + named instance
  export, communicate via `eventBus`, avoid circular imports (e.g.
  `ItemManager` does **not** import `EndingManager` directly — it emits
  `item:used` and `EndingManager` subscribes, to keep the dependency
  direction one-way).
- Never hardcode a keyword's label/definition/category outside
  `keywords.json` — always reference by id and resolve through
  `keywordManager`.
- Never hardcode a `data/<lang>/...` path — go through `dataLoader` (it is
  already language-aware).
- User-facing UI chrome strings should go through `i18n.t(key, fallback)`
  with an entry in `data/strings.zh_hans.json`; game content strings live
  directly in the relevant `data/<lang>/*.json` file (no separate i18n
  layer needed there since the whole file is per-language).
- Win95 app windows use `css/win95.css` (+ `css/apps.css` for per-app
  layout). The MainMenu/EndingScreen overlays are a deliberate style
  departure (retro CRT terminal look, `css/mainmenu.css`) representing
  "outside the simulated OS" — don't reuse Win95 chrome there.
- This repo has no `package.json`/npm dependencies by design — don't add a
  bundler, framework, or dependency manager without discussing it first;
  the project intentionally stays zero-build ES6 modules.
