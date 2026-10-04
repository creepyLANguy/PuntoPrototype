# Padel Push - Tournament Suite Master Implementation Specification
**Version:** 5.0  
**Status:** Authoritative implementation specification
**v5 route assumption:** `/m/{matchId}` is a dedicated match route. The repository's existing `/m` functionality will be moved to another endpoint separately and is not a tournament-spec concern.  
**Repository baseline:** `creepyLANguy/PuntoPrototype`, `main`  
**Purpose:** End-to-end implementation by an AI coding agent with repository access  
**Product principle:** A practical, simple-to-operate, but extensive tournament suite built directly on top of Padel Push's core court + match + scoring framework, with optional club/venue context used to streamline tournament setup.

---

## 0. Executive mandate

This document is the single implementation contract for the Padel Push tournament solution.

The coding agent must implement the solution end-to-end, including:

- durable match architecture;
- tournament data model;
- tournament lifecycle;
- participant and team management;
- concrete tournament formats;
- round generation;
- scheduling;
- court allocation;
- optional club association and club-aware court selection;
- dynamic additional rounds;
- byes and sitting-out logic;
- standings;
- bracket progression;
- match integration;
- host/admin workflows;
- public tournament views;
- player-facing views;
- spectator dashboards;
- live scoreboard/overlay integration;
- search;
- sharing and QR;
- deep links;
- security;
- auditability;
- performance;
- automated tests;
- deployment changes;
- documentation and solution-state alignment across all relevant Padel Push docs.

The implementation must not leave key behaviour to interpretation.

Where the current repo structure and this specification disagree, this specification defines the target architecture. Existing live data may be wiped; migration compatibility with the current court-centric live model is not required.

### v5 route clarification

For this version, the route contract is unambiguous: `/m/{matchId}` is the dedicated canonical match route. The existing repository implementation currently associated with `/m` will be moved elsewhere; that migration is not part of the tournament design and must not constrain match routing.

---

# 1. Product vision and scope

Padel Push tournaments are an orchestration layer above the existing Padel Push core platform. The overall solution has three deliberately separate but connected concerns:

1. **Club / venue context** — an optional organisational context that groups physical courts and can be used to streamline tournament setup.
2. **Core Padel Push match infrastructure** — physical courts, durable matches, scoring, event history, devices, scoreboards, overlays and sharing.
3. **Tournament orchestration** — formats, participants, rounds, fixtures, scheduling, standings, brackets and tournament views.

A tournament may optionally reference a club. That association is contextual rather than a replacement for the tournament's own lifecycle or court pool. When a club is selected, the tournament setup UI must surface that club's eligible courts first, while still allowing the host to choose other eligible courts.

The intended experience is:

**Create event -> optionally select club -> select format -> define rules -> add players/teams -> choose courts with the selected club's courts surfaced first -> generate schedule -> play normal Padel Push matches -> standings/progression update automatically -> host extends or adjusts the event as needed -> spectators follow the event live -> completed matches remain accessible forever.**

The suite must work equally well for:

- a casual Friday-night Americano;
- a structured club championship;
- a knockout cup;
- a multi-group event;
- a Mexicano where pairings react to standings;
- a fast King/Queen of the Court session.

The product should not become a bloated event-management platform. Do not add payments, ticketing, social chat, sponsorship management, marketplace discovery, or complex registration/account systems in this implementation.

The host manages the roster directly.

---

# 2. Non-negotiable architectural principle

## 2.1 System-level relationship

Padel Push has separate lifecycles for clubs, courts, matches and tournaments. A club provides organisational/venue context; a court is a physical resource; a match is the durable competitive/scoring identity; and a tournament orchestrates one or more matches.

The relationships are:

```text
Club (optional tournament context)
  -> eligible physical courts

Tournament
  -> optional clubId
  -> explicit court pool
  -> format engine
      -> rounds
          -> fixtures
              -> normal Padel Push matches
```

The club association must not make the tournament dependent on the club for match identity, scoring, progression or historical access. A tournament remains valid without a club, and a club remains useful independently of any tournament.

## 2.2 Tournament formats do not create a second match system

**Every tournament fixture is a normal Padel Push match.**

The tournament layer owns:

- participants;
- teams;
- pairings;
- rounds;
- fixtures;
- scheduling;
- byes/sitting-out;
- standings;
- bracket/progression rules;
- tournament-specific scoring interpretation.

The core Padel Push match layer owns:

- score;
- point/event history;
- checkpoints;
- undo;
- reset/versioning;
- live/historical lifecycle;
- court assignment;
- match details;
- share/QR;
- scoreboard;
- broadcast overlay.

Americano, Mexicano, Round Robin, Knockout, Swiss and every other format must all create ordinary Padel Push matches with durable `matchId` values.

**No format is allowed to introduce a parallel score engine, parallel match document, parallel event history or parallel scoreboard.**

## 2.2 Format engine boundary

A format module may decide:

- who plays whom;
- who partners whom;
- who sits out;
- how the next round is generated;
- how standings are ranked;
- how brackets progress;
- how format-specific points are interpreted.

It may not directly own:

- Firestore score events;
- event replay;
- current score state;
- checkpoints;
- score reset;
- court hardware state.

Those remain core Padel Push services.

---

# 3. Concrete tournament formats required

The initial production implementation must support the following concrete modes.

| Format | Entry model | Pairing model | Progression | Primary ranking/result |
|---|---|---|---|---|
| Americano | Individual | Rotating partners | Repeated rounds | Individual cumulative points |
| Mexicano | Individual | Standings-driven rotating partners | Repeated rounds | Individual cumulative points |
| Team Americano | Fixed teams | Fixed partners, rotating opponents | Repeated rounds | Team cumulative points |
| Team Mexicano | Fixed teams | Fixed partners, standings-driven opponents | Repeated rounds | Team cumulative points |
| Round Robin | Fixed teams/pairs | Every opponent once | Complete schedule | Match/competition points |
| Swiss | Fixed teams/pairs | Pair by current standings | Repeated rounds | Match/competition points |
| Single Elimination | Fixed teams/pairs | Bracket | Winner advances | Match win/loss |
| Double Elimination | Fixed teams/pairs | Winners + losers brackets | Bracket | Match win/loss |
| Group Stage + Knockout | Fixed teams/pairs | Round robin groups | Group -> bracket | Group standings + knockout |
| King/Queen of the Court | Individual or team | Court-rotation rules | Repeated timed rounds | Format-defined points/rank |

These are the concrete formats the agent must implement.

## 3.1 Format variants are configuration, not new architectures

Do not create separate codebases for variants such as:

- mixed-gender / Mixicano;
- fixed vs rotating partners;
- seeded vs random draw;
- point target 16/21/24/32/36/etc.;
- timed rounds vs fixed-point rounds;
- optional tie-breaks.

Use a common format schema plus explicit configuration and validation.

---

# 4. Tournament lifecycle

Tournament states:

```text
draft
published
live
completed
cancelled
```

## 4.1 Draft

Editable:

- name;
- description;
- date/time;
- optional club association;
- format;
- rules;
- participants/teams;
- courts;
- initial schedule;
- visibility.

## 4.2 Published

Public tournament page exists.

Host may still edit future operational details but structural changes are restricted according to lock rules.

## 4.3 Live

At least one match/round has started.

Lock:

- format;
- club association once the tournament is live;
- already-used participant/team identities;
- scoring configuration of created matches;
- completed results;
- bracket history.

Allow:

- court moves;
- schedule changes;
- generation of new applicable rounds;
- future fixture court assignment;
- controlled result corrections;
- participant withdrawal.

## 4.4 Completed

Tournament is read-only except audited administrative corrections.

## 4.5 Cancelled

Tournament remains accessible as historical data and is visibly marked cancelled.

---

# 5. Core domain model

## 5.1 Club

A club is a platform-level organisational/venue entity. This tournament specification does not redefine club management; it defines how tournaments may reference a club and how that reference affects court selection.

