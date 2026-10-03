# Frontend restructure — refactor log

This log records how the frontend restructure was carried out, so reviewers can
check the claim it rests on: the application behaves exactly as before, while
its source is organised by responsibility. The resulting architecture is
documented in [frontend-architecture.md](frontend-architecture.md).

## Baseline

Captured on the refactor starting point (`main` at `e10fc84`, Node 22.22.0)
before any frontend file was changed:

| Check | Command | Result |
| --- | --- | --- |
| Jest suites | `npm test --prefix functions` (Jest part) | 4 suites, 241 tests passed |
| Node/jsdom suites | `npm test --prefix functions` (`node --test` part) | 131 tests passed, 0 failed |
| Lint | `npm run lint --prefix functions` | passed |
| Format | `npm run format:check --prefix functions` | passed |
| Branding | `node scripts/check-branding.mjs` | **failed** (pre-existing): `app/js/script.js` contained two untrademarked "Padel Push" strings (a code comment and the share-logo load error message) |

Notes on the baseline:

- `functions/frontendAudio.node-test.mjs` exists but is not part of
  `npm test`; run on its own it passed (1 test).
- The branding check is not run by CI, which is how the pre-existing failure
  went unnoticed.

## Phases and commits

The plan's phases were grouped into six commits on top of `e10fc84`. Each
commit leaves the application working and every check passing.

| Commit | Plan phases | What changed |
| --- | --- | --- |
| `0f88aeb` Add frontend build and structure guardrails | 1 | `scripts/build-frontend.mjs` (include/manifest assembly, `--check`, reference validation) and `scripts/check-frontend-structure.mjs` (layer rules, cycles, size budget, vendor integrity, references), with legacy exemptions for the files not yet split; CI runs both; this baseline record |
| `5419e30` Split the scoring app into responsibility-based ES modules | 2-7 | The 10,021-line `app/js/script.js` closure and the 276-line `app/js/firebase.js` became 78 native ES modules under `app/js/` with `main.js` as the composition root; the Firebase boundary (`firebase/`); changeover UI moved out of `firebase.js` into `scoring/changeover.js`; source-text tests replaced by behavioural ones; unit tests for the pure modules; ESLint `no-undef` over `app/js` in CI |
| `ec23d17` Split the app stylesheet into ordered source files | 9 | The 6,557-line `app/css/style.css` is generated from `app/css/index.css` and its parts |
| `a3213f2` Assemble app/index.html from source templates | 8 | The 946-line `app/index.html` is generated from `app/templates/` (page and modal fragments) |
| `f75ce99` Give the OBS overlay its own source files | 10 | The 3,693-line `app/overlay.html` is generated from `app/overlay/` (template, CSS parts, script parts); the last size exemption was removed |
| `7a170fe` Build and validate the frontend before every deploy | 11 | Both deploy jobs build and validate the frontend and lint it before the tests; Hosting no-cache headers for the new layout; branding tooling works on sources; the branding check runs in CI |
| (this commit) | 12 | `README.md`, [frontend-architecture.md](frontend-architecture.md), architecture docs and diagrams, this log |

## How behavioural equivalence was verified

The restructure must not change behaviour. Four independent methods were used.

### 1. Differential behavioural harness

A throwaway harness (not committed; it exists only to compare two trees) booted
the baseline tree and the refactored tree in the same jsdom harness with the
same mocked Firebase backend, and drove both through six scripted scenarios:
the menu, the spectate route, the play route, menu-to-play navigation, the
admin portal and NFC scanning. That is 101 steps covering theme and appearance
controls, court passwords, scoring, undo, set wins, changeover, reset, match
details, player names, sharing, the QR panel, hotkeys, browser back / forward,
admin login, court and device editing, and NFC tag routing.

After every step it recorded the full serialised DOM, URL, title, history
length and state, localStorage and sessionStorage. Throughout the run it also
recorded:

- every `addEventListener` call, per target and in order;
- every `on*` property assignment;
- every MutationObserver;
- every `history` call;
- console output, toasts and the final Firestore state.

The comparison treats only two differences as intended:

- the script tag now loads `js/main.js`;
- the generated-file banner.

Result: **IDENTICAL** after the module split, after each of the CSS, HTML and
overlay phases, and on the final tree.

The harness found two real defects during the work, and both were fixed before
committing:

- template-literal whitespace drifted during the module extraction;
- a timing race, which the harness itself had caused, at the startup-spinner
  threshold.

### 2. Byte-identical rebuilds

Each generated file was compared with the hand-written original it replaced.
The first build of each, from its new sources, was byte-identical to the
original apart from the one-line `GENERATED FILE` banner. This holds for
`app/css/style.css`, `app/index.html` and `app/overlay.html`, so the
browser receives the same markup and the same cascade.

### 3. New tests checked against the original code

Some tests used to search `script.js` with regular expressions. They were
rewritten to assert behaviour: `frontendShareImage`, `frontendQrPanelResize`
and `frontendEngagementAnimations`. Each rewritten test was also run against
the **baseline** tree to confirm that it encodes the original behaviour rather
than the new code: 33 of the 34 tests pass there.

The remaining test, "the mobile-device class follows mobile detection", imports
`lifecycle/deviceIdentity.js` directly. That function was not reachable from
outside the original closure, so the test cannot run against the baseline.
The same behaviour is covered against the baseline by the differential
harness.

