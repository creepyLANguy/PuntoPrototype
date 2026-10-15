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
import {
  assertCurrentAssignment,
  getAllocationId,
} from "./assignmentContext.js";

function assertResourceIds(data) {
  const payload = { ...data };
  for (const type of ["court", "club"]) {
    const id = data[`${type}Id`];
    if (id === undefined) continue;
    if (id !== null) {
      assertId(type, id);
      if (!getAllocationId(type, id)) {
        throw Object.assign(
          new Error(
            `The ${type} "${id}" was not found in the loaded ${type}s. Select an existing ${type}, or refresh the list and try again.`,
          ),
          { code: "assignment-not-found" },
        );
      }
    }
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