```js
{
  clubId,
  name,
  ...
}
```

A club-to-court relationship must be authoritative and queryable. Where the repository already has a canonical club/court relationship, preserve it. Otherwise, the court model must include the optional `clubId` shown below.

A tournament's `clubId` is a reference, not a copy of the club record. Resolved club details may be included in read models where useful.

## 5.2 Court

Physical court only. A court may optionally belong to a club.

```js
{
  courtId,
  name,
  clubId: string | null,
  status: "open" | "closed" | "private",
  password,
  activeMatchId: string | null,
  devices: [...],
  physicalConfig: {...},
  createdAt,
  updatedAt
}
```

The three existing court statuses are preserved exactly:

- `open`
- `closed`
- `private`

Do not derive them from tournament state.

## 5.3 Match

```js
{
  matchId,
  name: string | null,

  status: "scheduled" | "live" | "completed" | "cancelled",
  currentCourtId: string | null,

  teamNames: {
    A: string,
    B: string
  },

  playerNames: {
    A1: string,
    A2: string,
    B1: string,
    B2: string
  },

  scoringOptions: {...},
  scoreVersion: number,

  tournamentId: string | null,
  roundId: string | null,
  fixtureId: string | null,

  createdAt,
  updatedAt,
  startedAt: timestamp | null,
  completedAt: timestamp | null,
  cancelledAt: timestamp | null
}
```

`matchId` is the durable logical identity.

A match retains the same `matchId` when it:

- moves courts;
- is paused/resumed;
- is detached from a court;
- is resumed on another court;
- is completed;
- becomes historical.

## 5.4 Match event history

Move scoring history from court scope to match scope:

```text
matches/{matchId}/events/{eventId}
```

Required event metadata:

```js
{
  matchId,
  scoreVersion,
  eventType,
  createdAt,
  serverReceivedAt,
  courtId: string | null,
  payload: {...}
}
```

The `courtId` on an event is audit context only. Replay must never depend on court identity.

## 5.5 Match checkpoints

```text
matches/{matchId}/checkpoints/{checkpointId}
```

Checkpoints remain performance optimisations, never the source of truth.

## 5.6 Participant

```js
{
  participantId,
  displayName,
  shortName,
  seed: number | null,
  status: "active" | "withdrawn" | "removed",
  createdAt,
  updatedAt
}
```

No participant account is required for V1.

## 5.7 Team

```js
{
  teamId,
  name,
  participantIds: [...],
  seed: number | null,
  status: "active" | "withdrawn" | "removed",
  createdAt,
  updatedAt
}
```

## 5.8 Tournament

```js
{
  tournamentId,
  name,
  description,
  status,

  clubId: string | null,

  format: {
    id,
    version,
    config
  },

  participantMode: "individual" | "team",

  participantIds: [...],
  teamIds: [...],

  courtPool: [courtId, ...],

  scheduling: {
    timezone,
    startAt,
    plannedEndAt: timestamp | null,
    defaultMatchDurationMinutes,
    defaultChangeoverMinutes,
    targetRoundCount: number | null
  },

  standingsConfig: {...},

  visibility: "public" | "private",

  currentRoundNumber: number,
  createdAt,
  updatedAt,
  publishedAt,
  startedAt,
  completedAt,
  cancelledAt
}
```

### Tournament club association rules

- `clubId` is optional and may be `null`.
- A tournament without a club behaves exactly as a normal tournament with a manually selected court pool.
- When `clubId` is set, the setup UI must surface eligible courts belonging to that club before other eligible courts.
- Club association is a selection aid, not an implicit court assignment and not a hard restriction on the tournament's court pool.
- The host must still explicitly select the tournament's `courtPool`.
- When the tournament becomes live, changing the club association is locked unless an explicit audited administrative operation is introduced.
- A tournament may use eligible courts outside the selected club.
- If the selected club changes while the tournament is still editable, the court picker must re-rank candidates using the new club while preserving explicit court selections where they remain valid.

## 5.9 Round

```js
{
  roundId,
  tournamentId,
  roundNumber,
  label,

  status: "draft" | "scheduled" | "live" | "completed" | "locked",

  fixtureIds: [...],

  sittingOutParticipantIds: [...],
  sittingOutTeamIds: [...],

  generatedAt,
  startedAt: timestamp | null,
  completedAt: timestamp | null,

  generationSnapshot: {...},
  notes: string | null
}
```

## 5.10 Fixture

```js
{
  fixtureId,
  tournamentId,
  roundId,

  participantIds: [...],
  teamIds: [...],

  matchId: string | null,

  courtId: string | null,
  scheduledStartAt: timestamp | null,

  status: "scheduled" | "live" | "completed" | "cancelled" | "bye",

  bracketPosition: string | null,
  sourceFixtureIds: [...],

  resultSnapshot: {...} | null
}
```

A `bye` fixture does not create a Match.

---

# 6. Match lifecycle and court relationship

## 6.1 Required lifecycle

```text
scheduled -> live -> completed
scheduled -> cancelled
live -> cancelled
live -> scheduled        (explicit host/admin requeue)
completed -> live        (explicit audited reopen)
```

## 6.2 Court invariants

- One court has at most one active match.
- One live match has at most one active court.
- Match assignment updates both sides atomically.
- Moving a match is one transaction.
- Detaching a match does not complete it.
- Completing a match clears its active court.
- Court status is independent from match status.

## 6.3 Start/resume

Starting/resuming a match:

1. validate match;
2. validate court;
3. verify court is usable;
4. verify no other active match occupies it;
5. verify match is not active elsewhere;
6. atomically set `court.activeMatchId`;
7. atomically set `match.currentCourtId`;
8. set match `status=live`;
9. record audit event.

---

# 7. Reset, replay and score versioning

Reset is a match operation, not a court operation.

Required:

- preserve `matchId`;
- preserve fixture/tournament association;
- increment `scoreVersion`;
- clear current scoring state;
- prevent old events from replaying into the new version;
- preserve an audit record;
- allow the match to continue from zero without generating a new match ID.

No new match is created merely because a host resets a match.

---

# 8. Shared scoring architecture

## 8.1 Existing scoring modes

Retain current Padel Push scoring modes:

```text
standard
straight
tiebreakTen
```

and current deuce/tiebreak configuration unless a format explicitly overrides them.

## 8.2 New generalized fixed-total-points profile

The shared scoring engine must add a reusable profile:

```js
{
  scoringMode: "fixedTotalPoints",

  pointsTarget: 36,

  serving: {
    enabled: true,
    order: ["A1", "B1", "A2", "B2"],
    servesPerPlayer: 4,
    serveBlockLength: 1,
    sideSwapRule: "after_each_player_serves_once"
  },

  completion: {
    rule: "exact_total_points",
    tieResolution: "allow_draw"
  }
}
```

The exact property names may differ, but the semantics above are mandatory.

This must be implemented in the shared scoring engine so tournament formats can reuse it.

## 8.3 Fixed-total-points semantics

For `pointsTarget=36`:

- exactly 36 rally points are scored;
- cumulative team scores must total 36 at completion;
- the match may end `19-17`, `18-18`, `24-12`, etc.;
- the completion rule is configurable;
- tie handling must be explicit.

The engine must store:

- total points A;
- total points B;
- total rally points;
- current server;
- serves completed by each player;
- current serve slot;
- current side;
- completed side-swap cycles;
- target and configuration snapshot.

## 8.4 Serve rotation

`serveBlockLength=1` and:

```text
A1 -> B1 -> A2 -> B2 -> A1 -> ...
```

means one serve per player before moving to the next player.

Four serves each means each player appears four times in the sequence.

A future format can use `serveBlockLength=2` without changing the scoring architecture.

## 8.5 Side swap

For:

```text
after_each_player_serves_once
```

swap sides after all configured players have completed one serving turn.

