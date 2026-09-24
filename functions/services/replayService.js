const { db, FieldPath } = require("../infrastructure/firebase");
const { defaultScore, applyEvent, normalizeScoringOptions, compareEventOrder } = require("../domain/scoring/engine");
const { SCORING_EVENTS, normalizeScoreVersion } = require("../domain/events/validation");
const { getPersistedScoreOrder, resolveReplayOrdering } = require("../domain/events/ordering");
const { getLatestCheckpoint } = require("./checkpointService");

function buildScoringEventsQuery(courtId) {
  return db
    .collection(`courts/${courtId}/events`)
    .orderBy("createdAt", "asc")
    .orderBy(FieldPath.documentId(), "asc");
}

function collectApplicableScoringEvents(eventsSnap, targetScoreVersion) {
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

    events.push({ id: docSnap.id, ...data });
  });

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
      query = query.startAfter(checkpoint.data.lastCreatedAt, checkpoint.data.lastEventId);
    }
  }

  const eventsSnap = await tx.get(query);
  let applicableEvents = collectApplicableScoringEvents(eventsSnap, targetScoreVersion);

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
  let lastEventId = null;
  let lastCreatedAt = null;

  eventsSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!SCORING_EVENTS.has(data.eventType)) {
      return;
    }

    if (normalizeScoreVersion(data.scoreVersion) !== targetScoreVersion) {
      return;
    }

    if (docSnap.id === excludedEventId) {
      return;
    }

    const event = { id: docSnap.id, ...data };
    replayedScore = applyEvent(replayedScore, event, activeOptions);
    lastEventId = docSnap.id;
    lastCreatedAt = data.createdAt || lastCreatedAt;
  });

  return {
    score: replayedScore,
    lastEventId,
    lastCreatedAt,
  };
}

module.exports = { buildScoringEventsQuery, collectApplicableScoringEvents, replayScoreFromEvents, replayScoreFromEventsExcluding, getPersistedScoreOrder, resolveReplayOrdering };