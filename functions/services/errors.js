// Operation errors carry a stable code plus a message that is safe to show to
// a host or player (spec section 57). Internal failures never leak paths or
// stack traces to callers.
const https = require("firebase-functions/v2/https");

const CALLABLE_CODES = {
  INVALID_ARGUMENT: "invalid-argument",
  NOT_FOUND: "not-found",
  PERMISSION_DENIED: "permission-denied",
  FAILED_PRECONDITION: "failed-precondition",
  ALREADY_EXISTS: "already-exists",
  ABORTED: "aborted",
  UNAVAILABLE: "unavailable",
};

class OperationError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "OperationError";
    this.code = code;
    this.details = details;
  }
}

const invalid = (message, details) => new OperationError("INVALID_ARGUMENT", message, details);
const notFound = (message, details) => new OperationError("NOT_FOUND", message, details);
const denied = (message = "You are not allowed to do that.") =>
  new OperationError("PERMISSION_DENIED", message);
const precondition = (message, details) =>
  new OperationError("FAILED_PRECONDITION", message, details);
const conflict = (message, details) => new OperationError("ABORTED", message, details);
const staleGeneration = (path) =>
  new OperationError("ABORTED", "This record was replaced. Refresh and retry.", {
    code: "STALE_GENERATION",
    path,
  });
// Domain errors (MatchRuleError, TournamentDomainError) are rule violations
// with user-safe messages.
function toOperationError(error) {
  if (error instanceof OperationError) return error;
  if (error && (error.name === "MatchRuleError" || error.name === "TournamentDomainError")) {
    return new OperationError("FAILED_PRECONDITION", error.message, { rule: error.code });
  }
  return null;
}

function toCallableError(error) {
  const operationError = toOperationError(error);
  const HttpsError = https.HttpsError;

  if (!operationError) {
    console.error("Unexpected operation failure:", error);
    const message = "Something went wrong. Please retry.";
    return HttpsError
      ? new HttpsError("internal", message)
      : new OperationError("INTERNAL", message);
  }

  if (!HttpsError) return operationError;
  return new HttpsError(
    CALLABLE_CODES[operationError.code] || "failed-precondition",
    operationError.message,
    { code: operationError.code, ...(operationError.details || {}) },
  );
}

function wrapCallable(handler) {
  return async (request) => {
    try {
      return await handler(request);
    } catch (error) {
      throw toCallableError(error);
    }
  };
}

// For handlers that keep their own error contract, map retryable operation
// errors to callable errors.
function mapRetryableErrors(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof OperationError && ["UNAVAILABLE", "ABORTED"].includes(error.code)) {
        throw toCallableError(error);
      }
      throw error;
    }
  };
}

module.exports = {
  OperationError,
  mapRetryableErrors,
  invalid,
  notFound,
  denied,
  precondition,
  conflict,
  staleGeneration,
  toOperationError,
  toCallableError,
  wrapCallable,
};