This must be represented as a structured enum/configuration rule, not free text.

## 8.6 Tournament scoring configuration is snapshotted

Every created tournament match must copy the applicable scoring profile into the match document.

Changing tournament defaults later must not rewrite historical match rules.

---

# 9. Format engine contract

Every format implements:

```js
validateConfig(config)
validateParticipants(state)
generateInitialRound(state)
generateNextRound(state)
calculateStandings(state)
calculateRoundResult(state, fixtureResults)
canGenerateNextRound(state)
getRulesSummary(config)
```

Bracket formats additionally:

```js
generateBracket(state)
advanceBracket(state, completedFixture)
```

Court-rotation formats additionally:

```js
calculateNextCourtAssignments(state, results)
```

Pairing code should be deterministic and pure wherever possible.

---

# 10. Americano

## 10.1 Required behaviour

- individual entries;
- four players per match;
- rotating partners;
- individual standings;
- fixed-total-point scoring;
- incremental round generation;
- explicit sitting-out support.

## 10.2 Required configuration

```js
{
  format: "americano",
  scoring: {
    pointsTarget: 36,
    servesPerPlayer: 4,
    serveOrder: ["A1", "B1", "A2", "B2"],
    serveBlockLength: 1,
    sideSwapRule: "after_each_player_serves_once",
    tieResolution: "allow_draw"
  },
  pairing: {
    partnerObjective: "maximise_unique_partners",
    opponentObjective: "minimise_repeats"
  },
  standings: {
    scoring: "individualMatchPoints"
  }
}
```

## 10.3 Pairing algorithm

When enough players exist:

1. no player appears twice in a fixture;
2. minimise repeat partners;
3. minimise repeat opponents;
4. minimise repeated four-player groups;
5. minimise sitting-out imbalance;
6. preserve host seed/randomisation preference;
7. deterministic participant ID tie-break.

The algorithm must record a generation seed/snapshot so the same round can be reproduced for audit/debugging.

## 10.4 Standings

If a match ends:

```text
Player A + Player B = 19
Player C + Player D = 17
```

then:

```text
A +19
B +19
C +17
D +17
```

If `18-18` is allowed, all four receive 18.

Default Americano ranking:

1. cumulative points;
2. point difference where configured;
3. points scored;
4. deterministic participant ID.

## 10.5 Additional rounds

`Generate Next Round` must:

- append a new round;
- use all prior pairing history;
- use all prior sitting-out history;
- never rewrite old rounds;
- create new normal matches;
- permit Round 7+ even if six rounds were initially planned.

---

# 11. Mexicano

## 11.1 Required behaviour

- individual entries;
- rotating partners;
- subsequent rounds generated from current standings;
- individual standings;
- fixed-total-point scoring.

## 11.2 Round generation

After each completed round:

1. calculate standings;
2. sort players;
3. group players into four;
4. default pairing pattern:
   - 1 + 4 vs 2 + 3;
5. inspect prior partner/opponent history;
6. choose the least repetitive valid alternative if it preserves reasonable standings proximity;
7. balance byes;
8. generate deterministic output.

## 11.3 Tie-breaks

Default:

1. cumulative points;
2. point difference;
3. points scored;
4. applicable head-to-head aggregate;
5. seed;
6. participant ID.

---

# 12. Team Americano

Team Americano is the fixed-partner equivalent of Americano.

## 12.1 Behaviour

- entries are fixed teams/pairs;
- partners never change;
- opponents rotate;
- points are awarded to the team;
- rounds may be added incrementally;
- byes apply when team count is odd.

## 12.2 Scoring

Use the same fixed-total-points shared scoring profile.

The format must not implement another scoring engine.

---

# 13. Team Mexicano

Team Mexicano is the fixed-partner, standings-driven equivalent of Mexicano.

## 13.1 Behaviour

- fixed teams;
- standings determine later opponents;
- pairings must favour teams near each other in current standings;
- repeated opponents should be minimised;
- byes are balanced;
- standings are team-level.

---

# 14. Round Robin

## 14.1 Behaviour

Every team/pair plays every other exactly once in the required single-round-robin implementation.

## 14.2 Schedule

Use a deterministic circle method or equivalent.

For odd team count, insert one virtual BYE and rotate it fairly.

## 14.3 Standings

Default hierarchy:

1. match/competition points;
2. wins;
3. head-to-head where applicable;
4. set difference;
5. game difference;
6. point difference;
7. points/sets/games won;
8. seed;
9. team ID.

The exact configured tie hierarchy must be displayed publicly.

---

# 15. Swiss

## 15.1 Purpose

Swiss is required for larger competitive fields where everyone should play multiple rounds without a full round robin.

## 15.2 Required behaviour

- fixed teams/pairs by default;
- no elimination from normal play;
- each round pairs teams with nearby standings;
- avoid repeat opponents;
- balance byes for odd counts;
- support a fixed number of rounds;
- support generation one round at a time.

## 15.3 Pairing priority

For each round:

1. never pair a team with itself;
2. avoid repeat opponents where possible;
3. minimise standings distance;
4. honour score-group pairing before crossing to adjacent score groups;
5. distribute byes fairly;
6. deterministic tie-break by seed/team ID.

The implementation does not need to reproduce chess-grade Swiss pairing optimisation; it must be deterministic, transparent and suitable for club events.

## 15.4 Standings

Default:

1. match points;
2. wins;
3. point/set/game difference according to configured scoring;
4. opponent strength / Buchholz-style tiebreak if enabled;
5. points scored;
6. seed;
7. team ID.

---

# 16. Single Elimination

## 16.1 Behaviour

- fixed teams/pairs;
- seeded or random draw;
- one loss eliminates;
- winner advances.

## 16.2 Non-power-of-two field sizes

Use next power-of-two bracket.

Allocate byes without creating fake played matches.

## 16.3 Progression

When a match completes:

1. validate result;
2. determine winner;
3. write fixture result;
4. populate next bracket slot;
5. create the next normal Padel Push match when both participants are known;
6. retain complete historical state.

## 16.4 Final

The final winner is tournament champion.

---

# 17. Double Elimination

## 17.1 Behaviour

Required architecture:

- winners bracket;
- losers bracket;
- two-loss elimination;
- grand final;
- optional reset final flag as a configuration.

## 17.2 Data model

Each bracket fixture must have:

- bracket type;
- round;
- slot;
- source fixtures;
- destination fixture;
- participant/team;
- matchId;
- status.

## 17.3 Progression

A winner remains in winners bracket.

A loser drops to the correct losers-bracket position.

A second loss eliminates them.

The implementation must prevent impossible bracket paths with explicit dependency metadata.

---

# 18. Group Stage + Knockout

## 18.1 Behaviour

- fixed teams;
- balanced group allocation;
- round robin inside each group;
- configurable qualifiers per group;
- knockout stage.

## 18.2 Group allocation

Default seeded snake distribution.

Example:

```text
1 -> A
2 -> B
3 -> C
4 -> D
5 -> D
6 -> C
7 -> B
8 -> A
```

## 18.3 Advancement

Configuration:

```js
{
  groupCount,
  advancePerGroup
}
```

The bracket should minimise same-group rematches in the first knockout round where the bracket size permits.

---

# 19. King/Queen of the Court

## 19.1 Behaviour

- repeated short rounds;
- court hierarchy;
- winner/loser movement;
- queue/order for players waiting to enter;
- format-specific points/rank.

## 19.2 Required configuration

```js
{
  courtCount,
  roundDurationMinutes,
  movement: {
    winner: "up_one",
    loser: "down_one"
  },
  tieBehaviour,
  scoringMethod,
  finalRanking
}
```

The host must see the movement rules before starting.

## 19.3 Match integration

Each court contest remains a normal Padel Push match.

After a round:

1. collect match results;
2. calculate movement;
3. generate next assignments;
4. create/resume normal matches;
5. preserve historical matches.

---

# 20. Generic format variants

