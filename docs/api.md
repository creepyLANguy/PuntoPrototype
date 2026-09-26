# Padel Push™ API

Production-facing API contract and integration guide for Padel Push™.

> **Status:** This document describes the current repository/runtime contract and separately identifies production-hardening targets. A hardening requirement below does not mean that the behaviour is already implemented.

## Start here

| Surface | Use | Contract |
|---|---|---|
| Public score | Live scoreboard, integrations | api/openapi.yaml, api/public-api.md |
| Device ingestion | ESP32/button hardware and other external device clients | api/device-api.md |
| Callable functions | First-party app/admin operations | api/callable-functions.md |
| Scoring rules | Modes, deuce, tiebreak semantics | scoring.md |
| Architecture | Data flow, caching, trust boundaries | architecture.md |
| Firestore | Persistence and replay model | data-model.md |
| Device protocol | Target provisioning, identity, replay protection | device-protocol.md |

## Current model

The public API and current web app are **court-scoped**. There is no first-class public matchId in this repository. The active match is represented by the current court document plus its scoreVersion and event stream.

## Environments

| Environment | Host | Firebase project |
|---|---|---|
| Production | https://www.padelpush.co.za | FIREBASE_PROJECT_ID_PRODUCTION |
| Staging / QA | https://qa.padelpush.co.za | FIREBASE_PROJECT_ID_STAGING |
| Branch preview | Firebase Hosting preview channel | staging project |

See firebase-environments.md.

### Function region

All Cloud Functions are deployed to `africa-south1` (Johannesburg), including callable functions, device ingestion, the Firestore event trigger, and the public JSON read functions used by Firebase Hosting rewrites.

Firebase Hosting remains global/CDN-based; the region applies to the functions that receive rewritten public API requests.

## API compatibility policy

The public JSON API is version v1 by contract even though the current public URLs are unversioned.

Compatibility rules:

- Additive response fields are backwards compatible.
- Existing field meaning, types, enum values and nullability must not change without a migration notice.
- Removing or renaming a field, changing an enum or changing scoring semantics is a breaking change.
- New API versions must use an explicit versioned path.
- Deprecated fields should remain for a documented deprecation period and appear in the changelog.

## Common HTTP contract

Public JSON endpoints support GET and OPTIONS. Other methods return 405.

Success responses are JSON with success: true. The current error shape is { "success": false, "error": "..." }. The structured code/message/requestId error object described in public-api.md is still a hardening target.

Public responses use Access-Control-Allow-Origin: * and are intentionally unauthenticated.

fetchedAt is the payload-generation timestamp and is not a guarantee that the underlying Firestore read happened at that exact instant because CDN/function caches can return an earlier generated payload.

revision is an opaque equality token. Consumers must compare it for equality/inequality and must not sort it or assume that it is a monotonic counter.

## Rate limiting and polling

The current API does not advertise a hard per-client rate limit. Recommended polling is:

1. Poll /revision/{courtId} about every 2 seconds for interactive displays.
2. Fetch /score/{courtId} when revision changes.
3. Fetch /stats/{courtId} at boundaries or on demand.
4. Fetch /momentum/{courtId} only when momentum is displayed/refreshed.

A future rate limit should return 429 with a stable error code and, where practical, Retry-After.

## Security boundary

Public score endpoints are intentionally unauthenticated.

The current postEvent endpoint is also not cryptographically authenticated. It looks up devices/{deviceId} and uses the device's current court binding as its authority. A discovered deviceId is therefore not a sufficient production credential.

The current callable functions resetCourt, updateScoringOptions and getDetailedScore do not contain explicit request.auth authorization checks in functions/index.js. Application-level authorization is therefore a production-hardening requirement, not a guarantee supplied by the current implementation.

The target device protocol is documented in device-protocol.md and includes per-device credentials, freshness, replay protection and client-generated idempotency keys.

## Contract testing

Functions package scripts run Jest plus Node-based frontend/scoring integration tests. The current deployment workflow does not show an OpenAPI validation step.

The OpenAPI document remains the canonical machine-readable HTTP contract.

## Hosting routes

| Route | Purpose |
|---|---|
| / | Marketing landing page |
| /app, /app/** | Scoreboard web app |
| /court/{courtId}, /c/{courtId} | Court/spectator deep links |
| /play, /p, /play/{courtId}, /p/{courtId} | Play/court picker and direct join |
| /overlay, /overlay/{courtId} | Canonical OBS overlay |
| /broadcast, /broadcast/{courtId} | Secondary overlay alias |
| /nfc, /nfc/** | NFC utility |
| /score/{courtId} | Live score JSON |
| /revision/{courtId} | Revision JSON |
| /stats/{courtId} | Match statistics JSON |
| /momentum/{courtId} | Momentum JSON |

Hosting rewrites are deployment concerns; the public API contract is maintained separately in the OpenAPI document.

## Change management

API changes should update, in the same pull request:

1. docs/api/openapi.yaml
2. the relevant human-readable API document
3. examples/fixtures and contract tests
4. docs/api/CHANGELOG.md
5. version/deprecation notes for breaking changes
