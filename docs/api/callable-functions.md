# Callable functions

First-party Firebase callable functions run in `africa-south1`. These are application/admin surfaces, not the public read-only HTTP API.

## Invocation

```js
const functions = getFunctions(app, "africa-south1");
const resetCourt = httpsCallable(functions, "resetCourt");
const result = await resetCourt({ courtId, deepReset: false });
```

## Functions

### `resetCourt`

Archives the current event log, clears the live score and increments `scoreVersion`.

Request:

- `courtId` — required.
- `deepReset` — optional boolean; when true resets team/player names.
- `newPassword` — optional; non-empty values must be at least 4 characters and differ from `courtId`.
- `requirePassword` — optional boolean; true requires `newPassword`.
- `scoringMode` — optional scoring-mode enum.
- `scoringOptions` — optional scoring configuration.

Response:

```json
{
  "success": true,
  "archivedId": "2026-09-03T10:15:00.000Z",
  "scoreVersion": 3,
  "scoringMode": "standard",
  "scoringOptions": {}
}
```

### `updateScoringOptions`

Persists scoring configuration and replays the complete event history under the new rules. The checkpoint stream is rebuilt.

Request: `courtId`, `scoringOptions`, `scoringMode`.

Response includes `success`, `scoringOptions`, `scoringMode`, `mode` and `score`.

### `getDetailedScore`

Request: `{ courtId }`.

Returns the detailed statistics payload equivalent to `/s/{courtId}` without its `success`, `courtId`, `totalPoints` and `fetchedAt` wrappers. Unlike `/s`, it is uncached.

## Firestore trigger: `onEventCreate`

`onEventCreate` is not callable. It consumes `courts/{courtId}/events/{eventId}` and maintains `courts/{courtId}/score/current`.

Important invariants:

- Non-scoring events do not change the score.
- Events from an old `scoreVersion` are ignored.
- Late/out-of-order events trigger a full replay.
- `UNDO` bypasses checkpoint shortcuts and replays as required.
- `RESET` archives/deletes the event stream and checkpoints and zeroes the score.
- Retries are expected; event processing must be idempotent.

## Callable error contract

First-party clients should use Firebase callable error codes rather than matching human-readable messages. A migration should standardize domain errors such as `invalid-argument`, `not-found`, `permission-denied`, `already-exists`, `failed-precondition`, `resource-exhausted` and `internal`.

Do not expose Firestore paths, stack traces, credentials or internal exception text to clients.

## Authorization requirements

Any callable that mutates court configuration must enforce application-level authorization. A public client must not be able to reset, reconfigure or administer an arbitrary court solely by knowing its ID.
