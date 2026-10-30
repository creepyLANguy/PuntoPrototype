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

function completeGroupFixturesBySeed(target) {
  const teamById = Object.fromEntries(target.teams.map((team) => [team.teamId, team]));
  for (const fixture of target.fixtures.filter((candidate) => candidate.stage === "group")) {
    const seedA = Number(teamById[fixture.sides.A.teamId]?.seed ?? Number.MAX_SAFE_INTEGER);
    const seedB = Number(teamById[fixture.sides.B.teamId]?.seed ?? Number.MAX_SAFE_INTEGER);
    completeFixture(fixture, seedA < seedB ? "A" : "B");
  }
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

  test("final placements do not depend on fixture storage order", () => {
    const target = bracketState("doubleElimination", 16, { grandFinalReset: false });
    const format = tournaments.getFormat("doubleElimination");
    append(target, format.generateInitialRound(target));
    simulateBracket(target, "A");

    const placementMap = (fixtures) =>
      format
        .calculateFinalStandings({ ...target, fixtures })
        .rows.map((row) => [row.entryId, row.placement, row.eliminated])
        .sort(([left], [right]) => left.localeCompare(right));

    const originalOrder = placementMap(target.fixtures);
    const reversedOrder = placementMap([...target.fixtures].reverse());

    expect(originalOrder.some(([, placement]) => placement === 1)).toBe(true);
    expect(reversedOrder).toEqual(originalOrder);
  });
});

describe("group knockout", () => {
  test("generates group round robin and qualifier knockout", () => {
    const target = bracketState("groupKnockout", 8, { groupCount: 2, advancePerGroup: 2 });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));
    expect(target.fixtures.filter((fixture) => fixture.stage === "group")).toHaveLength(12);
    completeGroupFixturesBySeed(target);
    append(target, format.generateNextRound(target));
    expect(target.fixtures.filter((fixture) => fixture.stage === "knockout")).toHaveLength(3);
    expect(format.calculateStandings(target).rows.filter((row) => row.groupId === "A").length).toBe(
      4,
    );
  });
});



