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

## 1.1.0 — 2026-09-24

Breaking public-route rename ahead of the tournament suite foundation.

- `/a/{courtId}` -> `/score/{courtId}`
- `/r/{courtId}` -> `/revision/{courtId}`
- `/s/{courtId}` -> `/stats/{courtId}`
- `/m/{courtId}` -> `/momentum/{courtId}`
- `/b` and `/b/{courtId}` -> `/overlay` and `/overlay/{courtId}`
- `/o` and `/o/{courtId}` are removed.
- The legacy single-character public routes are intentionally not retained as aliases so those paths are free for future functionality.
- `/c` is now an explicit spectator selection route; `/c/{courtId}` remains the direct court route.

This is a deliberate breaking route change. Update integrations to the canonical full-word endpoints before release.

## Deprecation policy

A deprecated field or endpoint must:

1. be marked deprecated in OpenAPI and human-readable docs;
2. include a migration path;
3. remain available for a documented period;
4. be covered by compatibility tests;
5. be removed only in a new breaking API version or after an explicitly communicated exception.

## Versioning policy

The public API remains v1 by contract, but 1.1.0 deliberately renames the unversioned public paths. This change is coordinated across Hosting rewrites, clients, tests and documentation; legacy single-character aliases are removed rather than retained as compatibility routes.
