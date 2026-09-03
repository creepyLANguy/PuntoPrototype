# Padel Push API

Reference for every network-reachable surface of Padel Push: Hosting routes, public read-only
JSON endpoints, the device ingestion endpoint, the callable Cloud Functions, and the Firestore
documents behind them.

## Hosts and environments

| Environment | Host | Firebase project |
| --- | --- | --- |
| Production | `https://www.padelpush.co.za` | `FIREBASE_PROJECT_ID_PRODUCTION` |
| Staging / QA | `https://qa.padelpush.co.za` | `FIREBASE_PROJECT_ID_STAGING` |
| Branch previews | Firebase Hosting preview channel URL | staging project |

Deployment rules are in [docs/firebase-environments.md](docs/firebase-environments.md).

Function regions:

| Surface | Region |
| --- | --- |
| Callable functions, `postEvent`, `onEventCreate` | `africa-south1` |
| Public JSON endpoints (`/a`, `/r`, `/s`, `/m`) | `europe-west1` |

The public endpoints run in `europe-west1` because Firebase Hosting rewrites only support a
subset of regions; the rewrite region is pinned in [firebase.json](firebase.json).

---

## 1. Hosting routes

All routes are defined as rewrites in [firebase.json](firebase.json).

| Route | Serves | Purpose |
| --- | --- | --- |
| `/` | `index.html` | Marketing landing page |
| `/app`, `/app/**` | `app/index.html` | Scoreboard web app |
| `/court/{courtId}`, `/c/{courtId}` | `app/index.html` | Deep link straight into a court as a spectator |
| `/play`, `/p` | `app/index.html` | Court picker / join prompt |
| `/play/{courtId}`, `/p/{courtId}` | `app/index.html` | Join prompt over the court's spectator view |
| `/b`, `/b/{courtId}` | `app/overlay.html` | OBS broadcast overlay |
| `/o`, `/overlay`, `/broadcast` (and `/{prefix}/{courtId}`) | `app/overlay.html` | Aliases of `/b` |
| `/nfc`, `/nfc/**` | `nfc/index.html` | NFC tag writing utility |
| `/a/{courtId}` | `getCourtScore` | Public live score JSON |
| `/r/{courtId}` | `getCourtScoreRevision` | Public score-revision JSON |
| `/s/{courtId}` | `getCourtStats` | Public match statistics JSON |
| `/m/{courtId}` | `getCourtMomentum` | Public momentum JSON |
| `**` | `index.html` | Catch-all |

`courtId` is the court document id: lowercase, drawn from `abcdefghjkmnpqrstuxyz`, and rejected
by the JSON endpoints if longer than 64 characters.

### Overlay URL parameters

`/b/{courtId}` accepts every persisted overlay setting as a query parameter, so a fully styled
overlay can be pasted into an OBS browser source as one URL. Booleans accept
`0|false|no|off` as false, colours accept bare hex (`b7f000`), objects and arrays accept JSON.
`timerText`, `timerOffset` and `timerAnchor` are local-only and ignored in URLs. Use the
**Copy OBS URL** button in the overlay settings panel to generate one — it always emits the
canonical `/b/{courtId}` form, but `/o`, `/overlay` and `/broadcast` behave identically.

Notable keys: `theme` / `themePreset` (`padelpush`, `broadcast`, `carbon`, `clay`, `club`,
`custom`), `position` (`tl|tr|bl|br`), `layout` (`panel|compact|ticker`), `scale`, `statsScale`,
`statsWidth`, `slateScale`, `showServer`, `showBrand`, `showHeaders`, `showTeamNames`,
`showPlayerNames`, `showTimer`, `showSponsor`, `showWinMoments`, `autoStatCards`,
`autoMomentumCards`, `sponsorSlateOnSet`, `showQr`, `panel`, `panel2`, `gradientAngle`, `text`,
`teamA`, `teamB`, `nameA`, `nameB`, `playerA1`…`playerB2`, `logoA`, `logoB`, `brandText`,
`brandLogo`, `sponsorHtml`, `sponsors`, `qrUrl`, `qrLabel`, `qrCorner`, `qrSize`.

