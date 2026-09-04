# Scoring contract

This document defines the scoring semantics that API consumers may rely on. Implementation changes that alter these rules are breaking API changes unless versioned.

## Enums

### `scoringMode`

| Value | Meaning |
|---|---|
| `standard` | Traditional games/sets scoring |
| `straight` | Direct point accumulation; no games/sets |
| `tiebreakTen` | Tiebreak Ten format; match can complete from the tiebreak |

### `deuceMode`

| Value | Meaning |
|---|---|
| `standard` | Continue advantage until a two-point lead |
| `golden` | Deuce is decided by one deciding point |
| `silver` | Deciding point from the second deuce cycle |
| `star` | Deciding point from the third deuce cycle |

### `tiebreakMode`

| Value | Meaning |
|---|---|
| `off` | No tiebreak |
| `sixAllSeven` | 7-point tiebreak at 6–6 |
| `sixAllTen` | 10-point tiebreak at 6–6 |

Unknown values currently fall back to `standard` / `standard` / `sixAllSeven`. A future API should prefer rejecting invalid configuration with a stable validation error so configuration mistakes cannot silently change match rules; this requires an explicit migration decision before changing current behaviour.

## Score representation

In standard play, `pointsDisplay` is one of `0`, `15`, `30`, `40`, `Ad`. The underlying point representation remains numeric. In `straight` and tiebreak contexts, the display may be numeric.

`deuceCycles` counts completed deuce cycles relevant to silver/star deciding-point semantics.

`inTiebreak` identifies whether the current game is a tiebreak.

`matchComplete` is currently only asserted by `tiebreakTen`; standard/straight modes otherwise represent an open-ended number of sets.

## Server

`server` is `A1`, `A2`, `B1`, `B2`, or `null`.

## Replay invariants

- Events are processed chronologically by their event creation timestamp.
- An event belongs to the `scoreVersion` active when it was accepted.
- Events from an older score version are stale and must not affect the current match.
- Late/out-of-order events require replay from a safe checkpoint or the beginning of the current event stream.
- `UNDO` must preserve a deterministic replay result.
- Reprocessing the same event ID must not alter the result after the first successful application.

## Revision invariant

The public score `revision` is an opaque fingerprint. It represents equality of the externally relevant score payload, excluding volatile `revision` and `fetchedAt` fields. Consumers must only test equality/inequality.

## Statistics invariants

Percentages are 0–100. Zero denominators produce 0. Break-point, deuce and game-point statistics are only accumulated for standard scoring outside tiebreaks.

## Momentum invariants

Momentum is clamped to `[-100,100]`, where positive favours Team A. Timeline entries correspond one-to-one with point-history entries. Set/game markers are 1-based point indices.

The current calculation applies decay (`0.94`) plus last-10 weighting, streak bonus, pressure weighting, game-win bonus, set-win bonus and decaying post-set carry-over. Any formula change should be treated as a model/version change for consumers that compare historical values.
