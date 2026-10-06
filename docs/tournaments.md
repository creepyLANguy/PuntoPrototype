# Tournament suite

This document describes the implemented tournament suite. It uses the normal
Padel Push match and scoring system; tournaments do not have a separate score
engine, event stream or scoreboard.

## Product boundary

Padel Push now has four related product concepts:

| Concept | Role |
| --- | --- |
| Club | Optional venue context and court-picker aid. |
| Court | Physical location and device binding. A court may point at one active match. |
| Match | Durable scoring identity with its own events, current score and lifecycle. |
| Tournament | Orchestrates participants, teams, rounds, fixtures, scheduling, standings and bracket progression. |

A tournament may reference `clubId`, but that reference does not create matches,
assign courts or restrict the tournament to that club. The host explicitly
chooses the tournament `courtPool`.

## Formats and configuration

Formats are registered in `functions/domain/tournaments/formats/`. Each format
normalises its own `format.config`; the tournament stores the normalised
`{ id, version, config }`.

| Format id | Entry mode | Main config keys |
| --- | --- | --- |
| `americano` | individual | `scoring`, `maxCourts`, `mixed`, `usePointDiff` |
| `mexicano` | individual | `scoring`, `maxCourts`, `mixed`, `usePointDiff`, `initialDraw` |
| `teamAmericano` | team | `scoring`, `maxCourts`, `mixed`, `usePointDiff` |
| `teamMexicano` | team | `scoring`, `maxCourts`, `mixed`, `usePointDiff` |
| `roundRobin` | team | `scheduleMode`, `pointsForWin`, `pointsForDraw`, `pointsForLoss` |
| `swiss` | team | `roundCount`, `initialDraw`, `useBuchholz`, `pointsForWin`, `pointsForDraw`, `pointsForLoss` |
| `singleElimination` | team | `draw`, `thirdPlaceMatch` |
| `doubleElimination` | team | `draw`, `grandFinalReset` |
| `groupKnockout` | team | `groupCount`, `advancePerGroup`, `thirdPlaceMatch`, `pointsForWin`, `pointsForDraw`, `pointsForLoss` |
| `kingCourt` | individual or team | `courtCount`, `roundDurationMinutes`, `movement`, `tieBehaviour`, `scoringMethod`, `finalRanking` |

Social formats use the shared fixed-total-points scoring profile by default:

```js
{
  pointsTarget: 36,
  serveOrder: ["A1", "B1", "A2", "B2"],
  serveBlockLength: 1,
  sideSwapRule: "after_each_player_serves_once",
  tieResolution: "allow_draw"
}
```

League/bracket formats default to standard scoring unless `config.scoring`
selects another supported mode. Knockout fixed-total matches require a winner,
so fixture match creation switches ties to `golden_point` for knockout stages.
The resolved scoring profile is snapshotted onto every created match.

## Lifecycle and lock rules

Tournament statuses are:

```text
draft -> published -> live -> completed
draft -> cancelled
published -> draft
published -> completed
published -> cancelled
live -> completed
live -> cancelled
```

Draft and published tournaments can change name, description, club, visibility,
court pool, scheduling and format until rounds exist. After rounds exist, the
format is locked. Live tournaments can still change name, description,
visibility, court pool and scheduling, but `clubId` and format are locked.
Completed and cancelled tournaments are read-only except for server-side
result corrections and recalculation paths that preserve audit history.

Mutations run through `manageTournament` or `manageMatch`. Multi-document state
changes use Firestore transactions.

## Participants, teams and withdrawals

Individual formats use participants directly. Team formats use two-player team
documents that reference participant ids. Participant paste input accepts one
player per line, optional gender markers such as `Name (m)` and optional seeds
such as `#3 Name`.

Participants and teams have `active`, `withdrawn` and `removed` states.
Withdrawn entries are excluded from future generation; already played matches
and historical fixtures remain visible. Sitting out and byes are tracked
explicitly and are not fake losses.

## Round generation and idempotency

Round generation is deterministic and server-authoritative:

- callers may pass `expectedRoundNumber`;
- if that round already exists, generation returns the existing round id as a
  duplicate instead of creating another round;
- deterministic round ids are `r{n}`;
- deterministic fixture ids are `r{n}-m{index}`;
- each round stores `generationSnapshot.seed`, algorithm and version;
- format algorithms use tournament id, round number and optional suffixes as
  their deterministic seed source.

Americano and Team Americano generate the entire schedule, including pairings,
sit-outs, courts, times and scheduled matches, on the initial generation request.
The length is `scheduling.targetRoundCount` when supplied. Otherwise, a configured
start/end window determines the number of rounds that fit; without a window,
the default is one social cycle (players minus one, or teams minus one with an
extra round for an odd team count). This is a pairing forecast, not a guarantee
that every possible partner/opponent will appear exactly once. Planned pairings
count towards repeat avoidance and sit-out fairness before any scores exist.
The selected length is stored so withdrawals do not silently shorten the event.
Future rounds remain visible but cannot start until earlier rounds have finished;
this is enforced in the match transaction as well as the host controls.
Forecasts that exceed the atomic write budget are rejected with instructions
to reduce the round count or court count.

Mexicano, Team Mexicano, Swiss and King/Queen of the Court still calculate actual
pairings after the previous playable fixtures complete because results determine
the next draw. Their dashboards show estimated future round slots explicitly
marked "forecast (pairings pending)", never fake playable matches. Planned round
counts bound generation; Swiss uses its configured round count first.
Full-bracket formats generate the bracket up front and progress it through
fixture result ingestion. Round Robin retains its existing full-schedule mode.