describe("group-knockout qualification after withdrawals", () => {
  test("withdrawals re-rank eligible teams before group-knockout cross-seeding", () => {
    const target = bracketState("groupKnockout", 9, {
      groupCount: 3,
      advancePerGroup: 2,
    });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));
    completeGroupFixturesBySeed(target);

    // Team 1 tops Group A and then withdraws. Teams 6 and 7 should become
    // eligible ranks 1 and 2 for knockout seeding without changing group history.
    target.teams.find((team) => team.teamId === "t1").status = "withdrawn";
    const groupStandings = format.calculateStandings(target);
    expect(groupStandings.rows.find((row) => row.entryId === "t1").rank).toBe(1);
    expect(groupStandings.rows.find((row) => row.entryId === "t6").rank).toBe(2);
    expect(groupStandings.rows.find((row) => row.entryId === "t7").rank).toBe(3);

    const generation = format.generateNextRound(target);
    const firstRoundNumber = Math.min(...generation.fixtures.map((fixture) => fixture.roundNumber));
    const firstRoundFixtures = generation.fixtures.filter(
      (fixture) =>
        fixture.stage === "knockout" && fixture.roundNumber === firstRoundNumber,
    );
    const playedPairings = firstRoundFixtures.filter(
      (fixture) => fixture.sides.A?.teamId && fixture.sides.B?.teamId,
    );

    expect(playedPairings).toHaveLength(2);
    expect(
      playedPairings.every(
        (fixture) => fixture.sourceRefs.A.groupId !== fixture.sourceRefs.B.groupId,
      ),
    ).toBe(true);

    const groupAFirst = firstRoundFixtures
      .flatMap((fixture) => ["A", "B"].map((side) => ({
        teamId: fixture.sides[side]?.teamId,
        source: fixture.sourceRefs[side],
      })))
      .find((entry) => entry.teamId === "t6");
    const groupASecond = firstRoundFixtures
      .flatMap((fixture) => ["A", "B"].map((side) => ({
        teamId: fixture.sides[side]?.teamId,
        source: fixture.sourceRefs[side],
      })))
      .find((entry) => entry.teamId === "t7");
    expect(groupAFirst.source).toMatchObject({ groupId: "A", rank: 1 });
    expect(groupASecond.source).toMatchObject({ groupId: "A", rank: 2 });
  });

  test("withdrawal-cancelled group fixtures do not block knockout qualification", () => {
    const target = bracketState("groupKnockout", 4, {
      groupCount: 2,
      advancePerGroup: 1,
    });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));

    const withdrawnTeamId = "t1";
    target.teams.find((team) => team.teamId === withdrawnTeamId).status = "withdrawn";
    for (const fixture of target.fixtures) {
      if ((fixture.teamIds || []).includes(withdrawnTeamId)) {
        // Mirror the durable marker written by the real withdrawal service.
        fixture.status = "cancelled";
        fixture.cancellationReason = "entry-withdrawn";
        fixture.withdrawnEntryId = withdrawnTeamId;
      } else {
        completeFixture(fixture, "A");
      }
    }

    expect(format.canGenerateNextRound(target)).toMatchObject({ allowed: true });
    const generation = format.generateNextRound(target);
    const advancingIds = generation.fixtures
      .flatMap((fixture) => [fixture.sides.A?.teamId, fixture.sides.B?.teamId])
      .filter(Boolean);

    expect(advancingIds).not.toContain(withdrawnTeamId);
    expect(advancingIds).toHaveLength(2);
  });

  function stateAfterGroupResults(activeTeamIds) {
    const target = bracketState("groupKnockout", 4, {
      groupCount: 2,
      advancePerGroup: 1,
    });
    append(target, tournaments.getFormat("groupKnockout").generateInitialRound(target));
    completeGroupFixturesBySeed(target);
    target.teams.forEach((team) => {
      if (!activeTeamIds.includes(team.teamId)) team.status = "withdrawn";
    });
    return target;
  }

  test("rejects knockout generation when zero eligible qualifiers remain", () => {
    const target = stateAfterGroupResults([]);
    const format = tournaments.getFormat("groupKnockout");

    expect(() => format.generateNextRound(target)).toThrow(
      /No eligible teams remain to advance from the group stage/,
    );
    expect(target.fixtures.some((fixture) => fixture.stage === "knockout")).toBe(false);
  });

  test("declares the sole eligible qualifier champion by qualification", () => {
    const target = stateAfterGroupResults(["t1"]);
    const format = tournaments.getFormat("groupKnockout");
    const generation = format.generateNextRound(target);

    expect(generation.rounds).toHaveLength(1);
    expect(generation.rounds[0].label).toBe("Champion by qualification");
    expect(generation.fixtures).toHaveLength(1);
    expect(generation.fixtures[0]).toMatchObject({
      label: "Champion by qualification",
      stage: "knockout",
      status: "bye",
      bracketPosition: "KO-CHAMPION",
      sides: { A: { teamId: "t1" }, B: null },
    });

    append(target, generation);
    const standings = format.calculateFinalStandings(target);
    expect(standings.finalDecided).toBe(true);
    expect(standings.championByDefault).toBe(true);
    expect(standings.championId).toBe("t1");
    expect(standings.runnerUpId).toBeNull();
    expect(standings.rows.find((row) => row.entryId === "t1")).toMatchObject({
      placement: 1,
      rank: 1,
      placementTied: false,
    });
  });

  test("two eligible qualifiers produce the normal playable final", () => {
    const target = stateAfterGroupResults(["t1", "t2"]);
    const format = tournaments.getFormat("groupKnockout");
    const generation = format.generateNextRound(target);

    expect(generation.rounds).toHaveLength(1);
    expect(generation.fixtures).toHaveLength(1);
    expect(generation.fixtures[0].label).toBe("Final");
    expect(generation.fixtures[0].status).toBe("scheduled");
    expect([
      generation.fixtures[0].sides.A.teamId,
      generation.fixtures[0].sides.B.teamId,
    ].sort()).toEqual(["t1", "t2"]);

    append(target, generation);
    const standings = format.calculateFinalStandings(target);
    expect(standings.finalDecided).toBe(false);
    expect(standings.championId).toBeNull();
    expect(standings.championByDefault).toBe(false);
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

  test("single elimination generates and resolves a third-place match for an eight-team bracket", () => {
    const target = bracketState("singleElimination", 8, { thirdPlaceMatch: true });
    const format = tournaments.getFormat("singleElimination");
    append(target, format.generateInitialRound(target));

    const thirdPlace = target.fixtures.find((fixture) => fixture.stage === "thirdPlace");
    expect(thirdPlace).toBeDefined();
    expect(thirdPlace.status).toBe("scheduled");
    expect(thirdPlace.sides.A).toBeNull();
    expect(thirdPlace.sides.B).toBeNull();

    simulateBracket(target, "A");

    expect(thirdPlace.status).toBe("completed");
    const standings = format.calculateFinalStandings(target);
    expect(standings.rows.filter((row) => row.placement === 3)).toHaveLength(1);
    expect(standings.rows.filter((row) => row.placement === 4)).toHaveLength(1);
    expect(unresolvedCompletedSourceFailures(target)).toHaveLength(0);
  });

  test("single elimination keeps third-place matches when six-team brackets have pending semifinal opponents", () => {
    const target = bracketState("singleElimination", 6, { thirdPlaceMatch: true });
    const format = tournaments.getFormat("singleElimination");
    append(target, format.generateInitialRound(target));

    const semifinalRound = target.rounds[target.rounds.length - 1].roundNumber - 1;
    const semifinals = target.fixtures.filter(
      (fixture) => fixture.stage === "knockout" && fixture.roundNumber === semifinalRound,
    );
    expect(semifinals).toHaveLength(2);
    expect(semifinals.every((fixture) => fixture.status === "scheduled")).toBe(true);

    const thirdPlace = target.fixtures.find((fixture) => fixture.stage === "thirdPlace");
    expect(thirdPlace).toBeDefined();
    expect(thirdPlace.sides).toEqual({ A: null, B: null });
    const final = target.fixtures.find((fixture) => fixture.label === "Final");
    expect(final.sides).toEqual({ A: null, B: null });

    simulateBracket(target, "A");

    expect(thirdPlace.status).toBe("completed");
    const standings = format.calculateFinalStandings(target);
    expect(standings.finalDecided).toBe(true);
    expect(standings.rows.filter((row) => row.placement === 3)).toHaveLength(1);
    expect(standings.rows.filter((row) => row.placement === 4)).toHaveLength(1);
    expect(unresolvedCompletedSourceFailures(target)).toHaveLength(0);
  });

  test("does not create a third-place match when a three-team bracket has only one played semifinal", () => {
    const target = bracketState("singleElimination", 3, { thirdPlaceMatch: true });
    const format = tournaments.getFormat("singleElimination");
    append(target, format.generateInitialRound(target));

    expect(target.fixtures.some((fixture) => fixture.stage === "thirdPlace")).toBe(false);
    simulateBracket(target, "A");
    expect(format.calculateFinalStandings(target).finalDecided).toBe(true);
  });

  test("group-knockout keeps third-place matches when six qualifiers include pending bye paths", () => {
    const target = bracketState("groupKnockout", 6, {
      groupCount: 3,
      advancePerGroup: 2,
      thirdPlaceMatch: true,
    });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));
    completeGroupFixturesBySeed(target);
    append(target, format.generateNextRound(target));

    const thirdPlace = target.fixtures.find((fixture) => fixture.stage === "thirdPlace");
    expect(thirdPlace).toBeDefined();
    expect(thirdPlace.sides).toEqual({ A: null, B: null });
    const final = target.fixtures.find((fixture) => fixture.label === "Final");
    expect(final.sides).toEqual({ A: null, B: null });

    simulateBracket(target, "A");

    expect(thirdPlace.status).toBe("completed");
    const standings = format.calculateFinalStandings(target);
    expect(standings.finalDecided).toBe(true);
    expect(standings.rows.filter((row) => row.placement === 3)).toHaveLength(1);
    expect(standings.rows.filter((row) => row.placement === 4)).toHaveLength(1);
    expect(unresolvedCompletedSourceFailures(target)).toHaveLength(0);
  });

  test("group-knockout generates and resolves a third-place match for eight qualifiers", () => {
    const target = bracketState("groupKnockout", 8, {
      groupCount: 2,
      advancePerGroup: 4,
      thirdPlaceMatch: true,
    });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));
    completeGroupFixturesBySeed(target);
    append(target, format.generateNextRound(target));

    const thirdPlace = target.fixtures.find((fixture) => fixture.stage === "thirdPlace");
    expect(thirdPlace).toBeDefined();
    expect(thirdPlace.status).toBe("scheduled");
    expect(thirdPlace.sides.A).toBeNull();
    expect(thirdPlace.sides.B).toBeNull();

    simulateBracket(target, "A");

    expect(thirdPlace.status).toBe("completed");
    const standings = format.calculateFinalStandings(target);
    expect(standings.rows.filter((row) => row.placement === 3)).toHaveLength(1);
    expect(standings.rows.filter((row) => row.placement === 4)).toHaveLength(1);
    expect(unresolvedCompletedSourceFailures(target)).toHaveLength(0);
  });

  test("an eliminated entry is not labelled as still in contention while the final is pending", () => {
    const target = bracketState("singleElimination", 4);
    const format = tournaments.getFormat("singleElimination");
    append(target, format.generateInitialRound(target));
    const semifinals = target.fixtures.filter((fixture) => fixture.roundNumber === 1);
    for (const fixture of semifinals) {
      completeFixture(fixture, "A");
      applyUpdates(target, format.advanceBracket(target, fixture.fixtureId).updates);
    }

    const standings = format.calculateStandings(target);
    expect(standings.finalDecided).toBe(false);
    const losers = semifinals.map((fixture) => fixture.sides.B.teamId);
    for (const id of losers) {
      const row = standings.rows.find((entry) => entry.entryId === id);
      expect(row.eliminated).toBe(true);
      expect(row.placementLabel).toBe("Eliminated");
    }
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

    const firstFinalWinnerDecides = {
      ...target,
      fixtures: [
        {
          ...target.fixtures[0],
          resultSnapshot: {
            winner: "A",
            points: { A: 6, B: 3 },
            games: { A: 6, B: 3 },
            sets: { A: 2, B: 0 },
          },
        },
        { ...target.fixtures[1], status: "cancelled" },
      ],
    };
    const winnerWithoutReset = format.calculateFinalStandings(firstFinalWinnerDecides);
    expect(winnerWithoutReset.finalDecided).toBe(true);
    expect(winnerWithoutReset.championId).toBe("t1");

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
    completeGroupFixturesBySeed(target);

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
  function tiedGroupState(seedMode) {
    const target = bracketState("groupKnockout", 4, {
      groupCount: 2,
      advancePerGroup: 1,
    });
    if (seedMode === "equal") target.teams.forEach((team) => { team.seed = 1; });
    if (seedMode === "missing") target.teams.forEach((team) => { team.seed = null; });
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
    return { target, format };
  }

  test("uses initial seed only as the final fallback when sporting criteria are tied", () => {
    const { target, format } = tiedGroupState("distinct");
    const standings = format.calculateStandings(target);

    expect(standings.rows.filter((row) => row.groupId === "A").map((row) => row.rank)).toEqual([
      1, 2,
    ]);
    expect(standings.rows.filter((row) => row.groupId === "B").map((row) => row.rank)).toEqual([
      1, 2,
    ]);

    const generation = format.generateNextRound(target);
    const qualifiers = generation.fixtures
      .flatMap((fixture) => [fixture.sides.A?.teamId, fixture.sides.B?.teamId])
      .filter(Boolean)
      .sort();
    expect(qualifiers).toEqual(["t1", "t2"]);
  });

  test.each(["equal", "missing"])(
    "blocks a qualification cutoff that remains tied with %s seeds",
    (seedMode) => {
      const { target, format } = tiedGroupState(seedMode);
      const standings = format.calculateStandings(target);
      expect(standings.rows.every((row) => row.rank === 1)).toBe(true);
      expect(() => format.generateNextRound(target)).toThrow(
        "tie at the qualification cutoff",
      );
    },
  );
});


