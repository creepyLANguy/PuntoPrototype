const { db, FieldValue } = require("../infrastructure/firebase");
const {
  normalizeScoringOptions,
  compareEventOrder,
  defaultScore,
  toLiveScorePayload,
} = require("../domain/scoring/engine");
const { normalizeScoreVersion } = require("../domain/events/validation");
const { paths } = require("./firestorePaths");

function scoringOptionsKey(options) {
  const normalized = normalizeScoringOptions(options);
  return JSON.stringify([
    normalized.scoringMode,
    normalized.deuceMode,
    normalized.tiebreakMode,
    normalized.pointsTarget ?? null,
    normalized.serving ?? null,
    normalized.completion ?? null,
  ]);
}

async function getLatestCheckpoint(tx, matchId, options, scoreVersion = 0) {
  // Order by a single field only: a multi-field orderBy requires a composite
  // Firestore index, which this repo never defines/deploys. If that index is
  // missing, this query throws FAILED_PRECONDITION inside every scoring
  // transaction and the score document is never updated. Tie-break the small
  // candidate window in memory instead.
  const checkpointsQuery = db
    .collection(paths.matchCheckpoints(matchId))
    .orderBy("lastCreatedAt", "desc")
    .limit(10);

  const checkpointsSnap = await tx.get(checkpointsQuery);
  const targetOptionsKey = scoringOptionsKey(options);
  const targetScoreVersion = normalizeScoreVersion(scoreVersion);

  const candidates = checkpointsSnap.docs
    .map((docSnap) => ({ ref: docSnap.ref, data: docSnap.data() || {} }))
    .sort((left, right) => {
      const createdAtDiff = compareEventOrder(
        right.data.lastCreatedAt,
        right.data.lastEventId,
        left.data.lastCreatedAt,
        left.data.lastEventId,
      );
      return createdAtDiff === null ? 0 : createdAtDiff;
    });

  for (const candidate of candidates) {
    const data = candidate.data;
    if (scoringOptionsKey(data.scoringOptions || {}) !== targetOptionsKey) continue;
    if (normalizeScoreVersion(data.scoreVersion) !== targetScoreVersion) continue;
    if (!data.score || !data.lastEventId || !data.lastCreatedAt) continue;

    return {
      ref: candidate.ref,
      data,
    };
  }

  return null;
}

function buildCheckpointPayload(score, options, lastEventId, lastCreatedAt, scoreVersion = 0) {
  return {
    scoreVersion: normalizeScoreVersion(scoreVersion),
    score: toLiveScorePayload(score),
    scoringOptions: normalizeScoringOptions(options),
    totalPoints: (Number(score?.A?.totalPoints) || 0) + (Number(score?.B?.totalPoints) || 0),
    setsCompleted: (Number(score?.A?.sets) || 0) + (Number(score?.B?.sets) || 0),
    lastEventId,
    lastCreatedAt,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

module.exports = { getLatestCheckpoint, buildCheckpointPayload };
