// Court documents: courts/{courtId}, its live score (score/current) and its
// event log (events). Functions return the SDK snapshots unchanged so callers
// keep the exact Firestore semantics (exists(), id, data()).
import
{
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  addDoc,
  serverTimestamp
} from "./firestore.js";
import { db } from "./client.js";

export function getCourt(courtId)
{
  return getDoc(doc(db, "courts", courtId));
}

export function getAllCourts()
{
  return getDocs(collection(db, "courts"));
}

// createdAt is always the server timestamp, written immediately after the
// password exactly as the court document has always been laid out.
export function createCourt(courtId, { name, password, ...court })
{
  return setDoc(doc(db, "courts", courtId), {
    name,
    password,
    createdAt: serverTimestamp(),
    ...court
  });
}

export function updateCourt(courtId, data)
{
  return updateDoc(doc(db, "courts", courtId), data);
}

export function deleteCourt(courtId)
{
  return deleteDoc(doc(db, "courts", courtId));
}

export function listenToCourtDocument(courtId, onNext, onError)
{
  return onSnapshot(doc(db, "courts", courtId), onNext, onError);
}

export function getCourtScore(courtId)
{
  return getDoc(doc(db, "courts", courtId, "score", "current"));
}

export function setCourtScore(courtId, score)
{
  return setDoc(doc(db, "courts", courtId, "score", "current"), score);
}

export function listenToCourtScore(courtId, onNext, onError)
{
  return onSnapshot(doc(db, "courts", courtId, "score", "current"), onNext, onError);
}

// Score events are processed by the onEventCreate Cloud Function.
export function addCourtEvent(courtId, { eventType, createdBy, ...fields })
{
  return addDoc(
    collection(db, "courts", courtId, "events"),
    {
      eventType,
      createdAt: serverTimestamp(),
      createdBy,
      ...fields
    }
  );
}
