const { db } = require("../infrastructure/firebase");
const { defaultScore, applyEvent, normalizeScoringOptions, compareEventOrder } = require("../domain/scoring/engine");
const { SCORING_EVENTS, normalizeScoreVersion } = require("../domain/events/validation");
const {
  getPersistedScoreOrder,
  resolveReplayOrdering,
  compareEventRecordOrder,
  isEventAfterOrder,
} = require("../domain/events/ordering");
const { getLatestCheckpoint } = require("./checkpointService");

function buildScoringEventsQuery(courtId, startAtCreatedAt = null) {
  let query = db.collection(`courts/${courtId}/events`).orderBy("createdAt", "asc");

  // Keep the Firestore query on a single indexed field. The deterministic
  // (createdAt, eventId) tie-break is applied in memory below, avoiding a
  // production-only composite-index dependency.
  if (startAtCreatedAt) {
    query = query.startAt(startAtCreatedAt);
  }

  return query;
}

function collectApplicableScoringEvents(eventsSnap, targetScoreVersion, afterOrder = null) {
  const events = [];

  eventsSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!SCORING_EVENTS.has(data.eventType)) {
      return;
    }

    // Mirror the direct-path staleness guard: events posted against an
    // older scoreVersion must never re-enter the score via a replay.
    if (normalizeScoreVersion(data.scoreVersion) !== targetScoreVersion) {
      return;
    }

    const event = { id: docSnap.id, ...data };

    // startAt() can only resume at createdAt, so the event id is applied as
    // the deterministic in-memory tie-break for events sharing that timestamp.
    if (
      afterOrder &&
      !isEventAfterOrder(event, afterOrder.createdAt, afterOrder.eventId)
    ) {
      return;
    }

    events.push(event);
  });

  events.sort(compareEventRecordOrder);
  return events;
}

async function replayScoreFromEvents(tx, courtId, options, useCheckpoint, activeScoreVersion = 0) {
  const activeOptions = normalizeScoringOptions(options);
  const targetScoreVersion = normalizeScoreVersion(activeScoreVersion);
  let replayedScore = defaultScore(activeOptions);
  let query = buildScoringEventsQuery(courtId);
  let checkpoint = null;

  if (useCheckpoint) {
    checkpoint = await getLatestCheckpoint(tx, courtId, activeOptions);
    if (checkpoint) {
      query = buildScoringEventsQuery(courtId, checkpoint.data.lastCreatedAt);
    }
  }

  const eventsSnap = await tx.get(query);
  let applicableEvents = collectApplicableScoringEvents(
    eventsSnap,
    targetScoreVersion,
    checkpoint
      ? {
          createdAt: checkpoint.data.lastCreatedAt,
          eventId: checkpoint.data.lastEventId,
        }
      : null,
  );

  // A checkpoint snapshot has its history stripped (see toLiveScorePayload),
  // so an UNDO event in the tail would replay against an empty undo stack
  // and silently no-op - resurrecting the very point the user removed.
  // Checkpoints are written exactly where undos tend to land (set-winning
  // points and scoring-option changes), so whenever the tail contains an
  // UNDO, abandon the checkpoint and rebuild from the full event log so the
  // in-memory history stack is complete.
  if (checkpoint && applicableEvents.some((event) => event.eventType === "UNDO")) {
    checkpoint = null;
    const fullEventsSnap = await tx.get(buildScoringEventsQuery(courtId));
    applicableEvents = collectApplicableScoringEvents(fullEventsSnap, targetScoreVersion);
  }

  if (checkpoint) {
    replayedScore = {
      ...defaultScore(activeOptions),
      ...(checkpoint.data.score || {}),
      A: { ...defaultScore(activeOptions).A, ...(checkpoint.data.score?.A || {}) },
      B: { ...defaultScore(activeOptions).B, ...(checkpoint.data.score?.B || {}) },
      completedSets: Array.isArray(checkpoint.data.score?.completedSets)
        ? checkpoint.data.score.completedSets.map((set) => ({ ...set }))
        : [],
      history: [],
      scoringOptions: activeOptions,
    };
  }

  let lastEventId = null;
  let lastCreatedAt = null;

  applicableEvents.forEach((event) => {
    replayedScore = applyEvent(replayedScore, event, activeOptions);
    lastEventId = event.id;
    lastCreatedAt = event.createdAt || lastCreatedAt;
  });

  return {
    score: replayedScore,
    lastEventId,
    lastCreatedAt,
  };
}

async function replayScoreFromEventsExcluding(
  tx,
  courtId,
  options,
  excludedEventId,
  activeScoreVersion = 0,
) {
  // Rebuild without excluded event so caller can apply it in a deterministic position.
  // Always replays from the very first event (no checkpoint shortcut here): a checkpoint
  // snapshot has its history stripped, so resuming from one leaves the undo stack empty
  // right at the checkpoint boundary and silently breaks "undo" for the point that just
  // completed a set. Undo is infrequent enough that a full replay is an acceptable cost
  // for guaranteeing the history stack is always correct.
  const activeOptions = normalizeScoringOptions(options);
  const targetScoreVersion = normalizeScoreVersion(activeScoreVersion);
  let replayedScore = defaultScore(activeOptions);
  const query = buildScoringEventsQuery(courtId);

  const eventsSnap = await tx.get(query);
  const applicableEvents = collectApplicableScoringEvents(eventsSnap, targetScoreVersion).filter(
    (event) => event.id !== excludedEventId,
  );
  let lastEventId = null;
  let lastCreatedAt = null;

  applicableEvents.forEach((event) => {
    replayedScore = applyEvent(replayedScore, event, activeOptions);
    lastEventId = event.id;
    lastCreatedAt = event.createdAt || lastCreatedAt;
  });

  return {
    score: replayedScore,
    lastEventId,
    lastCreatedAt,
  };
}

module.exports = { buildScoringEventsQuery, collectApplicableScoringEvents, replayScoreFromEvents, replayScoreFromEventsExcluding, getPersistedScoreOrder, resolveReplayOrdering };