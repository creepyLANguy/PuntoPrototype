# Firestore data model

This is the current implementation reference. The authoritative scoring state
and event history are match-scoped. Courts are physical resources that may
point at one active match.

The collection relationships are visualized in [PP_Data_Model.mmd](PP_Data_Model.mmd).

| Path | Role |
|---|---|
| courts/{courtId} | Physical court configuration, status, device orientation and active/last match pointer |
| matches/{matchId} | Durable match identity, lifecycle, names, court assignment and tournament links |
| matches/{matchId}/events/{eventId} | Append-only scoring event history |
| matches/{matchId}/score/current | Materialized current score |
| matches/{matchId}/scoreCheckpoints/{id} | Replay accelerators |
| matches/{matchId}/archive/{archiveId}/events/{eventId} | Archived events from resets |
| matches/{matchId}/audits/{auditId} | Match lifecycle/audit records |
| tournaments/{tournamentId} | Tournament configuration and lifecycle |
| tournaments/{tournamentId}/participants/{participantId} | Tournament players |
| tournaments/{tournamentId}/teams/{teamId} | Tournament teams |
| tournaments/{tournamentId}/rounds/{roundId} | Generated rounds |
| tournaments/{tournamentId}/fixtures/{fixtureId} | Scheduled/bracket fixtures |
| tournaments/{tournamentId}/audits/{auditId} | Tournament audit records |
| tournamentViews/{tournamentId} | Public tournament read model or private placeholder |
| tournamentPrivateViews/{tournamentId} | Full private tournament read model |
| tournamentDirectory/{tournamentId} | Public discovery/search entry |
| tournamentSecrets/{tournamentId} | Hashed host key and optional access code |
| tournamentCreations/{requestId} | Tournament creation idempotency markers |
| devices/{deviceId} | Device identity, SKU, current court binding and club |
| clubs/{clubId} | Club identity and the courts and devices that belong to it |

## Resource IDs

All resource IDs use only the 21-character alphabet `abcdefghjkmnpqrstuxyz`:

| Type | Length |
|---|---|
| clubId | 4 |
| courtId | 5 |
| matchId | 6 |
| tournamentId | 7 |

Backend allocation checks only the target type's collection within the same
Firestore transaction that creates its document. Allocating transactions use
`services/ids.runIdTransaction(db, callback, options)` to start a fresh reservation
context at every callback invocation: the Admin SDK reuses its Transaction object
across retry attempts. Rolled-back reservations must not survive that retry.
The canonical allocator tries at most `MAX_ID_ALLOCATION_ATTEMPTS = 5` candidates
per allocation within each attempt before returning an `aborted` error. Retries
recheck collisions; create-only writes prevent overwriting an existing resource.
Multiple allocations in one attempt reserve candidates synchronously before
awaiting collision reads, and all reads precede the transaction's actual writes.
`allocateId` rejects calls outside an active `runIdTransaction` callback.
Tournament planners use `deferIdTransactionWrites(transaction)` to share that
attempt's reservation context while queuing writes, then flush only after all
collision and relationship reads finish.

The frontend requests creation through `createWithUniqueId(type, data,
credentials)`; it never generates a resource ID or separately checks uniqueness.
Supplied internal IDs must satisfy their type's exact lowercase length and
alphabet. Legacy formats are not supported; clear and repopulate the database
before using this contract.

All four lengths are distinct, so collisions are checked only within the
requested ID type. Repeated characters remain valid.

Resource roots carry an immutable `allocationId` identifying that assignment.
Mutations must use the previously observed allocation, rather than rereading a
reassigned ID as the original entity. Device bindings carry
`courtAllocationId` and `clubAllocationId`; court match pointers carry
`activeMatchAllocationId` and `lastMatchAllocationId`. Scoring events identify
both the match allocation and their court allocation.
Frontend wrappers do not treat tokenless mutation acknowledgements as resource
snapshots. A fixture-creation response's allocation token identifies its match,
not the owning tournament.

