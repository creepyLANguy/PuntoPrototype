// Cloud Function callables used by the web client (africa-south1).
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { app, useLocalEmulators } from "./client.js";
import { assertId, ID_LENGTHS } from "../config/idContract.js";
import {
  captureExpectedAllocations,
  rememberAssignment,
} from "./assignmentContext.js";

const functions = getFunctions(app, "africa-south1");

if (useLocalEmulators) {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}

function assertResourceIds(data) {
  for (const type of Object.keys(ID_LENGTHS)) {
    const id = data[`${type}Id`];
    if (id !== undefined && id !== null) assertId(type, id);
  }
  for (const field of ["courtIds", "courtPool", "selectedCourtIds"]) {
    if (Array.isArray(data[field])) {
      data[field].forEach((id) => assertId("court", id));
    }
  }
}

function fencedPayload(data, credentials = {}) {
  assertResourceIds(data);
  return {
    ...data,
    expectedAllocations: captureExpectedAllocations(data, credentials),
  };
}

function rememberResult(data) {
  if (data.view?.tournamentId) {
    rememberAssignment("tournament", data.view.tournamentId, data.view);
  }
  for (const match of data.liveMatches || []) {
    if (match.matchId && match.allocationId) {
      rememberAssignment("match", match.matchId, match);
    }
  }
  return data;
}

// Allocation and creation are one backend operation; never request an
// unreserved id and then write its document from the browser.
export async function createWithUniqueId(type, data = {}, credentials = {}) {
  if (!Object.hasOwn(ID_LENGTHS, type)) {
    throw new TypeError("Unknown resource id type.");
  }
  const fenced = fencedPayload(data, credentials);
  let callable;
  let payload;
  switch (type) {
    case "court":
      callable = "createCourt";
      payload = { ...fenced, credentials };
      break;
    case "club":
      callable = "createClub";
      payload = {
        ...fenced,
        ...(Object.keys(credentials).length ? { credentials } : {}),
      };
      break;
    case "tournament":
      callable = "manageTournament";
      payload = { ...fenced, operation: "createTournament", credentials };
      break;
    case "match":
      callable = "manageMatch";
      payload = {
        ...fenced,
        operation:
          data.operation === "ensureCourtMatch" ||
          data.operation === "newCourtMatch"
            ? data.operation
            : "createMatch",
        credentials,
      };
      break;
  }
  const result = await httpsCallable(functions, callable)(payload);
  const created = result?.data || {};
  assertId(type, created[`${type}Id`]);
  if (typeof created.allocationId !== "string" || !created.allocationId) {
    throw new TypeError(
      "The resource allocation is missing from the response.",
    );
  }
  rememberAssignment(type, created[`${type}Id`], created);
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
  const result = await resetFn(
    fencedPayload(
      {
        courtId,
        deepReset,
        newPassword,
        requirePassword,
        credentials,
      },
      credentials,
    ),
  );
  return result;
}

// Match lifecycle operations (start, move, detach, complete, cancel, reset,
// ensureCourtMatch ...). Returns the callable result data.
export async function manageMatch(operation, data = {}, credentials = {}) {
  if (
    operation === "createMatch" ||
    operation === "ensureCourtMatch" ||
    operation === "newCourtMatch"
  ) {
    return createWithUniqueId("match", { ...data, operation }, credentials);
  }
  const payload = fencedPayload(
    { operation, ...data, credentials },
    credentials,
  );
  const result = await httpsCallable(functions, "manageMatch")(payload);
  const received = rememberResult(result?.data || {});
  if (received.matchId && received.allocationId) {
    rememberAssignment("match", received.matchId, received);
  }
  return received;
}

// Tournament operations (create, generate, schedule, results ...).
export async function manageTournament(operation, data = {}, credentials = {}) {
  if (operation === "createTournament") {
    return createWithUniqueId("tournament", data, credentials);
  }
  const readOnly = [
    "listFormats",
    "getCourtOptions",
    "getTournamentView",
    "previewTournament",
    "verifyHost",
  ].includes(operation);
  if (
    data.allocationId !== undefined &&
    data.tournamentAllocationId === undefined
  ) {
    data = { ...data, tournamentAllocationId: data.allocationId };
  }
  const payload = readOnly
    ? { operation, ...data, credentials }
    : fencedPayload({ operation, ...data, credentials }, credentials);
  assertResourceIds(data);
  const result = await httpsCallable(functions, "manageTournament")(payload);
  const received = rememberResult(result?.data || {});
  if (received.view && data.tournamentId) {
    rememberAssignment("tournament", data.tournamentId, received.view);
  }
  if (received.matchId && received.allocationId) {
    rememberAssignment("match", received.matchId, received);
  }
  const tournamentAllocationId =
    received.tournamentAllocationId ||
    (!received.matchId ? received.allocationId : null);
  if (received.tournamentId && tournamentAllocationId) {
    rememberAssignment("tournament", received.tournamentId, {
      allocationId: tournamentAllocationId,
    });
  }
  return received;
}

export function changeoverCourt(payload) {
  assertId("court", payload.courtId);
  return httpsCallable(
    functions,
    "changeoverCourt",
  )(fencedPayload(payload, payload.credentials));
}

export function updateScoringOptions(payload) {
  assertResourceIds(payload);
  const updateScoringOptionsFn = httpsCallable(
    functions,
    "updateScoringOptions",
  );
  return updateScoringOptionsFn(fencedPayload(payload, payload.credentials));
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
  credentials = {},
  expectedAllocations,
  courtAllocationIds,
  clubAllocationIds,
}) {
  const data = await createWithUniqueId(
    "club",
    {
      name,
      state,
      courtIds,
      deviceIds,
      expectedAllocations,
      courtAllocationIds,
      clubAllocationIds,
    },
    credentials,
  );
  return { data };
}

export function updateClub({
  clubId,
  name,
  state,
  courtIds = [],
  deviceIds = [],
  allocationId,
  expectedAllocations,
  courtAllocationIds,
  clubAllocationIds,
  credentials = {},
}) {
  assertResourceIds({ clubId, courtIds });
  const payload = {
    clubId,
    name,
    courtIds,
    deviceIds,
    clubAllocationId: allocationId,
    expectedAllocations,
    courtAllocationIds,
    clubAllocationIds,
    credentials,
  };
  if (state !== undefined) payload.state = state;
  return httpsCallable(
    functions,
    "updateClub",
  )(fencedPayload(payload, credentials));
}

export function deleteClub(clubId, credentials = {}, allocationId) {
  assertId("club", clubId);
  return httpsCallable(
    functions,
    "deleteClub",
  )(
    fencedPayload(
      { clubId, clubAllocationId: allocationId, credentials },
      credentials,
    ),
  );
}

export function deleteCourt(courtId, credentials = {}, allocationId) {
  assertId("court", courtId);
  return httpsCallable(
    functions,
    "deleteCourt",
  )(
    fencedPayload(
      { courtId, courtAllocationId: allocationId, credentials },
      credentials,
    ),
  );
}
