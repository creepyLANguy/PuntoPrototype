const { HttpsError } = require("firebase-functions/v2/https");
const { ClubError } = require("../domain/clubs/membership");
const { OperationError, toCallableError } = require("../services/errors");

// Runs a club operation and reports club errors to the client with their code
// and message. Operation errors (maintenance, stale generation) map like every
// other callable; anything else stays internal.
async function runClubOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ClubError) {
      throw new HttpsError(error.code, error.message);
    }
    if (error instanceof OperationError) throw toCallableError(error);
    throw error;
  }
}

module.exports = { runClubOperation };
