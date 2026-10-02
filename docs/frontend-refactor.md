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
