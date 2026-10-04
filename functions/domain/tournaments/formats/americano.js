const { calculateStandings: standings } = require("../standings");
const {
  baseRound,
  calculateRoundResult,
  canGenerateAfterComplete,
  chooseSitters,
  createRng,
  makeFixture,
  pairSocialGroup,
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
  const history = buildHistory(state);
  const courtLimit =
    cfg.maxCourts || state.tournament?.courtPool?.length || Number.MAX_SAFE_INTEGER;
  const matchCount = Math.min(Math.floor(active.length / 4), courtLimit);
  const playCount = matchCount * 4;
  const sitters = chooseSitters(active, active.length - playCount, history, rng);
  const sitterIds = new Set(sitters.map((participant) => participant.participantId));
  const playing = shuffle(
    active.filter((participant) => !sitterIds.has(participant.participantId)),
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

function socialRules(title, cfg, standingsLine) {
  const scoring = cfg.scoring;
  return {
    title,
    lines: [
      `${scoring.pointsTarget} total points`,
      `${scoring.servesPerPlayer} serves per player`,
      `Serve rotation: ${scoring.serveOrder.join(", ")}`,
      `${scoring.serveBlockLength} serve per player before rotation repeats`,
      scoring.sideSwapRule === "after_each_player_serves_once"
        ? "Swap sides after each player serves once"
        : "No automatic side swap",
      standingsLine,
    ],
  };
}

americano.socialRules = socialRules;

module.exports = americano;
