# Scoring golden master fixtures

This directory is the **canonical, frozen reference** for the scoring engine. Each
`*.json` file describes one match as a triple of `options`, `events`, and the
`expected` resulting score. Every scoring implementation path in the codebase
must reduce a fixture's `events` (under its `options`) to exactly its `expected`
projection.

The fixtures exist so that the frontend and backend can be rewritten with
confidence: a new implementation is correct **iff** it reproduces every
`expected`. They lock the behaviour documented in
[`docs/scoring.md`](../../../docs/scoring.md) against accidental change.

## Fixture format

```jsonc
{
  "name": "standard-normal",         // matches the filename (without .json)
  "description": "…",                // human-readable summary of what it covers
  "options": {                       // normalised scoring configuration
    "scoringMode": "standard",       // standard | straight | tiebreakTen
    "deuceMode": "standard",         // standard | golden | silver | star
    "tiebreakMode": "sixAllSeven"    // off | sixAllSeven | sixAllTen
  },
  "events": [                        // ordered event log (as stored in Firestore)
    { "eventType": "POINT_TEAM_A", "createdAt": { "seconds": 1, "nanoseconds": 0 }, "id": "e0001" }
    // eventType is one of: POINT_TEAM_A | POINT_TEAM_B | UNDO | RESET
  ],
  "expected": {                      // the engine-authoritative score projection
    "A": { "points": 1, "games": 1, "sets": 0, "totalPoints": 5 },
    "B": { "points": 1, "games": 1, "sets": 0, "totalPoints": 5 },
    "completedSets": [ { "A": 7, "B": 6, "tiebreakPoints": { "A": 7, "B": 5 } } ],
    "inTiebreak": false,
    "deuceCycles": 0,
    "matchComplete": false,
    "lastPointTeam": "B",            // "A" | "B" | null
    "lastGameTeam": "B",             // "A" | "B" | null
    "lastSetTeam": null,             // "A" | "B" | null
    "server": "A2"                   // "A1" | "A2" | "B1" | "B2" | null
  }
}
```

### The `expected` projection

`expected` is a deliberately trimmed view of the internal score object. It omits
volatile / replay-only fields (`history`, `lastEventId`, the echoed
`scoringOptions`, `updatedAt`) and keeps only what a consumer relies on:

- `A` / `B` — `points` (raw numeric point index, e.g. `4` = advantage in
  standard play), `games`, `sets`, and cumulative `totalPoints`.
- `completedSets` — one entry per finished set, `{ A, B, tiebreakPoints }`, where
  `tiebreakPoints` is `null` unless the set ended in a tiebreak.
- `inTiebreak`, `deuceCycles`, `matchComplete` — engine state flags.
- `lastPointTeam` / `lastGameTeam` / `lastSetTeam` — most recent scorer at each
  level.
- `server` — the serving player as computed by the **scoring engine**
  (`getCurrentServerLabel`). Note the frontend applies one extra display-only
  rule on top of this value: it hides the server (renders `null`) once a
  `tiebreakTen` match is `matchComplete`. The fixtures record the engine's raw
  value; that frontend guard is a rendering concern, not a scoring-state change.

## What the fixtures cover

All three scoring modes, every deuce mode, every tiebreak mode, and the mode
combinations that are meaningful, plus edge cases:

| Area | Fixtures |
|---|---|
| Standard basics | `standard-normal`, `empty-standard` |
| Deuce modes | `standard-deuce`, `golden-deuce`, `silver-deuce`, `silver-first-deuce-advantage`, `star-deuce`, `star-two-cycles-advantage` |
| Set completion | `seven-five-set`, `multi-set` |
| Tiebreaks | `6-6-tiebreak`, `six-all-ten-tiebreak`, `tiebreak-off`, `golden-tiebreak-two-clear` |
| Match tiebreak (Tiebreak Ten) | `10-point-match-tiebreak`, `tiebreakten-deuce` |
| Straight points | `straight-scoring` |
| Undo | `undo`, `undo-in-tiebreak`, `undo-match-complete` |
| Reset | `reset`, `reset-mid-tiebreak` |

## How they are consumed

Two suites (run by `npm test` in `functions/`) replay every fixture through
every scoring orchestration path and assert the same `expected`:

- **`functions/scoringGoldenMaster.test.js`** (jest) drives the engine directly
  through its three orchestrations:
  - `replay` — full replay from the event log (`replayEvents`), as the
    `resetScoring` reconciliation callable does.
  - `incremental` — `applyEvent` folded from a fresh score, as the live handler
    and analytics replay do.
  - `segmented` — replay a prefix to a resume state (carrying history, like a
    score checkpoint) then continue with `applyEvent`; tried at **every** split
    so resuming across any game/set/undo boundary is exercised. This is the
    invariant the checkpoint optimisation depends on.
- **`functions/scoringGoldenMaster.node-test.mjs`** (node:test) replays each
  fixture through the harness's mock Firestore backend, which processes events
  the way `functions/index.js` `onEventCreate` does in production.

## Adding or changing a fixture

`expected` is authored independently (by reasoning about the rules in
`docs/scoring.md`), **not** copied from whatever the engine currently returns. A
mismatch between a hand-authored `expected` and the engine is a signal to
investigate — it may be a fixture bug or a genuine engine regression. Only after
confirming the correct behaviour should either side change.

If you intentionally change scoring semantics, that is a breaking change to the
contract in `docs/scoring.md`; update the affected fixtures deliberately and call
it out.
