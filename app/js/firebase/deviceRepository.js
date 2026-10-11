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
import { assertCurrentAssignment } from "./assignmentContext.js";

function assertResourceIds(data) {
  const payload = { ...data };
  for (const type of ["court", "club"]) {
    const id = data[`${type}Id`];
    if (id === undefined) continue;
    if (id !== null) assertId(type, id);
    payload[`${type}AllocationId`] =
      id === null
        ? null
        : assertCurrentAssignment(type, id, data[`${type}AllocationId`]);
  }
  return payload;
}

export function getDevice(deviceId) {
  return getDoc(doc(db, "devices", deviceId));
}

export function getAllDevices() {
  return getDocs(collection(db, "devices"));
}

export function setDevice(deviceId, data) {
  return setDoc(doc(db, "devices", deviceId), assertResourceIds(data));
}

export function updateDevice(deviceId, data) {
  return updateDoc(doc(db, "devices", deviceId), assertResourceIds(data));
}

export function deleteDevice(deviceId) {
  return deleteDoc(doc(db, "devices", deviceId));
}
