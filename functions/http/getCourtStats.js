const {
  prepareScoreApiRequest,
  extractScoreApiTarget,
  resolveScoreTarget,
  targetCacheKey,
  statsApiCache,
  syncApiCacheGeneration,
} = require("../services/publicApiService");
const { buildDetailedScoreData } = require("../services/analyticsService");
function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function getCourtStats(req, res) {
  if (!prepareScoreApiRequest(req, res, 10)) {
    return;
  }

  try {
    const target = extractScoreApiTarget(req.path);
    if (!target) {
      return sendJson(res, 400, {
        success: false,
        error: "Missing or invalid id. Use /stats/{courtId} or /stats/match/{matchId}.",
      });
    }

    await syncApiCacheGeneration();
    const cacheKey = targetCacheKey(target);
    const cached = statsApiCache.get(cacheKey);
    if (cached) {
      return sendJson(res, cached.status, cached.body);
    }

    const resolved = await resolveScoreTarget(target);
    if (resolved.notFound) {
      const notFoundBody = { success: false, error: resolved.notFound };
      statsApiCache.set(cacheKey, 404, notFoundBody);
      return sendJson(res, 404, notFoundBody);
    }

    const { payload } = await buildDetailedScoreData(resolved.match?.matchId || null);

    const body = {
      success: true,
      courtId: resolved.court?.courtId || resolved.match?.currentCourtId || null,
      matchId: resolved.match?.matchId || null,
      ...payload,
      totalPoints: payload.advancedStats?.matchStats?.totalPoints ?? 0,
      fetchedAt: new Date().toISOString(),
    };

    statsApiCache.set(cacheKey, 200, body);
    return sendJson(res, 200, body);
  } catch (err) {
    console.error("getCourtStats failed:", err);
    res.set("Cache-Control", "no-store");
    return sendJson(res, 500, { success: false, error: "Error" });
  }
}

module.exports = { getCourtStats };
