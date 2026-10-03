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
