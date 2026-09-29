# Device ingestion API

## Current endpoint

POST /postEvent is the hardware/device ingestion endpoint. It is an HTTP Cloud Function in africa-south1, called directly at the Cloud Functions URL.

    POST https://africa-south1-<projectId>.cloudfunctions.net/postEvent
    Content-Type: application/json

The current firmware source is in the separate ProtoSketches repository.

## Current device families

| SKU | Current prototype | Primary role |
|---|---|---|
| Hub | NFC/control hub | Court operations, NFC-driven commands and scoring controls |
| Beacon | Distance-triggered point device | Physical point input for Team A/B |
| Pulse | Button-driven remote | Physical point input, undo and local team selection |

The backend accepts and stores Hub, Beacon and Pulse as device family identifiers. Beacon and Pulse prototype firmware include deviceSKU in scoring payloads; the Hub firmware currently identifies the hardware primarily through its device record rather than the generic scoring payload.

## Current request contract

| Field | Required | Values |
|---|---|---|
| deviceId | yes | Existing device identifier |
| deviceSKU | no | Hub, Beacon or Pulse |
| eventType | yes | POINT_TEAM_A, POINT_TEAM_B, UNDO, RESET, SPECTATE, REGISTER |
| courtId | SPECTATE | Target court |
| registeringDeviceId | REGISTER | Device being registered |

For scoring events, the server looks up the device's current court binding and stamps the event with the court's current scoreVersion.

### Beacon changeover behaviour

When the bound court has beaconSidesSwapped: true, Team A/B point events from a device identified as Beacon are inverted at ingestion. The stored event retains the effective eventType and records sourceEventType plus beaconSidesSwapped: true when inversion occurred.

Pulse events are not inverted by the Beacon mapping.

A court RESET restores beaconSidesSwapped to false.

## Operational event behaviour

### SPECTATE

SPECTATE moves the acting device's binding to the target court after validating that the target court exists. The resulting operation is recorded against the target court event stream.

### REGISTER

REGISTER binds the target device to the acting device's current court. The current implementation records the operation and returns the resulting device/court information.

The current implementation does not enforce the production authorization model described in ../device-protocol.md.

## Current success response

    { "success": true, "eventId": "aBc123" }

SPECTATE returns the resulting target court/device binding. REGISTER returns the resulting court/device/registering-device information.

## Current errors

- 400: validation, unknown device/court, missing binding or missing event-specific field.
- 405: wrong HTTP method.
- 500: generic server error.

## Current security boundary

The current endpoint uses deviceId as the device identity and checks devices/{deviceId} for its current court binding.

There is currently no cryptographic signature, timestamp freshness check, nonce, client-generated event ID or retry-safe server idempotency protocol.

A discovered device ID is therefore effectively a bearer credential. This is suitable only for controlled testing and is not a sufficient production security boundary.

## Production target

A production implementation should support:

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

See ../device-protocol.md.

## Firmware-to-platform compatibility

A device firmware release is not production-ready merely because it can send a valid HTTP request. It must also be compatible with the current event contract, court-binding rules, Beacon changeover semantics and device provisioning model.

## Idempotency target

For production, the device should create one eventId per physical action, persist it until acknowledgement and reuse it for retries. The server should atomically deduplicate the event ID.

## Rate limiting target

Apply per-device and global abuse limits and return 429 with a stable error code and Retry-After where appropriate.
