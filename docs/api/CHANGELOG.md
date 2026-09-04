# API changelog

## 1.0.0 — 2026-09-03

Documentation-only contract hardening release.

- Added OpenAPI 3.1 machine-readable public API contract.
- Separated public, device, callable, architecture, data-model and scoring documentation.
- Defined v1 compatibility and breaking-change rules.
- Defined stable structured-error target.
- Defined `revision` as an opaque equality token.
- Defined `fetchedAt` cache semantics.
- Documented polling and rate-limit expectations.
- Documented device authentication, freshness, idempotency and authorization requirements.
- Added integration examples and API contribution/contract-test checklist.

**Important:** this release does not itself alter deployed runtime security, error wire format, rate limiting or device idempotency. Those are implementation changes tracked as P0 hardening work.

## Deprecation policy

A deprecated field or endpoint must:

1. be marked deprecated in OpenAPI and human-readable docs;
2. include a migration path;
3. remain available for a documented period;
4. be covered by compatibility tests;
5. be removed only in a new breaking API version or after an explicitly communicated exception.

## Versioning policy

Current `/a`, `/r`, `/s`, `/m` endpoints are treated as v1. A breaking change must not be silently introduced into those paths. Use an explicit versioned path or equivalent negotiated version for future breaking contracts.
