// Score presentation rules: point labels, the serving player and critical-point
// (game / set / match point) status. Mirrors the display rules of the backend
// scoring engine; it never changes the score.
import { POINTS } from "../config/constants.js";
import { resolveScoreDisplayOptions } from "./options.js";
import { session } from "../state/sessionState.js";

function usesNumericPoints() {
  const options = resolveScoreDisplayOptions(session.score);
  return (
    options.scoringMode === "straight" ||
    options.scoringMode === "tiebreakTen" ||
    options.scoringMode === "fixedTotalPoints" ||
    session.score.inTiebreak
  );
}

export function pointLabel(p) {
  if (usesNumericPoints()) return p;
  return p === 4 ? "Ad" : (POINTS[p] ?? p);
}

function getCompletedMatchGames(currentScore) {
  const completedSets = Array.isArray(currentScore.completedSets)
    ? currentScore.completedSets
    : [];
  const completedGames = completedSets.reduce((sum, set) => {
    const setA = Number(set.A) || 0;
    const setB = Number(set.B) || 0;
    return sum + setA + setB;
  }, 0);

  return (
    completedGames +
    (Number(currentScore.A.games) || 0) +
    (Number(currentScore.B.games) || 0)
  );
}

function getGameServerLabel(totalCompletedGames) {
  const servingTeam = totalCompletedGames % 2 === 0 ? "A" : "B";
  const serviceRotationIndex = Math.floor(totalCompletedGames / 2);
  const playerNumber = serviceRotationIndex % 2 === 0 ? "1" : "2";
  return `${servingTeam}${playerNumber}`;
}

