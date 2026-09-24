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

module.exports = { getPersistedScoreOrder, resolveReplayOrdering };
