// Scoring options: normalising the scoring mode / deuce / tiebreak options and
// resolving which options apply to the court and to the current score.
import {
  DEFAULT_FIXED_TOTAL_POINTS,
  DEFAULT_SCORING_OPTIONS,
} from "../config/constants.js";
import { session } from "../state/sessionState.js";

// Fixed Total Points keeps its profile available even when another scoring mode
// is active so switching modes never discards the user's configuration.
const SCORING_MODES = [
  "standard",
  "straight",
  "tiebreakTen",
  "fixedTotalPoints",
];
const FIXED_TOTAL_FIELDS = ["pointsTarget", "serving", "completion"];

export function normalizeScoringOptions(options = {}) {
  const normalized = {
    ...DEFAULT_SCORING_OPTIONS,
    ...(options || {}),
  };

  if (!SCORING_MODES.includes(normalized.scoringMode)) {
    normalized.scoringMode = DEFAULT_SCORING_OPTIONS.scoringMode;
  }

  if (
    !["standard", "golden", "silver", "star"].includes(normalized.deuceMode)
  ) {
    normalized.deuceMode = DEFAULT_SCORING_OPTIONS.deuceMode;
  }

  if (!["off", "sixAllSeven", "sixAllTen"].includes(normalized.tiebreakMode)) {
    normalized.tiebreakMode = DEFAULT_SCORING_OPTIONS.tiebreakMode;
  }

  if (normalized.scoringMode === "fixedTotalPoints") {
    const fixed = DEFAULT_FIXED_TOTAL_POINTS;
    const sourceServing = normalized.serving || {};
    const sourceCompletion = normalized.completion || {};
    const serving = {
      enabled: sourceServing.enabled !== false,
      order: sourceServing.order,
      serveBlockLength: sourceServing.serveBlockLength,
      sideSwapRule: sourceServing.sideSwapRule,
    };
    const completion = {
      rule: sourceCompletion.rule,
      tieResolution: sourceCompletion.tieResolution,
    };
    const allowedSlots = new Set(fixed.serving.order);
    const orderIsValid =
      Array.isArray(serving.order) &&
      serving.order.length === fixed.serving.order.length &&
      serving.order.every((slot) => allowedSlots.has(slot)) &&
      new Set(serving.order).size === fixed.serving.order.length;

    const pointsTarget = Number(normalized.pointsTarget);
    normalized.pointsTarget =
      Number.isInteger(pointsTarget) && pointsTarget >= 1 && pointsTarget <= 500
        ? pointsTarget
        : fixed.pointsTarget;
    normalized.serving = {
      enabled: serving.enabled !== false,
      order: orderIsValid ? [...serving.order] : [...fixed.serving.order],
      serveBlockLength:
        Number.isInteger(Number(serving.serveBlockLength)) &&
        Number(serving.serveBlockLength) >= 1 &&
        Number(serving.serveBlockLength) <= 20
          ? Number(serving.serveBlockLength)
          : fixed.serving.serveBlockLength,
      sideSwapRule: ["after_each_player_serves_once", "none"].includes(
        serving.sideSwapRule,
      )
        ? serving.sideSwapRule
        : fixed.serving.sideSwapRule,
    };
    normalized.completion = {
      ...completion,
      rule: "exact_total_points",
      tieResolution: ["allow_draw", "golden_point"].includes(
        completion.tieResolution,
      )
        ? completion.tieResolution
        : fixed.completion.tieResolution,
    };
  } else if (FIXED_TOTAL_FIELDS.some((field) => normalized[field] !== undefined)) {
    const fixed = DEFAULT_FIXED_TOTAL_POINTS;
    const sourceServing = normalized.serving || {};
    const sourceCompletion = normalized.completion || {};
    const allowedSlots = new Set(fixed.serving.order);
    const orderIsValid =
      Array.isArray(sourceServing.order) &&
      sourceServing.order.length === fixed.serving.order.length &&
      sourceServing.order.every((slot) => allowedSlots.has(slot)) &&
      new Set(sourceServing.order).size === fixed.serving.order.length;
    const pointsTarget = Number(normalized.pointsTarget);
    normalized.pointsTarget =
      Number.isInteger(pointsTarget) && pointsTarget >= 1 && pointsTarget <= 500
        ? pointsTarget
        : fixed.pointsTarget;
    normalized.serving = {
      enabled: sourceServing.enabled !== false,
      order: orderIsValid ? [...sourceServing.order] : [...fixed.serving.order],
      serveBlockLength:
        Number.isInteger(Number(sourceServing.serveBlockLength)) &&
        Number(sourceServing.serveBlockLength) >= 1 &&
        Number(sourceServing.serveBlockLength) <= 20
          ? Number(sourceServing.serveBlockLength)
          : fixed.serving.serveBlockLength,
      sideSwapRule: ["after_each_player_serves_once", "none"].includes(
        sourceServing.sideSwapRule,
      )
        ? sourceServing.sideSwapRule
        : fixed.serving.sideSwapRule,
    };
    normalized.completion = {
      rule: "exact_total_points",
      tieResolution: ["allow_draw", "golden_point"].includes(
        sourceCompletion.tieResolution,
      )
        ? sourceCompletion.tieResolution
        : fixed.completion.tieResolution,
    };
  }

  return normalized;
}

export function areScoringOptionsEqual(a, b) {
  const left = normalizeScoringOptions(a);
  const right = normalizeScoringOptions(b);

  return (
    left.scoringMode === right.scoringMode &&
    left.deuceMode === right.deuceMode &&
    left.tiebreakMode === right.tiebreakMode &&
    FIXED_TOTAL_FIELDS.every(
      (field) =>
        JSON.stringify(left[field] ?? null) ===
        JSON.stringify(right[field] ?? null),
    )
  );
}

export function resolveScoringOptions(scoreData = session.score) {
  const courtOptions = normalizeScoringOptions(
    session.currentScoringOptions || {},
  );
  const scoreOptions = normalizeScoringOptions(scoreData?.scoringOptions || {});

  return normalizeScoringOptions({
    ...scoreOptions,
    ...courtOptions,
    scoringMode:
      courtOptions.scoringMode ||
      scoreOptions.scoringMode ||
      DEFAULT_SCORING_OPTIONS.scoringMode,
    deuceMode:
      courtOptions.deuceMode ||
      scoreOptions.deuceMode ||
      DEFAULT_SCORING_OPTIONS.deuceMode,
    tiebreakMode:
      courtOptions.tiebreakMode ||
      scoreOptions.tiebreakMode ||
      DEFAULT_SCORING_OPTIONS.tiebreakMode,
  });
}

// Options describing how the CURRENT score numbers were produced. The score
// document carries the options the backend engine actually scored it with,
// while the court document's options arrive on a separate listener and can
// land before the recalculated score does. Preferring the score's own
// options keeps the rendered numbers and their formatting consistent during
// a scoring-mode change; resolveScoringOptions (court-first) remains the
// right source for the settings controls.
export function resolveScoreDisplayOptions(scoreData = session.score) {
  if (scoreData?.scoringOptions?.scoringMode) {
    return normalizeScoringOptions(scoreData.scoringOptions);
  }
  return resolveScoringOptions(scoreData);
}
