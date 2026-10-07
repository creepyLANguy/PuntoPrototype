// Shared in-memory Firestore state used by the mocked Firebase SDK modules and
// the integration tests. A lightweight scoring backend (reusing the real
// scoringEngine from Cloud Functions) processes score events exactly like
// functions/index.js does in production.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const scoringEngine = require("../scoringEngine.js");

const SCORING_EVENTS = new Set(["POINT_TEAM_A", "POINT_TEAM_B", "UNDO", "RESET"]);

export const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

let timestampCounter = 0;

function nextTimestamp() {
  timestampCounter += 1;
  return { seconds: timestampCounter, nanoseconds: 0 };
}

export const firestoreState = {
  docs: new Map(), // path -> plain data object
  listeners: new Map(), // path -> Set of { onNext, onError }
  autoId: 0,
  backendEnabled: true, // set false to defer backend score processing
  pendingBackendWork: [],
  // per-match authoritative score incl. history (like the CF replay would produce)
  backendScores: new Map(),
  // Query listeners: { collectionPath, filters, onNext }.
  queryListeners: new Set(),
  // Collection paths whose reads (getDocs) fail, to test degraded loading.
  failingCollections: new Set(),
  // Collection path -> promise; reads (getDocs) of that collection wait for
  // it, so tests can observe a page while its data is still loading.
  readGates: new Map(),
  // Callbacks run (asynchronously, like a Firestore trigger) after a document
  // is deleted: (path, deletedData) => void.
  deleteHooks: new Set(),
};

export function resetFirestoreState() {
  firestoreState.docs.clear();
  firestoreState.listeners.clear();
  firestoreState.autoId = 0;
  firestoreState.backendEnabled = true;
  firestoreState.pendingBackendWork = [];
  firestoreState.backendScores.clear();
  firestoreState.queryListeners.clear();
  firestoreState.failingCollections.clear();
  firestoreState.readGates.clear();
  firestoreState.deleteHooks.clear();
  timestampCounter = 0;
}

function materialize(value) {
  if (value === SERVER_TIMESTAMP_SENTINEL) {
    return nextTimestamp();
  }
  if (Array.isArray(value)) {
    return value.map(materialize);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = materialize(entry);
    }
    return out;
  }
  return value;
}

function cloneValue(value) {
  if (value === SERVER_TIMESTAMP_SENTINEL) return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = cloneValue(entry);
    }
    return out;
  }
  return value;
}

export function makeSnapshot(path, data) {
  const id = path.split("/").pop();
  return {
    id,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : structuredClone(data)),
  };
}

export function queryDocs(collectionPath, filters = []) {
  const prefix = `${collectionPath}/`;
  const docs = [];
  for (const [path, data] of firestoreState.docs.entries()) {
    if (!path.startsWith(prefix) || path.slice(prefix.length).includes("/")) continue;
    if (filters.every(({ field, value }) => data?.[field] === value)) {
      docs.push(makeSnapshot(path, data));
    }
  }
  return { empty: docs.length === 0, size: docs.length, docs, forEach: (fn) => docs.forEach(fn) };
}

export function notifyListeners(path) {
  const listeners = firestoreState.listeners.get(path);
  const data = firestoreState.docs.get(path);
  for (const listener of [...(listeners || [])]) {
    queueMicrotask(() => listener.onNext(makeSnapshot(path, data)));
  }
  const collectionPath = path.split("/").slice(0, -1).join("/");
  for (const listener of [...firestoreState.queryListeners]) {
    if (listener.collectionPath !== collectionPath) continue;
    queueMicrotask(() => listener.onNext(queryDocs(listener.collectionPath, listener.filters)));
  }
}

export function writeDoc(path, data) {
  firestoreState.docs.set(path, materialize(cloneValue(data)));
  notifyListeners(path);
  maybeProcessBackend(path);
}

export function mergeDoc(path, data) {
  const existing = firestoreState.docs.get(path) || {};
  firestoreState.docs.set(path, { ...existing, ...materialize(cloneValue(data)) });
  notifyListeners(path);
  maybeProcessBackend(path);
}

export function deleteDocAt(path) {
  const deleted = firestoreState.docs.get(path);
  firestoreState.docs.delete(path);
  notifyListeners(path);
  for (const hook of firestoreState.deleteHooks) {
    queueMicrotask(() => hook(path, deleted));
  }
}

