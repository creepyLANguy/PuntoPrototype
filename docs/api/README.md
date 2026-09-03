# API documentation

This directory separates consumer-facing API contracts from implementation architecture.

## Canonical documents

- [`openapi.yaml`](openapi.yaml) — machine-readable HTTP contract for public JSON endpoints.
- [`public-api.md`](public-api.md) — practical guide for web/integration consumers.
- [`device-api.md`](../device-api.md) — current device-ingestion behaviour and request/response examples.
- [`callable-functions.md`](../callable-functions.md) — Firebase callable/trigger contract.
- [`../device-protocol.md`](../device-protocol.md) — production device authentication, idempotency and replay-protection target.
- [`../scoring.md`](../scoring.md) — scoring enums and invariants.
- [`../architecture.md`](../architecture.md) — trust boundaries, caching and data flow.
- [`../data-model.md`](../data-model.md) — Firestore persistence and replay model.
- [`CHANGELOG.md`](CHANGELOG.md) — API contract changes.

## API design rules

1. Prefer explicit, stable field names and JSON types.
2. Document required/optional/nullability for every public field.
3. Use enums for bounded values.
4. Keep public API responses free of implementation-only Firestore details.
5. Treat `revision` as opaque and equality-based.
6. Define error status, stable machine-readable error code and human message.
7. Make mutation requests idempotent where network retries can duplicate side effects.
8. Never expose credentials, internal secrets or raw provisioning material.
9. Document cache semantics and recommended polling intervals.
10. Add contract tests whenever an endpoint or schema changes.

## Pull-request checklist

- [ ] OpenAPI updated.
- [ ] Human-readable documentation updated.
- [ ] Request and response examples updated.
- [ ] Error cases documented.
- [ ] Enum/nullability changes reviewed for compatibility.
- [ ] Security implications reviewed.
- [ ] Idempotency/retry behaviour reviewed for mutations.
- [ ] Contract/integration tests updated.
- [ ] Changelog entry added.
- [ ] Breaking changes have an explicit migration/version plan.

## Tooling target

The repository should eventually publish rendered OpenAPI/Swagger documentation from this file and generate TypeScript types/clients from the same source. Generated artefacts must not become a second source of truth.
