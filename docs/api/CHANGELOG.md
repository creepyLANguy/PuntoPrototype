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
- The legacy single-character public routes are intentionally not retained as aliases; at this release those paths were freed for future functionality.
- `/c` is now an explicit spectator selection route; `/c/{courtId}` remains the direct court route.

This is a deliberate breaking route change. Update integrations to the canonical full-word endpoints before release.

## 1.2.0 — 2026-10-04

Match and tournament suite API expansion.

- Added match-scoped public endpoints:
  `/score/match/{matchId}`, `/revision/match/{matchId}`,
  `/stats/match/{matchId}` and `/momentum/match/{matchId}`.
- Added score response fields: `matchId`, `matchName`, `title`, `match`,
  `courtName` and conditional `fixedTotal`.
- Existing court endpoints now resolve the match on the court and return match
  context while preserving court-routed access.
- Added `fixedTotalPoints` scoring response support for fixed-end tournament
  matches.
- Added `manageMatch` and `manageTournament` callable surfaces.
- Added postEvent response fields for scoring events: `matchId` and `courtId`
  alongside `eventId`.
- Moved authoritative scoring events from `courts/{courtId}/events` to
  `matches/{matchId}/events`; court-scoped device events remain for SPECTATE
  and REGISTER operational records.
- Added dedicated Hosting routes for `/m`, `/m/**`, `/t` and `/t/**`; `/m` is
  now reserved for match pages.

## Deprecation policy

A deprecated field or endpoint must:

1. be marked deprecated in OpenAPI and human-readable docs;
2. include a migration path;
3. remain available for a documented period;
4. be covered by compatibility tests;
5. be removed only in a new breaking API version or after an explicitly communicated exception.

## Versioning policy

The public API remains v1 by contract, but 1.1.0 deliberately renames the unversioned public paths. This change is coordinated across Hosting rewrites, clients, tests and documentation; legacy single-character aliases are removed rather than retained as compatibility routes.
