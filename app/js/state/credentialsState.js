// Credentials sent with server-authoritative operations. There are no user
// accounts: the admin key unlocked this session, tournament host keys kept on
// this device, and the password of the court currently open.
import {
  ACCESS_CODES_STORAGE_KEY,
  ADMIN_KEY_STORAGE_KEY,
  HOST_KEYS_STORAGE_KEY,
} from "../config/constants.js";
import { session } from "./sessionState.js";

export function getAdminKey() {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setAdminKey(adminKey) {
  try {
    if (adminKey) sessionStorage.setItem(ADMIN_KEY_STORAGE_KEY, adminKey);
    else sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
  } catch (storageError) {
    console.warn(
      "Unable to store the admin key for this session.",
      storageError,
    );
  }
}

function readHostKeys() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(HOST_KEYS_STORAGE_KEY) || "{}",
    );
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getHostKey(tournamentId) {
  return tournamentId ? readHostKeys()[tournamentId] || null : null;
}

export function rememberHostKey(tournamentId, hostKey) {
  if (!tournamentId || !hostKey) return;
  const keys = readHostKeys();
  keys[tournamentId] = hostKey;
  try {
    localStorage.setItem(HOST_KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch (storageError) {
    console.warn("Unable to remember the tournament host key.", storageError);
  }
}

export function forgetHostKey(tournamentId) {
  const keys = readHostKeys();
  delete keys[tournamentId];
  try {
    localStorage.setItem(HOST_KEYS_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

export function listHostedTournamentIds() {
  return Object.keys(readHostKeys());
}

// Access codes of private tournaments created on this device, so the host
// can share them again (the server only keeps a hash).
export function rememberAccessCode(tournamentId, accessCode) {
  if (!tournamentId || !accessCode) return;
  try {
    const codes = JSON.parse(
      localStorage.getItem(ACCESS_CODES_STORAGE_KEY) || "{}",
    );
    codes[tournamentId] = accessCode;
    localStorage.setItem(ACCESS_CODES_STORAGE_KEY, JSON.stringify(codes));
  } catch (storageError) {
    console.warn("Unable to remember the access code.", storageError);
  }
}

export function getAccessCode(tournamentId) {
  try {
    return (
      JSON.parse(localStorage.getItem(ACCESS_CODES_STORAGE_KEY) || "{}")[
        tournamentId
      ] || null
    );
  } catch {
    return null;
  }
}

export function getCourtCredentials() {
  return {
    courtPassword: session.currentCourtPassword || null,
    adminKey: getAdminKey(),
  };
}

export function getTournamentCredentials(tournamentId) {
  return {
    hostKey: getHostKey(tournamentId),
    adminKey: getAdminKey(),
  };
}
