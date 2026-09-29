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

The public API and current web app are court-scoped. There is no first-class public matchId in this repository. The active match is represented by the current court document, its scoreVersion and its event stream.

## Environments

| Environment | Host | Firebase project |
|---|---|---|
| Production | https://www.padelpush.co.za | FIREBASE_PROJECT_ID_PRODUCTION |
| Staging / QA | https://qa.padelpush.co.za | FIREBASE_PROJECT_ID_STAGING |
| Branch preview | Firebase Hosting preview channel | staging project |

See firebase-environments.md.

## Security boundary

Public score endpoints are intentionally unauthenticated.

The current postEvent endpoint is not cryptographically authenticated. It uses deviceId plus the current device/court binding.

The current callable functions also do not contain explicit request.auth authorization checks. These are documented production-hardening gaps, not guarantees.

See device-protocol.md and roles-and-responsibilities.md.

## Hosting routes

| Route | Purpose |
|---|---|
| / | Marketing landing page |
| /app, /app/** | Scoreboard web app |
| /admin, /app/admin | Privileged admin surface |
| /court/{courtId}, /c/{courtId} | Court/spectator deep links |
| /play, /p, /play/{courtId}, /p/{courtId} | Play/court picker and direct join |
| /overlay, /overlay/{courtId} | Canonical OBS overlay |
| /broadcast, /broadcast/{courtId} | Secondary overlay alias |
| /nfc, /nfc/** | NFC utility |
| /score/{courtId} | Live score JSON |
| /revision/{courtId} | Revision JSON |
| /stats/{courtId} | Match statistics JSON |
| /momentum/{courtId} | Momentum JSON |

## Change management

API changes should update, in the same pull request:

1. docs/api/openapi.yaml
2. the relevant human-readable API document
3. examples/fixtures and contract tests
4. docs/api/CHANGELOG.md
5. version/deprecation notes for breaking changes