---

## 2. Public read-only JSON API

Shared behaviour for `/a`, `/r`, `/s` and `/m`:

- `GET` and `OPTIONS` only; anything else returns `405`.
- `Access-Control-Allow-Origin: *` — usable from any browser origin.
- No authentication. Only non-sensitive live match data is exposed.
- Two cache layers: a `Cache-Control: public, max-age=N, s-maxage=N` header for the Hosting CDN
  plus a per-`courtId` in-memory cache in the function instance. Error responses are `no-store`.
- Errors return `{ "success": false, "error": "..." }` with status `400` (bad courtId),
  `404` (court not found), `405` or `500`.

| Endpoint | Cache TTL | In-memory entries |
| --- | --- | --- |
| `/a/{courtId}` | 4 s | 500 |
| `/r/{courtId}` | 4 s | 500 (shared with `/a`) |
| `/s/{courtId}` | 10 s | 200 |
| `/m/{courtId}` | 5 s | 200 |

### `GET /a/{courtId}` — live score

Reads `courts/{courtId}` and `courts/{courtId}/score/current`. Cheap: no event replay.

```json
{
  "success": true,
  "courtId": "bnrm",
  "teamNames": { "A": "Team A", "B": "Team B" },
  "playerNames": { "A1": "", "A2": "", "B1": "", "B2": "" },
  "scoringOptions": {
    "scoringMode": "standard",
    "deuceMode": "standard",
    "tiebreakMode": "sixAllSeven"
  },
  "scoringMode": "standard",
  "teams": {
    "A": { "sets": 1, "games": 4, "points": 3, "pointsDisplay": "40" },
    "B": { "sets": 0, "games": 4, "points": 4, "pointsDisplay": "Ad" }
  },
  "completedSets": [{ "A": 6, "B": 4, "tiebreakPoints": null }],
  "inTiebreak": false,
  "deuceCycles": 1,
  "matchComplete": false,
  "server": "A1",
  "scoreVersion": 2,
  "revision": "9f1c2ab34de5f607",
  "fetchedAt": "2026-09-03T10:15:00.000Z"
}
```

| Field | Notes |
| --- | --- |
| `teams.*.pointsDisplay` | `0/15/30/40/Ad` in standard play; raw numbers in `straight`, `tiebreakTen` or while `inTiebreak` |
| `deuceCycles` | Needed to label a silver deuce, which only becomes a deciding point after the first cycle |
| `matchComplete` | Only ever `true` for `scoringMode: "tiebreakTen"`; other modes play an open number of sets |
| `server` | Serving player slot (`A1`, `A2`, `B1`, `B2`) or `null` |
| `scoreVersion` | Incremented by every reset; events stamped with an older version are ignored |
| `revision` | 16-char SHA-1 fingerprint of the whole payload excluding `revision` and `fetchedAt` |

### `GET /r/{courtId}` — score revision

Polling companion to `/a`. Clients poll this, compare `revision` to what they last rendered, and
only fetch `/a` when it differs. The full payload is built and cached here anyway, so the
follow-up `/a` call costs no extra Firestore reads. The overlay polls every 2 s.

```json
{ "success": true, "courtId": "bnrm", "revision": "9f1c2ab34de5f607" }
```

### `GET /s/{courtId}` — match statistics

Replays the court's full scoring event stream, so it is far heavier than `/a`. Fetch at natural
pauses (game/set boundaries or a manual trigger), not on every poll.

