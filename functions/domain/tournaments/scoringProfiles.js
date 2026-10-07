const DEFAULT_SERVE_ORDER = ["A1", "B1", "A2", "B2"];
const SOCIAL_DEFAULT_SCORING = {
  pointsTarget: 36,
  serveOrder: DEFAULT_SERVE_ORDER,
  serveBlockLength: 1,
  sideSwapRule: "after_all_players_serve_once",
  tieResolution: "allow_draw",
};

function buildFixedTotalPointsProfile(scoringConfig = {}) {
  const cfg = normalizeFixedTotalPointsConfig(scoringConfig);
  return {
    scoringMode: "fixedTotalPoints",
    deuceMode: "standard",
    tiebreakMode: "off",
    pointsTarget: cfg.pointsTarget,
    serving: {
      enabled: true,
      order: [...cfg.serveOrder],
      serveBlockLength: cfg.serveBlockLength,
      sideSwapRule: cfg.sideSwapRule,
    },
    completion: { rule: "exact_total_points", tieResolution: cfg.tieResolution },
  };
}

function normalizeFixedTotalPointsConfig(scoringConfig = {}) {
  return {
    pointsTarget: toInt(scoringConfig.pointsTarget, SOCIAL_DEFAULT_SCORING.pointsTarget),
    serveOrder: isServeOrder(scoringConfig.serveOrder)
      ? [...scoringConfig.serveOrder]
      : [...SOCIAL_DEFAULT_SCORING.serveOrder],
    serveBlockLength: toInt(
      scoringConfig.serveBlockLength,
      SOCIAL_DEFAULT_SCORING.serveBlockLength,
    ),
    sideSwapRule: ["after_all_players_serve_once", "none"].includes(
      scoringConfig.sideSwapRule,
    )
      ? scoringConfig.sideSwapRule
      : SOCIAL_DEFAULT_SCORING.sideSwapRule,
    tieResolution: ["allow_draw", "golden_point"].includes(scoringConfig.tieResolution)
      ? scoringConfig.tieResolution
      : SOCIAL_DEFAULT_SCORING.tieResolution,
  };
}

function validateFixedTotalPointsConfig(scoringConfig = {}) {
  const cfg = normalizeFixedTotalPointsConfig(scoringConfig);
  const errors = [];
  if (!Number.isInteger(cfg.pointsTarget) || cfg.pointsTarget < 4 || cfg.pointsTarget > 200) {
    errors.push({ code: "INVALID_POINTS_TARGET", message: "pointsTarget must be 4..200." });
  }
  if (
    !Number.isInteger(cfg.serveBlockLength) ||
    cfg.serveBlockLength < 1 ||
    cfg.serveBlockLength > 10
  ) {
    errors.push({ code: "INVALID_SERVE_BLOCK_LENGTH", message: "serveBlockLength must be 1..10." });
  }
  if (!isServeOrder(cfg.serveOrder)) {
    errors.push({
      code: "INVALID_SERVE_ORDER",
      message: "serveOrder must be A1,B1,A2,B2 permutation.",
    });
  }
  return { errors, warnings: [] };
}

function resolveMatchScoringOptions(formatId, config = {}) {
  if (["americano", "mexicano", "teamAmericano", "teamMexicano"].includes(formatId)) {
    return buildFixedTotalPointsProfile(config.scoring);
  }
  if (config.scoring?.scoringMode === "fixedTotalPoints") {
    return buildFixedTotalPointsProfile(config.scoring);
  }
  return {
    scoringMode: config.scoring?.scoringMode || "standard",
    deuceMode: config.scoring?.deuceMode || "golden",
    tiebreakMode: config.scoring?.tiebreakMode || "sixAllSeven",
  };
}

function toInt(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

function isServeOrder(order) {
  return (
    Array.isArray(order) &&
    order.length === 4 &&
    [...order].sort().join(",") === DEFAULT_SERVE_ORDER.slice().sort().join(",")
  );
}

module.exports = {
  SOCIAL_DEFAULT_SCORING,
  buildFixedTotalPointsProfile,
  normalizeFixedTotalPointsConfig,
  validateFixedTotalPointsConfig,
  resolveMatchScoringOptions,
};
