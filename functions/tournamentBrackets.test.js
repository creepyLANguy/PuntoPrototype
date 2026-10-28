const tournaments = require("./domain/tournaments");

function participantsForTeams(count) {
  return Array.from({ length: count * 2 }, (_, index) => ({
    participantId: `p${index + 1}`,
    displayName: `Player ${index + 1}`,
    seed: index + 1,
    status: "active",
  }));
}

function teams(count) {
  return Array.from({ length: count }, (_, index) => ({
    teamId: `t${index + 1}`,
    name: `Team ${index + 1}`,
    participantIds: [`p${index * 2 + 1}`, `p${index * 2 + 2}`],
    seed: index + 1,
    status: "active",
  }));
}

function bracketState(formatId, count, config = {}) {
  return {
    tournament: {
      tournamentId: `bracket-${formatId}-${count}`,
      participantMode: "team",
      format: {
        id: formatId,
        version: 1,
        config: tournaments.getFormat(formatId).normalizeConfig(config),
      },
      courtPool: ["c1", "c2", "c3", "c4"],
      scheduling: {},
    },
    participants: participantsForTeams(count),
    teams: teams(count),
    rounds: [],
    fixtures: [],
    generationSeed: `${formatId}:${count}`,
  };
}

function append(target, generation) {
  target.rounds.push(...generation.rounds);
  target.fixtures.push(...generation.fixtures);
}

function applyUpdates(target, updates) {
  for (const update of updates) {
    const fixture = target.fixtures.find((candidate) => candidate.fixtureId === update.fixtureId);
    Object.assign(fixture, update.patch);
  }
}

function completeFixture(fixture, winner) {
  fixture.status = "completed";
  fixture.resultSnapshot = {
    winner,
    points: winner === "A" ? { A: 6, B: 3 } : { A: 3, B: 6 },
    games: winner === "A" ? { A: 6, B: 3 } : { A: 3, B: 6 },
    sets: winner === "A" ? { A: 2, B: 0 } : { A: 0, B: 2 },
    scoringMode: "standard",
    completedAt: 1,
  };
}

function simulateBracket(target, prefer = "A") {
  const format = tournaments.getFormat(target.tournament.format.id);
  let progress = true;
  let guard = 0;
  while (progress && guard < 200) {
    guard += 1;
    progress = false;
    for (const fixture of target.fixtures) {
      if (
        fixture.status !== "scheduled" ||
        fixture.resultSnapshot ||
        !fixture.sides.A ||
        !fixture.sides.B
      )
        continue;
      completeFixture(fixture, prefer);
      applyUpdates(target, format.advanceBracket(target, fixture.fixtureId).updates);
      progress = true;
    }
  }
}

function lossesByTeam(target) {
  const losses = {};
  for (const fixture of target.fixtures) {
    const outcome = tournaments.fixtureOutcome(fixture);
    if (!outcome || outcome.winner === "draw") continue;
    const loser = outcome.winner === "A" ? fixture.sides.B : fixture.sides.A;
    if (loser?.teamId) losses[loser.teamId] = (losses[loser.teamId] || 0) + 1;
  }
  return losses;
}

function unresolvedCompletedSourceFailures(target) {
  const byId = Object.fromEntries(target.fixtures.map((fixture) => [fixture.fixtureId, fixture]));
  return target.fixtures.filter((fixture) => {
    if (fixture.status === "cancelled") return false;
    return ["A", "B"].some((side) => {
      const ref = fixture.sourceRefs?.[side];
      if (!ref || fixture.sides?.[side]) return false;
      const source = byId[ref.fixtureId];
      return (
        source &&
        ["completed", "bye"].includes(source.status) &&
        !(source.status === "bye" && ref.outcome === "loser")
      );
    });
  });
}

