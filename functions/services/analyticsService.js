const { db, FieldPath } = require("../infrastructure/firebase");

const { defaultScore, applyEvent, normalizeScoringOptions } = require("../domain/scoring/engine");

const { buildScoringOptions } = require("../domain/scoring/modes");

const { computeAdvancedStats } = require("../domain/stats/calculator");

const { computeMomentumTimeline } = require("../domain/momentum/calculator");

const { SCORING_EVENTS, normalizeScoreVersion } = require("../domain/events/validation");

const { paths } = require("./firestorePaths");

const DEFAULT_TEAM_NAMES = { A: "Team A", B: "Team B" };

const DEFAULT_PLAYER_NAMES = { A1: "", A2: "", B1: "", B2: "" };

async function replayMatchAnalytics(matchId) {
  const matchSnap = matchId ? await db.doc(paths.match(matchId)).get() : { exists: false };
  const matchExists = matchSnap.exists;
  const matchData = matchExists ? matchSnap.data() : {};
  const scoringOptions = buildScoringOptions({
    ...(matchData.scoringOptions || {}),
    scoringMode: matchData.scoringMode || matchData.scoringOptions?.scoringMode,
  });
  const normalizedOptions = normalizeScoringOptions(scoringOptions);

  const playerNames = {
    A1: typeof matchData?.playerNames?.A1 === "string" ? matchData.playerNames.A1 : "",
    A2: typeof matchData?.playerNames?.A2 === "string" ? matchData.playerNames.A2 : "",
    B1: typeof matchData?.playerNames?.B1 === "string" ? matchData.playerNames.B1 : "",
    B2: typeof matchData?.playerNames?.B2 === "string" ? matchData.playerNames.B2 : "",
  };

  if (!matchExists) {
    return {
      matchExists,
      score: defaultScore(normalizedOptions),
      normalizedOptions,
      playerNames,
      pointHistory: [],
      setPointMarkers: [],
    };
  }

  const eventsSnap = await db
    .collection(paths.matchEvents(matchId))
    .orderBy("createdAt", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .get();

  // Use only scoring events so details replay mirrors score/current logic,
  // including the stale-scoreVersion guard applied by onEventCreate.
  const activeScoreVersion = normalizeScoreVersion(matchData.scoreVersion);
  const events = eventsSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter(
      (event) =>
        SCORING_EVENTS.has(event.eventType) &&
        normalizeScoreVersion(event.scoreVersion) === activeScoreVersion,
    );

  let score = defaultScore(normalizedOptions);

  // Derived analytics streams (for momentum/stats UI)
  let pointHistory = []; // ["A", "B", ...]
  let setPointMarkers = []; // 1-based point index where a set is completed

  for (const event of events) {
    const oldSetsA = score.A.sets;
    const oldSetsB = score.B.sets;
    const oldTotalPoints = (Number(score.A.totalPoints) || 0) + (Number(score.B.totalPoints) || 0);

    score = applyEvent(score, event, normalizedOptions);

    const newTotalPoints = (Number(score.A.totalPoints) || 0) + (Number(score.B.totalPoints) || 0);
    const pointApplied = newTotalPoints > oldTotalPoints;

    if (event.eventType === "RESET") {
      pointHistory = [];
      setPointMarkers = [];
      continue;
    }

    if (event.eventType === "UNDO") {
      // Only pop pointHistory if the undo actually reversed a point.
      // If history was empty, the engine returns the score unchanged
      // (totalPoints stays the same), so we must not pop a real entry.
      const pointActuallyUndone = newTotalPoints < oldTotalPoints;
      if (pointActuallyUndone && pointHistory.length > 0) {
        pointHistory.pop();
      }
      while (
        setPointMarkers.length > 0 &&
        setPointMarkers[setPointMarkers.length - 1] > pointHistory.length
      ) {
        setPointMarkers.pop();
      }
      continue;
    }

    if (pointApplied && event.eventType === "POINT_TEAM_A") {
      pointHistory.push("A");
    } else if (pointApplied && event.eventType === "POINT_TEAM_B") {
      pointHistory.push("B");
    }

    const setCompleted = score.A.sets > oldSetsA || score.B.sets > oldSetsB;
    if (pointApplied && setCompleted) {
      setPointMarkers.push(pointHistory.length);
    }
  }

  return {
    matchExists,
    score,
    normalizedOptions,
    playerNames,
    pointHistory,
    setPointMarkers,
  };
}

async function buildDetailedScoreData(matchId) {
  const { matchExists, score, normalizedOptions, playerNames, pointHistory } =
    await replayMatchAnalytics(matchId);

  // Canonical source for per-set rows: completedSets from scorer state.
  // This guarantees details table aligns with score/current.
  const setScores = Array.isArray(score.completedSets)
    ? score.completedSets.map((set) => ({
        A: Number(set?.A) || 0,
        B: Number(set?.B) || 0,
        tiebreakPoints: set?.tiebreakPoints || null,
      }))
    : [];

  const currentSetGames = {
    A: Number(score.A.games) || 0,
    B: Number(score.B.games) || 0,
  };

  return {
    matchExists,
    payload: {
      sets: setScores,
      currentGames: currentSetGames,
      points: {
        A: Number(score.A.points) || 0,
        B: Number(score.B.points) || 0,
      },
      setsA: Number(score.A.sets) || 0,
      setsB: Number(score.B.sets) || 0,
      scoringMode: normalizedOptions.scoringMode,
      matchComplete: Boolean(score.matchComplete),
      playerNames,
      advancedStats: computeAdvancedStats(pointHistory, normalizedOptions),
    },
  };
}

async function buildMomentumData(matchId) {
  const { matchExists, score, normalizedOptions, pointHistory, setPointMarkers } =
    await replayMatchAnalytics(matchId);

  const momentumData = computeMomentumTimeline(pointHistory, normalizedOptions);

  return {
    matchExists,
    payload: {
      pointHistory,
      momentumTimeline: momentumData.timeline,
      setPointMarkers,
      gameMarkers: momentumData.gameMarkers,
      totalPoints: pointHistory.length,
      scoringMode: normalizedOptions.scoringMode,
      matchComplete: Boolean(score.matchComplete),
    },
  };
}

module.exports = { replayMatchAnalytics, buildDetailedScoreData, buildMomentumData };