describe("group-knockout placement before qualification is decided", () => {
  test("does not label all teams as not qualified when the knockout stage was never generated", () => {
    const target = bracketState("groupKnockout", 4, {
      groupCount: 2,
      advancePerGroup: 1,
    });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));
    for (const fixture of target.fixtures) {
      fixture.status = "completed";
      fixture.resultSnapshot = {
        winner: "A",
        points: { A: 6, B: 3 },
        games: { A: 6, B: 3 },
        sets: { A: 1, B: 0 },
        scoringMode: "fixedTotalPoints",
        completedAt: fixture.roundNumber,
      };
    }

    expect(target.fixtures.some((fixture) => ["knockout", "thirdPlace"].includes(fixture.stage))).toBe(false);
    const standings = format.calculateFinalStandings(target);
    expect(standings.rows.every((row) => row.placementLabel === "Qualification not decided")).toBe(true);
    expect(standings.rows.some((row) => row.placementLabel === "Did not qualify")).toBe(false);
  });
});


describe("unresolved third-place placements", () => {
  test.each([
    ["scheduled", null],
    ["cancelled", null],
    ["completed", "draw"],
  ])(
    "semifinal loser placements respect whether the third-place fixture is resolved (%s)",
    (thirdPlaceStatus, thirdPlaceWinner) => {
      const target = bracketState("singleElimination", 4, { thirdPlaceMatch: true });
      const format = tournaments.getFormat("singleElimination");
      append(target, format.generateInitialRound(target));

      const semifinals = target.fixtures.filter(
        (fixture) => fixture.stage === "knockout" && fixture.roundNumber === 1,
      );
      expect(semifinals).toHaveLength(2);
      completeFixture(semifinals[0], "A");
      applyUpdates(target, format.advanceBracket(target, semifinals[0].fixtureId).updates);
      completeFixture(semifinals[1], "B");
      applyUpdates(target, format.advanceBracket(target, semifinals[1].fixtureId).updates);

      const final = target.fixtures.find((fixture) => fixture.label === "Final");
      expect(final.sides.A).toBeTruthy();
      expect(final.sides.B).toBeTruthy();
      completeFixture(final, "A");
      applyUpdates(target, format.advanceBracket(target, final.fixtureId).updates);

      const thirdPlace = target.fixtures.find((fixture) => fixture.stage === "thirdPlace");
      expect(thirdPlace.sides.A).toBeTruthy();
      expect(thirdPlace.sides.B).toBeTruthy();
      if (thirdPlaceWinner) completeFixture(thirdPlace, thirdPlaceWinner);
      else thirdPlace.status = thirdPlaceStatus;

      const semifinalLosers = semifinals.map((fixture) => {
        const loserSide = fixture.resultSnapshot.winner === "A" ? "B" : "A";
        return fixture.sides[loserSide].teamId;
      });
      const result = format.calculateFinalStandings(target);
      const rowsById = Object.fromEntries(result.rows.map((row) => [row.entryId, row]));

      if (thirdPlaceStatus === "completed") {
        semifinalLosers.forEach((id) => {
          expect(rowsById[id].placement).toBe(3);
          expect(rowsById[id].placementTied).toBe(true);
        });
      } else {
        semifinalLosers.forEach((id) => {
          expect(rowsById[id].placement).toBeNull();
          expect(rowsById[id].placementLabel).toBe("Third/fourth place undecided");
        });
      }
      expect(result.rows.find((row) => row.entryId === final.sides.A.teamId).placement).toBe(1);
      expect(result.rows.find((row) => row.entryId === final.sides.B.teamId).placement).toBe(2);
    },
  );
});