The architecture should support modifiers without new engines.

Examples:

```text
mixedGenderRequired
fixedPartners
randomInitialDraw
seededInitialDraw
timedRound
fixedPointRound
bestOf
standardPadelScoring
fixedTotalPoints
```

A variant must declare its constraints in configuration and validation.

---

# 21. Sitting-out, bye and withdrawal rules

Every format must explicitly represent non-playing participants.

## 21.1 Sitting out

For social/rotating formats, store:

```js
sittingOutParticipantIds
```

or:

```js
sittingOutTeamIds
```

A sitting-out participant:

- has no fake match;
- receives no automatic loss;
- has no automatic points unless the selected format explicitly defines a rest-point rule;
- remains visible on the round view.

## 21.2 Bye

For bracket/Swiss/round-robin formats:

- a bye is explicit;
- a bye is not a played match;
- a bye does not count as a loss;
- bye frequency is tracked;
- repeated byes should be minimised where alternatives exist.

## 21.3 Fairness history

Store enough history to calculate:

- times sat out;
- consecutive sits;
- bye counts;
- last round sat out.

Round generation uses this history.

## 21.4 Withdrawals

Withdrawn players/teams:

- stop appearing in future fixtures;
- remain in historical fixtures;
- are not retroactively erased;
- have explicit status.

Format modules must define what happens to their future opponents when withdrawal occurs.

---

# 22. Dynamic round generation

The tournament cannot require a fixed final round count.

For applicable formats, expose:

**Generate Next Round**

Rules:

- sequential round number;
- append-only;
- no duplicate generation;
- no historical rewrite;
- new fixtures get new `matchId`;
- current standings/history are used;
- generation is idempotent.

This explicitly supports the event-running-ahead-of-schedule case.

Example:

```text
Planned: 6 rounds
Completed: 5
Time remaining: 40 min

Generate Round 6

Round 6 complete
Time remaining: 16 min

Generate Round 7
```

---

# 23. Time and schedule management

## 23.1 Tournament timing

Store:

- event timezone;
- start time;
- optional planned end time;
- default match duration;
- changeover time;
- court count;
- per-format timing configuration.

## 23.2 Schedule states

Each fixture should expose:

```text
WAITING
READY
LIVE
COMPLETED
DELAYED
CANCELLED
BYE
```

## 23.3 Behind schedule

Host must see:

- scheduled start;
- actual start;
- delay;
- next available courts;
- downstream impact.

The system should suggest, not silently execute, schedule compression.

## 23.4 Ahead of schedule

Host can generate additional rounds for applicable formats.

---

# 24. Court scheduling and utilisation

Court scheduling must:

- use the actual selected court pool;
- avoid assigning a court already occupied;
- support manual override;
- support match moves;
- support future assignment;
- account for changeover time;
- minimise unnecessary participant idle time;
- show unassigned fixtures clearly.

### 24.1 Club-aware court selection

When a tournament has an associated `clubId`, the court-selection UI must:

1. surface eligible courts belonging to the selected club first;
2. make the club relationship visible so the host understands why those courts are prioritised;
3. allow the host to select additional eligible courts outside the club;
4. preserve normal court status/availability rules;
5. keep the final `courtPool` explicit and deterministic; and
6. avoid automatically adding every club court merely because a club was selected.

Recommended candidate ordering is:

```text
1. eligible/open courts belonging to selected club
2. other eligible/open courts
3. eligible but currently unavailable courts, clearly marked
```

The exact visual treatment may differ by UI, but club-first prioritisation is mandatory.

Court availability remains distinct from tournament progression.

---

# 25. Host dashboard

The host dashboard is the tournament control room.

## 25.1 Header

Show:

- tournament name;
- associated club, when present;
- format;
- status;
- date/time;
- public URL/QR;
- quick share.

## 25.2 Live KPI strip

Show:

- current round;
- live matches;
- courts active;
- courts available;
- waiting matches;
- sitting out;
- delayed matches;
- completion percentage.

## 25.3 Primary controls

Show prominently:

- Generate Next Round;
- Schedule;
- Participants;
- Courts;
- Standings;
- Bracket;
- Results;
- Rules;
- Settings.

## 25.4 Live court board

Use compact cards:

```text
COURT 03
LIVE

FRIDAY NIGHT FINAL
John & Mike
6 - 4
Sam & Dave

[Open] [Move]
```

The match name is visible.

## 25.5 Exceptions

Surface only actionable issues:

- court unavailable;
- fixture unassigned;
- player withdrawn;
- match delayed;
- repeated bye imbalance;
- bracket dependency waiting;
- duplicate/concurrency conflict.

---

# 26. Public spectator dashboard

Canonical URL:

```text
/t/{tournamentId}
```

Public by default unless tournament visibility is explicitly private.

## 26.1 Information hierarchy

Order:

1. event identity and associated club when present;
2. format/rules summary;
3. live matches;
4. current round;
5. standings/progression;
6. round schedule/history;
7. bracket when applicable;
8. participants.

## 26.2 Live section

For each live match show:

- match name;
- court;
- players/teams;
- score;
- status;
- link to normal match view.

Example:

```text
LIVE

FRIDAY NIGHT FINAL
Court 03

John & Mike      6
Sam & Dave       4

View match
```

## 26.3 Rules panel

Show structured:

```text
Americano
36 total points
4 serves per player
1 serve per player in rotation
Swap sides after each player serves once
```

The text is generated from configuration.

## 26.4 Standings

Desktop columns:

```text
Rank | Player/Team | Played | Wins | Points | Diff | Form
```

Social formats may instead use:

```text
Rank | Player | Rounds | Points | Avg/Round | Last Round
```

Do not show irrelevant zero-valued columns.

## 26.5 Mobile

Mobile view is stacked:

- live;
- next;
- standings;
- rounds;
- rules.

No horizontal spreadsheet should be required for the primary experience.

---

# 27. Round view

Show:

- round label;
- status;
- all fixtures;
- court;
- scheduled time;
- match name;
- participants;
- score;
- result;
- sitting-out list;
- dependencies.

Example:

```text
ROUND 6

COURT 1  LIVE
Alice / Ben vs Chris / Dan
21 - 15

COURT 2  READY
Eva / Finn vs Gina / Hugo

SITTING OUT
Iris
```

---

# 28. Bracket view

Required for:

- Single Elimination;
- Double Elimination;
- Group Stage + Knockout.

Show:

- round columns;
- participants;
- status;
- scores;
- live court;
- scheduled time;
- advancement path;
- TBD dependencies.

Mobile should use a horizontally scrollable or stage-stacked view rather than a compressed unreadable bracket.

---

# 29. Player-facing experience

A participant should be able to identify:

- tournament;
- round;
- partner;
- opponents;
- court;
- start time;
- current score;
- sitting-out status;
- standings;
- previous matches;
- next match.

No login is required for read-only public information.

---

# 30. Match scoreboard identity

This is mandatory.

## 30.1 Match name is primary

When a match has a `name`, the live scoreboard must display it as the primary identity.

Example:

```text
FRIDAY NIGHT FINAL
Court 03
```

The scoreboard must not use:

```text
COURT 03
```

as the primary match identity.

## 30.2 Court remains secondary

Court name/ID may appear as physical-location context.

## 30.3 Court moves do not rename the match

If:

```text
Court 03 -> Court 07
```

the title remains:

```text
FRIDAY NIGHT FINAL
Court 07
```

## 30.4 Fallback

If no explicit match name:

1. generated matchup/team name;
2. match ID.

Do not fall back directly to court ID.

## 30.5 Broadcast overlay

Apply the same hierarchy to:

- `app/overlay.html`;
- OBS;
- share cards;
- other live match surfaces.

---

# 31. Search and discovery

## 31.1 Play/Spectate search

Replace court-only searching with:

- court name;
- court ID;
- match ID;
- match name;
- team names;
- player names;
- tournament name;
- tournament ID.

