const { db, FieldValue } = require("../infrastructure/firebase");
const { buildScoringOptions } = require("../domain/scoring/modes");
const { toLiveScorePayload, defaultScore } = require("../domain/scoring/engine");
const { normalizeScoreVersion } = require("../domain/events/validation");
const { SCORE_CHECKPOINTS_COLLECTION, DEFAULT_TEAM_NAMES, DEFAULT_PLAYER_NAMES, REGION } = require("../services/constants");

async function resetCourt(request) {

  const {
    courtId,
    deepReset,
    newPassword,
    requirePassword,
    scoringMode,
    scoringOptions: incomingScoringOptions,
  } = request.data;
  if (!courtId) throw new Error("Missing courtId");

  const courtRef = db.doc(`courts/${courtId}`);
  const courtDoc = await courtRef.get();
  const courtData = courtDoc.exists ? courtDoc.data() : {};
  const trimmedPassword = typeof newPassword === "string" ? newPassword.trim() : "";

  // A password is optional on reset: blank means "keep the existing court
  // password". When one is supplied it still has to satisfy the usual rules,
  // and callers can set requirePassword to make it mandatory.
  if (requirePassword && !trimmedPassword) {
    throw new Error("Password must be at least 4 characters.");
  }

  if (trimmedPassword) {
    if (trimmedPassword.length < 4) {
      throw new Error("Password must be at least 4 characters.");
    }

    if (trimmedPassword === courtId) {
      throw new Error("Password must be different from court name.");
    }
  }

  const scoringOptions = buildScoringOptions({
    ...(courtData.scoringOptions || {}),
    ...(incomingScoringOptions || {}),
    scoringMode: scoringMode || courtData.scoringMode || courtData.scoringOptions?.scoringMode,
  });
  const nextScoreVersion = normalizeScoreVersion(courtData.scoreVersion) + 1;

  const eventsRef = db.collection(`courts/${courtId}/events`);
  const eventsSnap = await eventsRef.get();
  const checkpointsRef = db.collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`);
  const checkpointsSnap = await checkpointsRef.get();
  const archiveId = new Date().toISOString();

  const archiveBatch = db.batch();
  eventsSnap.forEach((doc) => {
    const archiveRef = db.doc(`courts/${courtId}/archive/${archiveId}/events/${doc.id}`);
    archiveBatch.set(archiveRef, {
      ...doc.data(),
      archivedAt: FieldValue.serverTimestamp(),
      resetBy: request.auth?.uid || "system",
    });
  });
  await archiveBatch.commit();

  // Delete events
  const deleteBatch = db.batch();
  eventsSnap.forEach((doc) => deleteBatch.delete(doc.ref));
  checkpointsSnap.forEach((doc) => deleteBatch.delete(doc.ref));
  await deleteBatch.commit();

  // Reset score. Include explicit null sentinels for the ordering fields so
  // that any in-flight Cloud Function invocation for a pre-reset event — whose
  // event document has already been deleted — cannot corrupt the fresh score
  // (the tx.get(eventRef) existence check in onEventCreate will bail early,
  // but writing nulls here also clears any stale baseline timestamp that would
  // make a late CF fall through the orderComparison guard).
  await db.doc(`courts/${courtId}/score/current`).set({
    ...toLiveScorePayload(defaultScore(scoringOptions)),
    lastProcessedEventId: null,
    lastProcessedCreatedAt: null,
  });

  const courtUpdates = {
    scoreVersion: nextScoreVersion,
    scoringOptions,
    scoringMode: scoringOptions.scoringMode,
  };

  // Skip the write when the password is unchanged so connected clients do not
  // see a password-change event (which would switch them to spectate mode).
  if (trimmedPassword && trimmedPassword !== courtData.password) {
    courtUpdates.password = trimmedPassword;
  }

  if (deepReset) {
    courtUpdates.teamNames = { ...DEFAULT_TEAM_NAMES };
    courtUpdates.playerNames = { ...DEFAULT_PLAYER_NAMES };
  }

  if (Object.keys(courtUpdates).length > 0) {
    await courtRef.set(courtUpdates, { merge: true });
  }

  return {
    success: true,
    archivedId: archiveId,
    scoreVersion: nextScoreVersion,
    scoringMode: scoringOptions.scoringMode,
    scoringOptions,
  };

}

module.exports = { resetCourt, REGION };
