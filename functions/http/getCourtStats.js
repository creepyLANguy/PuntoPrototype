const { prepareScoreApiRequest, extractScoreApiCourtId, statsApiCache } = require("../services/publicApiService");
const { buildDetailedScoreData } = require("../services/analyticsService");
function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function getCourtStats(req, res) {

    if (!prepareScoreApiRequest(req, res, 10)) {
      return;
    }

    try {
      const courtId = extractScoreApiCourtId(req.path);
      if (!courtId) {
        return sendJson(res, 400, {
          success: false,
          error: "Missing or invalid courtId. Use /stats/{courtId}.",
        });
      }

      const cached = statsApiCache.get(courtId);
      if (cached) {
        return sendJson(res, cached.status, cached.body);
      }

      const { courtExists, payload } = await buildDetailedScoreData(courtId);

      if (!courtExists) {
        const notFoundBody = { success: false, error: "Court not found." };
        statsApiCache.set(courtId, 404, notFoundBody);
        return sendJson(res, 404, notFoundBody);
      }

      const body = {
        success: true,
        courtId,
        ...payload,
        totalPoints: payload.advancedStats?.matchStats?.totalPoints ?? 0,
        fetchedAt: new Date().toISOString(),
      };

      statsApiCache.set(courtId, 200, body);
      return sendJson(res, 200, body);
    } catch (err) {
      console.error("getCourtStats failed:", err);
      res.set("Cache-Control", "no-store");
      return sendJson(res, 500, { success: false, error: "Error" });
    }
  
}

module.exports = { getCourtStats };
