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
