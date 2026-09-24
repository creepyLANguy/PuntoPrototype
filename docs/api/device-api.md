# Device ingestion API

## Current endpoint

POST /postEvent is the hardware/device ingestion endpoint. It is an HTTP Cloud Function in africa-south1, not a Firebase callable function, and it is called directly at the Cloud Functions URL rather than through a Hosting rewrite.

    POST https://africa-south1-<projectId>.cloudfunctions.net/postEvent
    Content-Type: application/json

## Current request contract

| Field | Required | Values |
|---|---|---|
| deviceId | yes | Existing device identifier |
| eventType | yes | POINT_TEAM_A, POINT_TEAM_B, UNDO, RESET, SPECTATE, REGISTER |
| courtId | SPECTATE | Target court |
| registeringDeviceId | REGISTER | Device being registered |

For scoring events, the server looks up the device's current court binding and stamps the event with the court's current scoreVersion.

The current implementation does not require callers to provide eventId, timestamp, nonce or signature. Firestore creates the event document ID when the event is appended.

## Current success response

    { "success": true, "eventId": "aBc123" }

SPECTATE returns the resulting target court/device binding. REGISTER returns the resulting court/device/registering-device information.

## Current errors

- 400: validation, unknown device/court, missing binding or missing event-specific field.
- 405: wrong HTTP method.
- 500: generic server error.

## Current security boundary

The current endpoint uses deviceId as the device identity and then checks devices/{deviceId} for its current court binding. There is no cryptographic signature, timestamp freshness check, nonce, client-generated event ID or retry-safe idempotency protocol in the current endpoint.

A discovered deviceId is therefore effectively a bearer credential. This is suitable only for controlled testing and is not a sufficient production security boundary.

## Production target

A production implementation should support a request shape such as:

    {
      "deviceId": "device-123",
      "eventId": "evt-01J...",
      "timestamp": "2026-09-03T10:15:00.000Z",
      "nonce": "...",
      "eventType": "POINT_TEAM_A",
      "courtId": "bnrm",
      "signature": "..."
    }

The server should verify:

1. Device exists and is enabled.
2. Signature covers a canonical representation of the request.
3. Timestamp is inside an allowed clock-skew window.
4. Nonce/eventId has not already been accepted.
5. Event is authorized for the device's current binding.
6. The event is applied at most once.

See device-protocol.md for the full target protocol.

## Idempotency target

For production, the device should create one eventId per physical action, persist it until acknowledgement and reuse it for retries. The server should atomically deduplicate the eventId.

REGISTER and SPECTATE should have explicit authorization and deterministic concurrent-rebinding rules.

## Rate limiting target

Apply per-device and global abuse limits and return 429 with a stable error code and Retry-After where appropriate.
