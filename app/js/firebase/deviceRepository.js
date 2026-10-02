// Physical-device registrations: devices/{deviceId} -> { courtId }.
import
{
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection
} from "./firestore.js";
import { db } from "./client.js";

export function getDevice(deviceId)
{
  return getDoc(doc(db, "devices", deviceId));
}

export function getAllDevices()
{
  return getDocs(collection(db, "devices"));
}

export function setDevice(deviceId, data)
{
  return setDoc(doc(db, "devices", deviceId), data);
}

export function updateDevice(deviceId, data)
{
  return updateDoc(doc(db, "devices", deviceId), data);
}

export function deleteDevice(deviceId)
{
  return deleteDoc(doc(db, "devices", deviceId));
}
