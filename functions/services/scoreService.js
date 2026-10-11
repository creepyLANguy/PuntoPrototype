const { db, FieldValue } = require("../infrastructure/firebase");
const {
  defaultScore,
  applyEvent,
  toLiveScorePayload,
  getEventOrderingTuple,
  compareEventOrder,
  didSetCountIncrease,
} = require("../domain/scoring/engine");
const { buildScoringOptions } = require("../domain/scoring/modes");
const { SCORING_EVENTS, normalizeScoreVersion } = require("../domain/events/validation");
const { getPersistedScoreOrder, resolveReplayOrdering } = require("../domain/events/ordering");
const { replayScoreFromEvents, replayScoreFromEventsExcluding } = require("./replayService");
const { getLatestCheckpoint, buildCheckpointPayload } = require("./checkpointService");
const { paths } = require("./firestorePaths");
const { buildScoreSummary } = require("../domain/matches/lifecycle");

function shouldAutoChangeover(previousScore, nextScore, scoringOptions) {
  return (
    scoringOptions?.scoringMode === "fixedTotalPoints" &&
    !nextScore?.matchComplete &&
    (Number(previousScore?.A?.points) || 0) + (Number(previousScore?.B?.points) || 0) <
      scoringOptions.pointsTarget &&
    (Number(nextScore?.A?.points) || 0) + (Number(nextScore?.B?.points) || 0) <
      scoringOptions.pointsTarget &&
    scoringOptions?.serving?.sideSwapRule === "after_all_players_serve_once" &&
    Boolean(previousScore?.fixedTotal?.sidesSwapped) !==
      Boolean(nextScore?.fixedTotal?.sidesSwapped)
  );
}

async function stageAutomaticChangeover(
  tx,
  matchId,
  matchData,
  previousScore,
  nextScore,
  scoringOptions,
) {
  if (!shouldAutoChangeover(previousScore, nextScore, scoringOptions)) return;

  const courtId = matchData?.currentCourtId || null;
  if (!courtId) return;

  const courtRef = db.doc(paths.court(courtId));
  const courtSnap = await tx.get(courtRef);
  if (!courtSnap.exists || courtSnap.data()?.activeMatchId !== matchId) {
    return;
  }

  const currentBeaconSidesSwapped = courtSnap.data()?.beaconSidesSwapped === true;
  const changeoverEventId = db.collection("_changeoverEvents").doc().id;

  tx.set(
    courtRef,
    {
      beaconSidesSwapped: !currentBeaconSidesSwapped,
      changeoverEvent: {
        id: changeoverEventId,
        createdAt: FieldValue.serverTimestamp(),
        source: "automatic_scoring",
      },
    },
    { merge: true },
  );
}

