// Pending score writes are tracked independently of the rendered score. The
// displayed score remains authoritative; pending feedback only blurs the score
// affected by an input until a server-processed score snapshot acknowledges it.
import { session } from "../state/sessionState.js";

const pendingScoreEvents = new Map();
const confirmedEventIds = new Set();
const confirmedEventOrder = [];
const CONFIRMED_EVENT_CACHE_LIMIT = 256;

function rememberConfirmedEvent(eventId) {
  if (!eventId || confirmedEventIds.has(eventId)) return;
  confirmedEventIds.add(eventId);
  confirmedEventOrder.push(eventId);
  while (confirmedEventOrder.length > CONFIRMED_EVENT_CACHE_LIMIT) {
    confirmedEventIds.delete(confirmedEventOrder.shift());
  }
}

function isVisibleInCurrentCourt(event) {
  return (
    Boolean(event.courtId) &&
    event.courtId === session.currentCourtId &&
    event.listenerToken === session.activeCourtListenerToken
  );
}

function visiblePendingEvents() {
  return [...pendingScoreEvents.values()].filter(isVisibleInCurrentCourt);
}

function syncPendingScoreVisuals() {
  const visible = visiblePendingEvents();

  for (const team of ["A", "B"]) {
    const scoreElement = document.getElementById(`points${team}`);
    if (!scoreElement) continue;
    const isPending = visible.some((event) => event.team === team);
    scoreElement.classList.toggle("score-pending", isPending);
    if (isPending) {
      scoreElement.setAttribute("aria-busy", "true");
      scoreElement.setAttribute("title", "Waiting for the server to confirm this score");
    } else {
      scoreElement.removeAttribute("aria-busy");
      if (scoreElement.getAttribute("title") === "Waiting for the server to confirm this score") {
        scoreElement.removeAttribute("title");
      }
    }
  }

  let status = document.getElementById("scoreSyncStatus");
  if (!visible.length) {
    status?.remove();
    return;
  }

  if (!status) {
    status = document.createElement("div");
    status.id = "scoreSyncStatus";
    status.className = "score-sync-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    document.body.appendChild(status);
  }

  const sending = visible.some((event) => !event.submitted);
  const hasUndo = visible.some((event) => event.eventType === "UNDO");
  const action = hasUndo ? "Updating score" : "Saving score";
  status.textContent = sending
    ? `${action}…`
    : `Waiting for server confirmation${visible.length > 1 ? ` (${visible.length} events)` : ""}…`;
}

export function beginPendingScoreEvent({
  eventId,
  team = null,
  eventType,
  courtId,
  listenerToken,
  scoreVersion,
}) {
  if (!eventId || pendingScoreEvents.has(eventId)) return;
  pendingScoreEvents.set(eventId, {
    eventId,
    team,
    eventType,
    courtId,
    listenerToken,
    matchId: null,
    scoreVersion: Number(scoreVersion) || 0,
    submitted: false,
  });
  syncPendingScoreVisuals();
}

export function bindPendingScoreEvent(eventId, { matchId, scoreVersion } = {}) {
  const event = pendingScoreEvents.get(eventId);
  if (!event) return;
  event.matchId = matchId || null;
  if (scoreVersion !== undefined) event.scoreVersion = Number(scoreVersion) || 0;
  syncPendingScoreVisuals();
}

export function markPendingScoreEventSubmitted(eventId) {
  const event = pendingScoreEvents.get(eventId);
  if (!event) return;
  event.submitted = true;
  syncPendingScoreVisuals();
}

export function failPendingScoreEvent(eventId) {
  pendingScoreEvents.delete(eventId);
  syncPendingScoreVisuals();
}

export function wasScoreEventConfirmed(eventId) {
  return confirmedEventIds.has(eventId);
}

// The materialized score document carries a bounded history of processed event
// IDs. Matching IDs (rather than a changed number or the write promise alone)
// prevents a remote point or a fast/coalesced snapshot from falsely confirming
// another in-flight input.
export function reconcilePendingScoreEvents(matchId, scoreData) {
  if (!matchId || !scoreData) return 0;
  const processedIds = new Set([
    ...(Array.isArray(scoreData.recentProcessedEventIds)
      ? scoreData.recentProcessedEventIds
      : []),
    scoreData.lastEventId,
    scoreData.lastProcessedEventId,
  ].filter((eventId) => typeof eventId === "string" && eventId.length > 0));

  let resolvedCount = 0;
  for (const [eventId, event] of pendingScoreEvents) {
    if (event.matchId !== matchId || !processedIds.has(eventId)) continue;
    pendingScoreEvents.delete(eventId);
    rememberConfirmedEvent(eventId);
    resolvedCount++;
  }

  syncPendingScoreVisuals();
  return resolvedCount;
}

// A reset increments scoreVersion and makes older pending events stale. Clear
// only events from the superseded generation; never pretend they were saved.
export function discardPendingScoreEventsForMatch(matchId, scoreVersion) {
  let discardedCount = 0;
  for (const [eventId, event] of pendingScoreEvents) {
    if (
      event.matchId === matchId &&
      event.scoreVersion === (Number(scoreVersion) || 0)
    ) {
      pendingScoreEvents.delete(eventId);
      discardedCount++;
    }
  }
  syncPendingScoreVisuals();
  return discardedCount;
}
