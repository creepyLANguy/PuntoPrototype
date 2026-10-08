// Physical-device registrations: devices/{deviceId} -> { courtId }.
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
} from "./firestore.js";
import { db } from "./client.js";
import { assertId } from "../config/idContract.js";

function assertResourceIds(data) {
  for (const type of ["court", "club"]) {
    const id = data[`${type}Id`];
    if (id !== undefined && id !== null) assertId(type, id);
  }
}

export function getDevice(deviceId) {
  return getDoc(doc(db, "devices", deviceId));
}

export function getAllDevices() {
  return getDocs(collection(db, "devices"));
}

export function setDevice(deviceId, data) {
  assertResourceIds(data);
  return setDoc(doc(db, "devices", deviceId), data);
}

export function updateDevice(deviceId, data) {
  assertResourceIds(data);
  return updateDoc(doc(db, "devices", deviceId), data);
}

export function deleteDevice(deviceId) {
  return deleteDoc(doc(db, "devices", deviceId));
}
