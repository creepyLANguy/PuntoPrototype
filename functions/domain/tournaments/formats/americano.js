const { calculateStandings: standings } = require("../standings");
const {
  baseRound,
  calculateRoundResult,
  canGenerateAfterComplete,
  chooseSitters,
  createRng,
  makeFixture,
  pairSocialGroup,
  socialPatternCost,
  requireNextRoundAllowed,
  seedFor,
  shuffle,
  sideFromParticipants,
  socialConfigValidation,
  socialDefaultConfig,
  nextRoundNumber,
  buildHistory,
} = require("./shared");

const americano = {
  id: "americano",
  label: "Americano",
  entryMode: "individual",
  kind: "rotating",
  supportsNextRound: true,
  defaultConfig: () => socialDefaultConfig(),
  normalizeConfig: (config = {}) => socialDefaultConfig(config),
  validateConfig: socialConfigValidation,
  validateParticipants(state) {
    const active = (state.participants || []).filter(
      (participant) => participant.status === "active",
    );
    const errors =
      active.length < 4
        ? [{ code: "INSUFFICIENT_PLAYERS", message: "Americano needs at least 4 active players." }]
        : [];
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    if (cfg.mixed) {
      const genders = active.reduce((acc, participant) => {
        acc[participant.gender || "unknown"] = (acc[participant.gender || "unknown"] || 0) + 1;
        return acc;
      }, {});
      if ((genders.m || 0) < 2 || (genders.f || 0) < 2) {
        errors.push({
          code: "INSUFFICIENT_MIXED_GENDERS",
          message: "Mixed Americano needs at least two men and two women.",
        });
      }
    }
    return { errors, warnings: [] };
  },
  generateInitialRound(state) {
    return generateRound(state);
  },
  generateNextRound(state) {
    requireNextRoundAllowed(state);
    return generateRound(state);
  },
  canGenerateNextRound: canGenerateAfterComplete,
  calculateStandings(state) {
    return standings(state, { entryType: "participant", mode: "social", formatId: "americano" });
  },
  calculateRoundResult,
  getRulesSummary(config) {
    const cfg = this.normalizeConfig(config);
    return socialRules("AMERICANO", cfg, "Individual standings: total points won");
  },
};

function generateRound(state) {
  const cfg = americano.normalizeConfig(state.tournament?.format?.config || {});
  const active = (state.participants || []).filter(
    (participant) => participant.status === "active",
  );
  const roundNumber = nextRoundNumber(state);
  const seed = seedFor(state, roundNumber);
  const rng = createRng(seed);
  const history = buildHistory(state, { includeScheduled: Boolean(state.scheduleForecast) });
  const courtLimit =
    cfg.maxCourts || state.tournament?.courtPool?.length || Number.MAX_SAFE_INTEGER;
  const matchCount = Math.min(Math.floor(active.length / 4), courtLimit);
  const playCount = matchCount * 4;
  const sitters = chooseSitters(active, active.length - playCount, history, rng);
  const sitterIds = new Set(sitters.map((participant) => participant.participantId));
  const playing = bestGrouping(
    active.filter((participant) => !sitterIds.has(participant.participantId)),
    matchCount,
    history,
    rng,
  );

  const round = baseRound(roundNumber, `Round ${roundNumber}`, null, seed, {
    algorithm: "americano-greedy-v1",
    sittingOutParticipantIds: [...sitterIds],
  });
  round.sittingOutParticipantIds = [...sitterIds].sort();

  const fixtures = [];
  for (let index = 0; index < matchCount; index += 1) {
    const ids = playing
      .slice(index * 4, index * 4 + 4)
      .map((participant) => participant.participantId);
    const [a, b] = pairSocialGroup(ids, history);
    fixtures.push(
      makeFixture({
        roundNumber,
        index,
        label: `Round ${roundNumber} - Match ${index + 1}`,
        sides: { A: sideFromParticipants(a), B: sideFromParticipants(b) },
      }),
    );
  }
  round.fixtureIds = fixtures.map((fixture) => fixture.fixtureId);
  return { rounds: [round], fixtures };
}

// Multi-start search over seeded shuffles: groups of four are scored on
// repeated partners, opponents and groups (pairSocialGroup picks the best
// split inside each group) and the cheapest arrangement wins. Deterministic
// for a given seed.
const GROUPING_CANDIDATES = 80;

function groupingCost(order, matchCount, history) {
  let cost = 0;
  for (let index = 0; index < matchCount; index += 1) {
    const ids = order
      .slice(index * 4, index * 4 + 4)
      .map((participant) => participant.participantId);
    cost += socialPatternCost(pairSocialGroup(ids, history), history);
  }
  return cost;
}

function bestGrouping(players, matchCount, history, rng) {
  let best = shuffle(players, rng);
  let bestCost = groupingCost(best, matchCount, history);
  for (let attempt = 1; attempt < GROUPING_CANDIDATES && bestCost > 0; attempt += 1) {
    const candidate = shuffle(players, rng);
    const cost = groupingCost(candidate, matchCount, history);
    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }
  return best;
}

function socialRules(title, cfg, standingsLine) {
  const scoring = cfg.scoring;
  return {
    title,
    lines: [
      `${scoring.pointsTarget} total points`,
      `Serve rotation: ${scoring.serveOrder.join(", ")}`,
      `${scoring.serveBlockLength} consecutive serves`,
      ["after_each_player_serves_once", "after_all_players_serve_once"].includes(
        scoring.sideSwapRule,
      )
        ? scoring.sideSwapRule === "after_all_players_serve_once"
          ? "Swap sides after all players serve once"
          : "Swap sides after each player serves once"
        : "No automatic side swap",
      standingsLine,
    ],
  };
}

americano.socialRules = socialRules;

module.exports = americano;
