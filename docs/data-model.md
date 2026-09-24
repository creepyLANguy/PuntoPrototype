# Firestore data model

This is the current implementation reference. The model is **court-centric**: the active scoring state and its event history live underneath a court. The repository currently has no separate matches collection/document and no matchId field.

The collection relationships are visualized in [PP_Data_Model.mmd](PP_Data_Model.mmd).

| Path | Role |
|---|---|
| courts/{courtId} | Court configuration and active match configuration |
| courts/{courtId}/score/current | Materialized current score |
| courts/{courtId}/events/{eventId} | Append-only scoring and device event history |
| courts/{courtId}/scoreCheckpoints/{id} | Replay accelerators |
| courts/{courtId}/archive/{archiveId}/events/{eventId} | Archived events from resets |
| devices/{deviceId} | Device identity and current court binding |

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

The three frontend status values are:

- open
- private
- closed

The court document also acts as the container for the currently active match configuration. A separate match entity is not present.

## Current score document

courts/{courtId}/score/current is derived state produced by the scoring engine. It contains the current A/B score state, completed-set information, scoring options, match-complete/tiebreak state and processing metadata such as the last processed event and update timestamp.

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

Event documents can contain eventType, createdBy, createdAt, scoreVersion, actorDeviceId, sourceCourtId, targetCourtId and registeringDeviceId, depending on the operation.

Client/device event IDs are currently assigned by Firestore document creation. The production target described in the device protocol instead requires the originating device/client to create and persist an eventId.

## Checkpoints

Checkpoint documents contain the materialized score snapshot plus replay metadata such as scoringOptions, totalPoints, setsCompleted, lastEventId, lastCreatedAt and updatedAt.

They are optimizations only. The event stream remains authoritative.

## Reset archives

Reset archives are stored below an archiveId path segment generated from the reset timestamp. Archived event documents retain the original event fields plus archivedAt and resetBy.

The current implementation therefore preserves prior scoring events across RESET, but it does not yet expose a first-class archived match entity or matchId.

## Devices

The current application and device ingestion paths use devices/{deviceId} primarily to determine whether a device exists and which court it is currently bound to. The current implementation does not implement the production device credential model described in device-protocol.md.

## Indexes

firestore.indexes.json currently contains no composite indexes. Queries should continue to be checked against that file before adding new multi-field orderings or filters.