describe("single elimination", () => {
  test.each([4, 5, 6, 8, 12, 16])("generates and advances %i team bracket with byes", (count) => {
    const target = bracketState("singleElimination", count);
    append(target, tournaments.getFormat("singleElimination").generateInitialRound(target));
    expect(target.fixtures.some((fixture) => fixture.bracketPosition)).toBe(true);
    simulateBracket(target);
    const completedFinals = target.fixtures.filter(
      (fixture) => fixture.label === "Final" && fixture.status === "completed",
    );
    expect(completedFinals).toHaveLength(1);
    expect(unresolvedCompletedSourceFailures(target)).toHaveLength(0);
  });
});

describe("double elimination", () => {
  test.each([4, 5, 6, 8, 12, 16])(
    "simulates %i team double elimination without impossible losses",
    (count) => {
      const target = bracketState("doubleElimination", count);
      append(target, tournaments.getFormat("doubleElimination").generateInitialRound(target));
      expect(target.fixtures.some((fixture) => fixture.stage === "winners")).toBe(true);
      expect(target.fixtures.some((fixture) => fixture.stage === "losers")).toBe(true);
      simulateBracket(target, "A");
      const losses = lossesByTeam(target);
      expect(Math.max(...Object.values(losses), 0)).toBeLessThanOrEqual(2);
      const activeReset = target.fixtures.filter(
        (fixture) => fixture.stage === "grandFinalReset" && fixture.status !== "cancelled",
      );
      expect(activeReset.length).toBeLessThanOrEqual(1);
      expect(unresolvedCompletedSourceFailures(target)).toHaveLength(0);
    },
  );
});

describe("group knockout", () => {
  test("generates group round robin and qualifier knockout", () => {
    const target = bracketState("groupKnockout", 8, { groupCount: 2, advancePerGroup: 2 });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));
    expect(target.fixtures.filter((fixture) => fixture.stage === "group")).toHaveLength(12);
    for (const fixture of target.fixtures) completeFixture(fixture, "A");
    append(target, format.generateNextRound(target));
    expect(target.fixtures.filter((fixture) => fixture.stage === "knockout")).toHaveLength(3);
    expect(format.calculateStandings(target).rows.filter((row) => row.groupId === "A").length).toBe(
      4,
    );
  });
});