Placeholder:

`Search courts, matches, players or tournaments`

## 31.2 Ranking

Exact matches first:

1. match ID;
2. tournament ID;
3. court ID;
4. court name;
5. match name;
6. player/team exact;
7. substring.

## 31.3 Result context

Show:

```text
FRIDAY NIGHT FINAL
Court 03
John & Mike vs Sam & Dave
LIVE
Match abc123
```

## 31.4 Historical matches

Normal live browsing may exclude old matches from the default list.

Historical matches remain discoverable by:

- match ID;
- link;
- tournament;
- admin/history view.

---

# 32. Routes

Required:

```text
/m/{matchId}
/t/{tournamentId}
```

Existing routes remain operational:

```text
/c/{courtId}
/p/{...}
/b/{...}
/overlay/{...}
```

## 32.1 `/m/{matchId}`

If live:

- resolve current court;
- open live match experience.

If scheduled/historical with no court:

- show standalone match details.

If invalid:

- show intentional not-found state.

## 32.2 Dedicated `/m/{matchId}` route

For this tournament implementation, `/m/**` is assumed to be available and dedicated to match routing.

The canonical match URL is:

```text
/m/{matchId}
```

The repository's existing non-match functionality that currently uses `/m` will be moved to another endpoint separately. The tournament implementation must not depend on that old behaviour and must not prescribe the replacement endpoint.

Update all frontend/tests/docs references.

---

# 33. Sharing and QR

## 33.1 Match link

Canonical:

```text
/m/{matchId}
```

Match QR must remain valid after court reuse.

## 33.2 Court QR

Court QR remains court-centric:

> follow the live match currently on this physical court.

## 33.3 Tournament QR

Tournament QR:

```text
/t/{tournamentId}
```

The public tournament landing page should include live/current round information.

## 33.4 Share card

Match share image/text should include:

- Padel Push identity;
- match name where available;
- team/player names;
- current/final score;
- court as secondary context if desired;
- canonical match URL.

---

# 34. Admin / host application structure

Top-level sections:

```text
Courts
Matches
Tournaments
Devices
```

Tournament area:

```text
Overview
Participants / Teams
Rounds
Schedule
Standings
Bracket
Results
Rules
Settings
```

## 34.1 Match admin

Support:

- create;
- search;
- inspect;
- assign;
- move;
- detach;
- resume;
- complete;
- cancel;
- reset.

## 34.2 Tournament admin

Support:

- create;
- configure;
- publish;
- generate;
- schedule;
- start;
- operate;
- add rounds;
- correct result;
- complete;
- cancel;
- share.

---

# 35. Tournament creation workflow

## Step 1 - Basics

- name;
- description;
- date/time;
- optional club;
- visibility.

The club field is optional. Selecting a club immediately establishes the court-picker preference context for the rest of tournament setup.

## Step 2 - Format

Select required modes.

## Step 3 - Format settings

Render only relevant options.

## Step 4 - Participants

Add players or teams.

## Step 5 - Courts

Choose physical courts. If a club was selected in Step 1, surface that club's eligible courts first and clearly label the preferred club court group. Courts outside the club remain selectable.

Changing the selected club while the tournament is still in draft/setup must re-rank the available court candidates without silently changing explicit selections that remain valid.

## Step 6 - Schedule

Choose:

- automatic;
- manual;
- generate first round only;
- generate full schedule where appropriate.

## Step 7 - Review

Show:

- participant count;
- match count;
- court requirement;
- estimated duration;
- bye/sitting-out preview;
- rules summary.

## Step 8 - Publish

Create public `/t/{tournamentId}`.

---

# 36. Validation

Block:

- insufficient players;
- invalid team sizes;
- invalid scoring values;
- impossible group configuration;
- invalid bracket configuration;
- missing court dependencies when mandatory;
- invalid or inaccessible `clubId`;
- selected court IDs that cannot be resolved;
- duplicate participant identities within a team;
- unsupported format combinations.

Warn for:

- likely repeated byes;
- low number of rounds for social formats;
- likely event overrun;
- excessive participant idle time;
- very high opponent repetition.

---

# 37. Participant management

Host can:

- add;
- edit;
- remove before lock;
- seed;
- withdraw;
- restore withdrawal before fixture lock;
- create teams;
- edit teams;
- replace team members before they have played.

After fixtures have started:

- do not silently rewrite historical participants;
- withdrawals affect only future scheduling;
- replacements are explicit and audited.

Bulk paste of participant names should be supported for practical event setup.

---

# 38. Standings engine

The standings engine must support:

- participant standings;
- team standings;
- points;
- wins/losses;
- draws;
- played;
- point difference;
- set/game difference;
- head-to-head;
- strength-of-opponents tie-break where configured;
- movement/form;
- byes/sits;
- withdrawn status.

Standings are derived from authoritative match results.

Client-written standings are never trusted.

---

# 39. Result ingestion

Flow:

```text
Normal Padel Push match completes
    -> validate fixture/match association
    -> calculate canonical result
    -> persist fixture result
    -> update standings/progression
    -> update tournament read model
    -> push public UI update
```

Only valid completed match results affect standings.

A match can never be considered a tournament result merely because the frontend says it is finished.

---

# 40. Public read model

To avoid N+1 reads, derive a compact tournament view model containing:

```js
{
  tournamentId,
  name,
  club: { clubId, name } | null,
  format,
  rulesSummary,
  status,
  currentRound,

  liveMatches: [...],

  standings: [...],

  roundSummaries: [...],

  bracketSummary: {...} | null,

  sittingOut: [...]
}
```

Each match summary should include:

- matchId;
- matchName;
- court;
- participants;
- score;
- status;
- scheduled time.

---

# 41. Security

The existing repository's Firestore rules are intentionally permissive for emulator/test workflows and are not acceptable as production authorization.

Production must enforce authorization at the mutation boundary.

Protect:

- tournament creation/editing, including `clubId`;
- participant/team changes;
- round generation;
- fixture generation;
- court assignment;
- match move;
- match reset;
- result correction;
- bracket advancement;
- standings writes;
- tournament completion/cancellation.

Public reads may remain unauthenticated where the event is public.

Never trust a client-provided:

- tournament status;
- match status;
- active court;
- fixture winner;
- standings;
- bracket advancement;
- score summary.

---

# 42. Transactions and concurrency

Use Firestore transactions or atomic writes for any state transition affecting multiple documents.

Examples:

### Assign match to court

Atomically:

- check destination court;
- check match not already active;
- set court activeMatchId;
- set match currentCourtId;
- set live status.

### Move match

Atomically:

- verify destination;
- release old court;
- assign new court;
- update match.

### Generate next round

Atomically:

- verify current latest round;
- allocate the next number;
- create the round;
- create fixtures;
- create matches;
- mark generation complete.

### Generate button idempotency

Two rapid clicks must not create duplicate rounds or duplicate fixtures.

---

# 43. Audit trail

Audit:

- tournament creation;
- publish/start/complete/cancel;
- round generation;
- court assignment/move;
- match reset;
- result correction;
- participant withdrawal;
- club association change;
- bracket correction.

Record:

```js
{
  operation,
  tournamentId,
  roundId,
  fixtureId,
  matchId,
  actor,
  timestamp,
  beforeSummary,
  afterSummary,
  reason
}
```

Avoid logging passwords, secrets or unnecessary personal data.

---

# 44. Search/read efficiency

Do not perform one Firestore read per result row.

Prefer:

- summary/read-model documents;
- batched reads;
- targeted listeners;
- local filtering after initial discovery load;
- lazy historical match detail loading.

---

# 45. Device and hardware integration

Hardware is court-specific.

When a match moves:

- match ID stays unchanged;
- device binding does not move with the match;
- destination court's devices become relevant;
- scoreboard follows match identity;
- physical orientation remains a court/session concern.

Do not put device IDs into the durable tournament participant/match identity unless they are audit-only fields.

