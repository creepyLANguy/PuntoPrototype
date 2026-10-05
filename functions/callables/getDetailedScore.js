const { buildDetailedScoreData } = require("../services/analyticsService");
const { resolveCourtMatchId } = require("../services/matchService");
const { invalid } = require("../services/errors");

// Detailed score for a match, addressed directly or through the court it is
// (or was most recently) played on.
async function getDetailedScore(request) {
  const { courtId, matchId: requestedMatchId } = request.data || {};
  if (!courtId && !requestedMatchId) throw invalid("Missing courtId");

  const matchId = requestedMatchId || (await resolveCourtMatchId(courtId));
  const { payload } = await buildDetailedScoreData(matchId);
  return { ...payload, matchId: matchId || null };
}

module.exports = { getDetailedScore };
