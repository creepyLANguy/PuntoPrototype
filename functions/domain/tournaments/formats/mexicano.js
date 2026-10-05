const { calculateStandings: standings } = require("../standings");
const americano = require("./americano");
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

const mexicano = {
  id: "mexicano",
  label: "Mexicano",
  entryMode: "individual",
  kind: "rotating",
  supportsNextRound: true,
  defaultConfig: () => ({ ...socialDefaultConfig(), initialDraw: "seeded" }),
  normalizeConfig: (config = {}) => ({
    ...socialDefaultConfig(config),
    initialDraw: ["seeded", "random"].includes(config.initialDraw) ? config.initialDraw : "seeded",
  }),
  validateConfig: socialConfigValidation,
  validateParticipants: americano.validateParticipants,
  generateInitialRound(state) {
    return generateRound(state);
  },
  generateNextRound(state) {
    requireNextRoundAllowed(state);
    return generateRound(state);
  },
  canGenerateNextRound: canGenerateAfterComplete,
  calculateStandings(state) {
    return standings(state, { entryType: "participant", mode: "social", formatId: "mexicano" });
  },
  calculateRoundResult,
  getRulesSummary(config) {
    return americano.socialRules(
      "MEXICANO",
      this.normalizeConfig(config),
      "Individual standings: total points won",
    );
  },
};

function generateRound(state) {
  const cfg = mexicano.normalizeConfig(state.tournament?.format?.config || {});
  const roundNumber = nextRoundNumber(state);
  const seed = seedFor(state, roundNumber);
  const rng = createRng(seed);
  const history = buildHistory(state);
  const active = (state.participants || []).filter(
    (participant) => participant.status === "active",
  );
  const ranked = rankParticipants(state, active, cfg, rng, roundNumber);
  const courtLimit =
    cfg.maxCourts || state.tournament?.courtPool?.length || Number.MAX_SAFE_INTEGER;
  const matchCount = Math.min(Math.floor(ranked.length / 4), courtLimit);
  const sitters = chooseSitters(
    ranked,
    ranked.length - matchCount * 4,
    history,
    rng,
    rankMap(ranked),
  );
  const sitterIds = new Set(sitters.map((participant) => participant.participantId));
  const playing = ranked.filter((participant) => !sitterIds.has(participant.participantId));
  const round = baseRound(roundNumber, `Round ${roundNumber}`, null, seed, {
    algorithm: "mexicano-ranked-v1",
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

function rankParticipants(state, active, cfg, rng, roundNumber) {
  if (roundNumber === 1 && cfg.initialDraw === "random") return shuffle(active, rng);
  if (roundNumber === 1)
    return [...active].sort(
      (a, b) =>
        (a.seed || 9999) - (b.seed || 9999) || a.participantId.localeCompare(b.participantId),
    );
  const rows = mexicano.calculateStandings(state).rows;
  const byId = Object.fromEntries(
    active.map((participant) => [participant.participantId, participant]),
  );
  return rows.map((row) => byId[row.entryId]).filter(Boolean);
}

function rankMap(entries) {
  return entries.reduce((map, entry, index) => {
    map[entry.participantId] = index + 1;
    return map;
  }, {});
}

module.exports = mexicano;