---

# 46. Current frontend state migration

Current `script.js` has a court-centric `currentCourtId`.

Do not perform a blind global rename.

Add:

```js
currentMatchId
currentCourtId
```

Classify every usage:

- court-specific;
- match-specific;
- relationship-specific;
- obsolete.

Introduce a `MatchContext` abstraction:

```js
{
  matchId,
  currentCourtId,
  match,
  court,
  tournament,
  round,
  fixture
}
```

---

# 47. Frontend module decomposition

Do not make the existing monolithic `script.js` even more monolithic.

Use logical modules such as:

```text
app/js/tournament/
  tournamentApi.js
  tournamentState.js
  tournamentFormatRegistry.js
  formats/
    americano.js
    mexicano.js
    teamAmericano.js
    teamMexicano.js
    roundRobin.js
    swiss.js
    singleElimination.js
    doubleElimination.js
    groupKnockout.js
    kingCourt.js
  standings.js
  scheduling.js
  tournamentSearch.js
  tournamentViews.js
```

Exact filenames can differ, but responsibilities must remain isolated.

---

# 48. UX visual standards

The tournament UI must look like a mature Padel Push product.

## 48.1 Style

Use:

- restrained colour palette;
- strong typography;
- high information density only where operationally useful;
- generous spacing on public views;
- clean cards;
- clear hierarchy;
- subtle state accents;
- large scores;
- consistent controls.

Avoid:

- noisy gradients;
- excessive animations;
- dashboard widgets that provide no decision value;
- tiny type;
- colour-only statuses;
- spreadsheet-like public views.

## 48.2 Status chips

Consistent vocabulary:

```text
LIVE
READY
UP NEXT
SCHEDULED
COMPLETED
DELAYED
SITTING OUT
BYE
TBD
```

## 48.3 Responsive behaviour

Phone:

- stacked;
- one primary action at a time;
- sticky live/current context when useful.

Tablet/desktop:

- two-column or multi-column operational layout;
- standings and live courts visible together.

Large display:

- readable from a short distance;
- no tiny metadata;
- prominent current matches and rankings.

---

# 49. Host control-room layout

Recommended desktop composition:

```text
+------------------------------------------------------+
| Tournament name | LIVE | Round 6 | Share | QR       |
+------------------------------------------------------+
| 4 LIVE | 2 READY | 1 AVAILABLE | 1 SITTING OUT      |
+----------------------------+-------------------------+
| LIVE COURTS                | NEXT / EXCEPTIONS      |
| Court 1  Match A  18-14    | Match E  Court 4      |
| Court 2  Match B  21-15    | Match F  unassigned   |
| Court 3  Match C  LIVE     | Player X sitting out  |
+----------------------------+-------------------------+
| Standings / Round / Bracket                          |
+------------------------------------------------------+
```

Do not require a host to navigate through multiple modal screens for routine court operations.

---

# 50. Spectator dashboard layout

Recommended:

```text
EVENT HEADER
Format + concise rules

LIVE NOW
[Match card] [Match card] [Match card]

ROUND 6
Schedule / courts

STANDINGS
Rank | Name | Points | Played | Form

BRACKET / ROUND HISTORY

RULES
```

On mobile, use tabs or collapsible sections only where needed.

---

# 51. Rules display

Every tournament must have a generated rules summary.

Example:

```text
AMERICANO

36 total points
4 serves per player
Serve rotation: A1, B1, A2, B2
1 serve per player before rotation repeats
Swap sides after each player serves once
Individual standings: total points won
```

The host must be able to preview exactly what spectators will see.

---

# 52. Match names generated by tournaments

Fixtures should receive meaningful match names.

Examples:

```text
Round 4 - Match 2
Semi-final 1
Final
Court 2 - Round 5
```

Bracket labels should prefer:

```text
Quarter-final
Semi-final
Final
```

The host may override the match name.

`matchId` remains the technical identity.

---

# 53. Historical match access

Completed matches remain reachable through `/m/{matchId}` even when:

- the original court is reused;
- the original court is renamed;
- the match is detached;
- the tournament is completed;
- the tournament is no longer live.

Historical match pages must show:

- match name;
- participants;
- score;
- scoring rules used;
- tournament/round context;
- court at time of play where known;
- completion timestamp.

---

# 54. Tournament completion and early finish

A host may:

- complete normally when required fixtures are done;
- finish early.

Finish-early behaviour:

- mark tournament completed;
- preserve incomplete fixtures;
- calculate standings from actual played results;
- do not fabricate results;
- record reason/audit event.

---

# 55. Result correction

Corrections are explicit and audited.

A correction must:

1. require host/admin authorization;
2. preserve original match event history;
3. create correction metadata;
4. update fixture result snapshot;
5. recompute standings;
6. recompute bracket if necessary;
7. recompute downstream progression if necessary.

Never silently edit a historical outcome.

---

# 56. Tournament visibility and sharing

Default:

```text
public
```

unless host chooses private.

Public event page can be shared without login.

Private tournament:

- public URL exists;
- access requires configured visibility/access control;
- no sensitive participant information leaks into public reads.

---

# 57. Error handling

Translate backend failures into actionable UI.

Examples:

```text
Court 3 is already occupied.
This match is currently on Court 5.
Round 7 cannot be generated because a player is withdrawn.
Another host session changed the tournament. Refresh and retry.
```

Do not expose Firestore paths, stack traces or internal errors.

---

# 58. Idempotency

These operations must be idempotent or safely reject duplicates:

- create tournament;
- update tournament association/configuration;
- publish;
- generate round;
- create fixture/match;
- assign court;
- move match;
- start match;
- complete match;
- result correction.

A double-tap must never create two Round 7s.

---

# 59. Performance

Avoid:

- N+1 tournament reads;
- loading every score event into the public tournament page;
- polling every court continuously;
- recalculating all historical matches on every repaint.

Prefer:

- derived summaries;
- targeted real-time listeners;
- server-side standings/progression;
- lazy match details;
- local search.

---

# 60. Required backend operations

Provide server-authoritative functions equivalent to:

```text
createTournament
updateTournament
publishTournament
startTournament
completeTournament
cancelTournament

addTournamentParticipant
updateTournamentParticipant
withdrawTournamentParticipant

createTournamentTeam
updateTournamentTeam

generateTournamentRound
generateNextTournamentRound

createFixtureMatch
assignFixtureCourt
moveFixtureCourt
detachFixtureMatch

startMatch
resumeMatch
completeMatch
cancelMatch
resetMatch

correctTournamentResult
recalculateTournament
```

Function names may differ but responsibilities must exist.

---

# 61. Tournament API/read surfaces

The implementation should expose read operations equivalent to:

```text
getTournament
getTournamentOverview
getTournamentRound
getTournamentStandings
getTournamentBracket
getTournamentSchedule
getTournamentParticipants
getTournamentMatchList
getTournamentLiveMatches
getTournamentCourtOptions
getClubCourts (where club data is exposed through the platform API)
```

Use a compact public read model wherever possible.

---

# 62. Firestore collection structure

Target structure:

```text
clubs/{clubId}
courts/{courtId}

matches/{matchId}
matches/{matchId}/events/{eventId}
matches/{matchId}/checkpoints/{checkpointId}

tournaments/{tournamentId}
tournaments/{tournamentId}/participants/{participantId}
tournaments/{tournamentId}/teams/{teamId}
tournaments/{tournamentId}/rounds/{roundId}
tournaments/{tournamentId}/fixtures/{fixtureId}
tournaments/{tournamentId}/audits/{auditId}

devices/{deviceId}
```

A derived/public summary can live on the tournament document or in a dedicated `publicViews` collection depending on query/performance needs.

---

# 63. Firestore indexes

Review every tournament query against `firestore.indexes.json`.

Add only required composite indexes for:

