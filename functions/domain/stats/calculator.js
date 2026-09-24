const { defaultScore, applyEvent, getCurrentServerLabel, normalizeScoringOptions } = require("../scoring/engine");
const { isTeamOnGamePoint } = require("../scoring/helpers");





function createTeamStatsBucket() {
  return {
    pointsWon: 0,
    pointWinPct: 0,
    longestScoringStreak: 0,
    breakPointsFaced: 0,
    breakPointsWon: 0,
    breakPointWinPct: 0,
    breakPointConversionOpportunities: 0,
    breakPointConversions: 0,
    breakPointConversionPct: 0,
    gamesWonAfterDeuce: 0,
    gamesLostAfterDeuce: 0,
    goldenPointsWon: 0,
    goldenPointWinPct: 0,
    silverPointsWon: 0,
    silverPointWinPct: 0,
    starPointsWon: 0,
    starPointWinPct: 0,
    gamePointGames: 0,
    gamePointConversions: 0,
    closingEfficiencyPct: 0,
  };
}

function createServePlayerStatsBucket() {
  return {
    pointsServed: 0,
    pointsWonOnServe: 0,
    serveWinPct: 0,
  };
}

function computeAdvancedStats(pointHistory, scoringOptions) {
  const options = normalizeScoringOptions(scoringOptions);
  const teamStats = {
    A: createTeamStatsBucket(),
    B: createTeamStatsBucket(),
  };
  const matchStats = {
    totalPoints: pointHistory.length,
    deuceGames: 0,
    goldenPointsPlayed: 0,
    silverPointsPlayed: 0,
    starPointsPlayed: 0,
  };
  const servePlayerStats = {
    A1: createServePlayerStatsBucket(),
    A2: createServePlayerStatsBucket(),
    B1: createServePlayerStatsBucket(),
    B2: createServePlayerStatsBucket(),
  };

  const standardMode = options.scoringMode === "standard";
  let score = defaultScore(options);

  let streakTeam = null;
  let streakLength = 0;
  let currentServerTeam = "A";
  let gameContext = {
    reachedDeuce: false,
    hadGamePoint: { A: false, B: false },
  };

  for (const pointWinner of pointHistory) {
    if (pointWinner !== "A" && pointWinner !== "B") continue;

    const serverLabel = getCurrentServerLabel(score);
    if (serverLabel && servePlayerStats[serverLabel]) {
      servePlayerStats[serverLabel].pointsServed++;
      if (pointWinner === serverLabel[0]) {
        servePlayerStats[serverLabel].pointsWonOnServe++;
      }
    }

    const oldGamesA = score.A.games;
    const oldGamesB = score.B.games;
    const oldSetsA = score.A.sets;
    const oldSetsB = score.B.sets;
    const oldIsTiebreak =
      score.inTiebreak ||
      (standardMode &&
        options.tiebreakMode !== "off" &&
        score.A.games === 6 &&
        score.B.games === 6);

    let isBreakPoint = false;
    let breakPointServer = null;
    let breakPointReturner = null;
    let isGoldenPoint = false;
    let isSilverPoint = false;
    let isStarPoint = false;

    if (standardMode && !oldIsTiebreak) {
      const pointsA = Number(score.A.points) || 0;
      const pointsB = Number(score.B.points) || 0;

      if (pointsA >= 3 && pointsB >= 3) {
        gameContext.reachedDeuce = true;
      }

      if (options.deuceMode === "golden" && pointsA === 3 && pointsB === 3) {
        isGoldenPoint = true;
        matchStats.goldenPointsPlayed++;
      }

      if (
        options.deuceMode === "silver" &&
        pointsA === 3 &&
        pointsB === 3 &&
        (Number(score.deuceCycles) || 0) > 0
      ) {
        isSilverPoint = true;
        matchStats.silverPointsPlayed++;
      }

      if (
        options.deuceMode === "star" &&
        pointsA === 3 &&
        pointsB === 3 &&
        (Number(score.deuceCycles) || 0) >= 2
      ) {
        isStarPoint = true;
        matchStats.starPointsPlayed++;
      }

      const gamePointA = isTeamOnGamePoint(score, "A", options, false);
      const gamePointB = isTeamOnGamePoint(score, "B", options, false);
      if (gamePointA) gameContext.hadGamePoint.A = true;
      if (gamePointB) gameContext.hadGamePoint.B = true;

      breakPointServer = currentServerTeam;
      breakPointReturner = breakPointServer === "A" ? "B" : "A";
      isBreakPoint = isTeamOnGamePoint(score, breakPointReturner, options, false);

      if (isBreakPoint) {
        teamStats[breakPointServer].breakPointsFaced++;
        teamStats[breakPointReturner].breakPointConversionOpportunities++;
      }
    }

    score = applyEvent(
      score,
      {
        eventType: pointWinner === "A" ? "POINT_TEAM_A" : "POINT_TEAM_B",
      },
      options,
    );

    teamStats[pointWinner].pointsWon++;

    if (isGoldenPoint) {
      teamStats[pointWinner].goldenPointsWon++;
    }

    if (isSilverPoint) {
      teamStats[pointWinner].silverPointsWon++;
    }

    if (isStarPoint) {
      teamStats[pointWinner].starPointsWon++;
    }

    if (isBreakPoint) {
      if (pointWinner === breakPointServer) {
        teamStats[breakPointServer].breakPointsWon++;
      } else {
        teamStats[breakPointReturner].breakPointConversions++;
      }
    }

    if (pointWinner === streakTeam) {
      streakLength++;
    } else {
      streakTeam = pointWinner;
      streakLength = 1;
    }

    teamStats[pointWinner].longestScoringStreak = Math.max(
      teamStats[pointWinner].longestScoringStreak,
      streakLength,
    );

    const gameCompleted =
      standardMode &&
      (score.A.games !== oldGamesA ||
        score.B.games !== oldGamesB ||
        score.A.sets !== oldSetsA ||
        score.B.sets !== oldSetsB);

    if (gameCompleted) {
      const gameWinner = score.lastGameTeam || pointWinner;
      const gameLoser = gameWinner === "A" ? "B" : "A";

      if (gameContext.hadGamePoint.A) {
        teamStats.A.gamePointGames++;
        if (gameWinner === "A") teamStats.A.gamePointConversions++;
      }

      if (gameContext.hadGamePoint.B) {
        teamStats.B.gamePointGames++;
        if (gameWinner === "B") teamStats.B.gamePointConversions++;
      }

      if (gameContext.reachedDeuce) {
        matchStats.deuceGames++;
        teamStats[gameWinner].gamesWonAfterDeuce++;
        teamStats[gameLoser].gamesLostAfterDeuce++;
      }

      const setCompleted = score.A.sets !== oldSetsA || score.B.sets !== oldSetsB;
      if (setCompleted) {
        const completedSet =
          Array.isArray(score.completedSets) && score.completedSets.length > 0
            ? score.completedSets[score.completedSets.length - 1]
            : null;
        const finalSetScore = completedSet
          ? { A: Number(completedSet.A) || 0, B: Number(completedSet.B) || 0 }
          : {
              A: gameWinner === "A" ? oldGamesA + 1 : oldGamesA,
              B: gameWinner === "B" ? oldGamesB + 1 : oldGamesB,
            };
      }

      gameContext = {
        reachedDeuce: false,
        hadGamePoint: { A: false, B: false },
      };

      currentServerTeam = currentServerTeam === "A" ? "B" : "A";
    }
  }

  const totalPoints = Math.max(0, pointHistory.length);
  ["A", "B"].forEach((team) => {
    const bucket = teamStats[team];
    bucket.pointWinPct = totalPoints > 0 ? (bucket.pointsWon / totalPoints) * 100 : 0;
    bucket.breakPointWinPct =
      bucket.breakPointsFaced > 0 ? (bucket.breakPointsWon / bucket.breakPointsFaced) * 100 : 0;
    bucket.breakPointConversionPct =
      bucket.breakPointConversionOpportunities > 0
        ? (bucket.breakPointConversions / bucket.breakPointConversionOpportunities) * 100
        : 0;
    bucket.goldenPointWinPct =
      matchStats.goldenPointsPlayed > 0
        ? (bucket.goldenPointsWon / matchStats.goldenPointsPlayed) * 100
        : 0;
    bucket.silverPointWinPct =
      matchStats.silverPointsPlayed > 0
        ? (bucket.silverPointsWon / matchStats.silverPointsPlayed) * 100
        : 0;
    bucket.starPointWinPct =
      matchStats.starPointsPlayed > 0
        ? (bucket.starPointsWon / matchStats.starPointsPlayed) * 100
        : 0;
    bucket.closingEfficiencyPct =
      bucket.gamePointGames > 0 ? (bucket.gamePointConversions / bucket.gamePointGames) * 100 : 0;
  });

  ["A1", "A2", "B1", "B2"].forEach((slot) => {
    const bucket = servePlayerStats[slot];
    bucket.serveWinPct =
      bucket.pointsServed > 0 ? (bucket.pointsWonOnServe / bucket.pointsServed) * 100 : 0;
  });

  return {
    teamStats,
    servePlayerStats,
    matchStats,
    scoringMode: options.scoringMode,
    deuceMode: options.deuceMode,
  };
}

module.exports = { computeAdvancedStats, isTeamOnGamePoint };