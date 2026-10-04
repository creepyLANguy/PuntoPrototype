const { calculateStandings: standings } = require("../standings");
const americano = require("./americano");
const {
  baseRound,
  calculateRoundResult,
  canGenerateAfterComplete,
  chooseSitters,
  createRng,
  makeFixture,
  requireNextRoundAllowed,
  seedFor,
  sideFromTeam,
  socialConfigValidation,
  socialDefaultConfig,
  nextRoundNumber,
  buildHistory,
  pairCount,
  shuffle,
} = require("./shared");

const teamAmericano = {
  id: "teamAmericano",
  label: "Team Americano",
  entryMode: "team",
  kind: "rotating",
  supportsNextRound: true,
  defaultConfig: () => socialDefaultConfig(),
  normalizeConfig: (config = {}) => socialDefaultConfig(config),
  validateConfig: socialConfigValidation,
  validateParticipants(state) {
    const active = (state.teams || []).filter((team) => team.status === "active");
    const errors =
      active.length < 2
        ? [{ code: "INSUFFICIENT_TEAMS", message: "Team Americano needs at least 2 active teams." }]
        : [];
    for (const team of active) {
      if ((team.participantIds || []).length !== 2)
        errors.push({ code: "INVALID_TEAM_SIZE", message: `${team.teamId} must have 2 players.` });
    }
    return { errors, warnings: [] };
  },
  generateInitialRound(state) {
    return generateRound(state, false);
  },
  generateNextRound(state) {
    requireNextRoundAllowed(state);
    return generateRound(state, false);
  },
  canGenerateNextRound: canGenerateAfterComplete,
  calculateStandings(state) {
    return standings(state, { entryType: "team", mode: "social", formatId: "teamAmericano" });
  },
  calculateRoundResult,
  getRulesSummary(config) {
    return americano.socialRules(
      "TEAM AMERICANO",
      this.normalizeConfig(config),
      "Team standings: total points won",
    );
  },
};

function generateRound(state, rankedMode, rankedTeams = null) {
  const cfg = teamAmericano.normalizeConfig(state.tournament?.format?.config || {});
  const roundNumber = nextRoundNumber(state);
  const seed = seedFor(state, roundNumber);
  const rng = createRng(seed);
  const history = buildHistory(state);
  const active = rankedTeams || (state.teams || []).filter((team) => team.status === "active");
  const byeCount = active.length % 2;
  const sitters = chooseSitters(
    active,
    byeCount,
    { sitCounts: history.sitCounts, consecutiveSits: history.consecutiveSits },
    rng,
  );
  const sitterIds = new Set(sitters.map((team) => team.teamId));
  const playing = active.filter((team) => !sitterIds.has(team.teamId));
  const pairs = rankedMode
    ? pairAdjacentWithSwaps(playing, history)
    : bestGreedyPairing(playing, history, rng);
  const round = baseRound(roundNumber, `Round ${roundNumber}`, null, seed, {
    algorithm: rankedMode ? "team-mexicano-v1" : "team-americano-v1",
  });
  round.sittingOutTeamIds = [...sitterIds].sort();
  const fixtures = pairs.map(([a, b], index) =>
    makeFixture({
      roundNumber,
      index,
      label: `Round ${roundNumber} - Match ${index + 1}`,
      sides: { A: sideFromTeam(a), B: sideFromTeam(b) },
    }),
  );
  round.fixtureIds = fixtures.map((fixture) => fixture.fixtureId);
  return { rounds: [round], fixtures };
}

// Greedy pairing from several seeded starting orders; the arrangement with
// the fewest repeated opponents wins.
function bestGreedyPairing(teams, history, rng) {
  let best = pairGreedy(teams, history);
  let bestCost = pairingCost(best, history);
  for (let attempt = 1; attempt < 40 && bestCost > 0; attempt += 1) {
    const candidate = pairGreedy(shuffle(teams, rng), history);
    const cost = pairingCost(candidate, history);
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
}

function pairingCost(pairs, history) {
  return pairs.reduce(
    (sum, [a, b]) => sum + pairCount(history.opponentCounts, a.teamId, b.teamId),
    0,
  );
}

function pairGreedy(teams, history) {
  const remaining = [...teams];
  const pairs = [];
  while (remaining.length >= 2) {
    const left = remaining.shift();
    let bestIndex = 0;
    for (let i = 1; i < remaining.length; i += 1) {
      const best = remaining[bestIndex];
      if (
        pairCount(history.opponentCounts, left.teamId, remaining[i].teamId) <
        pairCount(history.opponentCounts, left.teamId, best.teamId)
      ) {
        bestIndex = i;
      }
    }
    pairs.push([left, remaining.splice(bestIndex, 1)[0]]);
  }
  return pairs;
}

function pairAdjacentWithSwaps(teams, history) {
  const arranged = [...teams];
  for (let i = 0; i + 1 < arranged.length; i += 2) {
    if (pairCount(history.opponentCounts, arranged[i].teamId, arranged[i + 1].teamId) === 0)
      continue;
    for (let j = i + 2; j < arranged.length; j += 1) {
      if (pairCount(history.opponentCounts, arranged[i].teamId, arranged[j].teamId) === 0) {
        [arranged[i + 1], arranged[j]] = [arranged[j], arranged[i + 1]];
        break;
      }
    }
  }
  return pairGreedy(arranged, { opponentCounts: {} });
}

teamAmericano.generateTeamRound = generateRound;
teamAmericano.pairAdjacentWithSwaps = pairAdjacentWithSwaps;

module.exports = teamAmericano;
