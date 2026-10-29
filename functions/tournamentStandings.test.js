const { calculateStandings } = require("./domain/tournaments/standings");
const tournaments = require("./domain/tournaments");

function participants(ids) {
  return ids.map((participantId, index) => ({
    participantId,
    displayName: participantId.toUpperCase(),
    seed: index + 1,
    status: "active",
  }));
}

function teams(ids, seeds = {}) {
  return ids.map((teamId, index) => ({
    teamId,
    name: teamId.toUpperCase(),
    participantIds: [],
    seed: seeds[teamId] ?? index + 1,
    status: "active",
  }));
}

function side(id, entryType = "team") {
  return entryType === "team"
    ? { teamId: id, participantIds: [] }
    : { teamId: null, participantIds: [id] };
}

function fixture({ id, a, b, entryType = "team", pointsA, pointsB, winner, stage, groupId, roundId = "r1", roundNumber = 1, courtLevel }) {
  return {
    fixtureId: id,
    roundId,
    roundNumber,
    label: id,
    stage,
    groupId,
    courtLevel,
    status: "completed",
    sides: { A: side(a, entryType), B: side(b, entryType) },
    resultSnapshot: {
      winner: winner || (pointsA === pointsB ? "draw" : pointsA > pointsB ? "A" : "B"),
      points: { A: pointsA, B: pointsB },
      games: { A: pointsA, B: pointsB },
      sets: { A: pointsA > pointsB ? 1 : 0, B: pointsB > pointsA ? 1 : 0 },
      scoringMode: "fixedTotalPoints",
      completedAt: roundNumber,
    },
  };
}

function state({ formatId = "americano", entryMode = "individual", participants: ps = [], teams: ts = [], fixtures = [], rounds = [], config = {} } = {}) {
  const format = tournaments.getFormat(formatId);
  return {
    tournament: {
      tournamentId: "standing-tests",
      participantMode: entryMode,
      format: { id: formatId, version: 1, config: format.normalizeConfig(config) },
    },
    participants: ps,
    teams: ts,
    fixtures,
    rounds,
  };
}

