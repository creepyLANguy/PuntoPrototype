# Frontend architecture

> Status: the frontend restructure is in progress. This document currently
> covers the build and the structural guardrails; it is extended as each
> subsystem is extracted. See [frontend-refactor.md](frontend-refactor.md).

## Build

`scripts/build-frontend.mjs` assembles the generated Hosting artifacts from
their sources. It never bundles or transpiles: the browser receives the same
documents and native ES modules it always has.

```bash
node scripts/build-frontend.mjs          # regenerate every artifact
node scripts/build-frontend.mjs --check  # fail if an artifact is stale
```

## Structural guardrails

`scripts/check-frontend-structure.mjs` runs in CI and enforces:

- generated files are up to date with their sources;
- third-party minified assets (`app/js/jscolor.min.js`, `app/js/qrcode.min.js`)
  are unmodified and excluded from size budgets;
- module directories only import the layers they are allowed to;
- `app/js/script.js` does not grow back into an implementation;
- no import cycle spans module directories;
- source files stay inside the size budget (under 600 lines normal,
  600–900 review required, over 900 fails unless exempted);
- every HTML include resolves and every local asset referenced by
  `app/index.html` and `app/overlay.html` exists.
