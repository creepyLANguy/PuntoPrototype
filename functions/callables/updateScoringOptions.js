// Changes the scoring options of a casual match (addressed by matchId, or by
// courtId for the match currently on that court) and replays its events under
// the new rules. Tournament match rules are snapshotted and locked.
const { db, FieldPath, FieldValue } = require("../infrastructure/firebase");
const { buildScoringOptions } = require("../domain/scoring/modes");
const { replayEvents, toLiveScorePayload } = require("../domain/scoring/engine");
const { buildCheckpointPayload } = require("../services/checkpointService");
const { REGION } = require("../services/constants");
const { normalizeScoreVersion, SCORING_EVENTS } = require("../domain/events/validation");
const { buildScoreSummary } = require("../domain/matches/lifecycle");
const { paths } = require("../services/firestorePaths");
const matchService = require("../services/matchService");
const { readCredentials, authorizeMatchControl, requireAdmin } = require("../services/authService");
const { invalid, notFound, precondition } = require("../services/errors");

async function updateScoringOptions(request) {
  const {
    courtId,
    matchId: requestedMatchId,
    scoringOptions: incomingScoringOptions,
    scoringMode,
  } = request.data || {};
  if (!courtId && !requestedMatchId) throw invalid("Missing courtId");

  let court = null;
  if (courtId) {
    const courtSnap = await db.doc(paths.court(courtId)).get();
    if (!courtSnap.exists) throw notFound("Court not found");
    court = { courtId, ...courtSnap.data() };
  }

  const matchId =
    requestedMatchId || (await matchService.resolveCourtMatchId(courtId, { ensure: true }));
  const matchRef = db.doc(paths.match(matchId));
  const matchSnap = await matchRef.get();
  if (!matchSnap.exists) throw notFound("Match not found");
  const match = { matchId, ...matchSnap.data() };
  if (match.tournamentId) {
    throw precondition("Tournament match scoring rules cannot be changed.");
  }

  const credentials = readCredentials(request);
  if (court || match.currentCourtId) {
    let controlCourt = court;
    if (!controlCourt) {
      const snap = await db.doc(paths.court(match.currentCourtId)).get();
      controlCourt = snap.exists ? { courtId: match.currentCourtId, ...snap.data() } : null;
    }
    await authorizeMatchControl({ match, court: controlCourt }, credentials);
  } else {
    await requireAdmin(credentials);
  }

  const normalizedOptions = buildScoringOptions({
    ...(match.scoringOptions || {}),
    ...(incomingScoringOptions || {}),
    scoringMode: scoringMode || match.scoringMode || match.scoringOptions?.scoringMode,
  });
  await matchRef.set(
    { scoringOptions: normalizedOptions, scoringMode: normalizedOptions.scoringMode },
    { merge: true },
  );
  // The court keeps the options as its default for future casual matches.
  if (court) {
    await db
      .doc(paths.court(courtId))
      .set(
        { scoringOptions: normalizedOptions, scoringMode: normalizedOptions.scoringMode },
        { merge: true },
      );
  }

  const activeScoreVersion = normalizeScoreVersion(match.scoreVersion);
  const eventsSnap = await db
    .collection(paths.matchEvents(matchId))
    .orderBy("createdAt", "asc")
    .orderBy(FieldPath.documentId(), "asc")
    .get();
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
  await db.doc(paths.matchScore(matchId)).set({
    ...toLiveScorePayload(replayedScore),
    lastEventId,
    lastProcessedEventId: lastEventId,
    lastProcessedCreatedAt: lastEventCreatedAt,
    updatedAt: FieldValue.serverTimestamp(),
  });
  await matchRef.set({ scoreSummary: buildScoreSummary(replayedScore) }, { merge: true });

  const checkpointsRef = db.collection(paths.matchCheckpoints(matchId));
  const checkpointsSnap = await checkpointsRef.get();
  const checkpointDeleteBatch = db.batch();
  checkpointsSnap.forEach((docSnap) => checkpointDeleteBatch.delete(docSnap.ref));
  await checkpointDeleteBatch.commit();

  if (lastEventId && lastEventCreatedAt) {
    await checkpointsRef
      .doc()
      .set(
        buildCheckpointPayload(
          replayedScore,
          normalizedOptions,
          lastEventId,
          lastEventCreatedAt,
          activeScoreVersion,
        ),
      );
  }

  return {
    success: true,
    matchId,
    scoringOptions: normalizedOptions,
    scoringMode: normalizedOptions.scoringMode,
    mode: normalizedOptions.scoringMode,
    score: replayedScore,
  };
}

module.exports = { updateScoringOptions, REGION };
