# Padel Push™ API

Production-facing API contract and integration guide for Padel Push™.

> Status: this document describes the current repository/runtime contract and separately identifies production-hardening targets. A hardening requirement is not a statement that the behaviour is already implemented.

## Start here

| Surface | Use | Contract |
|---|---|---|
| Public score | Live scoreboard, integrations | api/openapi.yaml, api/public-api.md |
| Device ingestion | ESP32 hardware and other external device clients | api/device-api.md |
| Callable functions | First-party app/admin operations | api/callable-functions.md |
| Scoring rules | Modes, deuce, tiebreak semantics | scoring.md |
| Architecture | Data flow, caching, trust boundaries | architecture.md |
| Firestore | Persistence and replay model | data-model.md |
| Device protocol | Target provisioning, identity, replay protection | device-protocol.md |
| Operating model | Business processes and organisational responsibilities | business-processes.md, roles-and-responsibilities.md |

## Current model

The public API supports both physical-court and durable-match reads. A court
request resolves the live or last match on that court. A match request reads
the specified `matches/{matchId}` document directly. Scoring events and replay
are match-scoped; court id is location context.

## Environments

| Environment | Host | Firebase project |
|---|---|---|
| Production | https://www.padelpush.co.za | FIREBASE_PROJECT_ID_PRODUCTION |
| Staging / QA (all non-main branches) | https://qa.padelpush.co.za | FIREBASE_PROJECT_ID_STAGING |

See firebase-environments.md.

## Security boundary

Public score endpoints and public tournament read models are intentionally unauthenticated.

The current postEvent endpoint is not cryptographically authenticated. It uses deviceId plus the current device/court binding and appends scoring events to the match on that court.

Server-authoritative match and tournament callables verify the admin skeleton
key/custom claim, tournament host key, or court password according to the
operation. Host keys and private access codes are stored server-side only as
hashes. Legacy court/device collections remain open in Firestore rules as
development access; this is a production-hardening gap, not a guarantee.

See device-protocol.md and roles-and-responsibilities.md.

## Hosting routes

| Route | Purpose |
|---|---|
| / | Marketing landing page |
| /app, /app/** | Scoreboard web app |
| /admin, /app/admin | Privileged admin surface |
| /court/{courtId}, /c/{courtId} | Court/spectator deep links |
| /play, /p, /play/{courtId}, /p/{courtId} | Play/court picker and direct join |
| /m, /m/{matchId} | Dedicated durable match page |
| /t, /t/new, /t/{tournamentId} | Tournament landing, setup wizard, public dashboard and host control room |
| /overlay, /overlay/{courtId} | Canonical OBS overlay |
| /overlay/match/{matchId} | OBS overlay for a durable match |
| /broadcast, /broadcast/{courtId} | Secondary overlay alias |
| /broadcast/match/{matchId} | Secondary match overlay alias |
| /nfc, /nfc/** | NFC utility |
| /score/{courtId} | Live score JSON |
| /score/match/{matchId} | Match score JSON |
| /revision/{courtId} | Revision JSON |
| /revision/match/{matchId} | Match revision JSON |
| /stats/{courtId} | Match statistics JSON |
| /stats/match/{matchId} | Match statistics JSON by match |
| /momentum/{courtId} | Momentum JSON |
| /momentum/match/{matchId} | Momentum JSON by match |

## Change management

API changes should update, in the same pull request:

1. docs/api/openapi.yaml
2. the relevant human-readable API document
3. examples/fixtures and contract tests
4. docs/api/CHANGELOG.md
5. version/deprecation notes for breaking changes
