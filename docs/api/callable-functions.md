# Callable functions

First-party Firebase callable functions run in africa-south1. They are used by the application for scoring/court administration operations and are separate from the public read-only HTTP API.

## Current functions

### resetCourt

Archives the current event log, clears the live score/checkpoints and increments scoreVersion.

Request fields currently accepted include:

- courtId — required.
- deepReset — optional boolean; when true resets team/player names.
- newPassword — optional.
- requirePassword — optional boolean.
- scoringMode — optional.
- scoringOptions — optional.

A reset also restores beaconSidesSwapped to false so the next scoring session starts with the default Beacon mapping.

### changeoverCourt

Toggles the court's Beacon side mapping atomically from its current backend value.

Request:

{ courtId }

The function does not accept the desired mapping from the client. This keeps changeover independent of each client's local "Switch views" preference and prevents a display-state choice from becoming the backend changeover state.

The function updates court configuration and writes a changeoverEvent marker. The successful response includes the resulting mapping and event ID, but clients treat the successful changeover as a blind toggle event for their own local controls. It does not rewrite already-recorded scoring events.

### updateScoringOptions

Persists scoring configuration and replays the active court event history under the new rules. Existing checkpoints are removed/rebuilt as required.

Request: courtId, scoringOptions and scoringMode.

### getDetailedScore

Request: { courtId }.

Replays the active court event history and returns detailed match statistics for the scoreboard app.

## Firestore trigger: onEventCreate

onEventCreate is not callable. It consumes:

courts/{courtId}/events/{eventId}

and maintains:

courts/{courtId}/score/current

Current invariants include:

- non-scoring events do not change score/current;
- events from an older scoreVersion are ignored;
- late/out-of-order events trigger replay;
- UNDO uses full-history replay where required;
- RESET archives/deletes the active event stream and checkpoints and reinitializes score/current;
- trigger retries are enabled.

## Current authorization status

The current callable implementations do not perform explicit request.auth checks in the Firebase function layer.

Therefore:

- courtId is not proof of authorisation;
- the current admin UI is not equivalent to a secure server-side RBAC system;
- callable mutation access must be treated as a production-hardening item.

See roles-and-responsibilities.md for the intended organisational boundaries.

## Error handling

First-party clients should use Firebase callable error codes rather than matching human-readable strings.

Production hardening should standardize domain errors such as invalid-argument, not-found, permission-denied, already-exists, failed-precondition, resource-exhausted and internal without exposing Firestore paths, stack traces, credentials or exception internals.
