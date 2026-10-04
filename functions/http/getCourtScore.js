const {
  prepareScoreApiRequest,
  buildScoreResponse,
  extractScoreApiTarget,
} = require("../services/publicApiService");
function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function getCourtScore(req, res) {
  if (!prepareScoreApiRequest(req, res, 4)) {
    return;
  }

  try {
    const target = extractScoreApiTarget(req.path);
    if (!target) {
      return sendJson(res, 400, {
        success: false,
        error: "Missing or invalid id. Use /score/{courtId} or /score/match/{matchId}.",
      });
    }

    const { status, body } = await buildScoreResponse(target);
    return sendJson(res, status, body);
  } catch (err) {
    console.error("getCourtScore failed:", err);
    res.set("Cache-Control", "no-store");
    return sendJson(res, 500, { success: false, error: "Error" });
  }
}

module.exports = { getCourtScore };
