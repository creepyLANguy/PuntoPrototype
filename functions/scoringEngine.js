const historyThreshold = 500;

const SCORING_MODES = new Set(["standard", "straight", "tiebreakTen"]);
const DEUCE_MODES = new Set(["standard", "golden", "silver"]);
const TIEBREAK_MODES = new Set(["off", "sixAllSeven", "sixAllTen"]);

const DEFAULT_SCORING_OPTIONS = {
  scoringMode: "standard",
  deuceMode: "standard",
  tiebreakMode: "sixAllSeven"
};

function clone(value)
{
  return structuredClone(value);
}

function normalizeScoringOptions(options = {})
{
  const normalized = {
    ...DEFAULT_SCORING_OPTIONS,
    ...(options || {})
  };

  if (!SCORING_MODES.has(normalized.scoringMode))
  {
    normalized.scoringMode = DEFAULT_SCORING_OPTIONS.scoringMode;
  }

  if (!DEUCE_MODES.has(normalized.deuceMode))
  {
    normalized.deuceMode = DEFAULT_SCORING_OPTIONS.deuceMode;
  }

  if (!TIEBREAK_MODES.has(normalized.tiebreakMode))
  {
    normalized.tiebreakMode = DEFAULT_SCORING_OPTIONS.tiebreakMode;
  }

  return normalized;
}

function defaultScore(scoringOptions = DEFAULT_SCORING_OPTIONS)
{
  return {
    A: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    B: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    lastPointTeam: null,
    lastGameTeam: null,
    lastSetTeam: null,
    lastEventId: null,
    inTiebreak: false,
    deuceCycles: 0,
    matchComplete: false,
    completedSets: [],
    scoringOptions: normalizeScoringOptions(scoringOptions),
    history: []
  };
}

function getCompletedMatchGames(score)
{
  const completedSets = Array.isArray(score.completedSets) ? score.completedSets : [];
  const completedGames = completedSets.reduce((sum, set) =>
  {
    const setA = Number(set.A) || 0;
    const setB = Number(set.B) || 0;
    return sum + setA + setB;
  }, 0);

  return completedGames + (Number(score.A.games) || 0) + (Number(score.B.games) || 0);
}

function getGameServerLabel(totalCompletedGames)
{
  const servingTeam = totalCompletedGames % 2 === 0 ? "A" : "B";
  const serviceRotationIndex = Math.floor(totalCompletedGames / 2);
  const playerNumber = serviceRotationIndex % 2 === 0 ? "1" : "2";
  return `${servingTeam}${playerNumber}`;
}

function getTiebreakServerLabel(score)
{
  const totalCompletedGames = getCompletedMatchGames(score);
  const startingServer = getGameServerLabel(totalCompletedGames);
  const totalPoints = (Number(score.A.points) || 0) + (Number(score.B.points) || 0);

  if (totalPoints === 0)
  {
    return startingServer;
  }

  const startingTeam = startingServer[0];
  const oppositeTeam = startingTeam === "A" ? "B" : "A";
  const segment = Math.floor((totalPoints + 1) / 2);
  const servingTeam = segment % 2 === 0 ? startingTeam : oppositeTeam;
  const serviceSegmentIndex = Math.floor(segment / 2);
  const playerNumber = serviceSegmentIndex % 2 === 0 ? "1" : "2";

  return `${servingTeam}${playerNumber}`;
}

function getCurrentServerLabel(score)
{
  const options = normalizeScoringOptions(score.scoringOptions);
  if (options.scoringMode === "straight")
  {
    return null;
  }

  const totalCompletedGames = getCompletedMatchGames(score);
  const isStandardTiebreak = options.scoringMode === "standard" &&
    (score.inTiebreak || (score.A.games === 6 && score.B.games === 6));
  const isMatchTiebreak = options.scoringMode === "tiebreakTen";

  if (isStandardTiebreak || isMatchTiebreak)
  {
    return getTiebreakServerLabel(score);
  }

  return getGameServerLabel(totalCompletedGames);
}

function normalizeScore(score, scoringOptions)
{
  const normalizedOptions = normalizeScoringOptions(scoringOptions || score?.scoringOptions);
  const base = defaultScore(normalizedOptions);
  const merged = {
    ...base,
    ...(score || {}),
    A: { ...base.A, ...(score?.A || {}) },
    B: { ...base.B, ...(score?.B || {}) },
    scoringOptions: normalizedOptions
  };

  if (!Array.isArray(merged.history)) merged.history = [];
  if (!Array.isArray(merged.completedSets)) merged.completedSets = [];
  if (typeof merged.inTiebreak !== "boolean") merged.inTiebreak = false;
  if (typeof merged.deuceCycles !== "number") merged.deuceCycles = 0;
  if (typeof merged.matchComplete !== "boolean") merged.matchComplete = false;

  return merged;
}