describe("bracket placements and podium rulings", () => {
  test("single elimination ranks entrants by finishing round, and shares third place without a play-off", () => {
    const target = bracketState("singleElimination", 8);
    const format = tournaments.getFormat("singleElimination");
    append(target, format.generateInitialRound(target));
    simulateBracket(target, "A");

    const standings = format.calculateFinalStandings(target);
    expect(standings.finalDecided).toBe(true);
    expect(standings.rows.filter((row) => row.placement === 1)).toHaveLength(1);
    expect(standings.rows.filter((row) => row.placement === 2)).toHaveLength(1);
    expect(standings.rows.filter((row) => row.placement === 3)).toHaveLength(2);
    expect(standings.rows.filter((row) => row.placement === 5)).toHaveLength(4);
    expect(standings.rows.filter((row) => row.rank === 3).every((row) => row.placementTied)).toBe(true);
  });

  test("single elimination creates and ranks a configured third-place match", () => {
    const target = bracketState("singleElimination", 4, { thirdPlaceMatch: true });
    const format = tournaments.getFormat("singleElimination");
    append(target, format.generateInitialRound(target));

    const thirdPlace = target.fixtures.find((fixture) => fixture.stage === "thirdPlace");
    expect(thirdPlace).toBeDefined();
    expect(thirdPlace.label).toMatch(/third-place/i);

    simulateBracket(target, "A");
    expect(target.fixtures.find((fixture) => fixture.stage === "thirdPlace").status).toBe("completed");
    const standings = format.calculateFinalStandings(target);
    expect(standings.rows.filter((row) => row.placement === 3)).toHaveLength(1);
    expect(standings.rows.filter((row) => row.placement === 4)).toHaveLength(1);
  });

  test("double elimination does not declare the champion before a required reset", () => {
    const target = bracketState("doubleElimination", 3, { grandFinalReset: true });
    const makeSide = (teamId) => ({ teamId, participantIds: [] });
    target.fixtures = [
      {
        fixtureId: "grand-final",
        roundId: "r1",
        roundNumber: 1,
        label: "Grand Final",
        stage: "grandFinal",
        status: "completed",
        sides: { A: makeSide("t1"), B: makeSide("t2") },
        resultSnapshot: {
          winner: "B",
          points: { A: 3, B: 6 },
          games: { A: 3, B: 6 },
          sets: { A: 0, B: 2 },
        },
      },
      {
        fixtureId: "grand-final-reset",
        roundId: "r1",
        roundNumber: 1,
        label: "Grand Final (Reset)",
        stage: "grandFinalReset",
        status: "scheduled",
        sides: { A: makeSide("t1"), B: makeSide("t2") },
      },
    ];

    const format = tournaments.getFormat("doubleElimination");
    const undecided = format.calculateFinalStandings(target);
    expect(undecided.finalDecided).toBe(false);
    expect(undecided.championId).toBeNull();

    target.fixtures[1] = {
      ...target.fixtures[1],
      status: "completed",
      resultSnapshot: {
        winner: "B",
        points: { A: 4, B: 6 },
        games: { A: 4, B: 6 },
        sets: { A: 1, B: 2 },
      },
    };
    const decided = format.calculateFinalStandings(target);
    expect(decided.finalDecided).toBe(true);
    expect(decided.championId).toBe("t2");
    expect(decided.runnerUpId).toBe("t1");
    expect(decided.rows.find((row) => row.entryId === "t2").placement).toBe(1);
    expect(decided.rows.find((row) => row.entryId === "t1").placement).toBe(2);
  });
});


  test("group knockout keeps group table separate and supports third-place medals", () => {
    const target = bracketState("groupKnockout", 8, {
      groupCount: 2,
      advancePerGroup: 2,
      thirdPlaceMatch: true,
    });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));
    for (const fixture of target.fixtures) completeFixture(fixture, "A");

    append(target, format.generateNextRound(target));
    const thirdPlace = target.fixtures.find((fixture) => fixture.stage === "thirdPlace");
    expect(thirdPlace).toBeDefined();

    // Later knockout fixtures must not change the group table's played counts.
    const groupStandingsBefore = format.calculateStandings(target);
    expect(groupStandingsBefore.rows.every((row) => row.played <= 3)).toBe(true);
    simulateBracket(target, "A");

    const groupStandingsAfter = format.calculateStandings(target);
    expect(groupStandingsAfter.rows.map((row) => row.played)).toEqual(
      groupStandingsBefore.rows.map((row) => row.played),
    );
    expect(target.fixtures.find((fixture) => fixture.stage === "thirdPlace").status).toBe("completed");

    const finalStandings = format.calculateFinalStandings(target);
    expect(finalStandings.finalDecided).toBe(true);
    expect(finalStandings.rows.filter((row) => row.placement === 1)).toHaveLength(1);
    expect(finalStandings.rows.filter((row) => row.placement === 2)).toHaveLength(1);
    expect(finalStandings.rows.filter((row) => row.placement === 3)).toHaveLength(1);
    expect(finalStandings.rows.filter((row) => row.placement === 4)).toHaveLength(1);
    expect(finalStandings.rows.filter((row) => row.placementLabel === "Did not qualify")).toHaveLength(4);
  });


describe("qualification tie safety", () => {
  test("does not silently select one team when a group tie crosses the qualification cutoff", () => {
    const target = bracketState("groupKnockout", 4, { groupCount: 2, advancePerGroup: 1 });
    target.teams.forEach((team) => { team.seed = null; });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));
    for (const fixture of target.fixtures) {
      fixture.status = "completed";
      fixture.resultSnapshot = {
        winner: "draw",
        points: { A: 8, B: 8 },
        games: { A: 8, B: 8 },
        sets: { A: 0, B: 0 },
        scoringMode: "fixedTotalPoints",
        completedAt: 1,
      };
    }

    expect(() => format.generateNextRound(target)).toThrow(
      "tie at the qualification cutoff",
    );
  });
});
