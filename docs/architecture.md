# Platform architecture

## Current implementation

Padel Push is a match-based scoring platform with physical courts and optional
tournaments. A court is a physical resource and device location. A match is the
durable scoring identity. A tournament orchestrates normal Padel Push matches.

The runtime sequence is visualized in [PP_Runtime_Flow.mmd](PP_Runtime_Flow.mmd).

### Application and clients

    Browser scoring app (native ES modules, entry app/js/main.js)
      |-- firebase/ repositories -> courts/{courtId}
      |-- firebase/ repositories -> matches/{matchId}
      |-- firebase/ repositories -> matches/{matchId}/events/{eventId}
      |-- firebase/ repositories -> matches/{matchId}/score/current
      |-- firebase/ repositories -> devices/{deviceId}
      |-- firebase/ repositories -> clubs/{clubId} (read only)
      |-- firebase/callables -> manageMatch / manageTournament
      |-- firebase/callables -> resetCourt / changeoverCourt / updateScoringOptions / getDetailedScore
      |-- firebase/callables -> createClub / updateClub / deleteClub
      |
      +-- public routes /c/{courtId}, /p/{courtId}, /m/{matchId}, /t/{tournamentId}, /overlay, /nfc, /admin

    Tournament pages
      |-- /t                -> tournament landing
      |-- /t/new            -> setup wizard
      |-- /t/{id}           -> public dashboard or host control room
      |-- manageTournament  -> server-authoritative host operations
      +-- read models       -> tournamentViews / tournamentPrivateViews / tournamentDirectory

    Physical devices
      |-- firmware source -> ProtoSketches repository
      |-- POST /postEvent (HTTP Cloud Function, africa-south1)
      |-- device court binding decides the acting physical court
      |-- Beacon point events are mapped using courts/{courtId}.beaconSidesSwapped
      +-- effective scoring event -> matches/{matchId}/events/{eventId}

    Device Lab
      |-- admin-gated diagnostic harness
      |-- local/branch workflows use staging
      +-- explicit acknowledgement before production mutations

### Firebase runtime

All current Cloud Functions run in africa-south1:

- device ingestion (postEvent);
- callable functions, including manageMatch and manageTournament;
- Firestore event trigger (onEventCreate);
- Firestore delete triggers (onCourtDeleted, onDeviceDeleted) that keep club member lists clean;
- public JSON read functions.

Firebase Hosting remains global/CDN-based. Public JSON paths redirect to the
Johannesburg functions because Firebase Hosting does not support a direct
function rewrite to africa-south1.

## Web client module boundaries

The scoring web app is a set of native ES modules under `app/js/`, separated
by responsibility. The full developer guide is
[frontend-architecture.md](frontend-architecture.md); in summary:

- **Composition roots.** `app/js/main.js`, `app/js/matchPage.js` and
  `app/js/tournamentPage.js` wire the scoring, match and tournament entry
  documents.
- **State ownership.** Cross-module state lives in plain objects in
  `app/js/state/`: the open court/match session (`session`), application state
  (`appState`), navigation history (`navigationState`), appearance preferences
  (`themeState`) and local admin/host credentials.
- **Routing.** `app/js/routing/` owns the scoring app routes. Match and
  tournament pages have dedicated composition roots and Hosting rewrites.
- **Firebase boundary.** `app/js/firebase/` initialises Firebase and is the only
  code that calls the Firestore SDK or callables.
- **Scoring boundary.** `app/js/scoring/` sends score events to the current
  match and presents the score the backend engine computed; `app/js/court/`
  owns court entry and follows `courts/{courtId}.activeMatchId`.
- **Match and tournament boundaries.** `app/js/match/` renders durable match
  pages. `app/js/tournament/` renders the wizard, public dashboard and host
  control room.
- **Admin boundary.** `app/js/admin/` owns admin authentication and court,
  match, tournament, club and device management.
- **Overlay.** `app/overlay.html` is a separate client that reads the public
  JSON API by court or by match.
- **Build.** `scripts/build-frontend.mjs` assembles the generated documents
  (`app/index.html`, `app/match.html`, `app/tournament.html`,
  `app/overlay.html`) and generated stylesheets (`app/css/style.css`,
  `app/css/events.css`) from sources. It does not bundle or transpile.

## Physical product boundary

### Current repositories

- PuntoPrototype: web application, admin tooling, backend, API, Device Lab,
  tournament suite and deployment configuration.
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

