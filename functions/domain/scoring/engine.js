const historyThreshold = 500;

const SCORING_MODES = new Set(["standard", "straight", "tiebreakTen", "fixedTotalPoints"]);
const DEUCE_MODES = new Set(["standard", "golden", "silver", "star"]);
const TIEBREAK_MODES = new Set(["off", "sixAllSeven", "sixAllTen"]);

// Modes with a defined end: the score itself decides when the match is over.
const FIXED_END_MODES = new Set(["tiebreakTen", "fixedTotalPoints"]);

const SERVE_SLOTS = ["A1", "B1", "A2", "B2"];
const SIDE_SWAP_RULES = new Set([
  "after_each_player_serves_once",
  "after_all_players_serve_once",
  "none",
]);
const COMPLETION_RULES = new Set(["exact_total_points"]);
const TIE_RESOLUTIONS = new Set(["allow_draw", "golden_point"]);

const DEFAULT_SCORING_OPTIONS = {
  scoringMode: "standard",
  deuceMode: "standard",
  tiebreakMode: "sixAllSeven",
};

const DEFAULT_FIXED_TOTAL_POINTS = {
  pointsTarget: 36,
  serving: {
    enabled: true,
    order: [...SERVE_SLOTS],
    serveBlockLength: 1,
    sideSwapRule: "after_each_player_serves_once",
  },
  completion: {
    rule: "exact_total_points",
    tieResolution: "allow_draw",
  },
};

function clone(value) {
  return structuredClone(value);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    return fallback;
  }
  return number;
}

function isServeOrder(order) {
  return (
    Array.isArray(order) &&
    order.length === SERVE_SLOTS.length &&
    SERVE_SLOTS.every((slot) => order.includes(slot))
  );
}

function normalizeFixedTotalPointsOptions(options) {
  const serving = { ...DEFAULT_FIXED_TOTAL_POINTS.serving, ...(options.serving || {}) };
  const completion = { ...DEFAULT_FIXED_TOTAL_POINTS.completion, ...(options.completion || {}) };

  return {
    pointsTarget: clampInteger(
      options.pointsTarget,
      1,
      500,
      DEFAULT_FIXED_TOTAL_POINTS.pointsTarget,
    ),
    serving: {
      enabled: serving.enabled !== false,
      order: isServeOrder(serving.order) ? [...serving.order] : [...SERVE_SLOTS],
      serveBlockLength: clampInteger(serving.serveBlockLength, 1, 20, 1),
      sideSwapRule: SIDE_SWAP_RULES.has(serving.sideSwapRule)
        ? serving.sideSwapRule
        : DEFAULT_FIXED_TOTAL_POINTS.serving.sideSwapRule,
    },
    completion: {
      rule: COMPLETION_RULES.has(completion.rule)
        ? completion.rule
        : DEFAULT_FIXED_TOTAL_POINTS.completion.rule,
      tieResolution: TIE_RESOLUTIONS.has(completion.tieResolution)
        ? completion.tieResolution
        : DEFAULT_FIXED_TOTAL_POINTS.completion.tieResolution,
    },
  };
}

function normalizeScoringOptions(options = {}) {
  const normalized = {
    ...DEFAULT_SCORING_OPTIONS,
    ...(options || {}),
  };

  if (!SCORING_MODES.has(normalized.scoringMode)) {
    normalized.scoringMode = DEFAULT_SCORING_OPTIONS.scoringMode;
  }

  if (!DEUCE_MODES.has(normalized.deuceMode)) {
    normalized.deuceMode = DEFAULT_SCORING_OPTIONS.deuceMode;
  }

  if (!TIEBREAK_MODES.has(normalized.tiebreakMode)) {
    normalized.tiebreakMode = DEFAULT_SCORING_OPTIONS.tiebreakMode;
  }

  const hasFixedTotalProfile = ["pointsTarget", "serving", "completion"].some(
    (field) => normalized[field] !== undefined,
  );
  if (normalized.scoringMode === "fixedTotalPoints" || hasFixedTotalProfile) {
    Object.assign(normalized, normalizeFixedTotalPointsOptions(normalized));
  } else {
    delete normalized.pointsTarget;
    delete normalized.serving;
    delete normalized.completion;
  }

  return normalized;
}

