// Court documents: courts/{courtId}, its live score (score/current) and its
// event log (events). Functions return the SDK snapshots unchanged so callers
// keep the exact Firestore semantics (exists(), id, data()).
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
} from "./firestore.js";
import { db } from "./client.js";
import { assertId } from "../config/idContract.js";

export function getCourt(courtId) {
  assertId("court", courtId);
  return getDoc(doc(db, "courts", courtId));
}

export function getAllCourts() {
  return getDocs(collection(db, "courts"));
}

export function updateCourt(courtId, data) {
  assertId("court", courtId);
  for (const field of ["activeMatchId", "lastMatchId"]) {
    if (data[field] !== undefined && data[field] !== null) {
      assertId("match", data[field]);
    }
  }
  if (data.clubId !== undefined && data.clubId !== null)
    assertId("club", data.clubId);
  return updateDoc(doc(db, "courts", courtId), data);
}

export function deleteCourt(courtId) {
  assertId("court", courtId);
  return deleteDoc(doc(db, "courts", courtId));
}

export function listenToCourtDocument(courtId, onNext, onError) {
  assertId("court", courtId);
  return onSnapshot(doc(db, "courts", courtId), onNext, onError);
}

export function getCourtScore(courtId) {
  assertId("court", courtId);
  return getDoc(doc(db, "courts", courtId, "score", "current"));
}

export function setCourtScore(courtId, score) {
  assertId("court", courtId);
  return setDoc(doc(db, "courts", courtId, "score", "current"), score);
}

export function listenToCourtScore(courtId, onNext, onError) {
  assertId("court", courtId);
  return onSnapshot(
    doc(db, "courts", courtId, "score", "current"),
    onNext,
    onError,
  );
}

// Score events are processed by the onEventCreate Cloud Function.
export function addCourtEvent(courtId, { eventType, createdBy, ...fields }) {
  assertId("court", courtId);
  return addDoc(collection(db, "courts", courtId, "events"), {
    eventType,
    createdAt: serverTimestamp(),
    createdBy,
    ...fields,
  });
}
