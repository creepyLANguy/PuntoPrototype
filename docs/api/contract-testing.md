# API contract testing

The API documentation should be executable as a compatibility contract rather than a static description.

## Test layers

### Schema tests

Validate every successful `/score`, `/revision`, `/stats`, `/momentum` response against `docs/api/openapi.yaml`.

Cover:

- empty/default court;
- standard scoring;
- straight scoring;
- tiebreak-ten;
- golden/silver/star deuce;
- 7- and 10-point tiebreaks;
- server changes;
- completed sets and match completion;
- null/empty player names;
- zero-denominator statistics;
- momentum marker alignment.

### HTTP tests

Verify:

- GET succeeds;
- OPTIONS supports CORS;
- unsupported methods return 405;
- invalid court IDs return 400;
- missing courts return 404;
- unexpected server failures return the documented 500 response;
- successful responses are JSON;
- error responses are not cached;
- CORS headers are present and correct.

### Cache/revision tests

- Repeated requests within the documented TTL return semantically identical payloads.
- `/revision` revision equals the corresponding `/score` revision.
- A score mutation changes revision.
- `fetchedAt` does not participate in revision generation.
- Clients never depend on lexical/numeric ordering of revision strings.

### Device mutation tests

For every mutation:

- authentication succeeds with valid credentials;
- invalid signatures fail;
- expired timestamps fail;
- reused nonce/event ID is rejected/deduplicated;
- retrying the same event cannot create a second score change;
- old `scoreVersion` events do not affect a new match;
- unauthorized REGISTER/SPECTATE operations fail;
- rate limits return 429 when exceeded.

### Replay tests

Build an event sequence, calculate the score, insert a late event, replay, and assert deterministic results. Run the same sequence twice and assert the final materialized score is identical.

### Compatibility tests

For each release, compare the public response shape with the previous supported contract. Additive fields are allowed; removed/renamed fields and changed types/enums require explicit breaking-change approval.

## CI requirements

CI should fail when:

- OpenAPI is invalid;
- an endpoint returns a shape outside the schema;
- a documented enum is unsupported;
- a breaking response change lacks a version/deprecation decision;
- security/idempotency regression tests fail.

The API spec and tests should be updated in the same pull request as implementation changes.

## Executable contract enforcement

The executable response-contract suite lives in `functions/openapiContract.test.js` and is included automatically by the existing Jest command invoked by `npm test` and GitHub Actions.

The suite:

- validates `docs/api/openapi.yaml` as an OpenAPI 3.1 document and resolves its local references;
- exercises representative successful `/score`, `/revision`, `/stats`, and `/momentum` responses;
- covers standard, straight, match-tiebreak and set-tiebreak states, golden/silver/star deuce modes, server rotation, completed sets, empty player names, zero-denominator statistics, and momentum markers;
- validates each successful response body against the corresponding schema from the OpenAPI document; and
- contains a negative control proving that an incompatible enum is rejected by the validator.

The validator dependencies are pinned in `functions/package.json` and `functions/package-lock.json` so CI continues to use `npm ci` with reproducible test dependencies.
