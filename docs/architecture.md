# API architecture

## Current implementation

The repository is currently **court-centric**. A court document is the configuration and active match container; there is no separate match document or public match identifier in the current implementation.

The runtime sequence is visualized in [PP_Runtime_Flow.mmd](PP_Runtime_Flow.mmd).

    Browser web app
      |-- Firebase Web SDK -> courts/{courtId}
      |-- Firebase Web SDK -> devices/{deviceId}
      |-- Firebase Web SDK -> courts/{courtId}/events/{eventId}
      |-- onSnapshot <- courts/{courtId}/score/current
      |-- callable -> resetCourt / changeoverCourt / updateScoringOptions / getDetailedScore
      |
      +-- public URLs /c/{courtId}, /p/{courtId}, /overlay and related Hosting routes

    External device clients
      |-- POST /postEvent (HTTP Cloud Function, africa-south1)
      |-- Beacon point events are inverted when courts/{courtId}.beaconSidesSwapped is true
      +-- append effective event -> courts/{courtId}/events/{eventId}

    onEventCreate (Cloud Function, africa-south1)
      |-- reads court configuration + event log
      |-- applies/replays scoring rules
      |-- writes courts/{courtId}/score/current
      +-- writes replay checkpoints when useful

    Public JSON consumers / OBS
      |-- /score/{courtId} -> current score
      |-- /revision/{courtId} -> revision token
      |-- /stats/{courtId} -> replayed statistics
      +-- /momentum/{courtId} -> replayed momentum

All current Cloud Functions run in `africa-south1` (Johannesburg): device ingestion, callable functions, Firestore event processing, and the public JSON read endpoints. Firebase Hosting remains a global CDN; its public JSON paths redirect to the Johannesburg Functions because Firebase Hosting does not support a direct function rewrite to `africa-south1`.

## Functions module boundaries

The Cloud Functions implementation is intentionally split between composition, domain logic, and infrastructure:

- `functions/index.js` is the Firebase composition root. It registers triggers, callable functions and HTTP functions but does not contain scoring, replay, statistics or HTTP-domain implementation.
- `functions/domain/scoring/` contains scoring rules and scoring-option helpers. `functions/scoringEngine.js` remains as a compatibility facade for existing imports/tests.
- `functions/domain/events/` contains event-type validation and ordering helpers.
- `functions/domain/stats/` and `functions/domain/momentum/` contain the pure statistics and momentum calculators.
- `functions/services/` contains score-event persistence, replay, checkpoint, analytics, device-event and public API orchestration.
- `functions/callables/`, `functions/http/` and `functions/triggers/` contain the thin Firebase entry handlers.
- `functions/infrastructure/` centralizes Firebase Admin access and shared API-cache behaviour.

This decomposition is deliberately independent of the future first-class match/tournament model. The current court-scoped Firestore model remains unchanged.

## Current data and mutation boundaries

- The web app uses the Firebase Web SDK directly for court reads, court creation/edit/delete, device reads/updates, event writes and score listeners.
- Callable functions currently present are resetCourt, changeoverCourt, updateScoringOptions and getDetailedScore.
- The current callable handlers do **not** perform an explicit request.auth authorization check in functions/index.js. Authorization is therefore a production-hardening requirement, not an implemented guarantee.
- The public JSON endpoints are intentionally unauthenticated read surfaces.
- postEvent currently identifies a device through its deviceId and current device/court binding. The cryptographic HMAC, freshness, nonce and client-generated idempotency protocol described elsewhere in the docs is a target, not the current implementation.
- Cloud Functions use the Admin SDK, so Firestore security rules do not constrain those Admin SDK writes.
- firestore.rules is explicitly documented in the repository as an emulator-only open ruleset. The deployment workflow currently deploys Functions and Hosting, not Firestore rules or indexes.

## Cache architecture

Public endpoints use two cache layers:

- Firebase Hosting/CDN HTTP caching.
- Per-court in-memory function caches.

Current implementation TTLs:

- /score: 4 seconds
- /revision: 4 seconds
- /stats: 10 seconds
- /momentum: 5 seconds

The /revision endpoint exists so polling clients can detect a changed revision before fetching the larger /score payload.

## Replay architecture

The event log is the authoritative scoring history for the active court. courts/{courtId}/score/current is a materialized view used for live display. scoreCheckpoints are replay accelerators and can be discarded/rebuilt.

RESET handling currently:

1. archives the current event stream under courts/{courtId}/archive/{archiveId}/events/{eventId};
2. deletes the active events and checkpoints;
3. resets score/current;
4. increments courts/{courtId}.scoreVersion.

Events whose scoreVersion no longer matches the court are ignored.

The `beaconSidesSwapped` court flag is reset to `false` on every RESET, so each new match begins with the default physical Beacon-to-team mapping.

UNDO and out-of-order events trigger full-history replay where required. Normal scoring uses the newest compatible checkpoint when it can do so safely.

## Failure behaviour

The event trigger runs with retries enabled and uses transactions around score processing. Duplicate delivery, rapid concurrent writes and out-of-order events are explicitly handled by replay and scoreVersion checks.

Public consumers should tolerate short-lived cached data and retry transient HTTP failures with bounded backoff.

## Current observability

The repository currently relies on console debug/error logging in the Functions runtime and does not show a dedicated request-correlation or telemetry layer.

For production hardening, telemetry should include function/endpoint latency, status/error code, environment/region, court ID where appropriate, event ID for device mutations and a request/correlation ID. Credentials and sensitive provisioning material must never be logged.

## Rate limiting

The current public read API has no published client quota. Device ingestion also has no implemented per-device/global rate limiter in the current repository.

Production hardening should add abuse controls to device ingestion and document any public read quota together with its 429 response behaviour.
