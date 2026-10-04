const { normalizeScoringOptions } = require("./engine");

const FIXED_TOTAL_POINTS_FIELDS = ["pointsTarget", "serving", "completion"];

function pickFixedTotalPointsFields(source) {
  const picked = {};
  FIXED_TOTAL_POINTS_FIELDS.forEach((field) => {
    if (source[field] !== undefined) {
      picked[field] = source[field];
    }
  });
  return picked;
}

function buildScoringOptions(source = {}) {
  const normalizedInput = { ...(source || {}) };
  const explicitScoringMode =
    typeof normalizedInput.scoringMode === "string" ? normalizedInput.scoringMode : undefined;
  const explicitDeuceMode =
    typeof normalizedInput.deuceMode === "string" ? normalizedInput.deuceMode : undefined;
  const explicitTiebreakMode =
    typeof normalizedInput.tiebreakMode === "string" ? normalizedInput.tiebreakMode : undefined;

  const options = normalizeScoringOptions({
    ...(normalizedInput.scoringOptions || {}),
    ...pickFixedTotalPointsFields(normalizedInput),
    scoringMode: explicitScoringMode,
    deuceMode: explicitDeuceMode,
    tiebreakMode: explicitTiebreakMode,
  });

  if (explicitScoringMode) {
    options.scoringMode = explicitScoringMode;
  }

  if (explicitDeuceMode) {
    options.deuceMode = explicitDeuceMode;
  }

  if (explicitTiebreakMode) {
    options.tiebreakMode = explicitTiebreakMode;
  }

  return normalizeScoringOptions(options);
}

module.exports = { buildScoringOptions, normalizeScoringOptions };
