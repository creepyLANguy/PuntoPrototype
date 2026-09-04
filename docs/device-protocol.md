# Production device protocol

This document is the target protocol for hardware mutation requests. It closes the security, replay and idempotency gaps identified in the API review.

## Goals

- Authenticate each physical device independently.
- Prevent captured requests from being replayed.
- Ensure network retries cannot score duplicate points.
- Authorize device-to-court bindings.
- Keep secrets out of logs, URLs and public NFC payloads.

## Identity and credentials

Each device has a stable `deviceId` and a unique per-device secret provisioned during manufacturing. The server stores only what is necessary to verify the credential.

A device identifier alone is **not** a credential.

Preferred baseline: HMAC-SHA-256 over a canonical request using a unique device secret. If asymmetric credentials are adopted later, update this contract and provisioning process as a versioned protocol change.

## Canonical request

The signed representation should include, in a deterministic order:

```text
deviceId
 eventId
timestamp
nonce
eventType
courtId
registeringDeviceId
```

Omit absent optional fields consistently. Use a documented encoding and separator. The exact canonicalization must be shared by ESP32 firmware and server tests.

## Freshness

The server should accept timestamps only within a small configured clock-skew window and reject reused nonces/event IDs. The server receipt timestamp remains authoritative for auditing and ordering.

## Idempotency

`eventId` is the idempotency key.

The originating device creates it once per physical action and persists it while the action is pending. Retries reuse the same ID. The server atomically deduplicates it and returns the original accepted result for a duplicate.

This is mandatory for `POINT_TEAM_A`, `POINT_TEAM_B`, `UNDO` and `RESET`.

## Event lifecycle

```text
physical action
  -> create eventId
  -> persist pending event
  -> sign request
  -> POST
  -> verify auth/freshness
  -> authorize binding
  -> atomically accept/dedupe
  -> append event
  -> acknowledge
  -> device clears pending event
```

## REGISTER

REGISTER is a privileged state transition. It must prove that the registering authority/device is permitted to bind the target device to the current court. A random device identifier must not be enough.

Concurrent registrations must have deterministic behaviour and must not silently transfer ownership without authorization.

## SPECTATE

SPECTATE changes which court a device targets. The target court must be validated and the operation must be authorized. It must not grant mutation authority beyond the device's permitted role.

## Error taxonomy

The device endpoint should use stable codes:

- `INVALID_ARGUMENT`
- `DEVICE_NOT_FOUND`
- `DEVICE_DISABLED`
- `AUTHENTICATION_FAILED`
- `TIMESTAMP_EXPIRED`
- `REPLAY_DETECTED`
- `EVENT_ALREADY_ACCEPTED`
- `COURT_NOT_FOUND`
- `DEVICE_NOT_BOUND`
- `NOT_AUTHORIZED`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

HTTP `401`/`403` should distinguish invalid credentials from valid-but-forbidden operations. `409` is appropriate for conflicting binding state; `429` for rate limiting.

## Secret handling

Do not put secrets in query strings, NFC URLs, source control, client bundles or telemetry. NFC may carry an opaque pairing code, but the pairing code must be short-lived/limited and must not itself be a permanent device credential.

## Provisioning requirements

Manufacturing/provisioning should establish the device identity and unique secret before the device leaves controlled production. Provisioning must be auditable without storing the plaintext secret in application logs.

## Firmware requirements

Firmware must:

- maintain persistent event IDs for pending actions;
- retry safely;
- reject obviously invalid server certificates/TLS failures rather than falling back to plaintext;
- avoid logging secrets;
- support credential rotation/revocation;
- fail closed when authentication material is missing or invalid.