function isFixedEndMode(scoringMode) {
  return FIXED_END_MODES.has(scoringMode);
}

// Serve/side state of a fixed-total-points match after `rallyPoints` points.
// It is a pure function of the configuration and the rally count, so undo and
// replay never need to store it separately; it is materialised on the score
// for display and audit.
function buildFixedTotalState(rallyPoints, options) {
  const { serving, pointsTarget } = options;
  const order = serving.order;
  const blockLength = serving.serveBlockLength;
  const servesCompleted = Object.fromEntries(order.map((slot) => [slot, 0]));
  const fullBlocks = Math.floor(rallyPoints / blockLength);

  order.forEach((slot, index) => {
    const blocksForSlot =
      Math.floor(fullBlocks / order.length) + (index < fullBlocks % order.length ? 1 : 0);
    servesCompleted[slot] = blocksForSlot;
  });

  const cycleLength = order.length * blockLength;
  const sideSwapCycles =
    serving.sideSwapRule !== "none" ? Math.floor(rallyPoints / cycleLength) : 0;

  return {
    pointsTarget,
    rallyPoints,
    remainingPoints: Math.max(0, pointsTarget - rallyPoints),
    currentServer: serving.enabled ? order[fullBlocks % order.length] : null,
    serveSlot: fullBlocks % order.length,
    servesCompleted,
    sideSwapCycles,
    sidesSwapped: sideSwapCycles % 2 === 1,
  };
}

function getFixedTotalResult(score) {
  const pointsA = Number(score?.A?.points) || 0;
  const pointsB = Number(score?.B?.points) || 0;
  if (pointsA === pointsB) return "draw";
  return pointsA > pointsB ? "A" : "B";
}

function defaultScore(scoringOptions = DEFAULT_SCORING_OPTIONS) {
  const options = normalizeScoringOptions(scoringOptions);
  const score = {
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
    scoringOptions: options,
    history: [],
  };

  if (options.scoringMode === "fixedTotalPoints") {
    score.fixedTotal = buildFixedTotalState(0, options);
    score.result = null;
  }

  return score;
}

function getCompletedMatchGames(score) {
  const completedSets = Array.isArray(score.completedSets) ? score.completedSets : [];
  const completedGames = completedSets.reduce((sum, set) => {
    const setA = Number(set.A) || 0;
    const setB = Number(set.B) || 0;
    return sum + setA + setB;
  }, 0);

  return completedGames + (Number(score.A.games) || 0) + (Number(score.B.games) || 0);
}

function getGameServerLabel(totalCompletedGames) {
  const servingTeam = totalCompletedGames % 2 === 0 ? "A" : "B";
  const serviceRotationIndex = Math.floor(totalCompletedGames / 2);
  const playerNumber = serviceRotationIndex % 2 === 0 ? "1" : "2";
  return `${servingTeam}${playerNumber}`;
}

