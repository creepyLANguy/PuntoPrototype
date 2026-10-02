# Platform architecture

## Current implementation

The repository is a court-centric scoring platform. A court document is the configuration and active match container; there is no separate match document or public matchId.

The runtime sequence is visualized in [PP_Runtime_Flow.mmd](PP_Runtime_Flow.mmd).

### Application and clients

    Browser web app (native ES modules, entry app/js/main.js)
      |-- firebase/ repositories -> courts/{courtId}
      |-- firebase/ repositories -> devices/{deviceId}
      |-- firebase/ repositories -> courts/{courtId}/events/{eventId}
      |-- onSnapshot <- courts/{courtId}/score/current
      |-- firebase/callables -> resetCourt / changeoverCourt / updateScoringOptions / getDetailedScore
      |
      +-- public routes /c/{courtId}, /p/{courtId}, /overlay, /nfc, /admin

    Physical devices
      |-- firmware source -> ProtoSketches repository
      |-- POST /postEvent (HTTP Cloud Function, africa-south1)
      |-- Beacon point events are mapped using courts/{courtId}.beaconSidesSwapped
      +-- effective event -> courts/{courtId}/events/{eventId}

    Device Lab
      |-- admin-gated diagnostic harness
      |-- local/branch workflows use staging
      +-- explicit acknowledgement before production mutations

### Firebase runtime

All current Cloud Functions run in africa-south1:

- device ingestion (postEvent);
- callable functions;
- Firestore event trigger (onEventCreate);
- public JSON read functions.

Firebase Hosting remains global/CDN-based. Public JSON paths redirect to the Johannesburg functions because Firebase Hosting does not support a direct function rewrite to africa-south1.

## Web client module boundaries

The scoring web app is a set of native ES modules under `app/js/`, separated
by responsibility. The full developer guide is
[frontend-architecture.md](frontend-architecture.md); in summary:

- **Composition root.** `app/js/main.js` is the module entry point loaded by
  `app/index.html`. It wires the modules together and starts them in a fixed
  order; it contains no feature behaviour.
- **State ownership.** Cross-module state lives in plain objects in
  `app/js/state/`: the open court session (`session`), application state
  (`appState`), navigation history (`navigationState`) and appearance
  preferences (`themeState`). Each state change is made by the feature that
  owns it.
- **Routing.** `app/js/routing/` owns URL parsing, view states, browser history
  and restoring a view onto the DOM; deep links, back / forward and modal
  history entries go through it.
- **Firebase boundary.** `app/js/firebase/` initialises Firebase and is the only
  code that calls the Firestore SDK or the callables (court, device and admin
  repositories plus `callables.js`). It owns no UI behaviour.
- **Scoring boundary.** `app/js/scoring/` sends score events and presents the
  score the backend engine computed; the backend remains the authoritative
  scoring engine. `app/js/court/` owns the court session and its live sync.
- **UI boundary.** `app/js/ui/` provides the reusable UI systems (DOM lookup,
  toasts, loading overlays, modals, theme and appearance, fullscreen); each
  module documents the part of the DOM it owns.
- **Admin boundary.** `app/js/admin/` owns admin authentication and court /
  device management, using the same shell and router.
- **Sharing, QR and NFC.** `app/js/sharing/` (share text, score-card image,
  Web Share / clipboard), `app/js/qr/` (court QR panel) and `app/js/nfc/` (Web
  NFC scanning and the tag-format parser).
- **Overlay.** `app/overlay.html` is a separate, self-contained client that
  reads the public JSON API; its sources live in `app/overlay/`.
- **Build.** `scripts/build-frontend.mjs` assembles the generated documents
  (`app/index.html`, `app/overlay.html`) and the generated stylesheet
  (`app/css/style.css`) from their sources. It does not bundle or transpile;
  CI and every deployment rebuild and validate the frontend before tests run.

## Physical product boundary

### Current repositories

- PuntoPrototype: web application, admin tooling, backend, API, Device Lab and deployment configuration.
- ProtoSketches: ESP32 firmware prototypes for Hub, Beacon and Pulse.

### Outside the repositories

The following are not yet managed end-to-end by the repositories:

- production BOM and approved hardware revision;
- PCB/Gerbers release control;
- enclosure production drawings;
- manufacturing execution;
- serialisation/inventory system;
- secure factory provisioning;
- packaging/labels/fulfilment;
- formal regulatory/compliance records.

These are business/operations processes, not missing source-code modules.

## Functions module boundaries

The Cloud Functions implementation is separated between composition, domain logic and infrastructure:

- functions/index.js is the Firebase composition root.
- functions/domain/scoring/ contains scoring rules and scoring-option helpers.
- functions/domain/events/ contains event validation and ordering.
- functions/domain/stats/ and functions/domain/momentum/ contain pure analytics calculations.
- functions/services/ contains persistence, replay, checkpoint, device-event and public API orchestration.
- functions/callables/, functions/http/ and functions/triggers/ contain thin Firebase entry handlers.
- functions/infrastructure/ centralizes Firebase Admin access and shared API-cache behaviour.

## Current data and mutation boundaries

- The web app uses the Firebase Web SDK (through its `app/js/firebase/` repositories) for court reads, court creation/edit/delete, device reads/updates, event writes and score listeners.
- Callable functions present are resetCourt, changeoverCourt, updateScoringOptions and getDetailedScore.
- The public JSON endpoints are intentionally unauthenticated read surfaces.
- postEvent currently identifies a device through deviceId and its current devices/{deviceId}.courtId binding.
- Cloud Functions use the Admin SDK, so Firestore security rules do not constrain those server-side writes.
- The repository's Firestore rules are documented as emulator-only; the current CI deployment workflow deploys Hosting and Functions, not Firestore rules or indexes.
- The current callable implementations do not perform explicit request.auth authorization checks.

## Device behaviour boundaries

| Device | Current firmware responsibility | Platform responsibility |
|---|---|---|
| Hub | NFC parsing, Wi-Fi configuration, operational commands, scoring controls | Validate/bind device, append events, update court state |
| Beacon | Distance detection, team selection, scoring event transmission | Apply Beacon side mapping and scoring |
| Pulse | Button input, local team selection, scoring/undo transmission | Interpret scoring event and update score |

The shared event protocol is intentionally narrow; device-specific physical behaviour remains in firmware.

## Cache architecture

Public endpoints use two cache layers:

- Firebase Hosting/CDN HTTP caching.
- Per-court in-memory function caches.

Current implementation TTLs:

- /score: 4 seconds
- /revision: 4 seconds
- /stats: 10 seconds
- /momentum: 5 seconds

The /revision endpoint exists so polling clients can detect a changed score revision before fetching the larger score payload.

## Replay architecture

The event log is the authoritative scoring history for the active court. courts/{courtId}/score/current is a materialized view for live display. Checkpoints are replay accelerators.

RESET handling currently:

1. archives the current event stream;
2. deletes active events and checkpoints;
3. resets score/current;
4. increments scoreVersion;
5. resets beaconSidesSwapped to false.

UNDO and out-of-order events trigger replay where required. Normal scoring uses a compatible checkpoint when safe.

## Operational security status

The current repository is suitable as a controlled development/prototype platform but has explicit production-hardening work remaining:

- cryptographic device authentication;
- timestamp/nonce freshness;
- client-generated event IDs and idempotency;
- explicit callable authorization/RBAC;
- rate limiting/abuse controls;
- production telemetry/correlation;
- formal manufacturing credential provisioning.

Those are documented targets, not current guarantees.