## Scheduling and club-first court picker

`getCourtOptions` returns all courts ordered for tournament setup:

1. eligible/open courts in the selected club;
2. other eligible/open courts;
3. unavailable courts, marked as unavailable.

The picker marks `inSelectedClub`, `available`, `selected` and a display
`group`. Selecting a club never auto-selects courts and never silently fills
`courtPool`. The stored `courtPool` is always explicit.

Generated fixtures are scheduled against the explicit court pool, default match
duration and default changeover minutes. Hosts may assign, move, detach and
reschedule fixture matches.

## Result ingestion and completion

Every scheduled fixture with known sides creates a normal match in
`matches/{matchId}`. Fixture status mirrors its match status during
recalculation.

Fixed-end tournament matches (`tiebreakTen` and `fixedTotalPoints`) can
auto-complete from scoring: when the scoring engine marks the match complete,
the tournament hook updates fixture result data and recalculates standings and
progression. Other match types are completed by host/admin operation.

Completing a match clears its active court. Completing a tournament normally
requires no open fixtures unless the host finishes early with a reason; early
finish cancels unplayed/open fixtures and matches.

## Corrections and recalculation

`correctTournamentResult` requires a reason and only applies to completed
fixtures. It preserves the original match event history and writes correction
metadata on the fixture result and match. If the winner changes, downstream
bracket sides are cleared unless downstream play has started. The audit trail
records before/after summaries and reason.

`recalculateTournament` rebuilds fixture statuses, standings, bracket
progression, round statuses and read models from stored tournament state,
fixtures, matches, courts and club data.

The host operation also rebuilds the remaining Americano/Team Americano schedule
using the current active roster and available courts. All rounds through the
latest round with a live, completed or scored match are preserved, including
unstarted fixtures in that round. Only later rounds are regenerated. Scheduled
match ids are reused and their player names follow the new pairings; obsolete
unplayed matches are cancelled. Results, event history and historical scoring
snapshots are never overwritten. The rebuild is transactional and audited as
`schedule.recalculate`. Ordinary score/read-model refreshes do not reshuffle or
retime the forecast. Existing one-round Americano tournaments gain their full
remaining forecast when the host recalculates.

## Bracket progression

Single elimination, double elimination and group-knockout use bracket feed
metadata (`sourceRefs`, `sourceFixtureIds`, `feeds`, `bracketPosition`). When a
source fixture completes or is a bye, bracket progression fills downstream
sides idempotently. In-flight and completed downstream fixtures are not
overwritten.

Double elimination includes winners and losers brackets plus a grand-final
reset fixture when configured.

## Read models

The server writes compact read models so host and public pages avoid one read
per row:

| Collection | Contents |
| --- | --- |
| `tournamentViews/{tournamentId}` | Public view for public tournaments, or a small private placeholder. |
| `tournamentPrivateViews/{tournamentId}` | Full private tournament view, reachable only through the callable. |
| `tournamentDirectory/{tournamentId}` | Small public search/discovery entry. Deleted for private tournaments. |

The view includes tournament status, club summary, rules summary, current
round, live matches, standings, rounds, fixtures, bracket summary, participants
and teams.

## Host keys, access codes and authorisation

There are no end-user accounts in the current host flow. Authority is proven at
the mutation boundary by:

- a platform admin custom claim or the server-side `admin/goodies.skeletonKey`;
- a tournament host key returned at tournament creation and stored only as a
  hash in `tournamentSecrets/{tournamentId}`;
- a court password for casual non-tournament match control.

Private tournaments receive an access code. The server stores only its hash.
`getTournamentView` returns the private view to a valid admin key, host key or
access code. URL keys (`?host=`, `?code=`) are consumed by the browser, stored
locally and removed from the address bar.

Firestore rules keep match/tournament server writes closed, but legacy
`courts`, `devices` and `admin` development collections remain broadly open as
documented production-hardening work.

## Frontend routes

| Route | Purpose |
| --- | --- |
| `/t` | Tournament landing page and hosted tournament shortcuts. |
| `/t/new` | Tournament setup wizard. |
| `/t/{id}` | Public dashboard; with a stored host key or admin session it becomes the host control room. |
| `/t/{id}?host=...` | Stores a host key for this device, then removes it from the URL. |
| `/t/{id}?code=...` | Opens a private tournament and stores the access code. |
| `/m/{matchId}` | Durable match page that follows the match across court moves and completion. |

The court scoreboard remains available through `/c/{courtId}` and `/p/{courtId}`.
The overlay supports `/overlay/{courtId}` and `/overlay/match/{matchId}`. Match
name is the primary display identity; court name is secondary location context.

## Known limitations

- There is no full account/RBAC system for hosts, referees or venue staff.
- Host keys and private access codes cannot be recovered from the server because
  only hashes are stored.
- Legacy court/device development rules remain open and need production
  hardening.
- Device authentication, nonce freshness and device idempotency remain target
  protocol work.
- Firestore composite indexes are not currently required: implemented queries
  use document reads, collection reads, equality filters or precomputed read
  models rather than multi-field filter/order combinations.

## Test coverage

Tournament and match work is covered by the existing Functions/Jest and
Node/jsdom commands. New focused suites include:

- `functions/scoringFixedTotalPoints.test.js`
- `functions/tournamentFormats.test.js`
- `functions/tournamentBrackets.test.js`
- `functions/tournamentIntegration.test.js`
- `functions/tournamentPairingQuality.test.js`
- `functions/frontendMatchContext.node-test.mjs`
- `functions/frontendTournament.node-test.mjs`
