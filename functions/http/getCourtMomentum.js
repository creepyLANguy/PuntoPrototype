const { prepareScoreApiRequest, extractScoreApiCourtId, momentumApiCache } = require("../services/publicApiService");
const { buildMomentumData } = require("../services/analyticsService");
function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function getCourtMomentum(req, res) {

    if (!prepareScoreApiRequest(req, res, 5)) {
      return;
    }

    try {
      const courtId = extractScoreApiCourtId(req.path);
      if (!courtId) {
        return sendJson(res, 400, {
          success: false,
          error: "Missing or invalid courtId. Use /momentum/{courtId}.",
        });
      }

      const cached = momentumApiCache.get(courtId);
      if (cached) {
        return sendJson(res, cached.status, cached.body);
      }

      const { courtExists, payload } = await buildMomentumData(courtId);

      if (!courtExists) {
        const notFoundBody = { success: false, error: "Court not found." };
        momentumApiCache.set(courtId, 404, notFoundBody);
        return sendJson(res, 404, notFoundBody);
      }

      const body = {
        success: true,
        courtId,
        ...payload,
        fetchedAt: new Date().toISOString(),
      };

      momentumApiCache.set(courtId, 200, body);
      return sendJson(res, 200, body);
    } catch (err) {
      console.error("getCourtMomentum failed:", err);
      res.set("Cache-Control", "no-store");
      return sendJson(res, 500, { success: false, error: "Error" });
    }
  
}

module.exports = { getCourtMomentum };
