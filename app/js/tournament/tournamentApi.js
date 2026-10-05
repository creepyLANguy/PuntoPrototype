// Tournament operations from the browser. Every mutation goes through the
// server-authoritative manageTournament / manageMatch callables with this
// device's host key or the session admin key (spec section 41).
import { manageMatch, manageTournament } from "../firebase/callables.js";
import { getTournamentCredentials } from "../state/credentialsState.js";

// Firebase callable errors carry the server's user-safe message; anything
// else becomes a generic retry message (spec section 57).
export function friendlyError(error) {
  const message =
    typeof error?.message === "string"
      ? error.message.replace(/^\w+(-\w+)*:\s*/, "")
      : "";
  if (
    !message ||
    /internal/i.test(error?.code || "") ||
    /^internal$/i.test(message)
  ) {
    return "Something went wrong. Please retry.";
  }
  return message;
}

export function tournamentOperation(operation, tournamentId, data = {}) {
  return manageTournament(
    operation,
    { tournamentId, ...data },
    getTournamentCredentials(tournamentId),
  );
}

export function publicTournamentOperation(
  operation,
  data = {},
  credentials = {},
) {
  return manageTournament(operation, data, credentials);
}

export function matchOperation(operation, tournamentId, data = {}) {
  return manageMatch(operation, data, getTournamentCredentials(tournamentId));
}

let requestCounter = 0;

// Idempotency key for creation: a double tap re-sends the same key and the
// server returns the first tournament instead of creating a second.
export function newRequestId() {
  requestCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `req-${Date.now().toString(36)}-${requestCounter}-${random}`;
}
