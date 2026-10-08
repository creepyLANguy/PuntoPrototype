const { getFormat } = require("./domain/tournaments");
const { generateSchedule, forecastRoundCount } = require("./domain/tournaments/forecast");

function stateFor(id, count, rounds) {
  const format = getFormat(id);
  const teamMode = format.entryMode === "team";
  const entries = Array.from({ length: count }, (_, index) =>
    teamMode
      ? {
          teamId: `t${index + 1}`,
          name: `Team ${index + 1}`,
          participantIds: [`a${index}`, `b${index}`],
          status: "active",
        }
      : {
          participantId: `p${String(index + 1).padStart(2, "0")}`,
          displayName: `Player ${index + 1}`,
          status: "active",
        },
  );
  return {
    tournament: {
      tournamentId: "quality",
      participantMode: teamMode ? "team" : "individual",
      format: { id, config: format.normalizeConfig({}) },
      courtPool: ["abcd", "efgh", "jkmn", "pqrs"],
      scheduling: {
        targetRoundCount: rounds,
        defaultMatchDurationMinutes: 15,
        defaultChangeoverMinutes: 2,
      },
    },
    participants: teamMode ? [] : entries,
    teams: teamMode ? entries : [],
    rounds: [],
    fixtures: [],
    generationSeed: "quality",
  };
}

test.each([
  [8, 3],
  [12, 4],
  [16, 5],
])("forecasts %i players across %i rounds without repeated partners", (count, rounds) => {
  const state = stateFor("americano", count, rounds);
  const format = getFormat("americano");
  const generation = generateSchedule(format, state);
  expect(generation.rounds).toHaveLength(rounds);
  expect(generation.fixtures).toHaveLength((count / 4) * rounds);
  const pairs = generation.fixtures.flatMap((fixture) =>
    ["A", "B"].map((side) => [...fixture.sides[side].participantIds].sort().join("|")),
  );
  expect(new Set(pairs).size).toBe(pairs.length);
  expect(
    generation.fixtures.every(
      (fixture) => fixture.status === "scheduled" && !fixture.resultSnapshot,
    ),
  ).toBe(true);
  expect(generateSchedule(format, state)).toEqual(generation);
  expect(state.rounds).toHaveLength(0);
});

test("Team Americano forecasts the whole opponent cycle without needing results", () => {
  const state = stateFor("teamAmericano", 8, 7);
  const generation = generateSchedule(getFormat("teamAmericano"), state);
  const pairs = generation.fixtures.map((fixture) =>
    [fixture.sides.A.teamId, fixture.sides.B.teamId].sort().join("|"),
  );
  expect(generation.rounds).toHaveLength(7);
  expect(pairs).toHaveLength(28);
  expect(new Set(pairs).size).toBe(28);
});

test("forecast length uses requested rounds, otherwise time window or one social cycle", () => {
  const state = stateFor("americano", 8, 3);
  const format = getFormat("americano");
  expect(forecastRoundCount(format, state)).toBe(3);
  state.tournament.scheduling.targetRoundCount = null;
  expect(forecastRoundCount(format, state)).toBe(7);
  Object.assign(state.tournament.scheduling, {
    startAt: 100000,
    plannedEndAt: 100000 + 60 * 60000,
  });
  expect(forecastRoundCount(format, state)).toBe(3);
  const teams = stateFor("teamAmericano", 5, null);
  expect(forecastRoundCount(getFormat("teamAmericano"), teams)).toBe(5);
});

test("planned history keeps sit-outs balanced before any result exists", () => {
  const state = stateFor("americano", 9, 9);
  const schedule = generateSchedule(getFormat("americano"), state);
  const sitters = schedule.rounds.flatMap((round) => round.sittingOutParticipantIds);
  expect(new Set(sitters).size).toBe(9);
});
