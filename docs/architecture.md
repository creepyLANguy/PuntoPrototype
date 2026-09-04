# API architecture

## Logical surfaces

```text
Browser / OBS / third-party consumers
        │
        ├── GET /a /r /s /m ──> Firebase Hosting ──> public functions
        │                                      └── Firestore read/replay
        │
ESP32 devices
        │
        └── POST /postEvent ──> device ingestion ──> Firestore events
                                                   └── onEventCreate
                                                        └── score/current

First-party web app
        └── Firebase callable functions ──> authenticated/authorized mutation logic
```

## Trust boundaries

1. **Public read boundary:** live score/statistics are deliberately public and unauthenticated.
2. **Device mutation boundary:** hardware can create score events and change bindings; this requires cryptographic authentication and replay protection for production.
3. **Application mutation boundary:** callable functions change court state and require user/application authorization.
4. **Persistence boundary:** Cloud Functions use Admin SDK and must enforce authorization themselves because Firestore rules do not protect Admin SDK writes.

## Cache architecture

Public endpoints use two cache layers:

- Hosting/CDN HTTP caching with endpoint-specific TTLs.
- Per-court in-memory function-instance caches.

Current TTLs: `/a` 4s, `/r` 4s, `/s` 10s, `/m` 5s.

The `/r` endpoint exists to avoid repeatedly transferring full score payloads. A changed revision causes a client to request `/a`.

## Replay architecture

The event log is the source of scoring history. `score/current` is a materialized current-state view. Checkpoints accelerate replay but are not authoritative history.

A reset increments `scoreVersion`, archives the previous event stream and clears current checkpoints. Stale events from an earlier version are ignored.

## Failure model

Network retries, duplicate event delivery and out-of-order Firestore trigger execution are expected. Event processing must therefore be deterministic and idempotent.

A public read client should tolerate stale cached data for the documented TTL and retry transient `5xx`/`429` responses with bounded backoff.

## Observability requirements

Production telemetry should record:

- request/function latency;
- HTTP status and stable error code;
- endpoint/function name;
- environment and region;
- court ID where appropriate;
- event ID for device mutations;
- correlation/request ID.

Never log device secrets, signatures, passwords, raw NFC credentials or full request bodies containing credentials.

## Rate limiting

Read endpoints currently have no published hard client quota. Device ingestion must have per-device and global abuse controls before production exposure. If public read limits are introduced, document them as part of the HTTP contract and return `429` consistently.
