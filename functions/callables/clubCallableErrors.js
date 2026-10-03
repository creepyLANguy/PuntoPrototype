const { HttpsError } = require("firebase-functions/v2/https");
const { ClubError } = require("../domain/clubs/membership");

// Runs a club operation and reports club errors to the client with their code
// and message (other errors stay internal, as for every other callable).
async function runClubOperation(operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ClubError) {
      throw new HttpsError(error.code, error.message);
    }
    throw error;
  }
}

module.exports = { runClubOperation };