Deleting a resource root frees its short ID for future allocation. If that ID is
later assigned again, its new `allocationId` distinguishes the replacement;
stale operations and references are rejected rather than applied to the new
resource. Public API cache keys include the allocation generation so a reused
ID cannot serve a previous assignment's cached response.

## Court document

The backend `createCourt` callable creates court documents with fields including:

- name
- password
- createdAt
- allocationId
- status
- scoringMode / scoringOptions defaults for casual matches
- beaconSidesSwapped
- changeoverEvent
- clubId
- activeMatchId
- lastMatchId

The three frontend status values are:

- open
- private
- closed

Court status is independent from match and tournament status. A closed court is
not assignable to a live match. A private court creates private casual matches
by default.

### Beacon changeover state

`beaconSidesSwapped` is a court-level setting used only when new Beacon scoring
events are ingested.

`changeoverEvent` stores the most recent changeover marker. It is a
notification/audit marker for clients; it does not rewrite existing scoring
events.

A match reset on a court restores `beaconSidesSwapped` to false.

## Match document

`matches/{matchId}` is the durable scoring identity. A match keeps the same
`matchId` when it moves courts, is detached, is reset, is completed or becomes
historical.

Fields include:

- matchId
- name
- kind (`casual` or tournament-driven)
- visibility
- status (`scheduled`, `live`, `completed`, `cancelled`)
- currentCourtId
- lastCourtId
- lastCourtName
- teamNames
- playerNames
- scoringOptions
- scoringMode
- scoreVersion
- scoreSummary
- result
- tournamentId
- roundId
- fixtureId
- createdAt, updatedAt, startedAt, completedAt, cancelledAt

The display title resolves to explicit match name, then generated matchup,
then match id. It never falls back directly to court id.

## Current score document

`matches/{matchId}/score/current` is derived state produced by the scoring
engine. It contains the current A/B score state, completed-set information,
scoring options, match-complete/tiebreak state, fixed-total state when
applicable, and processing metadata.

Important processing fields include:

- lastEventId
- lastProcessedEventId
- lastProcessedCreatedAt
- recentProcessedEventIds (bounded acknowledgement window for processed score events)
- updatedAt

This document is not the source of truth for historical scoring; it can be
reconstructed from the event stream.

## Event document

Current scoring event types include:

- POINT_TEAM_A
- POINT_TEAM_B
- UNDO
- RESET
- WARMUP

Operational device events also exist:

- SPECTATE
- REGISTER

Scoring events live under:

```text
matches/{matchId}/events/{eventId}
```

Depending on the source and operation, event documents can contain:

- matchId
- eventType
- createdBy
- createdAt
- scoreVersion
- actorDeviceId
- courtId
- sourceCourtId
- targetCourtId
- registeringDeviceId
- sourceEventType
- beaconSidesSwapped

For an inverted Beacon scoring event, `sourceEventType` preserves what the
physical device reported, while `eventType` stores the effective logical
scoring event. The event `courtId` is audit/location context; replay depends on
match id and score version, not court identity.

## Checkpoints

Checkpoint documents contain a materialized score snapshot plus replay metadata
such as:

- scoringOptions
- totalPoints
- setsCompleted
- lastEventId
- lastCreatedAt
- updatedAt

They are optimizations only. The event stream remains authoritative.

## Reset archives

Match reset archives the active event stream below:

```text
matches/{matchId}/archive/{archiveId}/events/{eventId}
```

Archived events retain their original event fields plus archive metadata such
as archivedAt and resetBy. Reset increments `scoreVersion` and preserves the
same match id, fixture and tournament association.

## Tournament document

`tournaments/{tournamentId}` stores tournament setup and lifecycle fields:

- tournamentId
- name
- description
- clubId
- visibility
- format: `{ id, version, config }`
- participantMode
- courtPool
- scheduling
- standingsConfig
- status
- participantIds
- teamIds
- currentRoundNumber
- lastGeneratedRoundNumber
- revision
- createdAt, updatedAt, publishedAt, startedAt, completedAt, cancelledAt

