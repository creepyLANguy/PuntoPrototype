# Firestore data model

This is the current implementation reference. The model is court-centric: the active scoring state and its event history live underneath a court. The repository currently has no separate matches collection/document and no matchId field.

The collection relationships are visualized in [PP_Data_Model.mmd](PP_Data_Model.mmd).

| Path | Role |
|---|---|
| courts/{courtId} | Court configuration and active match configuration |
| courts/{courtId}/score/current | Materialized current score |
| courts/{courtId}/events/{eventId} | Append-only scoring and device event history |
| courts/{courtId}/scoreCheckpoints/{id} | Replay accelerators |
| courts/{courtId}/archive/{archiveId}/events/{eventId} | Archived events from resets |
| devices/{deviceId} | Device identity, SKU and current court binding |

## Court document

The current frontend creates court documents with fields including:

- name
- password
- createdAt
- status
- teamNames
- playerNames
- scoringMode
- scoringOptions
- scoreVersion
- beaconSidesSwapped
- changeoverEvent

The three frontend status values are:

- open
- private
- closed

The court document also acts as the container for the currently active match configuration. A separate match entity is not present.

### Beacon changeover state

beaconSidesSwapped is a court-level setting used only when new Beacon scoring events are ingested.

changeoverEvent stores the most recent changeover marker. It is a notification/audit marker for clients; it does not rewrite existing scoring events.

RESET restores beaconSidesSwapped to false.

## Current score document

courts/{courtId}/score/current is derived state produced by the scoring engine. It contains the current A/B score state, completed-set information, scoring options, match-complete/tiebreak state and processing metadata.

Important processing fields include:

- lastEventId
- lastProcessedEventId
- lastProcessedCreatedAt
- updatedAt

This document is not the source of truth for historical scoring; it can be reconstructed from the event stream.

## Event document

Current scoring event types are:

- POINT_TEAM_A
- POINT_TEAM_B
- UNDO
- RESET

Operational events also exist:

- SPECTATE
- REGISTER

Depending on the source and operation, event documents can contain:

- eventType
- createdBy
- createdAt
- scoreVersion
- actorDeviceId
- sourceCourtId
- targetCourtId
- registeringDeviceId
- sourceEventType
- beaconSidesSwapped

For an inverted Beacon scoring event, sourceEventType preserves what the physical device reported, while eventType stores the effective logical scoring event.

## Checkpoints

Checkpoint documents contain a materialized score snapshot plus replay metadata such as:

- scoringOptions
- totalPoints
- setsCompleted
- lastEventId
- lastCreatedAt
- updatedAt

They are optimizations only. The event stream remains authoritative.

## Reset archives

RESET archives the active event stream below:

courts/{courtId}/archive/{archiveId}/events/{eventId}

Archived events retain their original event fields plus archive metadata such as archivedAt and resetBy.

The implementation therefore preserves prior scoring evidence across RESET, but does not expose a first-class archived match entity or matchId.

## Devices

devices/{deviceId} represents the current relationship between a physical/logical device and a court.

Current device families are:

- Hub
- Beacon
- Pulse

The current implementation primarily uses:

- deviceId
- deviceSKU
- courtId

The device record is also the current lookup point used by postEvent to determine the acting device's court binding.

The production credential model described in device-protocol.md is not yet implemented.

## Security and data ownership boundary

Cloud Functions use the Firebase Admin SDK for server-side data access. Current callable handlers do not enforce an explicit request.auth role check, so the Firestore data model must not be interpreted as a complete authorisation model.

## Indexes

firestore.indexes.json currently contains no composite indexes. New multi-field filters/orderings must be checked against the current index deployment process.
