// Pairing quality for rotating formats (spec sections 10.3 and 12): partner
// and opponent repeats are minimised across rounds.
const { getFormat } = require("./domain/tournaments");

function play(formatId, entries, rounds, { teams = false } = {}) {
  const format = getFormat(formatId);
  const state = {
    tournament: {
      tournamentId: "quality",
      participantMode: teams ? "team" : "individual",
      format: { id: formatId, version: 1, config: format.normalizeConfig({}) },
      courtPool: [],
    },
    participants: teams ? [] : entries,
    teams: teams ? entries : [],
    rounds: [],
    fixtures: [],
    generationSeed: "quality",
  };
  for (let round = 0; round < rounds; round += 1) {
    const generation =
      round === 0 ? format.generateInitialRound(state) : format.generateNextRound(state);
    state.rounds.push(...generation.rounds);
    state.fixtures.push(
      ...generation.fixtures.map((fixture, index) => ({
        ...fixture,
        status: "completed",
        resultSnapshot: {
          winner: index % 2 ? "A" : "B",
          points: { A: 18 + (index % 3), B: 18 - (index % 3) },
          games: { A: 0, B: 0 },
          sets: { A: 0, B: 0 },
        },
      })),
    );
  }
  return state;
}

function players(count) {
  return Array.from({ length: count }, (_, index) => ({
    participantId: `p${String(index + 1).padStart(2, "0")}`,
    displayName: `Player ${index + 1}`,
    seed: null,
    status: "active",
  }));
}

function repeatedPairs(fixtures, keyOf) {
  const seen = new Map();
  fixtures.forEach((fixture) =>
    keyOf(fixture).forEach((key) => seen.set(key, (seen.get(key) || 0) + 1)),
  );
  return [...seen.values()].filter((count) => count > 1).length;
}

const partnerKeys = (fixture) =>
  ["A", "B"].map((side) => [...fixture.sides[side].participantIds].sort().join("|"));

describe("rotating pairing quality", () => {
  test.each([
    [8, 3],
    [12, 4],
    [16, 5],
  ])("Americano with %i players repeats no partner over %i rounds", (count, rounds) => {
    const state = play("americano", players(count), rounds);
    expect(repeatedPairs(state.fixtures, partnerKeys)).toBe(0);
  });

  test("Team Americano avoids repeated opponents while alternatives exist", () => {
    const teams = Array.from({ length: 8 }, (_, index) => ({
      teamId: `t${index + 1}`,
      name: `Team ${index + 1}`,
      participantIds: [`t${index + 1}a`, `t${index + 1}b`],
      seed: null,
      status: "active",
    }));
    const state = play("teamAmericano", teams, 7, { teams: true });
    const opponentKeys = (fixture) => [
      [fixture.sides.A.teamId, fixture.sides.B.teamId].sort().join("|"),
    ];
    expect(repeatedPairs(state.fixtures, opponentKeys)).toBe(0);
  });
});
