# Callable functions

First-party Firebase callable functions run in africa-south1. These are app/admin surfaces, separate from the public read-only HTTP API.

## Invocation

    const functions = getFunctions(app, "africa-south1");
    const resetCourt = httpsCallable(functions, "resetCourt");
    const result = await resetCourt({ courtId, deepReset: false });

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

The function writes the new court scoring configuration and optionally the password/team/player changes.

### updateScoringOptions

Persists scoring configuration and replays the active court event history under the new rules. Existing checkpoints are deleted and a new checkpoint is written when there is active history.

Request: courtId, scoringOptions and scoringMode.

### getDetailedScore

Request: { courtId }.

Replays the active court event history and returns detailed match statistics data for the scoreboard app.

## Firestore trigger: onEventCreate

onEventCreate is not callable. It consumes courts/{courtId}/events/{eventId} and maintains courts/{courtId}/score/current.

Current invariants include:

- Non-scoring events do not change score/current.
- Events from an older scoreVersion are ignored.
- Late/out-of-order events trigger replay.
- UNDO uses full-history replay where required.
- RESET archives/deletes the active event stream and checkpoints and reinitializes score/current.
- Trigger retries are enabled; event processing is designed to be deterministic and idempotent with respect to repeated delivery.

## Current authorization note

The current implementations of resetCourt, updateScoringOptions and getDetailedScore do not perform explicit request.auth checks in functions/index.js.

Do not treat possession of a courtId as proof that the caller is authorized to mutate or inspect that court. Application-level authorization is a production-hardening requirement.

## Error handling

First-party clients should use Firebase callable error codes rather than matching human-readable error strings.

Production hardening should standardize domain errors such as invalid-argument, not-found, permission-denied, already-exists, failed-precondition, resource-exhausted and internal without exposing Firestore paths, stack traces, credentials or exception internals.