test("bracket ranking explanation matches unresolved-entry ordering", () => {
  const target = bracketState("singleElimination", 4);
  const format = tournaments.getFormat("singleElimination");
  append(target, format.generateInitialRound(target));

  const result = format.calculateStandings(target);
  expect(result.tiebreakerLabels).toContain(
    "Unresolved entries: qualification status, elimination losses, then initial seed",
  );
  expect(result.tiebreakerLabels).toContain("Entry ID (display order only)");
  expect(result.tiebreakerLabels).not.toContain("Elimination stage");
});


describe("group-knockout qualification-award eligibility", () => {
  test("a sole qualifier who withdraws after the award is generated is not champion", () => {
    const target = bracketState("groupKnockout", 4, {
      groupCount: 2,
      advancePerGroup: 1,
    });
    const format = tournaments.getFormat("groupKnockout");
    append(target, format.generateInitialRound(target));
    completeGroupFixturesBySeed(target);
    target.teams.forEach((team) => {
      if (team.teamId !== "t1") team.status = "withdrawn";
    });

    append(target, format.generateNextRound(target));
    expect(format.calculateFinalStandings(target)).toMatchObject({
      finalDecided: true,
      championId: "t1",
      championByDefault: true,
    });

    target.teams.find((team) => team.teamId === "t1").status = "withdrawn";
    const result = format.calculateFinalStandings(target);
    expect(result).toMatchObject({
      finalDecided: false,
      championId: null,
      championByDefault: false,
    });
    expect(result.rows.find((row) => row.entryId === "t1")).toMatchObject({
      status: "withdrawn",
      placement: null,
      rank: null,
      placementLabel: "Withdrawn",
    });
  });
});
