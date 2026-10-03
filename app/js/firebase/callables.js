// Cloud Function callables used by the web client (africa-south1).
import
{
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

import { app } from "./client.js";

const functions = getFunctions(app, "africa-south1");

export async function resetCourt(courtId, deepReset = false, newPassword = null, requirePassword = false)
{
  const resetFn = httpsCallable(functions, "resetCourt");
  const result = await resetFn({ courtId, deepReset, newPassword, requirePassword });
  return result;
}

export const changeoverCourt = httpsCallable(functions, "changeoverCourt");

export function updateScoringOptions(payload)
{
  const updateScoringOptionsFn = httpsCallable(functions, "updateScoringOptions");
  return updateScoringOptionsFn(payload);
}

export function getDetailedScore(payload)
{
  const getDetailedScoreFn = httpsCallable(functions, "getDetailedScore");
  return getDetailedScoreFn(payload);
}

// Clubs. Each call returns { clubId, name, courtIds, deviceIds, moved } where
// moved lists the courts and devices taken over from other clubs.
export function createClub({ name, courtIds = [], deviceIds = [] })
{
  return httpsCallable(functions, "createClub")({ name, courtIds, deviceIds });
}

export function updateClub({ clubId, name, courtIds = [], deviceIds = [] })
{
  return httpsCallable(functions, "updateClub")({ clubId, name, courtIds, deviceIds });
}

export function deleteClub(clubId)
{
  return httpsCallable(functions, "deleteClub")({ clubId });
}
