const {
  prepareScoreApiRequest,
  extractScoreApiTarget,
  resolveScoreTarget,
  targetCacheKey,
  momentumApiCache,
} = require("../services/publicApiService");
const { buildMomentumData } = require("../services/analyticsService");
function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function getCourtMomentum(req, res) {
  if (!prepareScoreApiRequest(req, res, 5)) {
    return;
  }

  try {
    const target = extractScoreApiTarget(req.path);
    if (!target) {
      return sendJson(res, 400, {
        success: false,
        error: "Missing or invalid id. Use /momentum/{courtId} or /momentum/match/{matchId}.",
      });
    }

    const cacheKey = targetCacheKey(target);
    const cached = momentumApiCache.get(cacheKey);
    if (cached) {
      return sendJson(res, cached.status, cached.body);
    }

    const resolved = await resolveScoreTarget(target);
    if (resolved.notFound) {
      const notFoundBody = { success: false, error: resolved.notFound };
      momentumApiCache.set(cacheKey, 404, notFoundBody);
      return sendJson(res, 404, notFoundBody);
    }

    const { payload } = await buildMomentumData(resolved.match?.matchId || null);

    const body = {
      success: true,
      courtId: resolved.court?.courtId || resolved.match?.currentCourtId || null,
      matchId: resolved.match?.matchId || null,
      ...payload,
      fetchedAt: new Date().toISOString(),
    };

    momentumApiCache.set(cacheKey, 200, body);
    return sendJson(res, 200, body);
  } catch (err) {
    console.error("getCourtMomentum failed:", err);
    res.set("Cache-Control", "no-store");
    return sendJson(res, 500, { success: false, error: "Error" });
  }
}

module.exports = { getCourtMomentum };
