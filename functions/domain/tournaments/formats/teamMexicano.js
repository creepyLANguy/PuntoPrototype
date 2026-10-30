const { calculateStandings: standings } = require("../standings");
const teamAmericano = require("./teamAmericano");
const {
  calculateRoundResult,
  canGenerateAfterComplete,
  requireNextRoundAllowed,
} = require("./shared");

const teamMexicano = {
  id: "teamMexicano",
  label: "Team Mexicano",
  entryMode: "team",
  kind: "rotating",
  supportsNextRound: true,
  defaultConfig: teamAmericano.defaultConfig,
  normalizeConfig: teamAmericano.normalizeConfig,
  validateConfig: teamAmericano.validateConfig,
  validateParticipants: teamAmericano.validateParticipants,
  generateInitialRound(state) {
    return generateRound(state);
  },
  generateNextRound(state) {
    requireNextRoundAllowed(state);
    return generateRound(state);
  },
  canGenerateNextRound: canGenerateAfterComplete,
  calculateStandings(state) {
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    return standings(state, { entryType: "team", mode: "social", formatId: "teamMexicano", usePointDiff: cfg.usePointDiff });
  },
  calculateRoundResult,
  getRulesSummary(config) {
    return teamAmericano.getRulesSummary(config);
  },
};

function generateRound(state) {
  const active = (state.teams || []).filter((team) => team.status === "active");
  let ranked = [...active].sort(
    (a, b) => (a.seed || 9999) - (b.seed || 9999) || a.teamId.localeCompare(b.teamId),
  );
  if ((state.rounds || []).length > 0) {
    const byId = Object.fromEntries(active.map((team) => [team.teamId, team]));
    ranked = teamMexicano
      .calculateStandings(state)
      .rows.map((row) => byId[row.entryId])
      .filter(Boolean);
  }
  return teamAmericano.generateTeamRound(state, true, ranked);
}

module.exports = teamMexicano;
