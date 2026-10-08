// Tournament read models: tournamentViews/{tournamentId} is the compact,
// server-derived view the public and host pages render from. Tournaments are
// only changed through the manageTournament callable.
import {
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  collection,
  query,
  where,
  limit,
} from "./firestore.js";
import { db } from "./client.js";
import { assertId } from "../config/idContract.js";

export function listenToTournamentView(tournamentId, onNext, onError) {
  assertId("tournament", tournamentId);
  return onSnapshot(doc(db, "tournamentViews", tournamentId), onNext, onError);
}

// Every tournament document (admin list). Tournament documents hold no
// secrets; host keys live in tournamentSecrets, which clients cannot read.
export function getAllTournaments() {
  return getDocs(collection(db, "tournaments"));
}

export function getTournamentDirectoryEntry(tournamentId) {
  assertId("tournament", tournamentId);
  return getDoc(doc(db, "tournamentDirectory", tournamentId));
}

// Small public directory entries ({ tournamentId, name, status, clubName,
// formatLabel }) for search and discovery.
export function getTournamentDirectory(maxResults = 200) {
  return getDocs(
    query(
      collection(db, "tournamentDirectory"),
      where("visibility", "==", "public"),
      limit(maxResults),
    ),
  );
}
