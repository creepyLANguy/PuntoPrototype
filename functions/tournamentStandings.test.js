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

function fixture({ id, a, b, entryType = "team", pointsA, pointsB, winner, stage, roundId = "r1", roundNumber = 1, courtLevel }) {
  return {
    fixtureId: id,
    roundId,
    roundNumber,
    label: id,
    stage,
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
    const input = state({
      participants: participants(["player-b", "player-a"]),
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
    const noDifferenceState = state({
      participants: input.participants,
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

  test("fixtureFilter keeps group standings isolated from later knockout matches", () => {
    const input = state({
      formatId: "groupKnockout",
      entryMode: "team",
      config: { groupCount: 2, advancePerGroup: 1 },
      teams: teams(["t1", "t2", "t3", "t4"]),
      fixtures: [
        fixture({ id: "group-match", a: "t1", b: "t4", pointsA: 6, pointsB: 3, winner: "A", stage: "group" }),
        fixture({ id: "knockout-match", a: "t1", b: "t2", pointsA: 2, pointsB: 8, winner: "B", stage: "knockout", roundId: "r2", roundNumber: 2 }),
      ],
    });

    const result = tournaments.getFormat("groupKnockout").calculateStandings(input);
    expect(result.rows.find((row) => row.entryId === "t1").played).toBe(1);
    expect(result.rows.find((row) => row.entryId === "t1").wins).toBe(1);
    expect(result.rows.find((row) => row.entryId === "t2").played).toBe(0);
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

  test("final ranking honors court position or configured point method", () => {
    const ts = teams(["t1", "t2", "t3", "t4"]);
    const fixtures = [
      fixture({ id: "court-1", a: "t1", b: "t3", pointsA: 2, pointsB: 8, winner: "B", courtLevel: 1 }),
      fixture({ id: "court-2", a: "t2", b: "t4", pointsA: 8, pointsB: 2, winner: "A", courtLevel: 2 }),
    ];
    fixtures.forEach((item) => (item.roundId = "r1"));

    const byCourt = tournaments.getFormat("kingCourt").calculateStandings(
      kingState({ courtCount: 2, finalRanking: "courtPosition", scoringMethod: "courtPoints" }, ts, fixtures),
    );
    const byPoints = tournaments.getFormat("kingCourt").calculateStandings(
      kingState({ courtCount: 2, finalRanking: "points", scoringMethod: "courtPoints" }, ts, fixtures),
    );

    expect(byCourt.rows[0].entryId).toBe("t1");
    expect(byPoints.rows[0].entryId).toBe("t2");
  });
});
