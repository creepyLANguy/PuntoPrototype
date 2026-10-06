const tournaments = require("./domain/tournaments");

function participants(count) {
  return Array.from({ length: count }, (_, index) => ({
    participantId: `p${index + 1}`,
    displayName: `Player ${index + 1}`,
    shortName: `P${index + 1}`,
    seed: index + 1,
    status: "active",
    gender: index % 2 === 0 ? "m" : "f",
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

function state(formatId, config = {}, participantMode = "team", entryCount = 8) {
  return {
    tournament: {
      tournamentId: `tour-${formatId}`,
      participantMode,
      format: {
        id: formatId,
        version: 1,
        config: tournaments.getFormat(formatId).normalizeConfig(config),
      },
      courtPool: ["c1", "c2", "c3", "c4"],
      scheduling: {
        startAt: 1000,
        defaultMatchDurationMinutes: 30,
        defaultChangeoverMinutes: 5,
        targetRoundCount: null,
      },
    },
    participants: participants(participantMode === "individual" ? entryCount : entryCount * 2),
    teams: participantMode === "team" ? teams(entryCount) : [],
    rounds: [],
    fixtures: [],
    generationSeed: `${formatId}:seed`,
  };
}

function appendGeneration(target, generation) {
  target.rounds.push(...generation.rounds);
  target.fixtures.push(...generation.fixtures);
  return target;
}

function completeFixtures(target, fixtureIds, seed = "results") {
  const rng = tournaments.createRng(seed);
  for (const fixture of target.fixtures) {
    if (
      !fixtureIds.includes(fixture.fixtureId) ||
      fixture.status === "bye" ||
      fixture.status === "cancelled"
    )
      continue;
    if (!fixture.sides.A || !fixture.sides.B) continue;
    const a = 18 + Math.floor(rng() * 19);
    const b = 36 - a;
    const winner = a === b ? "draw" : a > b ? "A" : "B";
    fixture.status = "completed";
    fixture.resultSnapshot = {
      winner,
      points: { A: a, B: b },
      games: { A: winner === "A" ? 2 : 1, B: winner === "B" ? 2 : 1 },
      sets: { A: winner === "A" ? 1 : 0, B: winner === "B" ? 1 : 0 },
      scoringMode: "fixedTotalPoints",
      completedAt: 1,
    };
  }
}

function assertNoDuplicateEntriesPerRound(target) {
  for (const round of target.rounds) {
    const seen = new Set();
    for (const fixture of target.fixtures.filter(
      (candidate) => candidate.roundId === round.roundId && candidate.status !== "bye",
    )) {
      for (const id of fixture.teamIds.length ? fixture.teamIds : fixture.participantIds) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
  }
}

describe("tournament format registry and scoring", () => {
  test("lists every contract format", () => {
    expect(tournaments.FORMAT_IDS).toEqual([
      "americano",
      "mexicano",
      "teamAmericano",
      "teamMexicano",
      "roundRobin",
      "swiss",
      "singleElimination",
      "doubleElimination",
      "groupKnockout",
      "kingCourt",
    ]);
  });

  test("builds fixed-total-points profile and rules summary with block serving", () => {
    const profile = tournaments.buildFixedTotalPointsProfile({
      pointsTarget: 36,
      serveBlockLength: 2,
      servesPerPlayer: 99,
    });
    expect(profile).toMatchObject({
      scoringMode: "fixedTotalPoints",
      pointsTarget: 36,
      serving: { order: ["A1", "B1", "A2", "B2"], serveBlockLength: 2 },
      completion: { rule: "exact_total_points", tieResolution: "allow_draw" },
    });
    expect(profile.serving).not.toHaveProperty("servesPerPlayer");
    expect(tournaments.getRulesSummary("americano", {}).lines).toContain("36 total points");
    expect(tournaments.getRulesSummary("americano", {}).lines).toContain("1 consecutive serves");
  });

  test("validates setup constraints", () => {
    const result = tournaments.validateTournamentSetup({
      format: { id: "americano", config: {} },
      participantMode: "individual",
      participants: participants(3),
      teams: [],
      courtPool: [],
    });
    expect(result.errors.map((error) => error.code)).toContain("INSUFFICIENT_PLAYERS");
  });
});

describe("rotating social formats", () => {
  test.each([
    ["americano", 4],
    ["americano", 8],
    ["americano", 12],
    ["americano", 16],
    ["mexicano", 9],
  ])("%s generates deterministic fair individual rounds for %i players", (formatId, count) => {
    const first = state(formatId, {}, "individual", count);
    const second = state(formatId, {}, "individual", count);
    const format = tournaments.getFormat(formatId);
    for (let i = 0; i < 4; i += 1) {
      appendGeneration(
        first,
        i === 0 ? format.generateInitialRound(first) : format.generateNextRound(first),
      );
      appendGeneration(
        second,
        i === 0 ? format.generateInitialRound(second) : format.generateNextRound(second),
      );
      completeFixtures(first, first.rounds.at(-1).fixtureIds, `${formatId}:${i}`);
      completeFixtures(second, second.rounds.at(-1).fixtureIds, `${formatId}:${i}`);
    }
    expect(first.rounds).toEqual(second.rounds);
    assertNoDuplicateEntriesPerRound(first);
    const sits = first.participants.map(
      (participant) =>
        first.rounds.filter((round) =>
          round.sittingOutParticipantIds.includes(participant.participantId),
        ).length,
    );
    expect(Math.max(...sits) - Math.min(...sits)).toBeLessThanOrEqual(count % 4 === 0 ? 0 : 1);
    expect(format.calculateStandings(first).rows[0]).toHaveProperty("totalPoints");
  });

  test.each(["teamAmericano", "teamMexicano"])(
    "%s keeps fixed teams and balances byes",
    (formatId) => {
      const target = state(formatId, {}, "team", 5);
      const format = tournaments.getFormat(formatId);
      for (let i = 0; i < 5; i += 1) {
        appendGeneration(
          target,
          i === 0 ? format.generateInitialRound(target) : format.generateNextRound(target),
        );
        completeFixtures(target, target.rounds.at(-1).fixtureIds, `${formatId}:${i}`);
      }
      assertNoDuplicateEntriesPerRound(target);
      const byes = target.teams.map(
        (team) =>
          target.rounds.filter((round) => round.sittingOutTeamIds.includes(team.teamId)).length,
      );
      expect(Math.max(...byes) - Math.min(...byes)).toBeLessThanOrEqual(1);
      expect(format.calculateStandings(target).entryType).toBe("team");
    },
  );
});

describe("league formats", () => {
  test("round robin schedules every pair once with odd-count byes", () => {
    const target = state("roundRobin", {}, "team", 5);
    appendGeneration(target, tournaments.getFormat("roundRobin").generateInitialRound(target));
    const pairs = new Set();
    for (const fixture of target.fixtures.filter((candidate) => candidate.status !== "bye")) {
      pairs.add([...fixture.teamIds].sort().join("|"));
    }
    expect(pairs.size).toBe(10);
    expect(target.fixtures.filter((fixture) => fixture.status === "bye")).toHaveLength(5);
  });

  test("swiss generates fixed count with no repeated pair when avoidable", () => {
    const target = state("swiss", { roundCount: 3 }, "team", 8);
    const format = tournaments.getFormat("swiss");
    for (let i = 0; i < 3; i += 1) {
      appendGeneration(
        target,
        i === 0 ? format.generateInitialRound(target) : format.generateNextRound(target),
      );
      completeFixtures(target, target.rounds.at(-1).fixtureIds, `swiss:${i}`);
    }
    const pairs = target.fixtures.map((fixture) => [...fixture.teamIds].sort().join("|"));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(format.canGenerateNextRound(target).allowed).toBe(false);
  });
});

describe("king court and scheduling", () => {
  test("moves winners up, manages queue, and assigns courts in waves", () => {
    const target = state("kingCourt", { courtCount: 2 }, "team", 6);
    const format = tournaments.getFormat("kingCourt");
    appendGeneration(target, format.generateInitialRound(target));
    completeFixtures(target, target.rounds[0].fixtureIds, "king");
    const next = format.calculateNextCourtAssignments(target);
    expect(next.assignments.length).toBeGreaterThan(0);
    expect(next.queue.length).toBeGreaterThan(0);
    const scheduled = tournaments.assignCourts(target.fixtures, {
      courtPool: ["c1", "c2"],
      unavailableCourtIds: [],
      startAt: 1000,
      matchDurationMinutes: 20,
      changeoverMinutes: 5,
    });
    expect(scheduled[0]).toMatchObject({ courtId: "c1", scheduledStartAt: 1000, wave: 1 });
  });
});
