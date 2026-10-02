# Frontend architecture

This is the document to read before changing the web frontend. It covers the
scoring app (`/app`, `/c`, `/p`, `/admin`), its build, and the OBS overlay
(`/overlay`, `/broadcast`). The landing page (`index.html`), the NFC utility
(`nfc/`) and the Device Lab (`device-harness/`) are separate pages and are not
covered here.

How the current structure was reached from the former monolithic `script.js`,
and how behavioural equivalence was verified, is recorded in
[frontend-refactor.md](frontend-refactor.md).

## Principles

- **Native ES modules, no framework, no bundler.** The browser loads
  `app/js/main.js` and follows its imports. Nothing is transpiled.
- **One responsibility per module, explicit dependencies.** A module imports
  everything it uses; ESLint `no-undef` and the structure check enforce this.
- **Explicit DOM ownership.** Every module documents, in its header comment,
  the part of the page it is allowed to manipulate.
- **Behaviour first.** The source layout changed; DOM ids, classes, routes, URLs,
  storage keys, Firestore documents, callables and event semantics did not.

## Directory structure

```text
app/
├── index.html              GENERATED from templates/ (do not edit)
├── overlay.html            GENERATED from overlay/ (do not edit)
├── templates/              scoring app document sources
│   ├── index.template.html   <head> and the body skeleton
│   ├── global/               controls, appearance menu, modals, loading, set-win overlay, waves
│   └── pages/                menu, play, spectate, scoreboard, admin/{auth,dashboard,...}
├── css/
│   ├── style.css           GENERATED from index.css (do not edit)
│   ├── index.css           ordered stylesheet manifest (the cascade order)
│   ├── tokens.css base.css layout.css title-animations.css overrides.css
│   ├── components/         scoreboard, modals, match details, toasts, loaders, ...
│   └── pages/              menu, scoreboard, court pages, admin
├── overlay/                OBS overlay sources (template.html, css/, js/)
└── js/
    ├── main.js             composition root (the module entry point)
    ├── script.js           compatibility entry point only (imports main.js)
    ├── firebase.js         Firebase re-export for non-app pages (device-harness)
    ├── brand.mjs           canonical brand registry (brand.js re-exports it)
    ├── scoreSync.mjs       stale-snapshot guard for the live score listener
    ├── jscolor.min.js      third-party (vendor) - never edit or reformat
    ├── qrcode.min.js       third-party (vendor) - never edit or reformat
    ├── config/             constants.js, routes.js
    ├── state/              appState, sessionState, navigationState, themeState, adminSessionState
    ├── firebase/           client, firestore (SDK), callables, court/device/admin repositories
    ├── audio/              audio.js
    ├── lifecycle/          deviceIdentity.js, wakeLock.js
    ├── utils/              colour.js, formatting.js, domHelpers.js
    ├── ui/                 dom, toast, loading, modals, forms, theme, appearance, fullscreen,
    │                       animations, settingsTiles, navigation, inputBehaviour
    ├── routing/            routeParsers, viewState, history, viewController, router
    ├── scoring/            actions, options, presentation, scoreboard, serverIndicator,
    │                       settings, reset, changeover
    ├── court/              session, courtSync, courtLists, playJoin
    ├── teams/              teamNames, playerNames, playerNamesModal
    ├── details/            matchDetails, momentum, advancedStats
    ├── sharing/            share, sharePayload, shareCardState, imageCapture, shareCardAssets
    ├── qr/                 courtQr, qrPanelInteractions, qrHandleVisibility, qrState
    ├── nfc/                nfc.js, parser.js
    ├── admin/              admin, courts, devices
    └── shell/              hotkeys, scoreboardControls, settingsModal, viewportResize
```

### Module responsibilities

