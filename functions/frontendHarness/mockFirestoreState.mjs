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

function nextTimestamp()
{
  timestampCounter += 1;
  return { seconds: timestampCounter, nanoseconds: 0 };
}

export const firestoreState = {
  docs: new Map(),          // path -> plain data object
  listeners: new Map(),     // path -> Set of { onNext, onError }
  autoId: 0,
  backendEnabled: true,     // set false to defer backend score processing
  pendingBackendWork: [],
  // per-court authoritative score incl. history (like the CF replay would produce)
  backendScores: new Map()
};

export function resetFirestoreState()
{
  firestoreState.docs.clear();
  firestoreState.listeners.clear();
  firestoreState.autoId = 0;
  firestoreState.backendEnabled = true;
  firestoreState.pendingBackendWork = [];
  firestoreState.backendScores.clear();
  timestampCounter = 0;
}

function materialize(value)
{
  if (value === SERVER_TIMESTAMP_SENTINEL)
  {
    return nextTimestamp();
  }
  if (Array.isArray(value))
  {
    return value.map(materialize);
  }
  if (value && typeof value === "object")
  {
    const out = {};
    for (const [key, entry] of Object.entries(value))
    {
      out[key] = materialize(entry);
    }
    return out;
  }
  return value;
}

function cloneValue(value)
{
  if (value === SERVER_TIMESTAMP_SENTINEL) return value;
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object")
  {
    const out = {};
    for (const [key, entry] of Object.entries(value))
    {
      out[key] = cloneValue(entry);
    }
    return out;
  }
  return value;
}

export function makeSnapshot(path, data)
{
  const id = path.split("/").pop();
  return {
    id,
    exists: () => data !== undefined,
    data: () => (data === undefined ? undefined : structuredClone(data))
  };
}

export function notifyListeners(path)
{
  const listeners = firestoreState.listeners.get(path);
  if (!listeners) return;
  const data = firestoreState.docs.get(path);
  for (const listener of [...listeners])
  {
    queueMicrotask(() => listener.onNext(makeSnapshot(path, data)));
  }
}

export function writeDoc(path, data)
{
  firestoreState.docs.set(path, materialize(cloneValue(data)));
  notifyListeners(path);
  maybeProcessBackend(path);
}

export function mergeDoc(path, data)
{
  const existing = firestoreState.docs.get(path) || {};
  firestoreState.docs.set(path, { ...existing, ...materialize(cloneValue(data)) });
  notifyListeners(path);
  maybeProcessBackend(path);
}

export function deleteDocAt(path)
{
  firestoreState.docs.delete(path);
  notifyListeners(path);
}

export function seedDoc(path, data)
{
  firestoreState.docs.set(path, materialize(cloneValue(data)));
}

// ---------------------------------------------------------------------------
// Simulated scoring backend (mirrors functions/index.js onEventCreate)
// ---------------------------------------------------------------------------

function maybeProcessBackend(path)
{
  const match = path.match(/^courts\/([^/]+)\/events\/([^/]+)$/);
  if (!match) return;

  const [, courtId, eventId] = match;
  const event = firestoreState.docs.get(path);
  if (!event || !SCORING_EVENTS.has(event.eventType)) return;

  const work = () => processScoringEvent(courtId, eventId, event);

  if (!firestoreState.backendEnabled)
  {
    firestoreState.pendingBackendWork.push(work);
    return;
  }

  // Asynchronous like the real Cloud Function round-trip.
  queueMicrotask(work);
}

export function flushBackendWork()
{
  const pending = firestoreState.pendingBackendWork;
  firestoreState.pendingBackendWork = [];
  pending.forEach((work) => work());
}

function processScoringEvent(courtId, eventId, event)
{
  const courtPath = `courts/${courtId}`;
  const scorePath = `courts/${courtId}/score/current`;
  const courtData = firestoreState.docs.get(courtPath) || {};

  const activeOptions = scoringEngine.normalizeScoringOptions({
    ...(courtData.scoringOptions || {}),
    scoringMode: courtData.scoringMode || courtData.scoringOptions?.scoringMode
  });

  const activeScoreVersion = Number(courtData.scoreVersion) || 0;
  const eventScoreVersion = Number(event.scoreVersion) || 0;
  if (eventScoreVersion !== activeScoreVersion)
  {
    return; // stale event, exactly like the CF skips it
  }

  let score = firestoreState.backendScores.get(courtId);
  if (!score)
  {
    score = scoringEngine.defaultScore(activeOptions);
  }

  score = scoringEngine.applyEvent(score, { id: eventId, ...event }, activeOptions);
  firestoreState.backendScores.set(courtId, score);

  writeDoc(scorePath, {
    ...scoringEngine.toLiveScorePayload(score),
    lastEventId: eventId,
    updatedAt: nextTimestamp()
  });
}

export function getBackendScore(courtId)
{
  return firestoreState.backendScores.get(courtId);
}

export function setBackendScore(courtId, score)
{
  firestoreState.backendScores.set(courtId, score);
}

export function nextAutoId()
{
  firestoreState.autoId += 1;
  return `auto-${firestoreState.autoId}`;
}

// Registry for httpsCallable handlers, configurable from tests.
export const callableHandlers = new Map();
