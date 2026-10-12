// Court documents: courts/{courtId}, its live score (score/current) and its
// event log (events). Functions return the SDK snapshots unchanged so callers
// keep the exact Firestore semantics (exists(), id, data()).
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp,
} from "./firestore.js";
import { db } from "./client.js";
import { assertId } from "../config/idContract.js";
import {
  assertCurrentAssignment,
  rememberQuerySnapshot,
  rememberSnapshot,
} from "./assignmentContext.js";
import { deleteCourt as deleteCourtCallable } from "./callables.js";

export function getCourt(courtId) {
  assertId("court", courtId);
  return getDoc(doc(db, "courts", courtId)).then((snap) =>
    rememberSnapshot("court", courtId, snap),
  );
}

export function getAllCourts() {
  return getDocs(collection(db, "courts")).then((snap) =>
    rememberQuerySnapshot("court", snap),
  );
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
  const allocationId = assertCurrentAssignment(
    "court",
    courtId,
    data.allocationId,
  );
  const payload = { ...data, allocationId };
  for (const field of ["activeMatch", "lastMatch"]) {
    const matchId = data[`${field}Id`];
    if (matchId !== undefined) {
      payload[`${field}AllocationId`] =
        matchId === null
          ? null
          : assertCurrentAssignment(
              "match",
              matchId,
              data[`${field}AllocationId`],
            );
    }
  }
  if (data.clubId !== undefined) {
    payload.clubAllocationId =
      data.clubId === null
        ? null
        : assertCurrentAssignment("club", data.clubId, data.clubAllocationId);
  }
  return updateDoc(doc(db, "courts", courtId), payload);
}

export function deleteCourt(courtId, credentials = {}, allocationId) {
  assertId("court", courtId);
  return deleteCourtCallable(courtId, credentials, allocationId);
}

export function listenToCourtDocument(courtId, onNext, onError) {
  assertId("court", courtId);
  return onSnapshot(
    doc(db, "courts", courtId),
    (snap) => onNext(rememberSnapshot("court", courtId, snap)),
    onError,
  );
}

export function getCourtScore(courtId) {
  assertId("court", courtId);
  return getDoc(doc(db, "courts", courtId, "score", "current"));
}

export function setCourtScore(courtId, score) {
  assertId("court", courtId);
  return setDoc(doc(db, "courts", courtId, "score", "current"), {
    ...score,
    allocationId: assertCurrentAssignment("court", courtId, score.allocationId),
  });
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
    allocationId: assertCurrentAssignment(
      "court",
      courtId,
      fields.allocationId,
    ),
  });
}