The Cloud Functions implementation is separated between composition, domain
logic and infrastructure:

- functions/index.js is the Firebase composition root.
- functions/domain/scoring/ contains scoring rules and scoring-option helpers,
  including fixed-total-points scoring.
- functions/domain/events/ contains event validation and ordering.
- functions/domain/matches/ contains pure match lifecycle and identity rules.
- functions/domain/tournaments/ contains format engines, setup rules,
  standings, fixture-to-match mapping, scheduling and tournament view builders.
- functions/domain/stats/ and functions/domain/momentum/ contain pure analytics calculations.
- functions/domain/clubs/ contains the club rules.
- functions/services/ contains persistence, replay, checkpoint, match,
  tournament, device-event, audit and public API orchestration.
- functions/callables/, functions/http/ and functions/triggers/ contain thin
  Firebase entry handlers.
- functions/infrastructure/ centralizes Firebase Admin access and shared
  API-cache behaviour.

## Current data and mutation boundaries

- The web app uses Firebase Web SDK repositories for reads/listeners and
  first-party callables for server-authoritative operations.
- Browser scoring writes `POINT_TEAM_A`, `POINT_TEAM_B`, `UNDO` and `WARMUP`
  events under `matches/{matchId}/events`.
- postEvent identifies a device by `deviceId`, resolves its current
  `devices/{deviceId}.courtId`, resolves or creates the live match on that
  court, and appends the effective match-scoped event.
- manageMatch owns create/start/move/detach/requeue/complete/cancel/reopen,
  reset, rename and casual court-match preparation.
- manageTournament owns tournament creation, host operations, round generation,
  fixture scheduling, bracket/result corrections, recalculation and read access.
- Clubs and the `clubId` of courts and devices are written only by the club
  callables, in one transaction, so a court or device is never in two clubs.
- The public JSON endpoints are intentionally unauthenticated read surfaces.
- Cloud Functions use the Admin SDK, so Firestore security rules do not
  constrain those server-side writes.
- Firestore rules close match/tournament server-owned writes but still leave
  legacy `courts`, `devices` and `admin` development collections open. This is
  documented production-hardening work, not a production authorization model.

## Device behaviour boundaries

| Device | Current firmware responsibility | Platform responsibility |
|---|---|---|
| Hub | NFC parsing, Wi-Fi configuration, operational commands, scoring controls | Validate/bind device, resolve court match, append events, update match score |
| Beacon | Distance detection, team selection, scoring event transmission | Apply Beacon side mapping and append effective match event |
| Pulse | Button input, local team selection, scoring/undo transmission | Interpret scoring event and update match score |

The shared event protocol is intentionally narrow; device-specific physical
behaviour remains in firmware.

## Cache architecture

Public endpoints use two cache layers:

- Firebase Hosting/CDN HTTP caching.
- Per-target in-memory function caches keyed by court or match.

Current implementation TTLs:

- /score and /score/match: 4 seconds
- /revision and /revision/match: 4 seconds
- /stats and /stats/match: 10 seconds
- /momentum and /momentum/match: 5 seconds

The /revision endpoint exists so polling clients can avoid fetching the larger
score payload when the externally relevant score has not changed.

## Replay architecture

The match event log is the authoritative scoring history.
`matches/{matchId}/score/current` is a materialized view for live display.
Checkpoints under the match are replay accelerators.

Match reset handling:

1. archives the current match event stream;
2. deletes active match events and checkpoints;
3. resets `matches/{matchId}/score/current`;
4. increments the match `scoreVersion`;
5. keeps the same `matchId`;
6. resets the court Beacon mapping when the match is currently on a court.

UNDO and out-of-order events trigger replay where required. Normal scoring uses
a compatible checkpoint when safe.

## Operational security status

The current repository is suitable as a controlled development/prototype
platform but has explicit production-hardening work remaining:

- cryptographic device authentication;
- timestamp/nonce freshness;
- client-generated event IDs and idempotency;
- full account/RBAC model for hosts, referees and venue staff;
- rate limiting/abuse controls;
- production telemetry/correlation;
- formal manufacturing credential provisioning.

Current mutation authorisation is enforced at the callable boundary by the
admin skeleton key/custom claim, hashed tournament host keys, and court
passwords for casual matches. Legacy court/device development access remains
open in Firestore rules.