- tournament fixtures by round/status;
- fixtures by court/time;
- courts by club/status where required by the club-aware court picker;
- public tournament discovery if implemented;
- matches by tournament/status;
- standings ordering if not precomputed.

Do not introduce unnecessary indexes.

---

# 64. Migration / data reset

Existing live/test data may be wiped.

Do not implement migration compatibility.

The new model becomes authoritative immediately.

Do not keep production dual-scoring sources:

```text
courts/{courtId}/events
```

and:

```text
matches/{matchId}/events
```

The target production scoring source is match-scoped.

---

# 65. Match route reservation

The implementation may assume that `/m/{matchId}` is available and dedicated to match routing.

The repository's existing `/m` functionality will be moved to another endpoint as part of the broader repository work. The tournament implementation must **not** spend scope resolving that conflict and must not depend on the old `/m` behaviour.

Required for the tournament implementation:

1. reserve `/m/**` for match pages;
2. implement `/m/{matchId}` as the canonical match route;
3. ensure all tournament links use `/m/{matchId}`;
4. add route regression tests for the dedicated match route.

The exact replacement endpoint for the existing non-match `/m` functionality is outside this specification.

## 65.1 Documentation and solution-state synchronisation

The implementation is not complete until the repository documentation reflects the actual Padel Push solution state produced by this specification. Documentation work is a required implementation task, not optional cleanup.

At minimum, the agent must audit and update all repository documentation that describes:

- the overall Padel Push architecture and product boundary;
- clubs, courts, matches and tournaments and their relationships;
- the tournament data model, including optional `clubId`;
- court selection and the club-first court-picker behaviour;
- match identity and `/m/{matchId}` routing;
- scoring/event/replay architecture;
- tournament APIs, workflows and operational behaviour;
- public and host-facing URLs and examples;
- deployment, Firestore rules/indexes and test/QA expectations.

The agent must also clean up inaccuracies and stale descriptions discovered during implementation. In particular, documentation must not continue to imply that tournaments are court-only, that a tournament must belong to a club, that club selection automatically assigns every club court, that matches are identified by courts, or that the old non-match `/m` behaviour remains the canonical match surface.

Where a document conflicts with the implemented architecture, update the document to the resulting solution state rather than preserving obsolete v4 terminology for historical reasons. Keep this specification as the authoritative implementation contract for the tournament solution.

---

# 66. Test strategy

## 66.1 Core and club-context unit tests

Club-aware tournament setup:

- tournament with no club;
- tournament with a club;
- club reference persistence;
- club-first court candidate ordering;
- courts outside the club remain selectable;
- selecting a club does not implicitly populate the tournament `courtPool`;
- changing club in draft/setup re-ranks candidates without corrupting explicit valid selections;
- invalid/inaccessible club is rejected;
- club association is locked once the tournament is live;
- club-to-court relationship resolves from the authoritative platform data model.

Americano:

- 4, 8, 12, 16 players;
- odd player counts;
- partner rotation;
- repeated opponent minimisation;
- sitting-out fairness;
- extra rounds;
- deterministic seeds;
- 36-point scoring;
- 4 serves each;
- one-serve player rotation;
- side swap cycles;
- ties.

Mexicano:

- first round;
- later standings-based rounds;
- ties in standings;
- repetition avoidance;
- byes;
- added rounds.

Team Americano / Team Mexicano:

- fixed partners;
- opponent rotation;
- standings;
- odd team counts.

Round Robin:

- even and odd counts;
- every pair exactly once;
- bye rotation.

Swiss:

- score groups;
- repeat avoidance;
- standings proximity;
- odd team count;
- fixed round count.

Single Elimination:

- powers of two;
- non-powers of two;
- byes;
- seeded draws;
- advancement;
- final.

Double Elimination:

- winners bracket;
- losers bracket;
- second-loss elimination;
- grand final;
- dependency resolution.

Group + Knockout:

- group generation;
- group robin;
- standings;
- qualifiers;
- knockout.

King/Queen:

- movement;
- queue;
- ties;
- court assignment;
- repeated rounds.

## 66.2 Integration tests

Test complete flows:

```text
Create tournament
-> configure
-> add participants
-> generate
-> create matches
-> assign courts
-> score
-> complete
-> update standings
-> generate next round
-> move a live match
-> view public page
-> view historical match
-> complete tournament
```

## 66.3 Frontend tests

Add tests for:

- optional club selector;
- club-first court picker ordering;
- visible club context in tournament setup;
- preserving explicit court selections when club context changes during setup;

- `/m/{matchId}`;
- `/t/{tournamentId}`;
- public dashboard;
- host dashboard;
- round view;
- standings;
- bracket;
- sitting-out list;
- dynamic round generation;
- match-name scoreboard;
- match move;
- search.

## 66.4 Regression

All existing scoring/overlay/lifecycle tests must continue to pass.

---

# 67. Acceptance criteria

The implementation is complete only if all are true.

### Core match architecture

- Match has durable `matchId`.
- Events/checkpoints are match-scoped.
- Match survives court changes.
- Reset is match-scoped.
- Court remains physical.
- Court status remains `open`, `closed`, `private`.

### Club-aware tournaments

- A tournament may be created without a club.
- A tournament may be associated with a club.
- The selected `clubId` is persisted on the tournament.
- When a club is selected, its eligible courts surface first in tournament setup.
- Courts outside the club remain selectable.
- Selecting a club does not silently add all of its courts to the tournament `courtPool`.
- Club association is appropriately locked once the tournament is live.
- Public/host read models show the associated club when present.

### Tournament formats

- Americano works.
- Mexicano works.
- Team Americano works.
- Team Mexicano works.
- Round Robin works.
- Swiss works.
- Single Elimination works.
- Double Elimination works.
- Group + Knockout works.
- King/Queen of the Court works.

### Americano specifically

- 36-point example can be configured.
- 4 serves/player can be configured.
- one-serve-per-player rotation can be configured.
- side swap after each full player-serve cycle can be configured.
- scoring rules appear on the tournament view.
- matches use the shared Padel Push scoring engine.
- generated matches use normal match lifecycle.

### Rounds

- additional rounds can be generated after the event starts;
- existing rounds never regenerate;
- generation is idempotent;
- prior pairing history is considered;
- time-remaining use case works.

### Sitting out

- explicit sitting-out list;
- no fake loss;
- no fake match;
- bye history tracked;
- repeated sits-out are minimised.

### Scoreboard

- match name is primary;
- court is secondary;
- moving the match preserves match identity;
- overlay follows the same rule.

### Public experience

- `/t/{tournamentId}` works;
- live matches are clear;
- standings are current;
- rules are visible;
- rounds/history are browsable;
- bracket is usable where applicable;
- mobile/desktop layouts are professional and readable.

### Operations

- host can create, start, schedule, move, extend, correct and complete;
- courts remain usable independently;
- historical matches remain accessible;
- sharing/QR remain stable.

### Documentation

- repository documentation reflects the final club-aware tournament architecture;
- stale/inaccurate v4 descriptions have been removed or corrected;
- docs covering routes, data model, scoring, club/court relationships and setup workflows agree with the implementation.

---

# 68. AI coding-agent implementation sequence

The agent must not attempt a giant UI-first rewrite.

## Phase 1 - Audit

Read:

- `functions/index.js`;
- `functions/scoringEngine.js`;
- existing tests;
- `app/js/script.js`;
- `app/overlay.html`;
- `firebase.json`;
- Firestore rules/indexes;
- architecture/data-model/scoring docs;
- any existing club/court documentation and data model.

Map every court-centric scoring dependency and identify the authoritative club-to-court relationship.

## Phase 2 - Match foundation

Implement and test:

- match collection;
- event/checkpoint move;
- match lifecycle;
- court attach/detach/move;
- reset;
- match URL;
- sharing/QR.

## Phase 3 - Shared scoring profile

Implement and test:

- `fixedTotalPoints`;
- serve order;
- serve count;
- serve block length;
- side swaps;
- tie resolution;
- score persistence/replay.