describe("shared tournament standings", () => {
  test("sporting ties share their rank instead of being broken by entry ID", () => {
    const seededParticipants = participants(["player-b", "player-a"]);
    seededParticipants[1].seed = seededParticipants[0].seed;
    const input = state({
      participants: seededParticipants,
      fixtures: [
        fixture({
          id: "draw",
          a: "player-b",
          b: "player-a",
          entryType: "participant",
          pointsA: 18,
          pointsB: 18,
        }),
      ],
    });

    const result = tournaments.getFormat("americano").calculateStandings(input);

    expect(result.rows.map((row) => row.rank)).toEqual([1, 1]);
    expect(result.rows.map((row) => row.totalPoints)).toEqual([18, 18]);
  });


  test("Americano uses initial seed as the final fallback after social scoring", () => {
    const seededParticipants = participants(["later-seed", "earlier-seed"]);
    seededParticipants[0].seed = 8;
    seededParticipants[1].seed = 2;
    const input = state({
      participants: seededParticipants,
      fixtures: [
        fixture({
          id: "draw",
          a: "later-seed",
          b: "earlier-seed",
          entryType: "participant",
          pointsA: 18,
          pointsB: 18,
        }),
      ],
    });

    const result = tournaments.getFormat("americano").calculateStandings(input);
    expect(result.tiebreakers.slice(-2)).toEqual(["seed", "entryId"]);
    expect(result.rows.find((row) => row.entryId === "earlier-seed").rank).toBe(1);
    expect(result.rows.find((row) => row.entryId === "later-seed").rank).toBe(2);
  });

  test("league standings use initial seed only after all sporting tiebreakers tie", () => {
    const input = state({
      formatId: "roundRobin",
      entryMode: "team",
      teams: teams(["later-seed", "earlier-seed"], {
        "later-seed": 8,
        "earlier-seed": 2,
      }),
      fixtures: [
        fixture({
          id: "draw",
          a: "later-seed",
          b: "earlier-seed",
          pointsA: 8,
          pointsB: 8,
          winner: "draw",
        }),
      ],
    });

    const result = tournaments.getFormat("roundRobin").calculateStandings(input);
    expect(result.tiebreakers.slice(-2)).toEqual(["seed", "entryId"]);
    expect(result.rows.find((row) => row.entryId === "earlier-seed").rank).toBe(1);
    expect(result.rows.find((row) => row.entryId === "later-seed").rank).toBe(2);
  });

  test("usePointDiff false removes point difference from social ranking", () => {
    const input = state({
      participants: participants(["z-player", "a-player", "x", "y"]),
      fixtures: [
        fixture({ id: "z-game", a: "z-player", b: "x", entryType: "participant", pointsA: 10, pointsB: 0 }),
        fixture({ id: "a-game", a: "a-player", b: "y", entryType: "participant", pointsA: 10, pointsB: 8 }),
      ],
    });

    const format = tournaments.getFormat("americano");
    const withDifference = format.calculateStandings(input);
    // Keep the seeds equal so this assertion isolates point-difference
    // configuration rather than the final seed fallback.
    const noDifferenceParticipants = input.participants.map((participant) =>
      ["z-player", "a-player"].includes(participant.participantId)
        ? { ...participant, seed: 1 }
        : participant,
    );
    const noDifferenceState = state({
      participants: noDifferenceParticipants,
      config: { usePointDiff: false },
      fixtures: input.fixtures,
    });
    const withoutDifference = format.calculateStandings(noDifferenceState);

    expect(withDifference.rows.find((row) => row.entryId === "z-player").rank).toBe(1);
    expect(withDifference.rows.find((row) => row.entryId === "a-player").rank).toBe(2);
    expect(withoutDifference.tiebreakers).not.toContain("pointDiff");
    expect(withoutDifference.rows.find((row) => row.entryId === "z-player").rank).toBe(1);
    expect(withoutDifference.rows.find((row) => row.entryId === "a-player").rank).toBe(1);
  });

  test("head-to-head counts match outcomes, not the size of the point margin", () => {
    const input = state({
      formatId: "roundRobin",
      entryMode: "team",
      teams: teams(["z-team", "a-team"]),
      fixtures: [
        fixture({ id: "first", a: "z-team", b: "a-team", pointsA: 6, pointsB: 0, winner: "A" }),
        fixture({ id: "second", a: "z-team", b: "a-team", pointsA: 0, pointsB: 1, winner: "B", roundNumber: 2, roundId: "r2" }),
      ],
    });

    const result = calculateStandings(input, {
      entryType: "team",
      formatId: "roundRobin",
      tiebreakers: ["headToHead", "entryId"],
    });
    const aTeam = result.rows.find((row) => row.entryId === "a-team");
    const zTeam = result.rows.find((row) => row.entryId === "z-team");

    expect(aTeam.rank).toBe(1);
    expect(zTeam.rank).toBe(1);
    expect(aTeam.rank).toEqual(zTeam.rank);
  });

  test("re-evaluates head-to-head among entries left tied by later tiebreakers", () => {
    const input = state({
      formatId: "roundRobin",
      entryMode: "team",
      teams: teams(["a", "b", "c", "d"]),
      fixtures: [
        fixture({ id: "a-beats-b", a: "a", b: "b", pointsA: 6, pointsB: 3 }),
        fixture({ id: "c-beats-a", a: "a", b: "c", pointsA: 4, pointsB: 5 }),
        fixture({ id: "a-draws-d", a: "a", b: "d", pointsA: 4, pointsB: 4 }),
        fixture({ id: "b-draws-c", a: "b", b: "c", pointsA: 4, pointsB: 4 }),
        fixture({ id: "b-beats-d", a: "b", b: "d", pointsA: 5, pointsB: 4 }),
        fixture({ id: "d-beats-c", a: "c", b: "d", pointsA: 4, pointsB: 5 }),
      ],
    });

    const result = tournaments.getFormat("roundRobin").calculateStandings(input);

    // All four have equal competition points, wins and full-group head-to-head
    // totals. Difference then separates a/b from c/d; the direct c-vs-d result
    // must decide the remaining tie instead of falling back to their seeds.
    expect(result.rows.map((row) => row.entryId)).toEqual(["a", "d", "c", "b"]);
    expect(result.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
  });

  test("Swiss Buchholz counts repeated encounters with the same opponent", () => {
    const input = state({
      formatId: "swiss",
      entryMode: "team",
      teams: teams(["a", "b", "c"]),
      fixtures: [
        fixture({ id: "a-beats-b-1", a: "a", b: "b", pointsA: 8, pointsB: 1, winner: "A" }),
        fixture({ id: "a-beats-b-2", a: "a", b: "b", pointsA: 7, pointsB: 2, winner: "A", roundNumber: 2, roundId: "r2" }),
        fixture({ id: "b-beats-c", a: "b", b: "c", pointsA: 7, pointsB: 2, winner: "A", roundNumber: 3, roundId: "r3" }),
      ],
    });

    const result = tournaments.getFormat("swiss").calculateStandings(input);
    expect(result.rows.find((row) => row.entryId === "a").buchholz).toBe(6);
    expect(result.rows.find((row) => row.entryId === "b").buchholz).toBe(12);
  });

  test("withdrawal does not reassign already drawn groups", () => {
    const entries = teams(["t1", "t2", "t3", "t4"]);
    entries[0].status = "withdrawn";
    const input = state({
      formatId: "groupKnockout",
      entryMode: "team",
      config: { groupCount: 2, advancePerGroup: 1 },
      teams: entries,
      fixtures: [
        fixture({ id: "a-match", a: "t1", b: "t4", pointsA: 6, pointsB: 3, winner: "A", stage: "group", groupId: "A" }),
        fixture({ id: "b-match", a: "t2", b: "t3", pointsA: 6, pointsB: 3, winner: "A", stage: "group", groupId: "B" }),
      ],
    });

    const result = tournaments.getFormat("groupKnockout").calculateStandings(input);
    expect(result.rows.find((row) => row.entryId === "t1").groupId).toBe("A");
    expect(result.rows.find((row) => row.entryId === "t4").groupId).toBe("A");
    expect(result.rows.find((row) => row.entryId === "t2").groupId).toBe("B");
    expect(result.rows.find((row) => row.entryId === "t3").groupId).toBe("B");
  });

  test("fixtureFilter keeps group standings isolated from later knockout matches", () => {
    const input = state({
      formatId: "groupKnockout",
      entryMode: "team",
      config: { groupCount: 2, advancePerGroup: 1 },
      teams: teams(["t1", "t2", "t3", "t4"]).map((team) => ({ ...team, seed: null })),
      fixtures: [
        fixture({ id: "group-match", a: "t1", b: "t4", pointsA: 6, pointsB: 6, winner: "draw", stage: "group", groupId: "A" }),
        fixture({ id: "other-group-match", a: "t2", b: "t3", pointsA: 5, pointsB: 5, winner: "draw", stage: "group", groupId: "B" }),
        fixture({ id: "knockout-match", a: "t1", b: "t2", pointsA: 2, pointsB: 8, winner: "B", stage: "knockout", roundId: "r2", roundNumber: 2 }),
      ],
    });

    const result = tournaments.getFormat("groupKnockout").calculateStandings(input);
    expect(result.rows.find((row) => row.entryId === "t1").played).toBe(1);
    expect(result.rows.find((row) => row.entryId === "t1").draws).toBe(1);
    expect(result.rows.find((row) => row.entryId === "t2").played).toBe(1);
    expect(result.rows.find((row) => row.entryId === "t2").rank).toBe(1);
    expect(result.rows.find((row) => row.entryId === "t3").rank).toBe(1);
  });

  test("group-knockout standings and qualification honor configured win, draw, and loss points", () => {
    const input = state({
      formatId: "groupKnockout",
      entryMode: "team",
      config: {
        groupCount: 1,
        advancePerGroup: 2,
        pointsForWin: 4,
        pointsForDraw: 3,
        pointsForLoss: 0,
      },
      teams: teams(["a", "b", "c", "d"]),
      rounds: [
        {
          roundId: "r1",
          roundNumber: 1,
          fixtureIds: [
            "a-beats-b",
            "a-draws-c",
            "a-beats-d",
            "b-draws-c",
            "b-beats-d",
            "c-draws-d",
          ],
        },
      ],
      fixtures: [
        fixture({
          id: "a-beats-b",
          a: "a",
          b: "b",
          pointsA: 6,
          pointsB: 3,
          winner: "A",
          stage: "group",
          groupId: "A",
        }),
        fixture({
          id: "a-draws-c",
          a: "a",
          b: "c",
          pointsA: 6,
          pointsB: 6,
          winner: "draw",
          stage: "group",
          groupId: "A",
        }),
        fixture({
          id: "a-beats-d",
          a: "a",
          b: "d",
          pointsA: 6,
          pointsB: 3,
          winner: "A",
          stage: "group",
          groupId: "A",
        }),
        fixture({
          id: "b-draws-c",
          a: "b",
          b: "c",
          pointsA: 6,
          pointsB: 6,
          winner: "draw",
          stage: "group",
          groupId: "A",
        }),
        fixture({
          id: "b-beats-d",
          a: "b",
          b: "d",
          pointsA: 6,
          pointsB: 3,
          winner: "A",
          stage: "group",
          groupId: "A",
        }),
        fixture({
          id: "c-draws-d",
          a: "c",
          b: "d",
          pointsA: 6,
          pointsB: 6,
          winner: "draw",
          stage: "group",
          groupId: "A",
        }),
      ],
    });

    const format = tournaments.getFormat("groupKnockout");
    const standings = format.calculateStandings(input);
    expect(standings.rows.map((row) => [row.entryId, row.competitionPoints])).toEqual([
      ["a", 11],
      ["c", 9],
      ["b", 7],
      ["d", 3],
    ]);
    expect(standings.rows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);

    const knockout = format.generateNextRound(input);
    const qualifiedIds = knockout.fixtures
      .flatMap((fixture) => [fixture.sides.A?.teamId, fixture.sides.B?.teamId])
      .filter(Boolean)
      .sort();
    expect(qualifiedIds).toEqual(["a", "c"]);
  });
});

describe("King/Queen of the Court rules", () => {
  function kingState(config, ts, fixtures) {
    const input = state({
      formatId: "kingCourt",
      entryMode: "team",
      config,
      teams: ts,
      rounds: [{
        roundId: "r1",
        roundNumber: 1,
        generationSnapshot: { queue: [] },
      }],
      fixtures,
    });
    return input;
  }

  test("the stay-on-tie rule preserves both sides on their current court", () => {
    const ts = teams(["t1", "t2"]);
    const input = kingState(
      { courtCount: 1, tieBehaviour: "stay" },
      ts,
      [fixture({ id: "tie", a: "t1", b: "t2", pointsA: 6, pointsB: 6, stage: null, courtLevel: 1 })],
    );
    input.fixtures[0].roundId = "r1";

    const result = tournaments.getFormat("kingCourt").calculateNextCourtAssignments(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].courtLevel).toBe(1);
    expect([result.assignments[0].sides.A.teamId, result.assignments[0].sides.B.teamId].sort()).toEqual(["t1", "t2"]);
  });

  test("higher seed uses configured team seeds, not digits in IDs", () => {
    const ts = teams(["t1", "t2", "t3", "t4"], { t1: 10, t2: 1, t3: 3, t4: 4 });
    const input = kingState(
      { courtCount: 2, tieBehaviour: "higher_seed_wins" },
      ts,
      [
        fixture({ id: "court-1", a: "t3", b: "t4", pointsA: 5, pointsB: 2, winner: "A", courtLevel: 1 }),
        fixture({ id: "court-2-tie", a: "t1", b: "t2", pointsA: 5, pointsB: 5, courtLevel: 2 }),
      ],
    );
    input.fixtures.forEach((fixture) => (fixture.roundId = "r1"));

    const result = tournaments.getFormat("kingCourt").calculateNextCourtAssignments(input);
    const topCourt = result.assignments.find((assignment) => assignment.courtLevel === 1);
    expect(topCourt).toBeDefined();
    expect([topCourt.sides.A.teamId, topCourt.sides.B.teamId]).toContain("t2");
  });

  test("an entry sitting out the latest round keeps its last played court position", () => {
    const ts = teams(["t1", "t2", "t3", "t4"]);
    const earlier = fixture({
      id: "earlier-court-2",
      a: "t3",
      b: "t4",
      pointsA: 8,
      pointsB: 2,
      winner: "A",
      courtLevel: 2,
      roundId: "r1",
      roundNumber: 1,
    });
    const later = fixture({
      id: "latest-court-1",
      a: "t1",
      b: "t2",
      pointsA: 8,
      pointsB: 2,
      winner: "A",
      courtLevel: 1,
      roundId: "r2",
      roundNumber: 2,
    });
    const input = kingState({ courtCount: 2, finalRanking: "courtPosition" }, ts, [earlier, later]);
    input.rounds = [
      { roundId: "r1", roundNumber: 1, generationSnapshot: { queue: [] } },
      { roundId: "r2", roundNumber: 2, generationSnapshot: { queue: [] } },
    ];

    const result = tournaments.getFormat("kingCourt").calculateStandings(input);
    expect(result.rows.find((row) => row.entryId === "t1").finalCourtPosition).toBe(1);
    expect(result.rows.find((row) => row.entryId === "t3").finalCourtPosition).toBe(2);
  });

  test("court-priority points are based on the court played, for both sides", () => {
    const ts = teams(["t1", "t2", "t3", "t4", "t5", "t6"]);
    const fixtures = [
      fixture({ id: "top-court", a: "t1", b: "t2", pointsA: 6, pointsB: 3, courtLevel: 1 }),
      fixture({ id: "middle-court", a: "t3", b: "t4", pointsA: 3, pointsB: 6, courtLevel: 2 }),
      fixture({ id: "bottom-court", a: "t5", b: "t6", pointsA: 6, pointsB: 4, courtLevel: 3 }),
    ];
    fixtures.forEach((item) => (item.roundId = "r1"));

    const result = tournaments.getFormat("kingCourt").calculateStandings(
      kingState(
        { courtCount: 3, finalRanking: "points", scoringMethod: "courtPoints" },
        ts,
        fixtures,
      ),
    );
    const pointsByEntry = Object.fromEntries(
      result.rows.map((row) => [row.entryId, row.courtPoints]),
    );

    expect(pointsByEntry).toEqual({
      t1: 3,
      t2: 3,
      t3: 2,
      t4: 2,
      t5: 1,
      t6: 1,
    });
  });

  test("final ranking and scoring method each determine King Court standings", () => {
    const ts = teams(["t1", "t2", "t3", "t4"]);
    const fixtures = [
      fixture({
        id: "r1-court-1",
        a: "t2",
        b: "t4",
        pointsA: 5,
        pointsB: 1,
        courtLevel: 1,
        roundId: "r1",
        roundNumber: 1,
      }),
      fixture({
        id: "r1-court-2",
        a: "t1",
        b: "t3",
        pointsA: 10,
        pointsB: 2,
        courtLevel: 2,
        roundId: "r1",
        roundNumber: 1,
      }),
      fixture({
        id: "r2-court-1",
        a: "t2",
        b: "t3",
        pointsA: 5,
        pointsB: 1,
        courtLevel: 1,
        roundId: "r2",
        roundNumber: 2,
      }),
      fixture({
        id: "r2-court-2",
        a: "t1",
        b: "t4",
        pointsA: 10,
        pointsB: 1,
        courtLevel: 2,
        roundId: "r2",
        roundNumber: 2,
      }),
      fixture({
        id: "r3-court-1",
        a: "t2",
        b: "t1",
        pointsA: 5,
        pointsB: 1,
        courtLevel: 1,
        roundId: "r3",
        roundNumber: 3,
      }),
      fixture({
        id: "r3-court-2",
        a: "t3",
        b: "t4",
        pointsA: 1,
        pointsB: 100,
        courtLevel: 2,
        roundId: "r3",
        roundNumber: 3,
      }),
      fixture({
        id: "r4-court-1",
        a: "t1",
        b: "t3",
        pointsA: 5,
        pointsB: 1,
        courtLevel: 1,
        roundId: "r4",
        roundNumber: 4,
      }),
      fixture({
        id: "r4-court-2",
        a: "t2",
        b: "t4",
        pointsA: 5,
        pointsB: 100,
        courtLevel: 2,
        roundId: "r4",
        roundNumber: 4,
      }),
    ];
    const rounds = [1, 2, 3, 4].map((roundNumber) => ({
      roundId: `r${roundNumber}`,
      roundNumber,
      generationSnapshot: { queue: [] },
    }));
    const format = tournaments.getFormat("kingCourt");
    const calculate = (config) => {
      const input = kingState(config, ts, fixtures);
      input.rounds = rounds;
      return format.calculateStandings(input);
    };

    const byCourtPosition = calculate({
      courtCount: 2,
      finalRanking: "courtPosition",
      scoringMethod: "courtPoints",
    });
    const byCourtPoints = calculate({
      courtCount: 2,
      finalRanking: "points",
      scoringMethod: "courtPoints",
    });
    const byRallyPoints = calculate({
      courtCount: 2,
      finalRanking: "points",
      scoringMethod: "rallyPoints",
    });

    expect(byCourtPosition.rows[0].entryId).toBe("t1");
    expect(byCourtPoints.rows[0].entryId).toBe("t2");
    expect(byRallyPoints.rows[0].entryId).toBe("t4");
    expect(byCourtPosition.rows[0].finalCourtPosition).toBe(1);
    expect(byCourtPoints.rows[0].courtPoints).toBe(7);
    expect(byRallyPoints.rows[0].rallyPoints).toBe(202);
  });

  test("King Court uses seed only as a fallback after configured ranking criteria tie", () => {
    const ts = teams(["later-seed", "earlier-seed"], {
      "later-seed": 8,
      "earlier-seed": 2,
    });
    const input = kingState(
      {
        courtCount: 1,
        finalRanking: "points",
        scoringMethod: "rallyPoints",
      },
      ts,
      [
        fixture({
          id: "draw",
          a: "later-seed",
          b: "earlier-seed",
          pointsA: 6,
          pointsB: 6,
          courtLevel: 1,
          roundId: "r1",
          roundNumber: 1,
        }),
      ],
    );

    const result = tournaments.getFormat("kingCourt").calculateStandings(input);
    expect(result.tiebreakers.slice(-2)).toEqual(["seed", "entryId"]);
    expect(result.rows.find((row) => row.entryId === "earlier-seed").rank).toBe(1);
    expect(result.rows.find((row) => row.entryId === "later-seed").rank).toBe(2);
  });
});


  test("a three-way circular head-to-head does not create an arbitrary ranking cycle", () => {
    const input = state({
      formatId: "roundRobin",
      entryMode: "team",
      teams: teams(["a", "b", "c"]),
      fixtures: [
        fixture({ id: "a-beats-b", a: "a", b: "b", pointsA: 6, pointsB: 2, winner: "A" }),
        fixture({ id: "b-beats-c", a: "b", b: "c", pointsA: 6, pointsB: 2, winner: "A", roundId: "r2", roundNumber: 2 }),
        fixture({ id: "c-beats-a", a: "c", b: "a", pointsA: 6, pointsB: 2, winner: "A", roundId: "r3", roundNumber: 3 }),
      ],
    });

    const result = calculateStandings(input, {
      entryType: "team",
      formatId: "roundRobin",
      tiebreakers: ["headToHead", "entryId"],
    });

    expect(result.rows.map((row) => row.rank)).toEqual([1, 1, 1]);
    expect(result.rows.map((row) => row.entryId)).toEqual(["a", "b", "c"]);
  });

  test("league scoring awards configured competition points for wins, draws and losses", () => {
    const input = state({
      formatId: "roundRobin",
      entryMode: "team",
      config: { pointsForWin: 3, pointsForDraw: 1, pointsForLoss: 0 },
      teams: teams(["a", "b", "c"]),
      fixtures: [
        fixture({ id: "draw", a: "a", b: "b", pointsA: 18, pointsB: 18, winner: "draw" }),
        fixture({ id: "win", a: "c", b: "a", pointsA: 6, pointsB: 3, winner: "A", roundId: "r2", roundNumber: 2 }),
      ],
    });

    const result = tournaments.getFormat("roundRobin").calculateStandings(input);
    const a = result.rows.find((row) => row.entryId === "a");
    const b = result.rows.find((row) => row.entryId === "b");
    const c = result.rows.find((row) => row.entryId === "c");
    expect(a.competitionPoints).toBe(1);
    expect(a.draws).toBe(1);
    expect(a.losses).toBe(1);
    expect(b.competitionPoints).toBe(1);
    expect(b.draws).toBe(1);
    expect(c.competitionPoints).toBe(3);
    expect(c.wins).toBe(1);
  });