```json
{
  "success": true,
  "courtId": "bnrm",
  "sets": [{ "A": 6, "B": 4, "tiebreakPoints": null }],
  "currentGames": { "A": 4, "B": 4 },
  "points": { "A": 3, "B": 4 },
  "setsA": 1,
  "setsB": 0,
  "scoringMode": "standard",
  "matchComplete": false,
  "playerNames": { "A1": "", "A2": "", "B1": "", "B2": "" },
  "advancedStats": {
    "teamStats": { "A": { }, "B": { } },
    "servePlayerStats": { "A1": { }, "A2": { }, "B1": { }, "B2": { } },
    "matchStats": {
      "totalPoints": 74,
      "deuceGames": 3,
      "goldenPointsPlayed": 0,
      "silverPointsPlayed": 0,
      "starPointsPlayed": 0
    },
    "scoringMode": "standard",
    "deuceMode": "standard"
  },
  "totalPoints": 74,
  "fetchedAt": "2026-09-03T10:15:00.000Z"
}
```

`advancedStats.teamStats.{A|B}` fields:

| Field | Meaning |
| --- | --- |
| `pointsWon`, `pointWinPct` | Points won and share of all points |
| `longestScoringStreak` | Longest run of consecutive points |
| `breakPointsFaced`, `breakPointsWon`, `breakPointWinPct` | Break points saved while serving |
| `breakPointConversionOpportunities`, `breakPointConversions`, `breakPointConversionPct` | Break points taken while returning |
| `gamesWonAfterDeuce`, `gamesLostAfterDeuce` | Games decided from deuce |
| `goldenPointsWon` / `silverPointsWon` / `starPointsWon` and their `…WinPct` | Deciding points under the matching `deuceMode` |
| `gamePointGames`, `gamePointConversions`, `closingEfficiencyPct` | Games where the team held a game point, and how many it closed out |

`advancedStats.servePlayerStats.{A1|A2|B1|B2}`: `pointsServed`, `pointsWonOnServe`,
`serveWinPct`. Percentages are 0–100 numbers, not fractions.

Percentage-style fields are `0` when their denominator is `0`. Break-point, deuce and
game-point stats are only accumulated in `scoringMode: "standard"` outside a tiebreak.

### `GET /m/{courtId}` — momentum

Single source of momentum data: the overlay's momentum card and the scoreboard's match-details
graph both read this, so the two renderers cannot drift.

```json
{
  "success": true,
  "courtId": "bnrm",
  "pointHistory": ["A", "A", "B"],
  "momentumTimeline": [7.2, 13.5, 4.1],
  "setPointMarkers": [58],
  "gameMarkers": [4, 9, 15],
  "totalPoints": 74,
  "scoringMode": "standard",
  "matchComplete": false,
  "fetchedAt": "2026-09-03T10:15:00.000Z"
}
```

| Field | Meaning |
| --- | --- |
| `pointHistory` | Winner of each point in order, `"A"` / `"B"` |
| `momentumTimeline` | Momentum value after each point, clamped to `[-100, 100]`; positive favours Team A |
| `setPointMarkers` | 1-based point indices where a set completed |
| `gameMarkers` | 1-based point indices where a game completed (`standard` mode only) |

Momentum after each point is a decayed running total (`×0.94` per point) plus six components:
a weighted last-10-points window, a non-linear current-streak bonus, a pressure multiplier
(1× normal, 1.5× 30-all, 2× deuce, 2.5× advantage, 3× game/break point), a game-win bonus
(±10), a set-win bonus (±20) and a decaying post-set carry-over.

---

## 3. Device ingestion endpoint

### `POST /postEvent`

The ESP32 court buttons and other hardware post here. Deployed in `africa-south1` and called at
its function URL — there is no Hosting rewrite for it.

```
https://africa-south1-<projectId>.cloudfunctions.net/postEvent
Content-Type: application/json
```

Request body:

| Field | Required | Description |
| --- | --- | --- |
| `deviceId` | always | Must match a document in `devices/{deviceId}` |
| `eventType` | always | `POINT_TEAM_A`, `POINT_TEAM_B`, `UNDO`, `RESET`, `SPECTATE` or `REGISTER` |
| `courtId` | `SPECTATE` only | Court to bind the acting device to |
| `registeringDeviceId` | `REGISTER` only | Device to bind to the acting device's court |