function getTiebreakServerLabel(score) {
  const totalCompletedGames = getCompletedMatchGames(score);
  const startingServer = getGameServerLabel(totalCompletedGames);
  const totalPoints = (Number(score.A.points) || 0) + (Number(score.B.points) || 0);

  if (totalPoints === 0) {
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

function getCurrentServerLabel(score) {
  const options = normalizeScoringOptions(score.scoringOptions);
  if (options.scoringMode === "straight") {
    return null;
  }

  if (options.scoringMode === "fixedTotalPoints") {
    const rallyPoints = (Number(score.A?.points) || 0) + (Number(score.B?.points) || 0);
    return buildFixedTotalState(rallyPoints, options).currentServer;
  }

  const totalCompletedGames = getCompletedMatchGames(score);
  const isStandardTiebreak =
    options.scoringMode === "standard" &&
    (score.inTiebreak || (score.A.games === 6 && score.B.games === 6));
  const isMatchTiebreak = options.scoringMode === "tiebreakTen";

  if (isStandardTiebreak || isMatchTiebreak) {
    return getTiebreakServerLabel(score);
  }

  return getGameServerLabel(totalCompletedGames);
}

function normalizeScore(score, scoringOptions) {
  const normalizedOptions = normalizeScoringOptions(scoringOptions || score?.scoringOptions);
  const base = defaultScore(normalizedOptions);
  const merged = {
    ...base,
    ...(score || {}),
    A: { ...base.A, ...(score?.A || {}) },
    B: { ...base.B, ...(score?.B || {}) },
    scoringOptions: normalizedOptions,
  };

  if (!Array.isArray(merged.history)) merged.history = [];
  if (!Array.isArray(merged.completedSets)) merged.completedSets = [];
  if (typeof merged.inTiebreak !== "boolean") merged.inTiebreak = false;
  if (typeof merged.deuceCycles !== "number") merged.deuceCycles = 0;
  if (typeof merged.matchComplete !== "boolean") merged.matchComplete = false;

  // matchComplete is only meaningful in modes with a defined end (the match
  // tiebreak and fixed total points). Standard and straight modes have no
  // fixed set/point target - a match can go on indefinitely - so a stale flag
  // (e.g. carried over from a scoring-mode change) must never block or end
  // scoring there.
  if (!isFixedEndMode(normalizedOptions.scoringMode)) {
    merged.matchComplete = false;
  }

  if (normalizedOptions.scoringMode === "fixedTotalPoints") {
    const rallyPoints = (Number(merged.A.points) || 0) + (Number(merged.B.points) || 0);
    merged.fixedTotal = buildFixedTotalState(rallyPoints, normalizedOptions);
    merged.result = merged.matchComplete ? getFixedTotalResult(merged) : null;
  } else {
    delete merged.fixedTotal;
    delete merged.result;
  }

  return merged;
}

function applyEvent(score, event, scoringOptions) {
  const options = normalizeScoringOptions(scoringOptions || score?.scoringOptions);

  if (event.eventType === "RESET") {
    return {
      ...defaultScore(options),
      lastEventId: event.id || event.eventId || null,
    };
  }

  if (event.eventType === "UNDO") {
    const undoneScore = undo(score, options);
    if (event.id || event.eventId) {
      undoneScore.lastEventId = event.id || event.eventId;
    }
    return undoneScore;
  }

  const newScore = normalizeScore(clone(score), options);

  // Only modes with a defined end can be complete; normalizeScore already
  // clears the flag for every other mode, so this guard can never fire there.
  if (isFixedEndMode(options.scoringMode) && newScore.matchComplete) {
    return newScore;
  }

  const snapshot = clone(newScore);
  delete snapshot.history;
  newScore.history.push(snapshot);

  if (newScore.history.length > historyThreshold) {
    newScore.history.shift();
  }

  switch (event.eventType) {
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

  if (event.id || event.eventId) {
    newScore.lastEventId = event.id || event.eventId;
  }

  return newScore;
}

function undo(score, scoringOptions) {
  if (!score.history || score.history.length === 0) {
    return normalizeScore(score, scoringOptions);
  }

  const history = [...score.history];
  const newScore = history.pop();
  newScore.history = history;
  newScore.scoringOptions = normalizeScoringOptions(scoringOptions || score.scoringOptions);
  return normalizeScore(newScore, newScore.scoringOptions);
}

function awardPoint(score, scoringTeam, otherTeam, options) {
  score.lastPointTeam = scoringTeam;
  score[scoringTeam].totalPoints = (score[scoringTeam].totalPoints || 0) + 1;

  if (options.scoringMode === "straight") {
    score[scoringTeam].points++;
    return;
  }

  if (options.scoringMode === "fixedTotalPoints") {
    awardFixedTotalPoint(score, scoringTeam, options);
    return;
  }

  if (options.scoringMode === "tiebreakTen") {
    awardTiebreakPoint(score, scoringTeam, otherTeam, 10, true);
    return;
  }

  if (isTiebreakGame(score, options)) {
    score.inTiebreak = true;
    awardTiebreakPoint(score, scoringTeam, otherTeam, getTiebreakTarget(options), false);
    return;
  }

  awardRegularGamePoint(score, scoringTeam, otherTeam, options);
}

function awardRegularGamePoint(score, scoringTeam, otherTeam, options) {
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  if (team.points < 3) {
    team.points++;
    return;
  }

  if (team.points >= 3 && opponent.points < 3) {
    winGame(score, scoringTeam, otherTeam);
    return;
  }

  if (team.points === 3 && opponent.points === 3) {
    // Golden: every deuce is sudden death. Silver: sudden death after one
    // cancelled advantage. Star: sudden death after two cancelled advantages.
    if (
      options.deuceMode === "golden" ||
      (options.deuceMode === "silver" && score.deuceCycles > 0) ||
      (options.deuceMode === "star" && score.deuceCycles >= 2)
    ) {
      winGame(score, scoringTeam, otherTeam);
      return;
    }

    team.points = 4;
    return;
  }

  if (team.points === 4) {
    winGame(score, scoringTeam, otherTeam);
    return;
  }

  if (opponent.points === 4) {
    opponent.points = 3;
    if (options.deuceMode === "silver" || options.deuceMode === "star") {
      score.deuceCycles++;
    }
  }
}

function awardFixedTotalPoint(score, scoringTeam, options) {
  score[scoringTeam].points++;

  const rallyPoints = score.A.points + score.B.points;
  score.fixedTotal = buildFixedTotalState(rallyPoints, options);

  if (rallyPoints < options.pointsTarget) {
    score.result = null;
    return;
  }

  // At (or past) the target: a tie under "golden_point" plays one deciding
  // rally; every other case ends the match on exactly the target.
  const tied = score.A.points === score.B.points;
  if (tied && options.completion.tieResolution === "golden_point") {
    score.result = null;
    return;
  }

  score.matchComplete = true;
  score.result = getFixedTotalResult(score);
  if (score.result !== "draw") {
    score[score.result].sets = 1;
    score.lastSetTeam = score.result;
  }
}

function winGame(score, scoringTeam, otherTeam) {
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  team.games++;
  score.lastGameTeam = scoringTeam;
  score.deuceCycles = 0;

  team.points = 0;
  opponent.points = 0;

  if (team.games >= 6 && team.games - opponent.games >= 2) {
    completeSet(score, scoringTeam);
  }
}

function completeSet(score, scoringTeam, tiebreakPoints = null) {
  score.completedSets.push({
    A: score.A.games,
    B: score.B.games,
    tiebreakPoints,
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

function isTiebreakGame(score, options) {
  if (options.tiebreakMode === "off") return false;
  return score.inTiebreak || (score.A.games === 6 && score.B.games === 6);
}

function getTiebreakTarget(options) {
  return options.tiebreakMode === "sixAllTen" ? 10 : 7;
}

function awardTiebreakPoint(score, scoringTeam, otherTeam, target, isMatchTiebreak) {
  const team = score[scoringTeam];
  const opponent = score[otherTeam];

  team.points++;

  if (team.points >= target && team.points - opponent.points >= 2) {
    score.lastGameTeam = scoringTeam;

    if (isMatchTiebreak) {
      score[scoringTeam].sets = 1;
      score.lastSetTeam = scoringTeam;
      score.matchComplete = true;
      return;
    }

    const tiebreakPoints = {
      A: score.A.points,
      B: score.B.points,
    };

    team.games++;
    completeSet(score, scoringTeam, tiebreakPoints);
  }
}

function replayEvents(events, scoringOptions = DEFAULT_SCORING_OPTIONS) {
  const options = normalizeScoringOptions(scoringOptions);
  let score = defaultScore(options);

  events.forEach((event) => {
    score = applyEvent(score, event, options);
  });

  return score;
}

// Strips the (potentially large, replay-only) undo stack before a score is persisted.
function toLiveScorePayload(score) {
  if (!score || typeof score !== "object") {
    return score;
  }

  const { history, ...liveScore } = score;
  return liveScore;
}

function getEventOrderingTuple(event) {
  const createdAt = event?.createdAt || null;
  const id = typeof event?.id === "string" ? event.id : null;
  return { createdAt, id };
}

// Returns <0/0/>0 like a comparator, or null when either side lacks ordering info.
function compareEventOrder(leftCreatedAt, leftId, rightCreatedAt, rightId) {
  if (!leftCreatedAt || !rightCreatedAt) {
    return null;
  }

  const secondsDiff = leftCreatedAt.seconds - rightCreatedAt.seconds;
  if (secondsDiff !== 0) return secondsDiff;

  const nanosDiff = leftCreatedAt.nanoseconds - rightCreatedAt.nanoseconds;
  if (nanosDiff !== 0) return nanosDiff;

  if (!leftId || !rightId) {
    return null;
  }

  return leftId.localeCompare(rightId);
}

function scoreEquivalent(leftScore, rightScore) {
  if (!leftScore || !rightScore) return false;

  const leftCompletedSets = Array.isArray(leftScore.completedSets) ? leftScore.completedSets : [];
  const rightCompletedSets = Array.isArray(rightScore.completedSets)
    ? rightScore.completedSets
    : [];

  if (leftCompletedSets.length !== rightCompletedSets.length) {
    return false;
  }

  for (let i = 0; i < leftCompletedSets.length; i++) {
    const leftSet = leftCompletedSets[i] || {};
    const rightSet = rightCompletedSets[i] || {};
    if ((Number(leftSet.A) || 0) !== (Number(rightSet.A) || 0)) return false;
    if ((Number(leftSet.B) || 0) !== (Number(rightSet.B) || 0)) return false;
  }

  return (
    (Number(leftScore.A?.points) || 0) === (Number(rightScore.A?.points) || 0) &&
    (Number(leftScore.B?.points) || 0) === (Number(rightScore.B?.points) || 0) &&
    (Number(leftScore.A?.games) || 0) === (Number(rightScore.A?.games) || 0) &&
    (Number(leftScore.B?.games) || 0) === (Number(rightScore.B?.games) || 0) &&
    (Number(leftScore.A?.sets) || 0) === (Number(rightScore.A?.sets) || 0) &&
    (Number(leftScore.B?.sets) || 0) === (Number(rightScore.B?.sets) || 0) &&
    (Number(leftScore.A?.totalPoints) || 0) === (Number(rightScore.A?.totalPoints) || 0) &&
    (Number(leftScore.B?.totalPoints) || 0) === (Number(rightScore.B?.totalPoints) || 0) &&
    Boolean(leftScore.inTiebreak) === Boolean(rightScore.inTiebreak) &&
    (Number(leftScore.deuceCycles) || 0) === (Number(rightScore.deuceCycles) || 0) &&
    Boolean(leftScore.matchComplete) === Boolean(rightScore.matchComplete)
  );
}

function didSetCountIncrease(previousScore, nextScore) {
  const previousSets =
    (Number(previousScore?.A?.sets) || 0) + (Number(previousScore?.B?.sets) || 0);
  const nextSets = (Number(nextScore?.A?.sets) || 0) + (Number(nextScore?.B?.sets) || 0);
  return nextSets > previousSets;
}

function compareTeams(left, right) {
  if (left === right) return null;
  return left > right ? "A" : "B";
}

// Canonical result of a match from its authoritative score. Rally points are
// the team's total points won in every mode; games include completed sets.
function getMatchResult(score) {
  const options = normalizeScoringOptions(score?.scoringOptions);
  const side = (team) => score?.[team] || {};
  const sets = { A: Number(side("A").sets) || 0, B: Number(side("B").sets) || 0 };
  const completedSets = Array.isArray(score?.completedSets) ? score.completedSets : [];
  const games = {
    A:
      completedSets.reduce((sum, set) => sum + (Number(set.A) || 0), 0) +
      (Number(side("A").games) || 0),
    B:
      completedSets.reduce((sum, set) => sum + (Number(set.B) || 0), 0) +
      (Number(side("B").games) || 0),
  };
  const points = {
    A: Number(side("A").totalPoints) || 0,
    B: Number(side("B").totalPoints) || 0,
  };

  let winner;
  if (options.scoringMode === "fixedTotalPoints" || options.scoringMode === "straight") {
    points.A = Number(side("A").points) || 0;
    points.B = Number(side("B").points) || 0;
    winner = compareTeams(points.A, points.B);
  } else {
    winner =
      compareTeams(sets.A, sets.B) ||
      compareTeams(games.A, games.B) ||
      compareTeams(points.A, points.B);
  }

  return {
    winner: winner || "draw",
    points,
    games,
    sets,
    scoringMode: options.scoringMode,
    matchComplete: Boolean(score?.matchComplete),
  };
}

module.exports = {
  DEFAULT_SCORING_OPTIONS,
  DEFAULT_FIXED_TOTAL_POINTS,
  SCORING_MODES,
  defaultScore,
  normalizeScoringOptions,
  isFixedEndMode,
  buildFixedTotalState,
  getMatchResult,
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
  didSetCountIncrease,
};
