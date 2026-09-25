const { compareEventOrder } = require("../scoring/engine");

function getPersistedScoreOrder(score = {}) {
  const createdAt = score?.lastProcessedCreatedAt || score?.updatedAt || null;
  const eventId =
    typeof score?.lastProcessedEventId === "string"
      ? score.lastProcessedEventId
      : typeof score?.lastEventId === "string"
        ? score.lastEventId
        : null;

  return { createdAt, eventId };
}

function resolveReplayOrdering(replayResult, existingScore = {}, fallbackOrder = {}) {
  const persistedOrder = getPersistedScoreOrder(existingScore);

  return {
    eventId: replayResult?.lastEventId ?? persistedOrder.eventId ?? fallbackOrder.id ?? null,
    createdAt:
      replayResult?.lastCreatedAt ?? persistedOrder.createdAt ?? fallbackOrder.createdAt ?? null,
  };
}

function compareEventRecordOrder(left, right) {
  const ordered = compareEventOrder(left?.createdAt, left?.id, right?.createdAt, right?.id);

  if (ordered !== null) {
    return ordered;
  }

  return String(left?.id || "").localeCompare(String(right?.id || ""));
}

function isEventAfterOrder(event, createdAt, eventId) {
  const ordered = compareEventOrder(event?.createdAt, event?.id, createdAt, eventId);
  return ordered !== null && ordered > 0;
}

module.exports = {
  getPersistedScoreOrder,
  resolveReplayOrdering,
  compareEventRecordOrder,
  isEventAfterOrder,
};