function getTiebreakServerLabel(currentScore) {
  const totalCompletedGames = getCompletedMatchGames(currentScore);
  const startingServer = getGameServerLabel(totalCompletedGames);
  const totalPoints =
    (Number(currentScore.A.points) || 0) + (Number(currentScore.B.points) || 0);

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

// Fixed-total-points serving: the server of rally point i is
// order[floor(i / serveBlockLength) % order.length] (spec section 8.4).
function getFixedTotalServerLabel(currentScore, options) {
  if (currentScore.matchComplete) return null;
  const serving = options.serving || {};
  if (serving.enabled === false) return null;
  const order =
    Array.isArray(serving.order) && serving.order.length
      ? serving.order
      : ["A1", "B1", "A2", "B2"];
  const blockLength = Math.max(1, Number(serving.serveBlockLength) || 1);
  const rallyPoints =
    (Number(currentScore.A.points) || 0) + (Number(currentScore.B.points) || 0);
  return order[Math.floor(rallyPoints / blockLength) % order.length];
}

export function getCurrentServerLabel(currentScore) {
  if (!currentScore) {
    return null;
  }

  const options = resolveScoreDisplayOptions(currentScore);

  // matchComplete only ends a match in tiebreakTen mode; every other mode
  // plays an open number of sets/points, so a stale flag must not hide the
  // server indicator there.
  if (options.scoringMode === "tiebreakTen" && currentScore.matchComplete) {
    return null;
  }

  if (options.scoringMode === "straight") {
    return null;
  }

  if (options.scoringMode === "fixedTotalPoints") {
    return getFixedTotalServerLabel(currentScore, options);
  }

  const totalCompletedGames = getCompletedMatchGames(currentScore);
  const isStandardTiebreak =
    options.scoringMode === "standard" &&
    (currentScore.inTiebreak ||
      (currentScore.A.games === 6 && currentScore.B.games === 6));
  const isMatchTiebreak = options.scoringMode === "tiebreakTen";

  if (isStandardTiebreak || isMatchTiebreak) {
    return getTiebreakServerLabel(currentScore);
  }

  return getGameServerLabel(totalCompletedGames);
}

// Celebrate the result only after all points, including a golden point, are played.
export function getFixedTotalDisplayResult(currentScore) {
  if (!currentScore) return null;
  const options = resolveScoreDisplayOptions(currentScore);
  if (options.scoringMode !== "fixedTotalPoints" || !currentScore.matchComplete) {
    return null;
  }

  const majority = Math.floor(options.pointsTarget / 2) + 1;
  if (currentScore.A.points >= majority) return "A";
  if (currentScore.B.points >= majority) return "B";
  return currentScore.matchComplete &&
    currentScore.A.points === currentScore.B.points &&
    options.completion.tieResolution === "allow_draw"
    ? "draw"
    : null;
}

export function getCriticalPointStatus(currentScore) {
  const status = {
    A: null, // "Game", "Set", "Match", or null
    B: null,
  };

  if (!currentScore) {
    return status;
  }

  // Use the score document's own scoring options (not the court settings)
  // so critical points match what the backend scoring engine calculated.
  const options = resolveScoreDisplayOptions(currentScore);

  // matchComplete only ends a match in tiebreakTen mode; a stale flag in
  // any other mode must not suppress critical-point indicators.
  if (options.scoringMode === "tiebreakTen" && currentScore.matchComplete) {
    return status;
  }

  if (options.scoringMode === "fixedTotalPoints") {
    if (
      currentScore.matchComplete ||
      currentScore.A.points > options.pointsTarget / 2 ||
      currentScore.B.points > options.pointsTarget / 2
    ) {
      return status;
    }
    const majorityPoint = Math.floor(options.pointsTarget / 2);
    const goldenPoint =
      options.completion.tieResolution === "golden_point" &&
      currentScore.A.points === currentScore.B.points &&
      currentScore.A.points + currentScore.B.points >= options.pointsTarget;
    for (const team of ["A", "B"]) {
      if (goldenPoint || currentScore[team].points === majorityPoint) {
        status[team] = "Match";
      }
    }
    return status;
  }

  if (options.scoringMode === "straight") {
    return status;
  }

  const teams = ["A", "B"];

  for (const team of teams) {
    const opponent = team === "A" ? "B" : "A";

    if (options.scoringMode === "tiebreakTen") {
      const target = 10;
      const pts = currentScore[team].points;
      const oppPts = currentScore[opponent].points;
      if (pts >= target - 1 && pts - oppPts >= 1) {
        status[team] = "Match";
      }
      continue;
    }

    // Standard scoring mode
    if (
      currentScore.inTiebreak ||
      (currentScore.A.games === 6 && currentScore.B.games === 6)
    ) {
      const target = options.tiebreakMode === "sixAllTen" ? 10 : 7;
      const pts = currentScore[team].points;
      const oppPts = currentScore[opponent].points;

      if (pts >= target - 1 && pts - oppPts >= 1) {
        if (currentScore[team].sets === 1) {
          status[team] = "Match";
        } else {
          status[team] = "Set";
        }
      }
    } else {
      const pts = currentScore[team].points;
      const oppPts = currentScore[opponent].points;
      const gms = currentScore[team].games;
      const oppGms = currentScore[opponent].games;

      let winsGame = false;
      if (pts === 3 && oppPts < 3) {
        winsGame = true;
      } else if (pts === 3 && oppPts === 3) {
        if (
          options.deuceMode === "golden" ||
          (options.deuceMode === "silver" && currentScore.deuceCycles > 0) ||
          (options.deuceMode === "star" && currentScore.deuceCycles >= 2)
        ) {
          winsGame = true;
        }
      } else if (pts === 4) {
        winsGame = true;
      }

      if (winsGame) {
        let winsSet = false;
        if (gms === 5 && oppGms <= 4) {
          winsSet = true;
        } else if (gms === 6 && oppGms === 5) {
          winsSet = true;
        }

        if (winsSet) {
          if (currentScore[team].sets === 1) {
            status[team] = "Match";
          } else {
            status[team] = "Set";
          }
        } else {
          status[team] = "Game";
        }
      }
    }
  }

  return status;
}
