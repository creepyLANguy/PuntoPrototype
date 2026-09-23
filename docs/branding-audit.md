# Padel Push™ branding audit

## Canonical definition

`app/js/brand.mjs` is the single source of truth for customer-facing brand identity.

- Display name: `Padel Push™`
- Display wordmark: `PADEL PUSH™`
- Single tagline: `Smart scoring. Connected courts. One platform.`

`app/js/brand.js` is only a compatibility re-export.

## Customer-facing surfaces updated

| Surface | Files | Changes |
|---|---|---|
| Landing page | `index.html` | Brand name, wordmark, page title, descriptions, social alt, visible tagline, accessibility labels, email subject text and footer |
| Scoring app | `app/index.html`, `app/js/script.js` | Brand name, alt text, share text and dynamic page titles |
| Score overlay | `app/overlay.html` | Overlay title, displayed brand, default text, sponsor copy and theme label |
| NFC tool | `nfc/index.html` | Title and attribution |
| API docs | `docs/api.md`, `docs/api/openapi.yaml` | User-facing product name |
| Architecture diagrams | `docs/PP_Basic_Flow.mmd`, `docs/PP_Architecture.mmd` | Product name |
| CSS | `app/css/style.css` | Brand-specific developer comment removed |

## Tagline

The former primary tagline `Smart devices. Live scoring. Connected courts.` has been removed.

The only brand tagline is now `Smart scoring. Connected courts. One platform.`

`Smart Scoring for Modern Padel Clubs`, `Live Scoreboard`, `Score Overlay`, and the page descriptions remain functional/SEO descriptors, not secondary taglines.

## Technical forms intentionally unchanged

- `padel_push_accessible_v1` — persisted NFC localStorage key
- `padelPushOverlaySettings:` — persisted overlay settings key
- `themePreset: "padelpush"` — internal overlay enum/key

Per scope, these are also untouched:

- Domains and domain URLs
- Email addresses
- `media/logo.svg`
- `media/favicon.svg`
- `media/social-preview.png`

## Tooling

Run `node scripts/build-branding.mjs` after changing the canonical brand values.

Run `node scripts/check-branding.mjs` to verify that no untrademarked customer-facing brand name or legacy primary tagline remains.
