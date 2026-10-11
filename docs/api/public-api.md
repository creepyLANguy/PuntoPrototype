# Public JSON API

The public API is designed for scoreboards, OBS integrations and third-party read-only consumers. Current endpoints are unversioned URLs but are governed by the v1 compatibility policy in [`../api.md`](../api.md).

## Endpoints

| Endpoint | Purpose | Typical refresh | Cache TTL |
|---|---|---:|---:|
| `GET /score/{courtId}` | Complete live score | On revision change | 4s |
| `GET /revision/{courtId}` | Cheap revision check | ~2s | 4s |
| `GET /stats/{courtId}` | Full match statistics | On demand/boundaries | 10s |
| `GET /momentum/{courtId}` | Momentum timeline | When displayed | 5s |
| `GET /score/match/{matchId}` | Complete score for a durable match | On revision change | 4s |
| `GET /revision/match/{matchId}` | Cheap revision check for a durable match | ~2s | 4s |
| `GET /stats/match/{matchId}` | Match statistics for a durable match | On demand/boundaries | 10s |
| `GET /momentum/match/{matchId}` | Momentum timeline for a durable match | When displayed | 5s |

`OPTIONS` is supported for CORS. Other methods return `405`.

Court routes resolve the live match on that physical court, falling back to its
last match when no match is active. Match routes read the durable
`matches/{matchId}` identity directly and keep working after court moves or
completion.

## Court and match IDs

Court IDs contain exactly five lowercase characters from
`abcdefghjkmnpqrstuxyz`. Clients should URL-encode path parameters.

A `matchId` is the durable match document ID and contains exactly six
characters from the same alphabet. Invalid lengths or characters return `400`;
legacy formats are not accepted. Clients should URL-encode it.

## CORS and caching

`Access-Control-Allow-Origin: *` is returned because the data is intentionally public. Public responses may be cached by the Hosting CDN and function instance. Errors are `no-store`.

Consumers should not use `fetchedAt` as proof of real-time freshness. Use `revision` to decide whether content has changed.

## Recommended polling

```js
let renderedRevision = null;

async function poll(courtId) {
  const revisionResponse = await fetch(`/revision/${encodeURIComponent(courtId)}`, {
    cache: "no-store"
  });
  if (!revisionResponse.ok) throw new Error(`Revision HTTP ${revisionResponse.status}`);

  const revisionPayload = await revisionResponse.json();
  if (!revisionPayload.success) throw new Error(revisionPayload.error?.message ?? revisionPayload.error);
  if (revisionPayload.revision === renderedRevision) return;

  const scoreResponse = await fetch(`/score/${encodeURIComponent(courtId)}`, {
    cache: "no-store"
  });
  if (!scoreResponse.ok) throw new Error(`Score HTTP ${scoreResponse.status}`);

  const score = await scoreResponse.json();
  if (!score.success) throw new Error(score.error?.message ?? score.error);

  render(score);
  renderedRevision = score.revision;
}

setInterval(() => poll("bnrm").catch(console.error), 2000);
```

Always store the `revision` returned with the `/score` response. Do not assume the `/revision` value that triggered a request still represents the fetched score if an update occurred during the request.

## `/score/{courtId}` and `/score/match/{matchId}` response

Top-level fields:

| Field | Type | Required | Notes |
|---|---|---|---|
| `success` | boolean | yes | `true` on success |
| `courtId` | string/null | yes | Active/current court when known |
| `courtName` | string/null | yes | Physical court name when known |
| `matchId` | string/null | yes | Durable match id when known |
| `matchName` | string/null | yes | Explicit match name when present |
| `title` | string/null | yes | Display title: match name, generated matchup, then match id |
| `match` | object/null | yes | Compact match context |
| `teamNames` | object | yes | `A`, `B` |
| `playerNames` | object | yes | `A1`, `A2`, `B1`, `B2` |
| `scoringOptions` | object | yes | Full scoring configuration |
| `scoringMode` | enum | yes | See [`../scoring.md`](../scoring.md) |
| `teams` | object | yes | Current set/game/point state |
| `completedSets` | array | yes | Completed set summaries |
| `inTiebreak` | boolean | yes | Whether current game is a tiebreak |
| `deuceCycles` | integer | yes | Current standard-mode deuce cycle count |
| `matchComplete` | boolean | yes | Meaningful for fixed-end modes (`tiebreakTen`, `fixedTotalPoints`) |
| `server` | enum/null | yes | `A1`, `A2`, `B1`, `B2`, or `null` |
| `scoreVersion` | integer | yes | Match generation; increments on reset |
| `revision` | string | yes | Opaque equality token |
| `fetchedAt` | RFC3339 timestamp | yes | Payload generation timestamp |
| `fixedTotal` | object | conditional | Present for fixed-total-points scores |

`match` contains `matchId`, `name`, `title`, `status`, `tournamentId`,
`roundId`, `fixtureId`, `courtId` and `courtName`.

`teams.A` and `teams.B` contain `sets`, `games`, `points`, and `pointsDisplay`.

`pointsDisplay` uses `0/15/30/40/Ad` in standard play and raw numeric values in straight, tiebreak and fixed-total contexts.

`fixedTotal` contains `pointsTarget`, `rallyPoints`, `remainingPoints`,
`currentServer`, `serveSlot`, `servesCompleted`, `sideSwapCycles` and
`sidesSwapped`.

## `/stats/{courtId}` and `/stats/match/{matchId}` statistics

This endpoint replays the event stream and is deliberately more expensive. Do not poll it at scoreboard cadence.

Percentages are represented as numbers from 0 to 100. A metric with a zero denominator returns `0`. Break-point, deuce and game-point statistics are accumulated only in standard scoring outside a tiebreak.

## `/momentum/{courtId}` and `/momentum/match/{matchId}` momentum

- `pointHistory`: ordered point winners (`A`/`B`).
- `momentumTimeline`: one value after each point, clamped to `[-100,100]`; positive favours A.
- `setPointMarkers`: 1-based indices where sets completed.
- `gameMarkers`: 1-based indices where games completed in standard mode.

The momentum algorithm is documented for reproducibility in [`../scoring.md`](../scoring.md).

## Errors

### Current wire format

```json
{ "success": false, "error": "Court not found" }
```

Current statuses are `400`, `404`, `405`, and `500`.

### Production target

The preferred stable shape is:

```json
{
  "success": false,
  "error": {
    "code": "COURT_NOT_FOUND",
    "message": "Court not found",
    "requestId": "req_01J..."
  }
}
```

`code` is for machines; `message` is for humans. Clients must not parse the message to determine behaviour. `requestId` is optional and must contain no secret material.

The implementation should migrate atomically or provide a documented compatibility period before changing the current wire shape.

## Example with curl

```bash
curl -sS https://www.padelpush.co.za/score/bnrm
curl -sS https://www.padelpush.co.za/revision/bnrm
curl -sS https://www.padelpush.co.za/stats/bnrm
curl -sS https://www.padelpush.co.za/momentum/bnrm

curl -sS https://www.padelpush.co.za/score/match/m_abc123
curl -sS https://www.padelpush.co.za/revision/match/m_abc123
curl -sS https://www.padelpush.co.za/stats/match/m_abc123
curl -sS https://www.padelpush.co.za/momentum/match/m_abc123
```
