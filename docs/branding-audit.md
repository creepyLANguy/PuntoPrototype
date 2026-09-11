# Padel Push branding audit

Audit of customer-facing product naming and tagline/copy in `main` before centralisation.

## Brand-name variants found

The repository currently uses these meaningful brand-name variants:

| Variant | Context | Locations |
|---|---|---|
| `Padel Push` | Normal product name | `index.html`, `app/index.html`, `app/overlay.html`, `nfc/index.html`, `app/js/script.js`, API/docs and diagrams |
| `PADEL PUSH` | Uppercase visual lock-up | `index.html` landing-page navigation and hero |
| `PadelPush` | JavaScript identifier / storage-key form | e.g. `padelPushOverlaySettings:` in overlay tests; this is a technical identifier, not customer-facing copy |
| `padelpush` | Domain/URL form | `www.padelpush.co.za`, `qa.padelpush.co.za`, email address, API examples and deployment configuration; this is intentionally not treated as display branding |

Examples confirmed by repository search include the API docs, landing page, NFC page, app page, overlay, public API docs, deployment configuration and frontend tests. fileciteturn0file0L2-L10 fileciteturn8file2L36-L43 fileciteturn8file6L100-L109 fileciteturn8file7L123-L130 fileciteturn5file7L110-L117

## Taglines / brand-level positioning copy found

### 1. Primary landing-page tagline

`Smart devices. Live scoring. Connected courts.`

Location: `index.html`, hero lead. fileciteturn12file0L2-L8

### 2. Landing-page title positioning

`Smart Scoring for Modern Padel Clubs`

Used in the HTML title and social title alongside the brand name. fileciteturn2file0L8-L15

### 3. Landing-page meta description

`The connected smart court ecosystem with portable scoring devices, live scoreboards, and scalable tools for modern padel clubs.`

Used as the landing page description. fileciteturn13file0L2-L8

### 4. Landing-page social description

`Smart devices, live scoring, and connected tools for modern padel clubs.`

Used as the Open Graph description. fileciteturn7file0L2-L9

### 5. App title / positioning

`Live Scoreboard`

Combined with the brand as `Padel Push - Live Scoreboard`. fileciteturn7file7L121-L128

### 6. App description

`Padel Push — Live padel scoring system. Track points, games, sets, and matches in real-time.`

A closely related Open Graph version omits the brand and uses `real time` rather than `real-time`. fileciteturn14file0L2-L21

### 7. App social alt text

`Padel Push - Live padel scoring`

Confirmed in `app/index.html`. fileciteturn7file7L121-L128

### 8. Overlay branding

The overlay has a configurable `brandText` / `brandLogo`, but its fallback currently hard-codes `Padel Push`. fileciteturn15file0L8-L13

The default sponsor copy also contains `Padel Push` and `padelpush.co.za`. fileciteturn7file14L233-L241

## Central definition introduced on this branch

`app/js/brand.js` is now the canonical source for the display name and the identified brand-level/tagline copy:

- `BRAND.name`
- `BRAND.displayName`
- `BRAND.taglines.primary`
- `BRAND.taglines.landingTitle`
- `BRAND.taglines.landingDescription`
- `BRAND.taglines.landingSocialDescription`
- `BRAND.taglines.appTitle`
- `BRAND.taglines.appDescription`
- `BRAND.taglines.appSocialDescription`
- `BRAND.taglines.appSocialAlt`
- `BRAND.taglines.landingSocialAlt`

Technical identifiers and infrastructure URLs such as `padelPushOverlaySettings`, `www.padelpush.co.za`, `qa.padelpush.co.za`, and `info.padelpush@gmail.com` should remain independent from display-brand configuration.

## Recommended follow-through

The remaining hard-coded customer-facing occurrences should be migrated to `BRAND` consumers. In particular:

1. Landing-page HTML metadata and visible brand copy in `index.html`.
2. App HTML metadata in `app/index.html`.
3. Overlay fallback/sponsor branding in `app/overlay.html`.
4. Generated/share text in `app/js/script.js`.
5. NFC page copy in `nfc/index.html` where applicable.
6. Any customer-facing documentation/diagrams where the product name is intended to be rendered rather than merely describing architecture.

Infrastructure URLs and stable technical identifiers should not be mechanically replaced with display-brand constants.
