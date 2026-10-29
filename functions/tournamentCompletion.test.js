const { assessRequiredCompletion } = require("./domain/tournaments/completion");
const { getFormat } = require("./domain/tournaments");

function team(teamId, seed, status = "active") {
  return { teamId, seed, status, name: teamId.toUpperCase(), participantIds: [] };
}

function fixture({
  fixtureId,
  stage = null,
  status = "completed",
  sides = { A: { teamId: "a", participantIds: [] }, B: { teamId: "b", participantIds: [] } },
  resultSnapshot = { winner: "A", points: { A: 4, B: 2 }, games: { A: 0, B: 0 }, sets: { A: 0, B: 0 } },
  sourceRefs = { A: null, B: null },
}) {
  return {
    fixtureId,
    roundId: "r1",
    roundNumber: 1,
    stage,
    status,
    sides,
    resultSnapshot,
    sourceRefs,
  };
}

function state(formatId, config, fixtures, teams = [team("a", 1), team("b", 2)]) {
  return {
    tournament: { tournamentId: "test", format: { id: formatId, config } },
    teams,
    participants: [],
    rounds: [{ roundId: "r1", roundNumber: 1, status: "completed" }],
    fixtures,
  };
}

describe("required tournament completion readiness", () => {
  test("allows a fully resolved full-schedule Round Robin even though no next round can be generated", () => {
    const input = state("roundRobin", { scheduleMode: "full" }, [fixture({ fixtureId: "r1-m1" })]);

    expect(getFormat("roundRobin").canGenerateNextRound(input)).toMatchObject({ allowed: false });
    expect(assessRequiredCompletion(input, getFormat("roundRobin"))).toMatchObject({
      required: true,
      allowed: true,
      reason: null,
      unresolvedFixtureIds: [],
    });
  });

  test("blocks a partial full-schedule Round Robin even if every generated fixture has a result", () => {
    const input = state(
      "roundRobin",
      { scheduleMode: "full" },
      [fixture({ fixtureId: "r1-m1" })],
      [team("a", 1), team("b", 2), team("c", 3), team("d", 4)],
    );

    expect(assessRequiredCompletion(input, getFormat("roundRobin"))).toMatchObject({
      allowed: false,
      reason: "incomplete-schedule",
    });
  });

  test("blocks a cancelled full-schedule fixture without a valid withdrawal record", () => {
    const input = state("roundRobin", { scheduleMode: "full" }, [
      fixture({
        fixtureId: "r1-m1",
        status: "cancelled",
        resultSnapshot: null,
      }),
    ]);

    expect(assessRequiredCompletion(input, getFormat("roundRobin"))).toMatchObject({
      allowed: false,
      reason: "unresolved-fixtures",
      unresolvedFixtureIds: ["r1-m1"],
    });
  });

  test("accepts an explicitly recorded withdrawal cancellation", () => {
    const input = state(
      "roundRobin",
      { scheduleMode: "full" },
      [
        fixture({
          fixtureId: "r1-m1",
          status: "cancelled",
          resultSnapshot: null,
        }),
      ],
      [team("a", 1, "withdrawn"), team("b", 2)],
    );
    input.fixtures[0].cancellationReason = "entry-withdrawn";
    input.fixtures[0].withdrawnEntryId = "a";

    expect(assessRequiredCompletion(input, getFormat("roundRobin"))).toMatchObject({
      allowed: true,
      reason: null,
    });
  });

  test("blocks a completed fixture with no result snapshot", () => {
    const input = state("roundRobin", { scheduleMode: "full" }, [
      fixture({ fixtureId: "r1-m1", status: "completed", resultSnapshot: null }),
    ]);

    expect(assessRequiredCompletion(input, getFormat("roundRobin"))).toMatchObject({
      allowed: false,
      reason: "unresolved-fixtures",
      unresolvedFixtureIds: ["r1-m1"],
    });
  });

  test("accepts an empty cancelled Group + Knockout placeholder when no source can advance", () => {
    const input = state("groupKnockout", { groupCount: 1, advancePerGroup: 1 }, [
      fixture({ fixtureId: "r1-m1", stage: "group" }),
      fixture({
        fixtureId: "r2-m1",
        stage: "knockout",
        status: "cancelled",
        sides: { A: null, B: null },
        resultSnapshot: null,
      }),
    ]);

    expect(assessRequiredCompletion(input, getFormat("groupKnockout"))).toMatchObject({
      allowed: true,
      reason: null,
    });
  });

  test("rejects an empty cancelled bracket fixture if a completed source still has an entrant to propagate", () => {
    const input = state("groupKnockout", { groupCount: 1, advancePerGroup: 1 }, [
      fixture({ fixtureId: "r1-m1", stage: "group" }),
      fixture({ fixtureId: "source", stage: "knockout" }),
      fixture({
        fixtureId: "destination",
        stage: "knockout",
        status: "cancelled",
        sides: { A: null, B: null },
        resultSnapshot: null,
        sourceRefs: { A: { fixtureId: "source", outcome: "winner" }, B: null },
      }),
    ]);

    expect(assessRequiredCompletion(input, getFormat("groupKnockout"))).toMatchObject({
      allowed: false,
      reason: "unresolved-fixtures",
      unresolvedFixtureIds: ["destination"],
    });
  });

  test("rejects a drawn knockout fixture because it cannot advance a champion", () => {
    const input = state("groupKnockout", { groupCount: 1, advancePerGroup: 1 }, [
      fixture({ fixtureId: "r1-m1", stage: "group" }),
      fixture({
        fixtureId: "r2-m1",
        stage: "knockout",
        resultSnapshot: {
          winner: "draw",
          points: { A: 6, B: 6 },
          games: { A: 0, B: 0 },
          sets: { A: 0, B: 0 },
        },
      }),
    ]);

    expect(assessRequiredCompletion(input, getFormat("groupKnockout"))).toMatchObject({
      allowed: false,
      reason: "unresolved-fixtures",
      unresolvedFixtureIds: ["r2-m1"],
    });
  });

  test("blocks a finite format whose required schedule has not been generated", () => {
    const input = {
      tournament: { tournamentId: "test", format: { id: "roundRobin", config: { scheduleMode: "full" } } },
      teams: [team("a", 1), team("b", 2)],
      participants: [],
      rounds: [],
      fixtures: [],
    };

    expect(assessRequiredCompletion(input, getFormat("roundRobin"))).toMatchObject({
      allowed: false,
      reason: "missing-schedule",
    });
  });
});
