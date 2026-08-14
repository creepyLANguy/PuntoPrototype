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
    const undoneScore = undo(score, options);
    if (event.id || event.eventId)
    {
      undoneScore.lastEventId = event.id || event.eventId;
    }
    return undoneScore;
  }

  const newScore = normalizeScore(clone(score), options);

  if (newScore.matchComplete)
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

// Strips the (potentially large, replay-only) undo stack before a score is persisted.
function toLiveScorePayload(score)
{
  if (!score || typeof score !== "object")
  {
    return score;
  }

  const { history, ...liveScore } = score;
  return liveScore;
}

function getEventOrderingTuple(event)
{
  const createdAt = event?.createdAt || null;
  const id = typeof event?.id === "string" ? event.id : null;
  return { createdAt, id };
}

// Returns <0/0/>0 like a comparator, or null when either side lacks ordering info.
function compareEventOrder(leftCreatedAt, leftId, rightCreatedAt, rightId)
{
  if (!leftCreatedAt || !rightCreatedAt)
  {
    return null;
  }

  const secondsDiff = leftCreatedAt.seconds - rightCreatedAt.seconds;
  if (secondsDiff !== 0) return secondsDiff;

  const nanosDiff = leftCreatedAt.nanoseconds - rightCreatedAt.nanoseconds;
  if (nanosDiff !== 0) return nanosDiff;

  if (!leftId || !rightId)
  {
    return null;
  }

  return leftId.localeCompare(rightId);
}

function scoreEquivalent(leftScore, rightScore)
{
  if (!leftScore || !rightScore) return false;

  const leftCompletedSets = Array.isArray(leftScore.completedSets) ? leftScore.completedSets : [];
  const rightCompletedSets = Array.isArray(rightScore.completedSets) ? rightScore.completedSets : [];

  if (leftCompletedSets.length !== rightCompletedSets.length)
  {
    return false;
  }

  for (let i = 0; i < leftCompletedSets.length; i++)
  {
    const leftSet = leftCompletedSets[i] || {};
    const rightSet = rightCompletedSets[i] || {};
    if ((Number(leftSet.A) || 0) !== (Number(rightSet.A) || 0)) return false;
    if ((Number(leftSet.B) || 0) !== (Number(rightSet.B) || 0)) return false;
  }

  return (Number(leftScore.A?.points) || 0) === (Number(rightScore.A?.points) || 0) &&
    (Number(leftScore.B?.points) || 0) === (Number(rightScore.B?.points) || 0) &&
    (Number(leftScore.A?.games) || 0) === (Number(rightScore.A?.games) || 0) &&
    (Number(leftScore.B?.games) || 0) === (Number(rightScore.B?.games) || 0) &&
    (Number(leftScore.A?.sets) || 0) === (Number(rightScore.A?.sets) || 0) &&
    (Number(leftScore.B?.sets) || 0) === (Number(rightScore.B?.sets) || 0) &&
    (Number(leftScore.A?.totalPoints) || 0) === (Number(rightScore.A?.totalPoints) || 0) &&
    (Number(leftScore.B?.totalPoints) || 0) === (Number(rightScore.B?.totalPoints) || 0) &&
    Boolean(leftScore.inTiebreak) === Boolean(rightScore.inTiebreak) &&
    (Number(leftScore.deuceCycles) || 0) === (Number(rightScore.deuceCycles) || 0) &&
    Boolean(leftScore.matchComplete) === Boolean(rightScore.matchComplete);
}

function didSetCountIncrease(previousScore, nextScore)
{
  const previousSets = (Number(previousScore?.A?.sets) || 0) + (Number(previousScore?.B?.sets) || 0);
  const nextSets = (Number(nextScore?.A?.sets) || 0) + (Number(nextScore?.B?.sets) || 0);
  return nextSets > previousSets;
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
  getCurrentServerLabel,
  toLiveScorePayload,
  getEventOrderingTuple,
  compareEventOrder,
  scoreEquivalent,
  didSetCountIncrease
};