function applyEvent(score, event, scoringOptions)
{
  const options = normalizeScoringOptions(scoringOptions || score?.scoringOptions);

  if (event.eventType === "RESET")
  {
    return {
      ...defaultScore(options),
      lastEventId: event.id || event.eventId || null
    };
  }

  if (event.eventType === "UNDO")
  {
    return undo(score, options);
  }

  const newScore = normalizeScore(clone(score), options);

  if (newScore.matchComplete && options.scoringMode === "tiebreakTen")
  {
    return newScore;
  }

  const snapshot = clone(newScore);
  delete snapshot.history;
  newScore.history.push(snapshot);

  if (newScore.history.length > historyThreshold)
  {
    newScore.history.shift();
  }

  switch (event.eventType)
  {
    case "POINT_TEAM_A":
      awardPoint(newScore, "A", "B", options);
      break;

    case "POINT_TEAM_B":
      awardPoint(newScore, "B", "A", options);
      break;

    default:
      newScore.history.pop();
      break;
  }

  if (event.id || event.eventId)
  {
    newScore.lastEventId = event.id || event.eventId;
  }

  return newScore;
}

function undo(score, scoringOptions)
{
  if (!score.history || score.history.length === 0)
  {
    console.log("Nothing to undo");
    return normalizeScore(score, scoringOptions);
  }

  const history = [...score.history];
  const newScore = history.pop();
  newScore.history = history;
  newScore.scoringOptions = normalizeScoringOptions(scoringOptions || score.scoringOptions);
  return normalizeScore(newScore, newScore.scoringOptions);
}

function awardPoint(score, scoringTeam, otherTeam, options)
{
  score.lastPointTeam = scoringTeam;
  score[scoringTeam].totalPoints = (score[scoringTeam].totalPoints || 0) + 1;

  if (options.scoringMode === "straight")
  {
    score[scoringTeam].points++;
    return;
  }

  if (options.scoringMode === "tiebreakTen")
  {
    awardTiebreakPoint(score, scoringTeam, otherTeam, 10, true);
    return;
  }

  if (isTiebreakGame(score, options))
  {
    score.inTiebreak = true;
    awardTiebreakPoint(score, scoringTeam, otherTeam, getTiebreakTarget(options), false);
    return;
  }

  awardRegularGamePoint(score, scoringTeam, otherTeam, options);
}

function awardRegularGamePoint(score, scoringTeam, otherTeam, options)
{
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  if (team.points < 3)
  {
    team.points++;
    return;
  }

  if (team.points >= 3 && opponent.points < 3)
  {
    winGame(score, scoringTeam, otherTeam);
    return;
  }

  if (team.points === 3 && opponent.points === 3)
  {
    if (options.deuceMode === "golden" || (options.deuceMode === "silver" && score.deuceCycles > 0))
    {
      winGame(score, scoringTeam, otherTeam);
      return;
    }

    team.points = 4;
    return;
  }

  if (team.points === 4)
  {
    winGame(score, scoringTeam, otherTeam);
    return;
  }

  if (opponent.points === 4)
  {
    opponent.points = 3;
    if (options.deuceMode === "silver")
    {
      score.deuceCycles++;
    }
  }
}

function winGame(score, scoringTeam, otherTeam)
{
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  team.games++;
  score.lastGameTeam = scoringTeam;
  score.deuceCycles = 0;

  team.points = 0;
  opponent.points = 0;

  if (team.games >= 6 && (team.games - opponent.games) >= 2)
  {
    completeSet(score, scoringTeam);
  }
}

function completeSet(score, scoringTeam, tiebreakPoints = null)
{
  score.completedSets.push({
    A: score.A.games,
    B: score.B.games,
    tiebreakPoints
  });

  score[scoringTeam].sets++;
  score.lastSetTeam = scoringTeam;
  score.A.games = 0;
  score.B.games = 0;
  score.A.points = 0;
  score.B.points = 0;
  score.deuceCycles = 0;
  score.inTiebreak = false;
}

function isTiebreakGame(score, options)
{
  if (options.tiebreakMode === "off") return false;
  return score.inTiebreak || (score.A.games === 6 && score.B.games === 6);
}

function getTiebreakTarget(options)
{
  return options.tiebreakMode === "sixAllTen" ? 10 : 7;
}

function awardTiebreakPoint(score, scoringTeam, otherTeam, target, isMatchTiebreak)
{
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  team.points++;

  if (team.points >= target && (team.points - opponent.points) >= 2)
  {
    score.lastGameTeam = scoringTeam;

    if (isMatchTiebreak)
    {
      score[scoringTeam].sets = 1;
      score.lastSetTeam = scoringTeam;
      score.matchComplete = true;
      return;
    }

    const tiebreakPoints = {
      A: score.A.points,
      B: score.B.points
    };

    team.games++;
    completeSet(score, scoringTeam, tiebreakPoints);
  }
}

function replayEvents(events, scoringOptions = DEFAULT_SCORING_OPTIONS)
{
  const options = normalizeScoringOptions(scoringOptions);
  let score = defaultScore(options);

  events.forEach((event) =>
  {
    score = applyEvent(score, event, options);
  });

  return score;
}

module.exports = {
  DEFAULT_SCORING_OPTIONS,
  defaultScore,
  normalizeScoringOptions,
  applyEvent,
  replayEvents,
  getCompletedMatchGames,
  getGameServerLabel,
  getTiebreakServerLabel,
  getCurrentServerLabel
};