Behaviour by event type:

- **Scoring events** (`POINT_TEAM_A`, `POINT_TEAM_B`, `UNDO`, `RESET`) are appended to
  `courts/{courtId}/events` for the device's currently bound court and stamped with that court's
  active `scoreVersion`. Without the stamp, `onEventCreate` would treat them as stale after the
  first reset.
- **`SPECTATE`** rebinds the acting device to the supplied `courtId`, then logs the event.
- **`REGISTER`** binds `registeringDeviceId` to the acting device's court, then logs the event.

Responses:

```json
{ "success": true, "eventId": "aBc123" }
```

`SPECTATE` also returns `courtId` and `deviceId`; `REGISTER` also returns `courtId`, `deviceId`
and `registeringDeviceId`.

| Status | Cause |
| --- | --- |
| `400` | Missing `deviceId`/`eventType`, unknown `eventType`, unknown device, unknown court, device not bound to a court, or a missing event-specific field |
| `405` | Method other than `POST` |
| `500` | `{ "success": false, "error": "Error" }` |

> The endpoint is unauthenticated and identifies callers only by `deviceId`. Treat `deviceId`
> values as secrets and do not print them in logs or share tag contents publicly.

---

## 4. Callable Cloud Functions

Invoked from the web app with the Firebase SDK, region `africa-south1`:

```js
const functions = getFunctions(app, "africa-south1");
const result = await httpsCallable(functions, "resetCourt")({ courtId, deepReset: false });
```

### `resetCourt`

Archives and clears a court's event log, zeroes the score, and bumps `scoreVersion` so any
in-flight event for the old match is discarded.

Request: `courtId` (required), `deepReset`, `newPassword`, `requirePassword`, `scoringMode`,
`scoringOptions`.

- `deepReset: true` also resets team names to `Team A`/`Team B` and clears player names.
- With `requirePassword: true`, `newPassword` must be at least 4 characters and must differ
  from the court id.

Response: `{ success, archivedId, scoreVersion, scoringMode, scoringOptions }`. `archivedId` is
an ISO timestamp naming the archive at `courts/{courtId}/archive/{archivedId}/events`.

### `updateScoringOptions`

Persists new scoring options on the court and replays the entire event log under them, so an
in-progress match can switch rules without losing history. Also rebuilds the checkpoint stream.

Request: `courtId` (required), `scoringOptions`, `scoringMode`.
Response: `{ success, scoringOptions, scoringMode, mode, score }`.
Throws `Court not found` if the court document does not exist.

### `getDetailedScore`

Request: `{ courtId }`. Returns the same payload as `/s/{courtId}` minus the `success`,
`courtId`, `totalPoints` and `fetchedAt` wrappers. Used by the scoreboard's match-details modal;
it is uncached, unlike `/s`.

### `onEventCreate` (trigger, not callable)

Firestore trigger on `courts/{courtId}/events/{eventId}`. It is the only writer of
`courts/{courtId}/score/current`. Behaviour worth knowing when integrating:

- Non-scoring events (`SPECTATE`, `REGISTER`) are ignored for scoring.
- Events whose `scoreVersion` differs from the court's active version are skipped as stale.
- Out-of-order or late events trigger a full replay so they land in their correct chronological
  position; the checkpoint shortcut is deliberately skipped there and for any `UNDO`.
- `RESET` archives and deletes the event log and all checkpoints, then zeroes the score.
- Runs with `retry: true` and up to 20 transaction attempts, so rapid button presses under
  contention are never dropped. Handlers must therefore be idempotent — the same `eventId` may
  be delivered more than once and is guarded by the `lastEventId` check.

---

## 5. Scoring options

