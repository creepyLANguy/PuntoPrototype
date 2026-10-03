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

The function does not accept the desired mapping from the client. This keeps changeover independent of each client's local "Swap views" preference and prevents a display-state choice from becoming the backend changeover state.

The function updates court configuration and writes a changeoverEvent marker. The successful response includes the resulting mapping and event ID, but clients treat the successful changeover as a blind toggle event for their own local controls. It does not rewrite already-recorded scoring events.

### updateScoringOptions

Persists scoring configuration and replays the active court event history under the new rules. Existing checkpoints are removed/rebuilt as required.

Request: courtId, scoringOptions and scoringMode.

### getDetailedScore

Request: { courtId }.

Replays the active court event history and returns detailed match statistics for the scoreboard app.

### createClub

Creates a club. The backend generates the clubId.

Request:

{ name, courtIds?, deviceIds? }

- name — required; trimmed, whitespace collapsed, at most 80 characters.
- courtIds / deviceIds — optional lists of existing court / device ids (at most 100 each; duplicates are ignored).

Response:

{ clubId, name, courtIds, deviceIds, moved: { courts: [...], devices: [...] } }

moved lists every member that belonged to another club before, as { id, fromClubId, fromClubName }. A court or device belongs to at most one club, so it is removed from its previous club in the same transaction.

### updateClub

Renames a club and replaces its members.

Request:

{ clubId, name, courtIds, deviceIds }

courtIds and deviceIds are the complete new member lists. Members that are left out are released (their clubId is cleared); members of other clubs are moved, as for createClub. Ids of courts or devices that no longer exist are dropped from the club. The response has the same shape as createClub's.

### deleteClub

Request: { clubId }.

Deletes the club and clears clubId on the courts and devices it still owned. The courts and devices themselves are kept. Response: { clubId, releasedCount }.

### Club errors

The club callables report problems as callable errors with a code and a readable message:

- invalid-argument — missing or invalid name, ids or clubId, or too many members;
- not-found — unknown clubId, or a court / device id that does not exist (nothing is written);
- aborted — a unique clubId could not be allocated (retry).

## Firestore triggers: onCourtDeleted and onDeviceDeleted

These are not callable. When courts/{courtId} or devices/{deviceId} is deleted, they remove the id from the courtIds / deviceIds of every club that listed it.

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

First-party clients should use Firebase callable error codes rather than matching human-readable strings. The club callables already report their errors this way (see [Club errors](#club-errors)).

Production hardening should standardize domain errors such as invalid-argument, not-found, permission-denied, already-exists, failed-precondition, resource-exhausted and internal without exposing Firestore paths, stack traces, credentials or exception internals.