`clubId` is optional and is not an implicit court assignment. The host must
explicitly select `courtPool`.

## Participants and teams

Participants contain:

- participantId
- displayName
- shortName
- gender
- seed
- status
- createdAt, updatedAt

Teams contain:

- teamId
- name
- participantIds
- seed
- status
- createdAt, updatedAt

Statuses are `active`, `withdrawn` or `removed`. Withdrawn entries are excluded
from future round generation without rewriting existing match history.

## Rounds and fixtures

Round ids are deterministic (`r{roundNumber}`). Fixture ids are deterministic
(`r{roundNumber}-m{index}`). Rounds contain:

- roundId
- tournamentId
- roundNumber
- label
- stage
- status
- fixtureIds
- sittingOutParticipantIds
- sittingOutTeamIds
- generationSnapshot
- generatedAt, startedAt, completedAt

Fixtures contain:

- fixtureId
- tournamentId
- roundId
- roundNumber
- label
- stage
- groupId
- sides
- participantIds
- teamIds
- status
- matchId
- courtId
- scheduledStartAt
- courtLevel
- bracketPosition
- sourceFixtureIds
- feeds
- sourceRefs
- resultSnapshot

A `bye` fixture does not create a match. Scheduled fixtures with known sides
create normal Padel Push matches.

## Read models and secrets

`tournamentViews/{tournamentId}` contains the compact public view for public
tournaments. For private tournaments it contains only a private placeholder.

`tournamentPrivateViews/{tournamentId}` contains the full private view and is
not directly readable by Firestore clients.

`tournamentDirectory/{tournamentId}` is a small public entry for discovery:
tournament id, name, status, visibility, club summary, format and start time.
It is deleted for private tournaments.

`tournamentSecrets/{tournamentId}` stores hashes for the host key and optional
private access code. Plaintext keys are returned once and may be remembered by
the frontend on the host device.

## Devices

`devices/{deviceId}` represents the current relationship between a
physical/logical device and a court.

Current device families are:

- Hub
- Beacon
- Pulse

The current implementation primarily uses:

- deviceId
- deviceSKU
- courtId
- clubId

The device record is the current lookup point used by postEvent to determine
the acting device's court binding. For scoring events, the bound court's live
match is used; a court without one gets a casual match.

## Clubs

`clubs/{clubId}` represents a padel club. A club groups zero or more courts and
zero or more devices. A court or device belongs to at most one club at a time,
because it is a physical thing that cannot be part of two clubs at once.

Club document fields:

- name — display name, 1-80 characters (whitespace collapsed).
- courtIds — ids of the club's courts (at most 100).
- deviceIds — ids of the club's devices (at most 100).
- createdAt, updatedAt — server timestamps.

The relationship is stored in two places, which are always written together in
one transaction:

- the club document lists its members (courtIds / deviceIds);
- each member's own document carries clubId (null or absent when it belongs to
  no club).

Only the club callables (createClub, updateClub, deleteClub; see
[callable-functions.md](api/callable-functions.md)) change club membership.

The tournament setup UI uses `clubId` to rank court candidates, not to
auto-select the court pool.

## Security and data ownership boundary

Cloud Functions use the Firebase Admin SDK for server-side data access.
Server-authoritative match and tournament writes go through callables and
services.

Current mutation authority is:

- admin custom claim or server-side skeleton key for platform administration;
- hashed tournament host key for tournament control;
- court password for casual matches on a court.

Firestore rules allow public reads of match/tournament read data and client
creation of live scoring events. Legacy `courts`, `devices` and `admin`
development collections remain open in rules and must not be mistaken for
production access control.

## Indexes

`firestore.indexes.json` currently contains no composite indexes. The current
tournament implementation avoids composite-index requirements by using direct
document reads, full subcollection reads within one tournament, equality-only
match filters, and precomputed read models. New multi-field filters/orderings
must be checked against the deployment process before being added.
