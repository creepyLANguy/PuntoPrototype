const { db, FieldPath, FieldValue } = require("../infrastructure/firebase");
const { buildScoringOptions } = require("../domain/scoring/modes");
const { replayEvents, toLiveScorePayload } = require("../domain/scoring/engine");
const { getLatestCheckpoint, buildCheckpointPayload } = require("../services/checkpointService");
const { SCORE_CHECKPOINTS_COLLECTION, REGION } = require("../services/constants");
const { normalizeScoreVersion } = require("../domain/events/validation");
const { SCORING_EVENTS } = require("../domain/events/validation");

async function updateScoringOptions(request) {

  const { courtId, scoringOptions: incomingScoringOptions, scoringMode } = request.data;
  if (!courtId) throw new Error("Missing courtId");

  const courtRef = db.doc(`courts/${courtId}`);
  const scoreRef = db.doc(`courts/${courtId}/score/current`);
  const eventsRef = db
    .collection(`courts/${courtId}/events`)
    .orderBy("createdAt", "asc")
    .orderBy(FieldPath.documentId(), "asc");

  const courtSnap = await courtRef.get();
  if (!courtSnap.exists) {
    throw new Error("Court not found");
  }

  const courtData = courtSnap.data() || {};
  const normalizedOptions = buildScoringOptions({
    ...(courtData.scoringOptions || {}),
    ...(incomingScoringOptions || {}),
    scoringMode: scoringMode || courtData.scoringMode || courtData.scoringOptions?.scoringMode,
  });
  await courtRef.set(
    { scoringOptions: normalizedOptions, scoringMode: normalizedOptions.scoringMode },
    { merge: true },
  );

  const activeScoreVersion = normalizeScoreVersion(courtData.scoreVersion);
  const eventsSnap = await eventsRef.get();
  const events = eventsSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter(
      (event) =>
        !SCORING_EVENTS.has(event.eventType) ||
        normalizeScoreVersion(event.scoreVersion) === activeScoreVersion,
    );
  const replayedScore = replayEvents(events, normalizedOptions);

  const lastEventId = events.length > 0 ? events[events.length - 1].id : null;
  const lastEventCreatedAt = events.length > 0 ? events[events.length - 1].createdAt || null : null;
  await scoreRef.set({
    ...toLiveScorePayload(replayedScore),
    lastEventId,
    lastProcessedEventId: lastEventId,
    lastProcessedCreatedAt: lastEventCreatedAt,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const checkpointsRef = db.collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`);
  const checkpointsSnap = await checkpointsRef.get();
  const checkpointDeleteBatch = db.batch();
  checkpointsSnap.forEach((docSnap) => checkpointDeleteBatch.delete(docSnap.ref));
  await checkpointDeleteBatch.commit();

  if (lastEventId && lastEventCreatedAt) {
    await checkpointsRef
      .doc()
      .set(
        buildCheckpointPayload(replayedScore, normalizedOptions, lastEventId, lastEventCreatedAt),
      );
  }

  return {
    success: true,
    scoringOptions: normalizedOptions,
    scoringMode: normalizedOptions.scoringMode,
    mode: normalizedOptions.scoringMode,
    score: replayedScore,
  };

}

module.exports = { updateScoringOptions, REGION };
