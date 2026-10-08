// Cloud Function callables used by the web client (africa-south1).
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { app, useLocalEmulators } from "./client.js";
import { assertId, ID_LENGTHS } from "../config/idContract.js";

const functions = getFunctions(app, "africa-south1");

if (useLocalEmulators) {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

function assertResourceIds(data) {
  for (const type of Object.keys(ID_LENGTHS)) {
    const id = data[`${type}Id`];
    if (id !== undefined && id !== null) assertId(type, id);
  }
  if (Array.isArray(data.courtIds)) {
    data.courtIds.forEach((id) => assertId("court", id));
  }
}

// Allocation and creation are one backend operation; never request an
// unreserved id and then write its document from the browser.
export async function createWithUniqueId(type, data = {}, credentials = {}) {
  if (!Object.hasOwn(ID_LENGTHS, type)) {
    throw new TypeError("Unknown resource id type.");
  }
  assertResourceIds(data);
  let callable;
  let payload;
  switch (type) {
    case "court":
      callable = "createCourt";
      payload = { ...data, credentials };
      break;
    case "club":
      callable = "createClub";
      payload = {
        ...data,
        ...(Object.keys(credentials).length ? { credentials } : {}),
      };
      break;
    case "tournament":
      callable = "manageTournament";
      payload = { ...data, operation: "createTournament", credentials };
      break;
    case "match":
      callable = "manageMatch";
      payload = {
        ...data,
        operation:
          data.operation === "ensureCourtMatch"
            ? "ensureCourtMatch"
            : "createMatch",
        credentials,
      };
      break;
  }
  const result = await httpsCallable(functions, callable)(payload);
  const created = result?.data || {};
  assertId(type, created[`${type}Id`]);
  return created;
}

export async function resetCourt(
  courtId,
  deepReset = false,
  newPassword = null,
  requirePassword = false,
  credentials = {},
) {
  assertId("court", courtId);
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
  if (operation === "createMatch" || operation === "ensureCourtMatch") {
    return createWithUniqueId("match", { ...data, operation }, credentials);
  }
  assertResourceIds(data);
  const result = await httpsCallable(
    functions,
    "manageMatch",
  )({ operation, ...data, credentials });
  return result?.data || {};
}

// Tournament operations (create, generate, schedule, results ...).
export async function manageTournament(operation, data = {}, credentials = {}) {
  if (operation === "createTournament") {
    return createWithUniqueId("tournament", data, credentials);
  }
  assertResourceIds(data);
  const result = await httpsCallable(
    functions,
    "manageTournament",
  )({ operation, ...data, credentials });
  return result?.data || {};
}

export function changeoverCourt(payload) {
  assertId("court", payload.courtId);
  return httpsCallable(functions, "changeoverCourt")(payload);
}

export function updateScoringOptions(payload) {
  assertResourceIds(payload);
  const updateScoringOptionsFn = httpsCallable(
    functions,
    "updateScoringOptions",
  );
  return updateScoringOptionsFn(payload);
}

export function getDetailedScore(payload) {
  assertResourceIds(payload);
  const getDetailedScoreFn = httpsCallable(functions, "getDetailedScore");
  return getDetailedScoreFn(payload);
}

// Clubs. Each call returns { clubId, name, courtIds, deviceIds, moved } where
// moved lists the courts and devices taken over from other clubs.
export async function createClub({
  name,
  state = "maintenance",
  courtIds = [],
  deviceIds = [],
}) {
  const data = await createWithUniqueId("club", {
    name,
    state,
    courtIds,
    deviceIds,
  });
  return { data };
}

export function updateClub({
  clubId,
  name,
  state,
  courtIds = [],
  deviceIds = [],
}) {
  assertResourceIds({ clubId, courtIds });
  const payload = { clubId, name, courtIds, deviceIds };
  if (state !== undefined) payload.state = state;
  return httpsCallable(functions, "updateClub")(payload);
}

export function deleteClub(clubId) {
  assertId("club", clubId);
  return httpsCallable(functions, "deleteClub")({ clubId });
}