Accepted values wherever `scoringOptions` appears:

| Option | Values | Meaning |
| --- | --- | --- |
| `scoringMode` | `standard` | Games and sets |
| | `straight` | Straight points, no games or sets |
| | `tiebreakTen` | Tiebreak Tens — the only mode that can report `matchComplete` |
| `deuceMode` | `standard` | Play advantage until a two-point lead |
| | `golden` | Golden point — deuce is decided immediately |
| | `silver` | Silver deuce — deciding point from the second deuce cycle |
| | `star` | Star point — deciding point from the third deuce cycle |
| `tiebreakMode` | `off` | No tiebreak |
| | `sixAllSeven` | 7-point tiebreak at 6–6 |
| | `sixAllTen` | 10-point tiebreak at 6–6 |

Unknown values fall back to `standard` / `standard` / `sixAllSeven`.

---

## 6. Firestore data model

Cloud Functions use `firebase-admin` and bypass security rules;
[firestore.rules](firestore.rules) is permissive and applies to the local emulator only. The web
app reads and writes Firestore directly with the client SDK.

| Path | Contents |
| --- | --- |
| `courts/{courtId}` | `name`, `status` (`open` / `closed` / `private`), `password`, `teamNames.{A,B}`, `playerNames.{A1,A2,B1,B2}`, `scoringMode`, `scoringOptions`, `scoreVersion` |
| `courts/{courtId}/score/current` | Authoritative live score: `A`/`B` (`points`, `games`, `sets`, `totalPoints`), `completedSets`, `inTiebreak`, `deuceCycles`, `matchComplete`, `lastPointTeam`, `lastGameTeam`, `lastSetTeam`, `scoringOptions`, `lastEventId`, `lastProcessedEventId`, `lastProcessedCreatedAt`, `updatedAt` |
| `courts/{courtId}/events/{eventId}` | Append-only log: `eventType`, `createdBy`, `createdAt`, `scoreVersion`, plus `actorDeviceId`, `targetCourtId`, `sourceCourtId`, `registeringDeviceId` for device events |
| `courts/{courtId}/scoreCheckpoints/{id}` | Replay accelerators: `score`, `scoringOptions`, `totalPoints`, `setsCompleted`, `lastEventId`, `lastCreatedAt`, `updatedAt`. Written at set completions, undos and option changes; deleted on reset |
| `courts/{courtId}/archive/{isoTimestamp}/events/{eventId}` | Events copied aside by a reset, with `archivedAt` and `resetBy` |
| `devices/{deviceId}` | `courtId` binding for hardware and NFC tags |
| `admin/goodies` | `skeletonKey` used for admin access in the web app |

There are no composite Firestore indexes — see [firestore.indexes.json](firestore.indexes.json).
Queries are written to stay within single-field ordering for that reason.

---

## 7. Integration recipes

### Poll a live score cheaply

```js
let renderedRevision = null;

async function poll(courtId) {
  const { revision } = await (await fetch(`/r/${encodeURIComponent(courtId)}`, { cache: "no-store" })).json();
  if (revision === renderedRevision) return;

  const score = await (await fetch(`/a/${encodeURIComponent(courtId)}`, { cache: "no-store" })).json();
  render(score);
  renderedRevision = score.revision;
}

setInterval(() => poll("bnrm"), 2000);
```

Trust the `revision` that ships with the `/a` payload rather than the one that triggered the
fetch, so an update landing mid-request is not mistaken for already-rendered state.

### Post a point from a device

```bash
curl -X POST https://africa-south1-<projectId>.cloudfunctions.net/postEvent \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"<deviceId>","eventType":"POINT_TEAM_A"}'
```

### Detect a non-deployed endpoint

The public endpoints are Hosting rewrites. Until one is deployed, the request falls through to
the catch-all rewrite and returns `index.html` with HTTP 200. Treat a non-JSON body as
"endpoint not deployed" rather than as a valid empty response.