export function seedDoc(path, data) {
  firestoreState.docs.set(path, materialize(cloneValue(data)));
}

// ---------------------------------------------------------------------------
// Simulated scoring backend (mirrors functions/index.js onEventCreate)
// ---------------------------------------------------------------------------

function maybeProcessBackend(path) {
  const match = path.match(/^matches\/([^/]+)\/events\/([^/]+)$/);
  if (!match) return;

  const [, matchId, eventId] = match;
  const event = firestoreState.docs.get(path);
  if (!event || !SCORING_EVENTS.has(event.eventType)) return;

  const work = () => processScoringEvent(matchId, eventId, event);

  if (!firestoreState.backendEnabled) {
    firestoreState.pendingBackendWork.push(work);
    return;
  }

  // Asynchronous like the real Cloud Function round-trip.
  queueMicrotask(work);
}

export function flushBackendWork() {
  const pending = firestoreState.pendingBackendWork;
  firestoreState.pendingBackendWork = [];
  pending.forEach((work) => work());
}

function processScoringEvent(matchId, eventId, event) {
  const matchPath = `matches/${matchId}`;
  const scorePath = `matches/${matchId}/score/current`;
  const matchData = firestoreState.docs.get(matchPath) || {};
  if (matchData.status && matchData.status !== "live") return;

  const activeOptions = scoringEngine.normalizeScoringOptions({
    ...(matchData.scoringOptions || {}),
    scoringMode: matchData.scoringMode || matchData.scoringOptions?.scoringMode,
  });

  const activeScoreVersion = Number(matchData.scoreVersion) || 0;
  const eventScoreVersion = Number(event.scoreVersion) || 0;
  if (eventScoreVersion !== activeScoreVersion) {
    return; // stale event, exactly like the CF skips it
  }

  let score = firestoreState.backendScores.get(matchId);
  if (!score) {
    score = scoringEngine.defaultScore(activeOptions);
  }

  const previousSidesSwapped = Boolean(score?.fixedTotal?.sidesSwapped);
  const previousRallyPoints = score.A.points + score.B.points;
  score = scoringEngine.applyEvent(score, { id: eventId, ...event }, activeOptions);
  const nextSidesSwapped = Boolean(score?.fixedTotal?.sidesSwapped);

  if (
    activeOptions.scoringMode === "fixedTotalPoints" &&
    !score.matchComplete &&
    previousRallyPoints < activeOptions.pointsTarget &&
    score.A.points + score.B.points < activeOptions.pointsTarget &&
    activeOptions.serving?.sideSwapRule === "after_all_players_serve_once" &&
    previousSidesSwapped !== nextSidesSwapped
  ) {
    const courtId = matchData.currentCourtId || null;
    const courtPath = courtId ? `courts/${courtId}` : null;
    const court = courtPath ? firestoreState.docs.get(courtPath) : null;

    if (court && court.activeMatchId === matchId) {
      const changeoverEventId = nextAutoId();
      writeDoc(courtPath, {
        ...court,
        beaconSidesSwapped: court.beaconSidesSwapped !== true,
        changeoverEvent: {
          id: changeoverEventId,
          createdAt: nextTimestamp(),
          source: "automatic_scoring",
        },
      });
    }
  }

  firestoreState.backendScores.set(matchId, score);

  writeDoc(scorePath, {
    ...scoringEngine.toLiveScorePayload(score),
    lastEventId: eventId,
    updatedAt: nextTimestamp(),
  });
}

// Tests address scores by court (the match currently on it) or by match id.
export function resolveMatchIdForCourt(courtOrMatchId) {
  const court = firestoreState.docs.get(`courts/${courtOrMatchId}`);
  return court?.activeMatchId || court?.lastMatchId || courtOrMatchId;
}

export function getBackendScore(courtOrMatchId) {
  return firestoreState.backendScores.get(resolveMatchIdForCourt(courtOrMatchId));
}

export function setBackendScore(courtOrMatchId, score) {
  firestoreState.backendScores.set(resolveMatchIdForCourt(courtOrMatchId), score);
}

export function nextAutoId() {
  firestoreState.autoId += 1;
  return `auto-${firestoreState.autoId}`;
}

// Registry for httpsCallable handlers, configurable from tests.
export const callableHandlers = new Map();
