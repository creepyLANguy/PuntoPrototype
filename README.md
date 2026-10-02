# Padel Push™

Court-centric padel scoring platform: the web scoring app, admin tooling, the
OBS score overlay, the public JSON API, Cloud Functions and the Device Lab.
Device firmware lives in the separate ProtoSketches repository.

## Repository layout

| Path | Contents |
| --- | --- |
| `index.html`, `style.css` | Public landing page |
| `app/` | Scoring web app and OBS overlay (see below) |
| `functions/` | Cloud Functions, scoring engine and all automated tests |
| `nfc/` | NFC tag tool |
| `device-harness/` | Admin-gated Device Lab |
| `scripts/` | Build, validation and environment-configuration scripts |
| `docs/` | Architecture, API, data model and process documentation |

## Frontend workflow

The scoring app is native ES modules with no bundler. Some files the browser
loads are **generated** from sources and committed:

| Generated (do not edit) | Edit instead |
| --- | --- |
| `app/index.html` | `app/templates/` (`index.template.html` and its fragments) |
| `app/overlay.html` | `app/overlay/` (`template.html`, `css/`, `js/`) |
| `app/css/style.css` | `app/css/index.css` and the parts it imports |

JavaScript is not generated: edit the modules under `app/js/` directly. The
entry point is `app/js/main.js`.

After changing a template, overlay source or stylesheet part, rebuild and
commit the sources together with the regenerated files:

```bash
npm ci --prefix functions                  # once
node scripts/build-frontend.mjs            # regenerate the generated files
```

CI fails if a generated file is out of date with its sources.

### Checks

These are the checks CI runs:

```bash
node scripts/build-frontend.mjs --check    # generated files up to date
node scripts/check-frontend-structure.mjs  # module layering, cycles, file-size budget, vendor files
npm run lint:frontend --prefix functions   # ESLint over app/js
node scripts/check-branding.mjs            # canonical brand usage
npm test --prefix functions                # backend, frontend (jsdom) and overlay tests
npm run lint --prefix functions
npm run format:check --prefix functions
```

## Documentation

- [Frontend architecture](docs/frontend-architecture.md): module boundaries,
  dependency rules, templates, CSS, build and tests.
- [Platform architecture](docs/architecture.md) and
  [runtime flow](docs/PP_Runtime_Flow.mmd).
- [Firebase environments](docs/firebase-environments.md): local
  configuration, staging/production and the deployment pipeline.
- [API](docs/api.md), [data model](docs/data-model.md),
  [scoring](docs/scoring.md), [device protocol](docs/device-protocol.md).
- [Frontend refactor log](docs/frontend-refactor.md): how the modular
  restructure was carried out and verified.
