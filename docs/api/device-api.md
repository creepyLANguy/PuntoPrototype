# Device ingestion API

## Current endpoint

`POST /postEvent` is the hardware ingestion endpoint. It runs in `africa-south1` and is called at the Firebase callable-function HTTP URL rather than through Hosting.

```http
POST https://africa-south1-<projectId>.cloudfunctions.net/postEvent
Content-Type: application/json
```

## Current request contract

| Field | Required | Values |
|---|---|---|
| `deviceId` | yes | Existing device identifier |
| `eventType` | yes | `POINT_TEAM_A`, `POINT_TEAM_B`, `UNDO`, `RESET`, `SPECTATE`, `REGISTER` |
| `courtId` | SPECTATE | Target court |
| `registeringDeviceId` | REGISTER | Device being registered |

Scoring events are written to the device's currently bound court and stamped with the active `scoreVersion`.

## Current success response

```json
{ "success": true, "eventId": "aBc123" }
```

SPECTATE returns the resulting court/device binding. REGISTER returns the resulting court/device/registering-device information.

## Current errors

- `400`: validation, unknown device/court, missing binding, or missing event-specific field.
- `405`: wrong HTTP method.
- `500`: generic server error.

## Critical production issue

The current endpoint is unauthenticated and uses `deviceId` as the caller identity. A device identifier is therefore effectively a bearer credential. This is acceptable only for controlled testing and is not a sufficient production security boundary.

The target protocol is specified in [`../device-protocol.md`](../device-protocol.md).

## P0 migration contract

A production implementation should support:

```json
{
  "deviceId": "device-123",
  "eventId": "evt-01J...",
  "timestamp": "2026-09-03T10:15:00.000Z",
  "nonce": "...",
  "eventType": "POINT_TEAM_A",
  "courtId": "bnrm",
  "signature": "..."
}
```

The exact cryptographic algorithm should be selected and implemented consistently on ESP32 and server; HMAC-SHA-256 with a unique per-device secret is the preferred simple baseline for this hardware architecture.

The server must verify:

1. Device exists and is enabled.
2. Signature covers a canonical representation of the request.
3. Timestamp is inside an allowed clock-skew window.
4. Nonce/eventId has not already been accepted.
5. Event is authorized for the device's current binding.
6. Event is applied at most once.

### Idempotency

Network retries must not score the same physical button press twice. `eventId` must be generated once on the device before transmission and reused for retries. The server must atomically record accepted IDs and return the original result for a duplicate.

### REGISTER and SPECTATE authorization

These operations change device state and must not be treated as ordinary score events. Authorization must explicitly identify who/what is permitted to bind a device, validate target courts, and define concurrent rebinding behaviour. Last-write-wins must not silently transfer control between unrelated parties.

### Rate limiting

Apply per-device and global abuse limits. Return `429` with a stable error code and `Retry-After` when appropriate.

## ESP32 retry guidance

- Generate one `eventId` per physical event.
- Persist the pending event until a successful acknowledgement is received.
- Retry with bounded exponential backoff.
- Never generate a new event ID merely because a network request failed.
- Treat a duplicate/idempotent acknowledgement as success.
- Treat authentication, authorization and validation failures as non-retryable until configuration changes.
