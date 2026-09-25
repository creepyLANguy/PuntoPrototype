const {
  defaultScore,
  applyEvent,
  getCurrentServerLabel,
  normalizeScoringOptions,
} = require("../scoring/engine");
const { isTeamOnGamePoint } = require("../scoring/helpers");

const MOMENTUM_CONFIG = Object.freeze({
  decayPerPoint: 0.94,
  clampMin: -100,
  clampMax: 100,
  recentWindowSize: 10,
  recentWeights: [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
  recentScale: 12,
  streakGrowthDivisor: 2,
  streakScale: 0.6,
  streakCap: 18,
  pressureScale: 1.2,
  gameWinBonus: 10,
  setWinBonus: 20,
  setCarryDecayPerPoint: 0.9,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function extractServingTeam(serverLabel) {
  if (typeof serverLabel !== "string" || serverLabel.length === 0) {
    return null;
  }

  const team = serverLabel[0];
  return team === "A" || team === "B" ? team : null;
}

function buildRecentComponent(recentWinners) {
  if (!Array.isArray(recentWinners) || recentWinners.length === 0) {
    return 0;
  }

  const maxLen = Math.min(MOMENTUM_CONFIG.recentWindowSize, recentWinners.length);
  const windowStart = recentWinners.length - maxLen;
  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < maxLen; i++) {
    const winner = recentWinners[windowStart + i];
    const sign = winner === "A" ? 1 : winner === "B" ? -1 : 0;
    const ageIndex = maxLen - i - 1;
    const weight = MOMENTUM_CONFIG.recentWeights[ageIndex] ?? 0;
    weightedSum += sign * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) {
    return 0;
  }

  return (weightedSum / totalWeight) * MOMENTUM_CONFIG.recentScale;
}

function buildStreakComponent(streakLength) {
  if (!Number.isFinite(streakLength) || streakLength <= 1) {
    return 0;
  }

  // Non-linear growth makes short streaks noticeable and long streaks feel decisive.
  // Dividing by streakGrowthDivisor keeps the curve responsive without overwhelming other components too early.
  const rawBonus = (streakLength * streakLength) / MOMENTUM_CONFIG.streakGrowthDivisor;
  return Math.min(MOMENTUM_CONFIG.streakCap, rawBonus) * MOMENTUM_CONFIG.streakScale;
}

function classifyPressureBonus(beforeScore, scoringTeam, options) {
  if (!beforeScore || options.scoringMode !== "standard") {
    return 1;
  }

  const isTiebreakGame =
    beforeScore.inTiebreak ||
    (options.tiebreakMode !== "off" && beforeScore.A.games === 6 && beforeScore.B.games === 6);
  if (isTiebreakGame) {
    return 1;
  }

  const pointsA = Number(beforeScore.A?.points) || 0;
  const pointsB = Number(beforeScore.B?.points) || 0;

  const isAdvantage = (pointsA === 4 && pointsB === 3) || (pointsB === 4 && pointsA === 3);
  const isDeuce = pointsA >= 3 && pointsB >= 3 && pointsA === pointsB;
  const isThirtyAll = pointsA === 2 && pointsB === 2;
  const gamePointA = isTeamOnGamePoint(beforeScore, "A", options, false);
  const gamePointB = isTeamOnGamePoint(beforeScore, "B", options, false);

  const serverLabel = getCurrentServerLabel(beforeScore);
  const serverTeam = extractServingTeam(serverLabel);
  const returnerTeam = serverTeam === "A" ? "B" : serverTeam === "B" ? "A" : null;
  const isBreakPoint = (returnerTeam === "A" && gamePointA) || (returnerTeam === "B" && gamePointB);
  const scoringTeamOnGamePoint = scoringTeam === "A" ? gamePointA : gamePointB;

  if (isBreakPoint || scoringTeamOnGamePoint || gamePointA || gamePointB) {
    return 3;
  }

  if (isAdvantage) {
    return 2.5;
  }

  if (isDeuce) {
    return 2;
  }

  if (isThirtyAll) {
    return 1.5;
  }

  return 1;
}

function computeMomentumTimeline(pointHistory, scoringOptions) {
  const options = normalizeScoringOptions(scoringOptions);
  const standardMode = options.scoringMode === "standard";
  const timeline = [];
  const breakdown = [];
  const gameMarkers = [];
  let score = defaultScore(options);
  let momentum = 0;
  let streakTeam = null;
  let streakLength = 0;
  let setCarry = 0;
  let pointIndex = 0;
  const recentWinners = [];

  for (const pointWinner of pointHistory) {
    if (pointWinner !== "A" && pointWinner !== "B") {
      continue;
    }

    pointIndex++;

    const oldGamesA = score.A.games;
    const oldGamesB = score.B.games;
    const oldSetsA = score.A.sets;
    const oldSetsB = score.B.sets;
    const beforeScore = JSON.parse(JSON.stringify(score));

    score = applyEvent(
      score,
      {
        eventType: pointWinner === "A" ? "POINT_TEAM_A" : "POINT_TEAM_B",
      },
      options,
    );

    // Decay first so this point is applied as fresh "current control" on top of prior state.
    momentum *= MOMENTUM_CONFIG.decayPerPoint;

    recentWinners.push(pointWinner);
    if (recentWinners.length > MOMENTUM_CONFIG.recentWindowSize) {
      recentWinners.shift();
    }

    if (pointWinner === streakTeam) {
      streakLength++;
    } else {
      streakTeam = pointWinner;
      streakLength = 1;
    }

    const pointSign = pointWinner === "A" ? 1 : -1;
    const recentComponent = buildRecentComponent(recentWinners);
    const streakComponent = buildStreakComponent(streakLength) * pointSign;
    const pressureMultiplier = classifyPressureBonus(beforeScore, pointWinner, options);
    // pressureMultiplier is in [1..3], and pressureScale controls the final pressure contribution size.
    const pressureComponent = pressureMultiplier * MOMENTUM_CONFIG.pressureScale * pointSign;
    const setCarryComponent = setCarry;

    const gameCompleted =
      score.A.games !== oldGamesA ||
      score.B.games !== oldGamesB ||
      score.A.sets !== oldSetsA ||
      score.B.sets !== oldSetsB;
    const gameWinner = gameCompleted ? score.lastGameTeam || pointWinner : null;
    const gameResultComponent = gameWinner
      ? (gameWinner === "A" ? 1 : -1) * MOMENTUM_CONFIG.gameWinBonus
      : 0;

    // Only games-and-sets play has game boundaries worth marking on the
    // graph; straight/tiebreak modes are one continuous run of points.
    if (gameCompleted && standardMode) {
      gameMarkers.push(pointIndex);
    }

    const setCompleted = score.A.sets !== oldSetsA || score.B.sets !== oldSetsB;
    const setWinner = setCompleted ? score.lastSetTeam || pointWinner : null;
    const setResultComponent = setWinner
      ? (setWinner === "A" ? 1 : -1) * MOMENTUM_CONFIG.setWinBonus
      : 0;
    if (setResultComponent !== 0) {
      setCarry += setResultComponent;
    }

    momentum += recentComponent;
    momentum += streakComponent;
    momentum += pressureComponent;
    momentum += gameResultComponent;
    momentum += setResultComponent;
    momentum += setCarryComponent;
    momentum = clamp(momentum, MOMENTUM_CONFIG.clampMin, MOMENTUM_CONFIG.clampMax);

    timeline.push(momentum);
    breakdown.push({
      recentPoints: recentComponent,
      currentStreak: streakComponent,
      pressurePerformance: pressureComponent,
      gameResultBonus: gameResultComponent,
      setResultBonus: setResultComponent,
      setCarryBonus: setCarryComponent,
      total: momentum,
    });

    if (!setCompleted) {
      setCarry *= MOMENTUM_CONFIG.setCarryDecayPerPoint;
    }
    // setCarry intentionally starts decaying from the next point after a set win for an immediate post-set carryover.
  }

  return {
    timeline,
    breakdown,
    gameMarkers,
    config: MOMENTUM_CONFIG,
  };
}

module.exports = { MOMENTUM_CONFIG, computeMomentumTimeline, classifyPressureBonus };
