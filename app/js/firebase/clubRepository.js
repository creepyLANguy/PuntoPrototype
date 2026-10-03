// Club documents: clubs/{clubId} -> { name, courtIds, deviceIds }. Reads only;
// clubs are created, changed and deleted through the club callables so that
// court and device membership stays consistent (see callables.js).
import { collection, doc, getDoc, getDocs } from "./firestore.js";
import { db } from "./client.js";

export function getAllClubs()
{
  return getDocs(collection(db, "clubs"));
}

export function getClub(clubId)
{
  return getDoc(doc(db, "clubs", clubId));
}