Do this before Americano/Mexicano.

## Phase 4 - Tournament data model

Implement:

- optional tournament-to-club association;
- club-aware tournament read models;
- tournaments;
- participants;
- teams;
- rounds;
- fixtures;
- audits;
- read models.

## Phase 5 - Format engine

Implement in this order:

1. Americano;
2. Mexicano;
3. Team Americano;
4. Team Mexicano;
5. Round Robin;
6. Swiss;
7. Single Elimination;
8. Double Elimination;
9. Group + Knockout;
10. King/Queen.

Each format gets unit tests before moving on.

## Phase 6 - Scheduler/court operations

Implement:

- club-prioritised court selection;
- automatic scheduling;
- manual overrides;
- delays;
- dynamic extra rounds;
- sitting-out;
- byes;
- match moves.

## Phase 7 - Host UI

Implement control-room dashboard.

## Phase 8 - Public UI

Implement:

- tournament home;
- round;
- standings;
- bracket;
- match links.

## Phase 9 - Scoreboard/overlay integration

Apply match-name-first identity.

## Phase 10 - Security + deployment

Finalize:

- authorization;
- Firestore rules;
- indexes;
- routing;
- region usage;
- production error contracts.

## Phase 11 - Documentation synchronisation

Update the repository's architecture, data-model, route, scoring, club/court, tournament and operational documentation to reflect the implemented v5 solution. Correct stale or inaccurate claims rather than carrying them forward.

## Phase 12 - Full QA

Run existing and new tests, including club-aware setup, routing and concurrency cases.

---

# 69. Implementation quality rules

The AI coding agent must:

- prefer existing Padel Push utilities over duplication;
- keep format algorithms pure/testable;
- keep mutations server-authoritative;
- avoid unnecessary dependencies;
- preserve current scoring behaviour;
- avoid breaking hardware/NFC/device flows;
- avoid changing unrelated screens;
- use clear naming;
- add comments only where behaviour is non-obvious;
- keep public UI free of technical identifiers unless useful;
- keep technical IDs accessible to hosts/admins;
- keep documentation synchronized with the actual implemented solution state.

---

# 70. Non-negotiable rules

1. `matchId` is permanent match identity.
2. `courtId` is physical location.
3. Tournament formats orchestrate normal matches.
4. There is one shared score engine.
5. There is one event/replay architecture.
6. Match reset never creates a new match ID.
7. Court status remains `open`, `closed`, `private`.
8. A court has at most one live match.
9. A live match has at most one court.
10. Match links survive court reuse.
11. Tournament rules are structured configuration.
12. Historical scoring configuration is immutable.
13. Extra rounds append rather than regenerate history.
14. Sitting-out is explicit.
15. A bye is not a loss.
16. Standings derive from canonical match results.
17. Host mutations are server-authoritative.
18. Public tournament view does not require an active court.
19. Match name is primary scoreboard identity.
20. `/m/{matchId}` is reserved for match pages.
21. The existing non-match `/m` functionality is outside the tournament route contract and will be moved separately.
22. No dual production scoring model.
23. The host can operate the event from a phone.
24. Spectators can understand the event without technical knowledge.
25. The UI must look like a finished Padel Push product, not an admin spreadsheet.
26. Format expansion must happen through the format interface, not by duplicating core architecture.
27. Documentation is part of the implementation and must describe the resulting solution accurately.
28. A tournament may optionally reference a club; when it does, club courts are prioritised in setup without becoming a hidden court assignment.

---

# Appendix A - Format coverage rationale

Current 2026 padel tournament software/documentation consistently groups the practical club landscape around rotating-partner social formats such as Americano/Mexicano/King of the Court and fixed-partner competitive formats such as Round Robin, Single/Double Elimination, Swiss and Group Stage Knockout. Team Americano is also a common fixed-pair variant.

The selected Padel Push set therefore deliberately covers:

- social rotation;
- standings-driven rotation;
- fixed teams;
- complete leagues;
- Swiss competition;
- single and double elimination;
- group-to-bracket competition;
- court-rotation play.

The system also supports format modifiers rather than creating a separate mode for every variation.

---

# Appendix B - Example Americano rules

```text
AMERICANO

36 total rally points
4 serves per player
Serve order: A1 -> B1 -> A2 -> B2
One serve per player per cycle
Swap sides after each player has served once
Individual standings: cumulative points won

Example:
A/B = 19
C/D = 17

A +19
B +19
C +17
D +17
```

---

# Appendix C - Example public tournament page

```text
FRIDAY NIGHT PADEL SOCIAL
Example Padel Club
Americano

36 points · 4 serves/player
Swap sides after each player serves once

LIVE NOW

COURT 1
Friday Night Final
Alice / Ben        21
Chris / Dan        15
LIVE

COURT 2
Round 6 - Match 2
Eva / Finn         18
Gina / Hugo        18
LIVE

ROUND 6

NEXT
Court 3 - Iris / Jack vs Kim / Leo

SITTING OUT
Maya

STANDINGS

1  Alice       92
2  Dan         88
3  Chris       86
4  Ben         84
...
```

---

# Appendix D - Example host control room

```text
PADEL PUSH
EXAMPLE PADEL CLUB · FRIDAY NIGHT PADEL SOCIAL
LIVE · ROUND 6

4 LIVE    1 READY    2 AVAILABLE    1 SITTING OUT

LIVE COURTS
Court 1  Friday Night Final       21-15
Court 2  Round 6 - Match 2        18-18
Court 3  Semi-final                6-4
Court 4  Round 6 - Match 4        READY

NEXT
Round 6 - Match 5 -> Court 4

EXCEPTIONS
No blocking issues

STANDINGS
1 Alice 92
2 Dan 88
3 Chris 86
...
```

---

# Appendix E - Format implementation checklist

Before marking each format complete:

- config schema implemented;
- config validation implemented;
- participant validation implemented;
- round generation implemented;
- additional-round generation implemented where applicable;
- deterministic seed/snapshot implemented;
- bye/sitting-out handling implemented;
- standings calculation implemented;
- tie-breaks implemented;
- normal Padel Push matches created;
- results ingested;
- public display implemented;
- host display implemented;
- historical reconstruction tested;
- concurrency/idempotency tested.

---

# Appendix F - Reference material

The following current format references informed the concrete mode coverage and terminology:

- Padeli - Padel social formats, updated May 2026.
- Padelio Help - tournament formats, updated May 2026.
- The Padel Organizer - Americano, Mexicano, Team Americano, Round Robin, Group + Knockout, Single Elimination.
- ScorePal - tournament formats including Americano, Mexicano, Round Robin, King of the Court, ladder, group/knockout, single/double elimination and Swiss.
- Padelturn - current Americano/Mexicano/league/knockout format guidance.

Padel Push's structured tournament configuration is authoritative; external sources do not override a tournament's stored rules.

---

# Appendix G - Final definition of the product boundary

**Padel Push platform context**

```text
Clubs
Courts
Devices
```

**Padel Push core match system**

```text
Matches
Scoring
Events
Checkpoints
Scoreboard
Overlay
Sharing
```

**Tournament suite**

```text
Tournaments
Participants
Teams
Formats
Rounds
Fixtures
Schedules
Standings
Brackets
Byes / Sitting Out
Live Dashboards
Public Tournament Views
```

**Relationship**

```text
Club (optional tournament context)
  -> eligible Courts

Tournament
  -> optional clubId
  -> explicit courtPool
  -> Format engine
      -> Round
          -> Fixture
              -> Match (normal Padel Push)
                  -> Scoring engine
                  -> Event history
                  -> Checkpoints
                  -> Scoreboard
                  -> Overlay
                  -> Sharing
```

The club relationship improves venue-aware tournament setup but does not replace the tournament's explicit court pool or change the durable match architecture. That relationship is the central architectural rule for the entire implementation.
