import { ADMIN_LOGOUT_SIGNAL_KEY, ADMIN_SESSION_STORAGE_KEY } from "../config/constants.js";
import { appState } from "./appState.js";

// Admin session persistence: the unlocked flag lives in sessionStorage, and a
// logout is broadcast to other tabs through a localStorage signal.

export function hasAdminSession()
{
  try
  {
    return sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === "true";
  }
  catch
  {
    return false;
  }
}

export function clearAdminSession()
{
  try
  {
    sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  }
  catch (storageError)
  {
    console.warn("Unable to clear admin session state.", storageError);
  }
}

function broadcastAdminLogout()
{
  try
  {
    localStorage.setItem(ADMIN_LOGOUT_SIGNAL_KEY, String(Date.now()));
  }
  catch (storageError)
  {
    console.warn("Unable to broadcast admin logout.", storageError);
  }
}

export function endAdminSession()
{
  clearAdminSession();
  broadcastAdminLogout();
  appState.isAdmin = false;
}

export function initAdminSession()
{
  appState.isAdmin = hasAdminSession();
}
