// Scoring options: normalising the scoring mode / deuce / tiebreak options and
// resolving which options apply to the court and to the current score.
import { DEFAULT_SCORING_OPTIONS } from "../config/constants.js";
import { session } from "../state/sessionState.js";

export function normalizeScoringOptions(options = {})
{
  const normalized = {
    ...DEFAULT_SCORING_OPTIONS,
    ...(options || {})
  };

  if (!["standard", "straight", "tiebreakTen"].includes(normalized.scoringMode))
  {
    normalized.scoringMode = DEFAULT_SCORING_OPTIONS.scoringMode;
  }

  if (!["standard", "golden", "silver", "star"].includes(normalized.deuceMode))
  {
    normalized.deuceMode = DEFAULT_SCORING_OPTIONS.deuceMode;
  }

  if (!["off", "sixAllSeven", "sixAllTen"].includes(normalized.tiebreakMode))
  {
    normalized.tiebreakMode = DEFAULT_SCORING_OPTIONS.tiebreakMode;
  }

  return normalized;
}

export function areScoringOptionsEqual(a, b)
{
  const left = normalizeScoringOptions(a);
  const right = normalizeScoringOptions(b);

  return left.scoringMode === right.scoringMode &&
    left.deuceMode === right.deuceMode &&
    left.tiebreakMode === right.tiebreakMode;
}

export function resolveScoringOptions(scoreData = session.score)
{
  const courtOptions = normalizeScoringOptions(session.currentScoringOptions || {});
  const scoreOptions = normalizeScoringOptions(scoreData?.scoringOptions || {});

  return normalizeScoringOptions({
    ...scoreOptions,
    ...courtOptions,
    scoringMode: courtOptions.scoringMode || scoreOptions.scoringMode || DEFAULT_SCORING_OPTIONS.scoringMode,
    deuceMode: courtOptions.deuceMode || scoreOptions.deuceMode || DEFAULT_SCORING_OPTIONS.deuceMode,
    tiebreakMode: courtOptions.tiebreakMode || scoreOptions.tiebreakMode || DEFAULT_SCORING_OPTIONS.tiebreakMode
  });
}

// Options describing how the CURRENT score numbers were produced. The score
// document carries the options the backend engine actually scored it with,
// while the court document's options arrive on a separate listener and can
// land before the recalculated score does. Preferring the score's own
// options keeps the rendered numbers and their formatting consistent during
// a scoring-mode change; resolveScoringOptions (court-first) remains the
// right source for the settings controls.
export function resolveScoreDisplayOptions(scoreData = session.score)
{
  if (scoreData?.scoringOptions?.scoringMode)
  {
    return normalizeScoringOptions(scoreData.scoringOptions);
  }
  return resolveScoringOptions(scoreData);
}
