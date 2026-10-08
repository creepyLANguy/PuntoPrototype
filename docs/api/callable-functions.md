# Callable functions

First-party Firebase callable functions run in africa-south1. They are used by
the application for scoring, match, tournament and administration operations
and are separate from the public read-only HTTP API.

## Current functions

Resource IDs use `abcdefghjkmnpqrstuxyz` exclusively: court IDs have 4
characters, tournament IDs 6, match IDs 8, and club IDs 10. Creation uses one
transactional backend allocator with at most five candidate attempts; exhaustion
returns `aborted` without partial writes. Existing IDs cannot be overwritten by
creation. Supplied IDs are validated against the exact type contract; legacy
formats are not accepted.

Browser creation calls are centralized in `createWithUniqueId(type, data,
credentials)`, which dispatches to the appropriate callable and validates the
returned ID. Allocation is never separated from document creation.

### createCourt

Creates a physical court and allocates its four-character ID atomically.
Requires `credentials.adminKey`.

Request: `{ name, password, status?, scoringOptions?, credentials }`.

Returns `{ courtId }`. New courts have no active match; a match is created when
play starts. Direct client creation of court documents is denied by security
rules.

### resetCourt

Resolves the match currently on a court, archives that match's current event
log, clears its live score/checkpoints and increments match scoreVersion.

Request fields currently accepted include:

- courtId — required.
- deepReset — optional boolean; when true resets team/player names.
- newPassword — optional.
- requirePassword — optional boolean.
- scoringMode — optional.
- scoringOptions — optional.

A reset also restores the court's beaconSidesSwapped value to false so the next
scoring session starts with the default Beacon mapping.

### changeoverCourt

Toggles the court's Beacon side mapping atomically from its current backend value.

Request:

{ courtId }

The function does not accept the desired mapping from the client. This keeps changeover independent of each client's local "Swap views" preference and prevents a display-state choice from becoming the backend changeover state.

The function updates court configuration and writes a changeoverEvent marker. The successful response includes the resulting mapping and event ID, but clients treat the successful changeover as a blind toggle event for their own local controls. It does not rewrite already-recorded scoring events.

### updateScoringOptions

Persists court-default scoring configuration and replays the current match on
that court under the new rules. Existing match checkpoints are removed/rebuilt
as required.

Request: courtId, scoringOptions and scoringMode.

### getDetailedScore

Request: { courtId }.

Resolves the match on the requested court, replays its event history and
returns detailed match statistics for the scoreboard app.

### manageMatch

One callable exposes server-authoritative match operations. The request carries
`operation`, operation fields and `credentials`.

Implemented operations:

- ensureCourtMatch
- createMatch
- startMatch
- moveMatch
- detachMatch
- requeueMatch
- completeMatch
- cancelMatch
- reopenMatch
- resetMatch
- renameMatch
- updateMatchNames
- courtControlCheck

Tournament matches are authorised with the tournament host key or admin key.
Casual matches are authorised with the court password or admin key.

### manageTournament

One callable exposes public tournament reads/setup helpers and host operations.
The request carries `operation`, operation fields and, for protected operations,
`credentials`.

Public operations:

- listFormats
- previewTournament
- getCourtOptions
- getTournamentView
- createTournament

Host/admin operations:

- verifyHost
- updateTournament
- publishTournament
- unpublishTournament
- startTournament
- completeTournament
- cancelTournament
- addParticipants
- updateParticipant
- removeParticipant
- withdrawParticipant
- restoreParticipant
- createTeam
- updateTeam
- removeTeam
- withdrawTeam
- restoreTeam
- replaceTeamMember
- generateRound
- generateNextRound
- startFixture
- startRound
- assignFixtureCourt
- setFixtureSchedule
- moveFixtureCourt
- detachFixtureMatch
- renameFixture
- completeFixture
- createFixtureMatch
- correctTournamentResult
- recalculateTournament

createTournament returns the plaintext `hostKey` once and an `accessCode` for
private tournaments. The server stores only hashes in
`tournamentSecrets/{tournamentId}`.

`generateRound` creates the full Americano/Team Americano forecast, rather than
one round. Its `roundIds` response contains every generated round. Set
`scheduling.targetRoundCount` to choose its length; otherwise a configured time
window or one social cycle supplies the default. `expectedRoundNumber` retains
its duplicate-request behaviour. Once the schedule exists, use
`recalculateTournament` rather than `generateNextRound` for these formats.

The host `recalculateTournament` operation transactionally rebuilds unstarted
Americano/Team Americano rounds after the latest round containing a live,
completed or scored match, using the current roster and court availability.
Historical matches/results are preserved and the operation is audited. Internal
read-model refreshes do not rebuild the schedule. Result-dependent formats
retain result-gated generation; their read model includes `roundForecast` slots
with pending pairings, not playable fixtures.

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

matches/{matchId}/events/{eventId}

and maintains:

matches/{matchId}/score/current

Current invariants include:

- non-scoring events do not change score/current;
- events from an older scoreVersion are ignored;
- late/out-of-order events trigger replay;
- UNDO uses full-history replay where required;
- RESET archives/deletes the active match event stream and checkpoints and reinitializes score/current;
- trigger retries are enabled.

## Current authorization status

Server-authoritative match and tournament callables verify caller authority at
the mutation boundary:

- admin custom claim or `admin/goodies.skeletonKey` for admin operations;
- tournament host key hash for tournament operations and tournament matches;
- court password for casual match control.

Therefore:

- courtId is not proof of authorisation;
- the current admin UI is not equivalent to a complete account/RBAC system;
- legacy court/device development rules still require production hardening.

See roles-and-responsibilities.md for the intended organisational boundaries.

## Error handling

First-party clients should use Firebase callable error codes rather than matching human-readable strings. The club callables already report their errors this way (see [Club errors](#club-errors)).

Production hardening should standardize domain errors such as invalid-argument, not-found, permission-denied, already-exists, failed-precondition, resource-exhausted and internal without exposing Firestore paths, stack traces, credentials or exception internals.