describe("King Court tie assignment safety", () => {
  test("a tied court plus incoming movement never drops an entry", () => {
    const entries = teams(["t1", "t2", "t3", "t4"]);
    const input = state({
      formatId: "kingCourt",
      entryMode: "team",
      config: { courtCount: 2, tieBehaviour: "stay" },
      teams: entries,
      rounds: [{ roundId: "r1", roundNumber: 1, generationSnapshot: { queue: [] } }],
      fixtures: [
        fixture({ id: "top-tie", a: "t1", b: "t2", pointsA: 6, pointsB: 6, courtLevel: 1, roundId: "r1" }),
        fixture({ id: "lower-match", a: "t3", b: "t4", pointsA: 8, pointsB: 3, courtLevel: 2, roundId: "r1" }),
      ],
    });

    const result = tournaments.getFormat("kingCourt").calculateNextCourtAssignments(input);
    const assigned = result.assignments.flatMap((assignment) => [
      assignment.sides.A.teamId,
      assignment.sides.B.teamId,
    ]);
    const accountedFor = [...assigned, ...result.queue];

    expect(assigned.filter((id) => ["t1", "t2"].includes(id)).sort()).toEqual(["t1", "t2"]);
    expect(accountedFor.sort()).toEqual(["t1", "t2", "t3", "t4"]);
    expect(new Set(accountedFor).size).toBe(4);
  });

  test("a missing seed cannot beat a valid seed by default in a tied match", () => {
    const entries = teams(["t1", "t2", "t3", "t4"]);
    entries[3].seed = null;
    const input = state({
      formatId: "kingCourt",
      entryMode: "team",
      config: { courtCount: 2, tieBehaviour: "higher_seed_wins" },
      teams: entries,
      rounds: [{ roundId: "r1", roundNumber: 1, generationSnapshot: { queue: [] } }],
      fixtures: [
        fixture({ id: "top-match", a: "t1", b: "t2", pointsA: 8, pointsB: 3, courtLevel: 1, roundId: "r1" }),
        fixture({ id: "lower-tie", a: "t3", b: "t4", pointsA: 6, pointsB: 6, courtLevel: 2, roundId: "r1" }),
      ],
    });

    const result = tournaments.getFormat("kingCourt").calculateNextCourtAssignments(input);
    const lowerCourt = result.assignments.find((assignment) => assignment.courtLevel === 2);
    expect(lowerCourt).toBeDefined();
    expect([lowerCourt.sides.A.teamId, lowerCourt.sides.B.teamId].sort()).toEqual(["t3", "t4"]);
  });

  test("individual King Court pairs queued sit-outs into valid two-player sides", () => {
    const ps = participants(["p1", "p2", "p3", "p4", "p5", "p6"]);
    const lastFixture = fixture({
      id: "court-1",
      a: "p1",
      b: "p3",
      entryType: "participant",
      pointsA: 8,
      pointsB: 3,
      winner: "A",
      courtLevel: 1,
      roundId: "r1",
    });
    lastFixture.sides = {
      A: { teamId: null, participantIds: ["p1", "p2"] },
      B: { teamId: null, participantIds: ["p3", "p4"] },
    };
    const input = state({
      formatId: "kingCourt",
      entryMode: "individual",
      config: { courtCount: 1, tieBehaviour: "stay" },
      participants: ps,
      rounds: [
        {
          roundId: "r1",
          roundNumber: 1,
          generationSnapshot: { queue: ["p5", "p6"] },
        },
      ],
      fixtures: [lastFixture],
    });

    const result = tournaments.getFormat("kingCourt").calculateNextCourtAssignments(input);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].sides.A.participantIds).toEqual(["p1", "p2"]);
    expect(result.assignments[0].sides.B.participantIds).toEqual(["p5", "p6"]);
    expect(result.queue).toEqual(["p3+p4"]);

    const assigned = result.assignments.flatMap((assignment) => [
      ...assignment.sides.A.participantIds,
      ...assignment.sides.B.participantIds,
    ]);
    const queued = result.queue.flatMap((sideId) => sideId.split("+"));
    const accountedFor = [...assigned, ...queued];
    expect(accountedFor.sort()).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(new Set(accountedFor).size).toBe(6);
    expect(result.assignments.every((assignment) =>
      [assignment.sides.A, assignment.sides.B].every(
        (side) => side.participantIds.length === 2,
      ),
    )).toBe(true);
  });

});