### 4. Deploy simulation

The staging deploy sequence was run in a clean worktree of the committed tree:

1. `configure-public-origin.mjs` with a staging origin;
2. build, then `build --check`;
3. the structure check, frontend lint and `npm test`.

All of it passed. The generated `app/index.html` carried only the configured
origin, with 4 references to it and none to the production origin.

## Final results

On the final tree, Node 22.22.0:

| Check | Result |
| --- | --- |
| `node scripts/build-frontend.mjs --check` | passed, all 3 generated files up to date |
| `node scripts/check-frontend-structure.mjs` | passed, 78 modules, 0 warnings |
| `npm run lint:frontend --prefix functions` | 0 errors, 9 warnings (see below) |
| `npm run lint --prefix functions` | passed |
| `npm run format:check --prefix functions` | passed |
| `node scripts/check-branding.mjs` | passed (it failed at baseline) |
| Jest suites | 4 suites, 241 tests passed, the same as baseline |
| Node/jsdom suites | 168 tests passed, 0 failed, against 131 at baseline |
| Differential harness | IDENTICAL |
| Mermaid diagrams in `docs/` | all five render in Chromium with Mermaid 11 |

The net increase of 37 Node tests is made up as follows:

- **+43:** unit tests for the extracted pure modules (route parsing, names,
  scoring presentation, the NFC parser, the share payload, utilities) and the
  toast tests;
- **+1:** the existing `frontendAudio` suite, now part of `npm test`;
- **+1:** a Hosting header coverage test in `endpointRoutes`;
- **-8:** the three rewritten suites went from 42 to 34 cases, because
  several source-text assertions about one behaviour became a single
  behavioural test.

## Deviations and decisions

- **`app/js/script.js` is kept as a one-line shim** (`import "./main.js";`).
  Cached copies of the old `app/index.html` load `js/script.js`; the shim
  boots the same application instead of a 404. The structure check fails if
  the shim gains anything but imports. It can be deleted once old documents
  have expired from caches.
- **Overlay script parts are build-time fragments, not ES modules.** OBS
  browser sources and the overlay's jsdom tests run it as one inline classic
  script, and turning it into modules would change load timing and global
  scope. The parts are concatenated in order inside the overlay's inline
  `<script>` element. They share one script scope, as before, and each part's
  header says what it owns.
- **CSS and template parts are named by what they contain** (pages,
  components, global fragments), not by the exact file names in the plan's
  illustrative tree. Each part is a contiguous region of the original file in
  its original order. The cascade is therefore unchanged, and some parts hold
  rules the plan's tree would have placed elsewhere.
- **An extra `shell/` feature directory** holds application-level wiring
  that spans several features: hotkeys, the scoreboard controls, the settings
  modal and viewport-resize upkeep. That wiring imports from many features, so
  putting it in `ui/` would break the rule that `ui/` does not import
  features, and putting it in `main.js` would give the composition root
  feature behaviour.
- **`app/js/firebase.js` remains** as a thin re-export of
  `firebase/client.js` and the SDK, because `device-harness/` imports it.
  The changeover hooks used to be defined in `firebase.js`. They were inert in
  the Device Lab, which has no changeover UI, and the harness no longer
  receives them.
- **Branding:** at baseline the branding check failed, and
  `build-branding.mjs` had a syntax error and doubled the trademark sign in
  `mailto:` subjects. Both scripts were rewritten to work on the sources and
  to be idempotent. The two untrademarked strings flagged at baseline (a
  comment and the share-logo error message) were fixed; the error message
  now uses `BRAND.name`.
- **The 9 `no-unused-vars` warnings** reported by `lint:frontend` were
  present in the original code, and the baseline `app/js` gives the same 9
  warnings. Removing them is a code change, so they were left for a separate
  change.

## Not verified here

- **The app in the staging deployment.** The push of this branch ran the
  staging job in `deploy.yml` successfully: build, structure check,
  frontend lint, tests, deploy and the public-endpoint smoke tests. Those
  smoke tests cover the JSON API, not the web app, so the deployed app has
  not been exercised.
- **Manual visual checks in real browsers and OBS.** The equivalence
  evidence above means a visual change is unlikely: the generated CSS and
  markup are byte-identical, and the DOM is identical at every scripted step.
  It is not a substitute for a manual check of the main screens before
  merging, especially on mobile Safari and in OBS.

## Follow-ups

- **Rewritten document routes are not marked no-cache.** Hosting header
  globs match request paths, so `/app/index.html` is no-cache but routes
  rewritten to it, such as `/c/{courtId}` and `/court/**`, still get the
  default caching. This was the same before the refactor; covering them
  needs header entries for those routes.
- **Branches share one staging site.** `deploy.yml` deploys every non-main
  branch straight to the staging project. It creates no Hosting preview
  channel and never has. The docs that described a 7-day branch preview
  (`firebase-environments.md`, `api.md`, `business-processes.md`) were
  corrected. If per-branch isolation is wanted, the staging job would need
  `firebase hosting:channel:deploy` for Hosting; Functions would still be
  shared.
- **The `script.js` shim can be removed** once cached pages that reference
  it have expired.
