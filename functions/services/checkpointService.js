const { db, FieldValue } = require("../infrastructure/firebase");
const {
  normalizeScoringOptions,
  compareEventOrder,
  defaultScore,
  toLiveScorePayload,
} = require("../domain/scoring/engine");
const { SCORE_CHECKPOINTS_COLLECTION } = require("./constants");

async function getLatestCheckpoint(tx, courtId, options) {
  // Order by a single field only: a multi-field orderBy requires a composite
  // Firestore index, which this repo never defines/deploys. If that index is
  // missing, this query throws FAILED_PRECONDITION inside every scoring
  // transaction and the score document is never updated. Tie-break the small
  // candidate window in memory instead.
  const checkpointsQuery = db
    .collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`)
    .orderBy("lastCreatedAt", "desc")
    .limit(10);

  const checkpointsSnap = await tx.get(checkpointsQuery);
  const targetOptions = normalizeScoringOptions(options);

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
    const checkpointOptions = normalizeScoringOptions(data.scoringOptions || {});
    const sameOptions =
      checkpointOptions.scoringMode === targetOptions.scoringMode &&
      checkpointOptions.deuceMode === targetOptions.deuceMode &&
      checkpointOptions.tiebreakMode === targetOptions.tiebreakMode;

    if (!sameOptions) continue;
    if (!data.score || !data.lastEventId || !data.lastCreatedAt) continue;

    return {
      ref: candidate.ref,
      data,
    };
  }

  return null;
}

function buildCheckpointPayload(score, options, lastEventId, lastCreatedAt) {
  return {
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
