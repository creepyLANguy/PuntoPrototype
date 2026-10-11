// Match documents: matches/{matchId}, its live score (score/current) and its
// event log (events). Scoring is match-scoped; a court only points at the
// match currently being played on it (courts/{courtId}.activeMatchId).
import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  limit,
} from "./firestore.js";
import { db } from "./client.js";
import { assertId } from "../config/idContract.js";
import {
  assertCurrentAssignment,
  rememberQuerySnapshot,
  rememberSnapshot,
} from "./assignmentContext.js";

export function getMatch(matchId) {
  assertId("match", matchId);
  return getDoc(doc(db, "matches", matchId)).then((snap) =>
    rememberSnapshot("match", matchId, snap),
  );
}

export function listenToMatch(matchId, onNext, onError) {
  assertId("match", matchId);
  return onSnapshot(
    doc(db, "matches", matchId),
    (snap) => onNext(rememberSnapshot("match", matchId, snap)),
    onError,
  );
}

export function getMatchScore(matchId) {
  assertId("match", matchId);
  return getDoc(doc(db, "matches", matchId, "score", "current"));
}

export function listenToMatchScore(matchId, onNext, onError) {
  assertId("match", matchId);
  return onSnapshot(
    doc(db, "matches", matchId, "score", "current"),
    onNext,
    onError,
  );
}

// Team and player names of a casual match. Tournament match names come from
// the tournament roster and are changed through the tournament host tools.
export function updateMatch(matchId, data) {
  assertId("match", matchId);
  return updateDoc(doc(db, "matches", matchId), {
    ...data,
    allocationId: assertCurrentAssignment("match", matchId, data.allocationId),
    updatedAt: serverTimestamp(),
  });
}

// Score events are processed by the onEventCreate Cloud Function. The court
// on the event is audit context only.
export function addMatchEvent(matchId, { eventType, createdBy, ...fields }) {
  assertId("match", matchId);
  if (fields.courtId != null) assertId("court", fields.courtId);
  return addDoc(collection(db, "matches", matchId, "events"), {
    eventType,
    createdAt: serverTimestamp(),
    createdBy,
    ...fields,
    matchId,
    allocationId: assertCurrentAssignment(
      "match",
      matchId,
      fields.allocationId,
    ),
    ...(fields.courtId != null
      ? {
          courtAllocationId: assertCurrentAssignment(
            "court",
            fields.courtId,
            fields.courtAllocationId,
          ),
        }
      : {}),
  });
}

// Live public matches for search and discovery. Historical matches stay
// reachable by id, link, tournament and the admin match list.
export function getLiveMatches(maxResults = 200) {
  return getDocs(
    query(
      collection(db, "matches"),
      where("status", "==", "live"),
      where("visibility", "==", "public"),
      limit(maxResults),
    ),
  ).then((snap) => rememberQuerySnapshot("match", snap));
}

export function getMatchesByStatus(status, maxResults = 200) {
  return getDocs(
    query(
      collection(db, "matches"),
      where("status", "==", status),
      limit(maxResults),
    ),
  ).then((snap) => rememberQuerySnapshot("match", snap));
}

export function listenToTournamentLiveMatches(tournamentId, onNext, onError) {
  assertId("tournament", tournamentId);
  return onSnapshot(
    query(
      collection(db, "matches"),
      where("tournamentId", "==", tournamentId),
      where("status", "==", "live"),
      where("visibility", "==", "public"),
    ),
    (snap) => onNext(rememberQuerySnapshot("match", snap)),
    onError,
  );
}
