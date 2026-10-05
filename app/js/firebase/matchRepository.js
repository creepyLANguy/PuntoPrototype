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

export function getMatch(matchId) {
  return getDoc(doc(db, "matches", matchId));
}

export function listenToMatch(matchId, onNext, onError) {
  return onSnapshot(doc(db, "matches", matchId), onNext, onError);
}

export function getMatchScore(matchId) {
  return getDoc(doc(db, "matches", matchId, "score", "current"));
}

export function listenToMatchScore(matchId, onNext, onError) {
  return onSnapshot(
    doc(db, "matches", matchId, "score", "current"),
    onNext,
    onError,
  );
}

// Team and player names of a casual match. Tournament match names come from
// the tournament roster and are changed through the tournament host tools.
export function updateMatch(matchId, data) {
  return updateDoc(doc(db, "matches", matchId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

// Score events are processed by the onEventCreate Cloud Function. The court
// on the event is audit context only.
export function addMatchEvent(matchId, { eventType, createdBy, ...fields }) {
  return addDoc(collection(db, "matches", matchId, "events"), {
    eventType,
    createdAt: serverTimestamp(),
    createdBy,
    matchId,
    ...fields,
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
  );
}

export function getMatchesByStatus(status, maxResults = 200) {
  return getDocs(
    query(
      collection(db, "matches"),
      where("status", "==", status),
      limit(maxResults),
    ),
  );
}

export function listenToTournamentLiveMatches(tournamentId, onNext, onError) {
  return onSnapshot(
    query(
      collection(db, "matches"),
      where("tournamentId", "==", tournamentId),
      where("status", "==", "live"),
      where("visibility", "==", "public"),
    ),
    onNext,
    onError,
  );
}
