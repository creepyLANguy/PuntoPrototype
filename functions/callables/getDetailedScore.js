const { buildDetailedScoreData } = require("../services/analyticsService");

async function getDetailedScore(request) {
  const { courtId } = request.data;
  if (!courtId) throw new Error("Missing courtId");

  const { payload } = await buildDetailedScoreData(courtId);
  return payload;
}

module.exports = { getDetailedScore };