| Directory | Owns |
| --- | --- |
| `config/` | Constants and the navigation vocabulary (`NAV_PAGES`, `NAV_MODALS`). |
| `state/` | Plain-data state objects shared between modules (see [State](#state)). |
| `firebase/` | Firebase initialisation and every Firestore / callable call. |
| `audio/` | Sound effects and the audio unlock on user gesture. |
| `lifecycle/` | Device identity, the mobile-device class, the screen wake lock. |
| `utils/` | Pure helpers (colour, formatting) and DOM predicates. |
| `ui/` | Reusable UI systems: DOM lookup, toasts, loading overlays, the confirm modal, forms, theme and appearance, fullscreen, settings tiles, document-level input behaviour. |
| `routing/` | URLs, view states, browser history and turning a view state into visible pages. |
| `scoring/` | Sending score events, scoring options, score presentation and scoreboard rendering, reset and changeover. The backend scoring engine remains authoritative. |
| `court/` | The court session (enter / leave / spectate), live Firestore sync, the court lists and the join flow. |
| `teams/` | Team / player name rules and the names modal. |
| `details/` | The Match Details modal, momentum graph and advanced stats. |
| `sharing/` | Share text, the shareable score-card image and the Web Share / clipboard flow. |
| `qr/` | The court QR panel: link, rendering, drag / resize, handle visibility. |
| `nfc/` | Web NFC scanning, cooldown and the tag format parser. |
| `admin/` | Admin authentication, the dashboard, court and device management. |
| `shell/` | Application-level wiring that spans features: hotkeys, scoreboard controls, the settings modal and viewport-resize upkeep. |

## Dependency rules

`scripts/check-frontend-structure.mjs` enforces these rules in CI.

| Layer | May import |
| --- | --- |
| `config/` | nothing |
| `utils/` | `config/` |
| `state/` | `config/`, `utils/` |
| `firebase/` | `config/`, `firebase-config.js` |
| `audio/`, `lifecycle/` | `config/`, `utils/`, `state/` |
| `ui/` | `config/`, `utils/`, `state/`, `audio/`, `lifecycle/`, `brand.mjs` |
| features (`routing/`, `scoring/`, `court/`, `teams/`, `details/`, `sharing/`, `qr/`, `nfc/`, `admin/`, `shell/`) | any layer above, any feature, `brand.mjs`, `scoreSync.mjs` |
| `main.js` | anything |
| `script.js` | `main.js` only |

Additionally:

- Only `firebase/` (and the `firebase.js` re-export) imports the Firebase SDK,
  and only `sharing/` imports html-to-image. Feature code calls repository and
  callable functions instead (`getCourt`, `addCourtEvent`, `updateScoringOptions`, ...).
- **No import cycle may span directories.** Modules inside one directory may
  depend on each other cyclically (they are one feature); a cycle across
  directories is an architectural error. Break it by inverting the dependency
  in the composition root, as `routing/history.js` does with
  `bindViewController()`.
- Modules have **no DOM side effects at import time**. The exceptions are
  deliberate: `firebase/` initialises the Firebase SDK, `brand.mjs` publishes
  `globalThis.PadelPushBrand` and `scoreSync.mjs` injects one style element.
  Listeners are registered by `register*()` / `init*()` functions that
  `main.js` calls.

## Composition root

`app/js/main.js` imports the feature modules and starts them:

1. At module evaluation it installs the changeover behaviour (which must own
   the changeover button's click first and hook history before the first
   navigation), registers the `DOMContentLoaded` handler and the
   document-level input guards.
2. On `DOMContentLoaded` it reads state from storage, looks up the DOM
   (`initElements()`), registers every feature's listeners, starts the router
   for the current URL and renders the initial scoreboard.

**Ordering contract.** The order in `startApplication()` reproduces the order
in which the former monolith registered listeners on shared targets
(`document`, `window`, `visualViewport`), created observers and mutated the
DOM. Listener order on a shared target decides which handler runs first, and
a `MutationObserver` only sees mutations made after it starts observing. When
you add a registration, put it where it belongs in that sequence; listeners on
an element nobody else listens to can go in the feature's existing
`register*()` function.

## State

State that more than one module reads or writes lives in a plain object in
`state/`:

| Object | Holds |
| --- | --- |
| `session` (`sessionState.js`) | The open court: id, name, score, scoring options, team / player names, password, mode (player / spectator), score version, changeover flags, match-details caches. |
| `appState` | Device id, admin flag, mute, NFC permission, court lists, the selected Play court, the court / device being edited. |
| `navigationState` | The app's mirror of the history stack and the court-session counter that expires modal history entries. |
| `themeState` | Light mode, waves, server badge, per-theme team colours (persisted in `localStorage`). |
| `adminSessionState.js` | Functions over the admin session flag (`sessionStorage`) and the cross-tab logout signal. |

Rules:

- State objects hold data only; behaviour lives in the feature that owns the
  state change (for example `court/session.js` resets `session` when a court is
  entered or left).
- State used by one module only stays a module-level variable in that module.
- Values read from storage are assigned during boot (`initThemeState()`,
  `initAdminSession()`, `initDeviceIdentity()`), not at import time.

## Routing

| Path | View |
| --- | --- |
| `/` | menu |
| `/c`, `/court` | spectate court list |
| `/c/{courtId}`, `/court/{courtId}` | spectate that court |
| `/p`, `/play` | play court list |
| `/p/{courtId}`, `/play/{courtId}` | join prompt over the court's spectator view |
| `/admin`, `/app/admin` | admin dashboard (through admin authentication) |

Every path also works under `/app/`. Firebase Hosting rewrites them all to
`/app/index.html` (`firebase.json`).

- `routing/routeParsers.js` - pathname -> view state, view state -> URL (pure
  when given a pathname).
- `routing/viewState.js` - the view-state model (`{ page, courtId, modal, ... }`).
- `routing/history.js` - `pushState` / `replaceState` / `back`, the navigation
  stack, `syncCurrentViewState()` and `stepBackInApp()`.
- `routing/viewController.js` - reads the current view state from the visible
  DOM and restores a requested view state onto the DOM.
- `routing/router.js` - deep links on startup, `popstate`, opening courts from a
  route and Escape-key back navigation.

Features record a navigation step by calling `syncCurrentViewState()` after
changing what is visible, and go back with `stepBackInApp(fallbackViewState)`.

## Firebase boundary

- `firebase/client.js` reads `app/js/firebase-config.js` (generated at deploy
  time from a secret; copy `firebase-config.template.js` for local use) and
  initialises the app, Firestore and the optional emulator connection.
- `firebase/courtRepository.js` - `courts/{courtId}`, its `score/current` and
  its `events` (reads, writes, listeners). Functions return SDK snapshots
  unchanged.
- `firebase/deviceRepository.js` - `devices/{deviceId}`.
- `firebase/adminRepository.js` - the admin key in `admin/goodies`.
- `firebase/callables.js` - `resetCourt`, `changeoverCourt`,
  `updateScoringOptions`, `getDetailedScore` (africa-south1).

Firebase modules never touch the DOM, toasts, audio or history. Reactions to
Firestore events live in the features: `court/courtSync.js` for the court and
score listeners and `scoring/changeover.js` for changeover events.

## Scoring, UI and features

- **Scoring.** `scoring/actions.js` writes `POINT_TEAM_A` / `POINT_TEAM_B` /
  `UNDO` events; the backend engine computes the score and the live listener
  (`court/courtSync.js`) stores it in `session.score`; `scoring/scoreboard.js`
  renders it. `scoring/presentation.js` only decides how a score is displayed
  (point labels, server, critical points).
- **Changeover.** `scoring/changeover.js`: callable -> court snapshot
  listener -> `punto:changeover` / `punto:changeover-processing` window events
  -> `session` -> Switch Views and settings tiles -> toast and clash sound.
- **UI systems.** `ui/dom.js` exposes `elements` (populated once by
  `initElements()`) and `$()`. Toasts, loading overlays, the confirm modal,
  theme / appearance and fullscreen each have one module.
- **Admin.** `admin/admin.js` (authentication, dashboard, tabs),
  `admin/courts.js` (court list, create / edit / delete), `admin/devices.js`
  (device list and the add / edit forms).
- **Sharing.** `sharing/sharePayload.js` builds the share text,
  `sharing/imageCapture.js` renders the 1080x1350 score card when Match Details
  finishes rendering, and `sharing/share.js` tries Web Share (with the image,
  then text only), the clipboard, then a prompt.
- **NFC.** `nfc/parser.js` defines the tag format
  (`EVENT:SPECTATE;COURTID:abcd`, or a bare event type); `nfc/nfc.js` owns the
  reader, the scan cooldown and dispatching tag events.
- **QR.** `qr/courtQr.js` builds `{origin}/c/{courtId}` (printed codes depend on
  this format) and renders the panel; interaction and handle visibility are
  separate modules.

## OBS overlay

The overlay is a separate client. It is not part of the scoring app's module
graph and loads none of its modules. OBS browser sources load one
self-contained document with an inline classic script, so its sources are
assembled at build time instead of being loaded as modules:

```text
app/overlay/template.html    head, markup and the <style> / <script> shells
app/overlay/css/*.css        stylesheet parts, included in order inside <style>
app/overlay/js/*.js          script parts, included in order inside the inline
                             IIFE: settings, presentation, score, stats,
                             win-moments, render, apiClient, settingsPanel,
                             drag, main (boot)
```

The script parts share one function scope (the IIFE), so they are an
organisational split, not isolated modules: keep each part's top-level
statements in place and add new code to the part that owns the concern. The
overlay reads the public JSON API (`/revision`, `/score`, `/stats`,
`/momentum`); `/overlay` and `/broadcast` rewrite to `app/overlay.html`.

## HTML templates

`app/index.html` is generated from `app/templates/index.template.html`. A line
consisting only of

```html
    <!-- @include pages/menu.html -->
```

is replaced by the named file (resolved relative to the including file). The
included file keeps its own indentation and must end with a newline; includes
can nest (`global/controls.html` includes `appearance.html`). The build fails
on a missing or circular include.

The browser still receives one complete document - nothing is fetched at
runtime - so all DOM ids the modules look up at boot exist immediately.

## CSS

`app/css/style.css` is generated from the manifest `app/css/index.css`, which
lists the stylesheet parts with `@import "part.css";` lines. The parts are
concatenated in manifest order, and **that order is the cascade**. The parts
were cut from the former single stylesheet at section boundaries without
reordering any rule. When adding styles, put them in the part that owns the
component; only move rules between parts deliberately, knowing which rules
they may override.

## Build and generated files

```bash
node scripts/build-frontend.mjs          # regenerate app/index.html, app/overlay.html, app/css/style.css
node scripts/build-frontend.mjs --check  # fail if any generated file is stale
```

- Generated files start with a `GENERATED FILE - DO NOT EDIT` banner and are
  committed, so the repository always contains exactly what Hosting serves.
- CI fails when a generated file differs from a fresh build (edited directly,
  or sources changed without rebuilding).
- The build validates that every local asset the generated documents
  reference (`<script src>`, stylesheets, icons, images) exists, resolving
  relative URLs against `<base href="/app/">`.
- Deployment rebuilds after `scripts/configure-public-origin.mjs` has
  configured the environment (see [firebase-environments.md](firebase-environments.md)).

## Adding a feature

1. Decide which directory owns the behaviour (table above). Create a new
   directory only for a genuinely new responsibility, and add it to
   `FEATURE_LAYERS` in `scripts/check-frontend-structure.mjs`.
2. Add markup to the page or modal fragment under `app/templates/` and styles to
   the owning part under `app/css/` (or a new part in `index.css`), then run
   `node scripts/build-frontend.mjs`.
3. Look the new elements up in `ui/dom.js` (`initElements()`).
4. Put shared state in the appropriate `state/` object; keep the rest local.
5. Go through `firebase/` for any Firestore or callable access.
6. Export a `register...()` function for the listeners and call it from
   `startApplication()` in `main.js`, respecting the ordering contract.
7. Record navigation with `syncCurrentViewState()` if the change is a new
   view or modal, and teach `routing/viewController.js` to restore it.
8. Add unit tests for pure logic and an integration test through the harness.

## Tests

All frontend tests live in `functions/` and run with `npm test --prefix functions`.

- **Integration tests** (`frontend*.node-test.mjs` using
  `functions/frontendHarness/harness.mjs`) boot the real application in jsdom:
  the harness loads the generated `app/index.html`, inlines the generated
  stylesheet, imports the module entry point the document references and
  dispatches `DOMContentLoaded`. Firebase, the Firebase config and
  html-to-image are replaced by mocks through Node loader hooks
  (`frontendHarness/loaderHooks.mjs`); `mockFirestoreState.mjs` runs the real
  backend scoring engine against an in-memory Firestore. The app boots once
  per test file.
- **Unit tests** import pure modules directly and need no DOM:
  `frontendRouteParsing`, `frontendNames`, `frontendScoringPresentation`,
  `frontendNfcParser`, `frontendSharePayload`, `frontendUtils` (and
  `frontendToast` with its own small jsdom document).
- **Overlay tests** (`frontendOverlay.node-test.mjs`) load the generated
  `app/overlay.html` in jsdom with its inline script enabled.
- Tests assert behaviour - what is rendered, sent, stored or shared - rather
  than source text. Stylesheet and markup contracts are checked against the
  generated `style.css` and `index.html`.

## Validation commands

```bash
npm ci --prefix functions
node scripts/build-frontend.mjs --check     # generated files up to date
node scripts/check-frontend-structure.mjs   # layering, cycles, budgets, vendor files, references
npm run lint:frontend --prefix functions    # ESLint over app/js (no-undef)
npm test --prefix functions                 # Jest + node:test (backend, frontend, overlay)
npm run lint --prefix functions
npm run format:check --prefix functions
node scripts/check-branding.mjs
```

Size budget (structure check): under 600 lines is normal, 600-900 lines is
reported for review, over 900 lines fails unless the file is listed in
`SIZE_EXEMPTIONS` with a reason. Generated files and vendor files are exempt.

## Compatibility notes

- `app/js/script.js` only imports `main.js`. It exists for pages cached before
  the modular frontend was deployed, which still request `js/script.js`;
  without it Hosting's `/app/**` rewrite would answer that request with HTML
  and the cached page would fail to boot. It can be deleted once no client can
  still hold such a page.
- `app/js/firebase.js` re-exports the Firebase app, Firestore instance and SDK
  functions for `device-harness/script.js`.
- Hosting sends `Cache-Control: no-cache, no-store, must-revalidate` for
  `/app/js/**`, `/app/css/**`, `/app/index.html` and `/app/overlay.html`, so
  modules are never mixed across deploys.