async function processScoreEvent(event) {
  const { matchId, eventId } = event.params;
  const newEvent = event.data?.data();
  const incomingEvent = { id: eventId, ...(newEvent || {}) };

  console.debug(`Processing event ${eventId} for match ${matchId}:`, newEvent?.eventType);

  if (!newEvent) return;

  if (!SCORING_EVENTS.has(newEvent.eventType)) {
    console.debug(
      `Ignoring non-scoring event ${eventId} (${newEvent.eventType}) for score processing.`,
    );
    return;
  }

  const scoreRef = db.doc(paths.matchScore(matchId));
  const matchRef = db.doc(paths.match(matchId));
  let completedFixedEndMatch = false;
  let completedTournamentId = null;

  try {
    await db.runTransaction(
      async (tx) => {
        // Guard against reset races: if the event document was deleted by a
        // concurrent reset before this CF ran its transaction, skip processing
        // so a pre-reset point cannot corrupt the newly-zeroed score.
        const eventRef = db.doc(paths.matchEvent(matchId, eventId));
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
          return;
        }

        const matchSnap = await tx.get(matchRef);
        if (!matchSnap.exists) {
          return;
        }
        const matchData = matchSnap.data() || {};
        // Events belong to one match generation: a delayed event for a culled
        // match id must never score the match that reused it.
        if ((newEvent.allocationId ?? null) !== (matchData.allocationId ?? null)) {
          console.debug(`Ignoring event ${eventId}: it targets another generation of ${matchId}.`);
          return;
        }
        if (matchData.status && matchData.status !== "live") {
          console.debug(`Ignoring event ${eventId}: match ${matchId} is ${matchData.status}.`);
          if (matchData.status === "completed")
            completedTournamentId = matchData.tournamentId || null;
          return;
        }
        const scoreSnap = await tx.get(scoreRef);
        const activeScoringOptions = buildScoringOptions({
          ...(matchData.scoringOptions || {}),
          scoringMode: matchData.scoringMode || matchData.scoringOptions?.scoringMode,
        });
        const activeScoreVersion = normalizeScoreVersion(matchData.scoreVersion);

        // The compact summary on the match document feeds match lists and
        // tournament dashboards without one read per score document.
        const writeSummary = (nextScore) => {
          tx.set(
            matchRef,
            { scoreSummary: buildScoreSummary(nextScore), updatedAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
          completedFixedEndMatch =
            Boolean(nextScore?.matchComplete) &&
            Boolean(matchData.tournamentId) &&
            matchData.status === "live";
        };
        let score = scoreSnap.exists ? scoreSnap.data() : defaultScore(activeScoringOptions);
        const incomingOrder = getEventOrderingTuple(incomingEvent);
        const persistedOrder = getPersistedScoreOrder(score);
        const eventScoreVersion = normalizeScoreVersion(newEvent.scoreVersion);

        if (score.lastEventId === eventId) {
          console.debug(`Event ${eventId} already processed, skipping.`);
          // A retried delivery still owes the completion hand-off.
          completedFixedEndMatch =
            Boolean(score.matchComplete) &&
            Boolean(matchData.tournamentId) &&
            matchData.status === "live";
          return;
        }

        if (eventScoreVersion !== activeScoreVersion) {
          console.debug(
            `Skipping stale event ${eventId} for match ${matchId}: event version ${eventScoreVersion}, active version ${activeScoreVersion}.`,
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
            matchId,
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
          await stageAutomaticChangeover(
            tx,
            matchId,
            matchData,
            score,
            replayResult.score,
            activeScoringOptions,
          );
          writeSummary(replayResult.score);

          return;
        }

        // -----------------------------
        // Handle RESET event
        // -----------------------------
        if (newEvent.eventType === "RESET") {
          console.debug(`Resetting match ${matchId}`);
          const eventsRef = db.collection(paths.matchEvents(matchId));
          const eventsSnap = await eventsRef.get();
          const checkpointsRef = db.collection(paths.matchCheckpoints(matchId));
          const checkpointsSnap = await checkpointsRef.get();
          const archiveId = new Date().toISOString();

          const archiveBatch = db.batch();
          eventsSnap.forEach((doc) => {
            const archiveRef = db.doc(paths.matchArchiveEvent(matchId, archiveId, doc.id));
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
          writeSummary(defaultScore(activeScoringOptions));

          return;
        }

        // Rebuild state for undo from the full event log (never a
        // checkpoint - see replayScoreFromEventsExcluding), then apply it.
        if (newEvent.eventType === "UNDO") {
          const replayResult = await replayScoreFromEventsExcluding(
            tx,
            matchId,
            activeScoringOptions,
            eventId,
            activeScoreVersion,
          );
          const replayedScore = applyEvent(replayResult.score, incomingEvent, activeScoringOptions);

          await stageAutomaticChangeover(
            tx,
            matchId,
            matchData,
            score,
            replayedScore,
            activeScoringOptions,
          );

          tx.set(scoreRef, {
            ...toLiveScorePayload(replayedScore),
            lastEventId: eventId,
            lastProcessedEventId: eventId,
            lastProcessedCreatedAt: incomingOrder.createdAt,
            updatedAt: FieldValue.serverTimestamp(),
          });
          writeSummary(replayedScore);

          // Re-anchor the checkpoint stream at the undo itself. The
          // newest existing checkpoint may sit exactly at the undone
          // point (set completions and scoring-option changes both write
          // one there); replays that resume from it would carry this
          // UNDO in their tail and be forced onto the slow full-replay
          // path forever. A fresh checkpoint holding the post-undo state
          // lets subsequent points resume cheaply without ever crossing
          // the undo boundary.
          if (incomingOrder.createdAt) {
            const checkpointRef = db.collection(paths.matchCheckpoints(matchId)).doc();
            tx.set(
              checkpointRef,
              buildCheckpointPayload(
                replayedScore,
                activeScoringOptions,
                eventId,
                incomingOrder.createdAt,
                activeScoreVersion,
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
          matchId,
          activeScoringOptions,
          true,
          activeScoreVersion,
        );
        const nextScore = replayResult.score;
        const replayOrdering = resolveReplayOrdering(replayResult, score, incomingOrder);

        console.debug(
          `Updating score for match ${matchId}. New points: A:${nextScore.A.points}, B:${nextScore.B.points}`,
        );

        await stageAutomaticChangeover(
          tx,
          matchId,
          matchData,
          previousScore,
          nextScore,
          activeScoringOptions,
        );

        tx.set(scoreRef, {
          ...toLiveScorePayload(nextScore),
          lastEventId: replayOrdering.eventId,
          lastProcessedEventId: replayOrdering.eventId,
          lastProcessedCreatedAt: replayOrdering.createdAt,
          updatedAt: FieldValue.serverTimestamp(),
        });
        writeSummary(nextScore);

        // Persist checkpoint whenever set total increases under active scoring mode.
        if (didSetCountIncrease(previousScore, nextScore)) {
          const checkpointRef = db.collection(paths.matchCheckpoints(matchId)).doc();
          tx.set(
            checkpointRef,
            buildCheckpointPayload(
              nextScore,
              activeScoringOptions,
              replayOrdering.eventId,
              replayOrdering.createdAt,
              activeScoreVersion,
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

  if (completedTournamentId) {
    const { onTournamentMatchChanged } = require("./tournamentHooks");
    await onTournamentMatchChanged({ tournamentId: completedTournamentId });
    return;
  }

  // A tournament match whose scoring mode has a defined end (fixed total
  // points, match tiebreak) completes itself; the result then flows into the
  // tournament through the normal completion path.
  if (completedFixedEndMatch) {
    const { completeMatch } = require("./matchService");
    const { onTournamentMatchChanged } = require("./tournamentHooks");
    const completion = await completeMatch({
      matchId,
      actor: { type: "system" },
      reason: "Finishing score reached",
    });
    await onTournamentMatchChanged(completion);
  }
}

module.exports = { processScoreEvent };
