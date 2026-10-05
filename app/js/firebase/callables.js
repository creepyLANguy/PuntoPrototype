// Cloud Function callables used by the web client (africa-south1).
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { app, useLocalEmulators } from "./client.js";

const functions = getFunctions(app, "africa-south1");

if (useLocalEmulators) {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

export async function resetCourt(
  courtId,
  deepReset = false,
  newPassword = null,
  requirePassword = false,
  credentials = {},
) {
  const resetFn = httpsCallable(functions, "resetCourt");
  const result = await resetFn({
    courtId,
    deepReset,
    newPassword,
    requirePassword,
    credentials,
  });
  return result;
}

// Match lifecycle operations (start, move, detach, complete, cancel, reset,
// ensureCourtMatch ...). Returns the callable result data.
export async function manageMatch(operation, data = {}, credentials = {}) {
  const result = await httpsCallable(
    functions,
    "manageMatch",
  )({ operation, ...data, credentials });
  return result?.data || {};
}

// Tournament operations (create, generate, schedule, results ...).
export async function manageTournament(operation, data = {}, credentials = {}) {
  const result = await httpsCallable(
    functions,
    "manageTournament",
  )({ operation, ...data, credentials });
  return result?.data || {};
}

export const changeoverCourt = httpsCallable(functions, "changeoverCourt");

export function updateScoringOptions(payload) {
  const updateScoringOptionsFn = httpsCallable(
    functions,
    "updateScoringOptions",
  );
  return updateScoringOptionsFn(payload);
}

export function getDetailedScore(payload) {
  const getDetailedScoreFn = httpsCallable(functions, "getDetailedScore");
  return getDetailedScoreFn(payload);
}

// Clubs. Each call returns { clubId, name, courtIds, deviceIds, moved } where
// moved lists the courts and devices taken over from other clubs.
export function createClub({
  name,
  state = "maintenance",
  courtIds = [],
  deviceIds = [],
}) {
  return httpsCallable(functions, "createClub")({
    name,
    state,
    courtIds,
    deviceIds,
  });
}

export function updateClub({
  clubId,
  name,
  state = "maintenance",
  courtIds = [],
  deviceIds = [],
}) {
  return httpsCallable(
    functions,
    "updateClub",
  )({ clubId, name, state, courtIds, deviceIds });
}

export function deleteClub(clubId) {
  return httpsCallable(functions, "deleteClub")({ clubId });
}
