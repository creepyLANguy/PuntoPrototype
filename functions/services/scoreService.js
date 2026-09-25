const { db, FieldValue } = require("../infrastructure/firebase");
const { defaultScore, applyEvent, toLiveScorePayload, getEventOrderingTuple, compareEventOrder, didSetCountIncrease } = require("../domain/scoring/engine");
const { buildScoringOptions } = require("../domain/scoring/modes");
const { SCORING_EVENTS, normalizeScoreVersion } = require("../domain/events/validation");
const { getPersistedScoreOrder, resolveReplayOrdering } = require("../domain/events/ordering");
const { replayScoreFromEvents, replayScoreFromEventsExcluding } = require("./replayService");
const { getLatestCheckpoint, buildCheckpointPayload } = require("./checkpointService");
const { SCORE_CHECKPOINTS_COLLECTION } = require("./constants");

async function processScoreEvent(event) {

    const { courtId, eventId } = event.params;
    const newEvent = event.data?.data();
    const incomingEvent = { id: eventId, ...(newEvent || {}) };

    console.debug(`Processing event ${eventId} for court ${courtId}:`, newEvent?.eventType);

    if (!newEvent) return;

    if (!SCORING_EVENTS.has(newEvent.eventType)) {
      console.debug(
        `Ignoring non-scoring event ${eventId} (${newEvent.eventType}) for score processing.`,
      );
      return;
    }

    const scoreRef = db.doc(`courts/${courtId}/score/current`);

    try {
      await db.runTransaction(
        async (tx) => {
          // Guard against reset races: if the event document was deleted by a
          // concurrent reset before this CF ran its transaction, skip processing
          // so a pre-reset point cannot corrupt the newly-zeroed score.
          const eventRef = db.doc(`courts/${courtId}/events/${eventId}`);
          const eventSnap = await tx.get(eventRef);
          if (!eventSnap.exists) {
            return;
          }

          const courtRef = db.doc(`courts/${courtId}`);
          const courtSnap = await tx.get(courtRef);
          const courtData = courtSnap.exists ? courtSnap.data() : {};
          const scoreSnap = await tx.get(scoreRef);
          const activeScoringOptions = buildScoringOptions({
            ...(courtData.scoringOptions || {}),
            scoringMode: courtData.scoringMode || courtData.scoringOptions?.scoringMode,
          });
          const activeScoreVersion = normalizeScoreVersion(courtData.scoreVersion);
          let score = scoreSnap.exists ? scoreSnap.data() : defaultScore(activeScoringOptions);
          const incomingOrder = getEventOrderingTuple(incomingEvent);
          const persistedOrder = getPersistedScoreOrder(score);
          const eventScoreVersion = normalizeScoreVersion(newEvent.scoreVersion);

          if (score.lastEventId === eventId) {
            console.debug(`Event ${eventId} already processed, skipping.`);
            return;
          }

          if (eventScoreVersion !== activeScoreVersion) {
            console.debug(
              `Skipping stale event ${eventId} for court ${courtId}: event version ${eventScoreVersion}, active version ${activeScoreVersion}.`,
            );
            return;
          }

          const orderComparison = compareEventOrder(
            incomingOrder.createdAt,
            incomingOrder.id,
            persistedOrder.createdAt,
            persistedOrder.eventId,
          );

          if (orderComparison !== null && orderComparison <= 0) {
            // The incoming event arrived out-of-order relative to what the score
            // document has already processed.  Rebuild from the full event log so
            // the event is applied in its correct chronological position.
            //
            // Do a full replay here instead of resuming from a checkpoint.
            // A delayed point can sort *before* the latest checkpoint boundary;
            // if we only replay the tail after that checkpoint, that earlier
            // event is silently skipped and never affects the authoritative
            // score. A full replay also preserves the in-memory history stack
            // that undo() depends on.
            const useCheckpoint = false;
            const replayResult = await replayScoreFromEvents(
              tx,
              courtId,
              activeScoringOptions,
              useCheckpoint,
              activeScoreVersion,
            );
            const replayOrdering = resolveReplayOrdering(replayResult, score, incomingOrder);

            tx.set(scoreRef, {
              ...toLiveScorePayload(replayResult.score),
              lastEventId: replayOrdering.eventId,
              lastProcessedEventId: replayOrdering.eventId,
              lastProcessedCreatedAt: replayOrdering.createdAt,
              updatedAt: FieldValue.serverTimestamp(),
            });

            return;
          }

          // -----------------------------
          // Handle RESET event
          // -----------------------------
          if (newEvent.eventType === "RESET") {
            console.debug(`Resetting court ${courtId}`);
            const eventsRef = db.collection(`courts/${courtId}/events`);
            const eventsSnap = await eventsRef.get();
            const checkpointsRef = db.collection(
              `courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`,
            );
            const checkpointsSnap = await checkpointsRef.get();
            const archiveId = new Date().toISOString();

            const archiveBatch = db.batch();
            eventsSnap.forEach((doc) => {
              const archiveRef = db.doc(`courts/${courtId}/archive/${archiveId}/events/${doc.id}`);
              archiveBatch.set(archiveRef, {
                ...doc.data(),
                archivedAt: FieldValue.serverTimestamp(),
                resetBy: newEvent.createdBy || "system",
              });
            });
            await archiveBatch.commit();

            const deleteBatch = db.batch();
            eventsSnap.forEach((doc) => deleteBatch.delete(doc.ref));
            await deleteBatch.commit();

            checkpointsSnap.forEach((docSnap) => {
              tx.delete(docSnap.ref);
            });

            tx.set(scoreRef, {
              ...toLiveScorePayload(defaultScore(activeScoringOptions)),
              lastEventId: eventId,
              lastProcessedEventId: eventId,
              lastProcessedCreatedAt: incomingOrder.createdAt,
              updatedAt: FieldValue.serverTimestamp(),
            });

            return;
          }

          // Rebuild state for undo from the full event log (never a
          // checkpoint - see replayScoreFromEventsExcluding), then apply it.
          if (newEvent.eventType === "UNDO") {
            const replayResult = await replayScoreFromEventsExcluding(
              tx,
              courtId,
              activeScoringOptions,
              eventId,
              activeScoreVersion,
            );
            const replayedScore = applyEvent(
              replayResult.score,
              incomingEvent,
              activeScoringOptions,
            );

            tx.set(scoreRef, {
              ...toLiveScorePayload(replayedScore),
              lastEventId: eventId,
              lastProcessedEventId: eventId,
              lastProcessedCreatedAt: incomingOrder.createdAt,
              updatedAt: FieldValue.serverTimestamp(),
            });

            // Re-anchor the checkpoint stream at the undo itself. The
            // newest existing checkpoint may sit exactly at the undone
            // point (set completions and scoring-option changes both write
            // one there); replays that resume from it would carry this
            // UNDO in their tail and be forced onto the slow full-replay
            // path forever. A fresh checkpoint holding the post-undo state
            // lets subsequent points resume cheaply without ever crossing
            // the undo boundary.
            if (incomingOrder.createdAt) {
              const checkpointRef = db
                .collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`)
                .doc();
              tx.set(
                checkpointRef,
                buildCheckpointPayload(
                  replayedScore,
                  activeScoringOptions,
                  eventId,
                  incomingOrder.createdAt,
                ),
              );
            }

            return;
          }

          // Normal point events are rebuilt from the authoritative event log so
          // rapid concurrent writes cannot drop points by racing on score/current.
          const previousScore = {
            ...defaultScore(activeScoringOptions),
            ...(score || {}),
            A: { ...defaultScore(activeScoringOptions).A, ...(score?.A || {}) },
            B: { ...defaultScore(activeScoringOptions).B, ...(score?.B || {}) },
            completedSets: Array.isArray(score?.completedSets)
              ? score.completedSets.map((set) => ({ ...set }))
              : [],
          };
          const replayResult = await replayScoreFromEvents(
            tx,
            courtId,
            activeScoringOptions,
            true,
            activeScoreVersion,
          );
          const nextScore = replayResult.score;
          const replayOrdering = resolveReplayOrdering(replayResult, score, incomingOrder);

          console.debug(
            `Updating score for ${courtId}. New points: A:${nextScore.A.points}, B:${nextScore.B.points}`,
          );

          tx.set(scoreRef, {
            ...toLiveScorePayload(nextScore),
            lastEventId: replayOrdering.eventId,
            lastProcessedEventId: replayOrdering.eventId,
            lastProcessedCreatedAt: replayOrdering.createdAt,
            updatedAt: FieldValue.serverTimestamp(),
          });

          // Persist checkpoint whenever set total increases under active scoring mode.
          if (didSetCountIncrease(previousScore, nextScore)) {
            const checkpointRef = db
              .collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`)
              .doc();
            tx.set(
              checkpointRef,
              buildCheckpointPayload(
                nextScore,
                activeScoringOptions,
                replayOrdering.eventId,
                replayOrdering.createdAt,
              ),
            );
          }
        },
        { maxAttempts: 20 },
      );
    } catch (err) {
      console.error(`Transaction failed for event ${eventId}:`, err);
      // Rethrow so Cloud Functions retries delivery (see retry:true above) instead of
      // silently dropping this point/undo when the score doc is under heavy contention.
      throw err;
    }
  
}

module.exports = { processScoreEvent };
