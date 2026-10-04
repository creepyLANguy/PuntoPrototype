const {
  prepareScoreApiRequest,
  buildScoreResponse,
  extractScoreApiTarget,
} = require("../services/publicApiService");
function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function getCourtScoreRevision(req, res) {
  if (!prepareScoreApiRequest(req, res, 4)) {
    return;
  }

  try {
    const target = extractScoreApiTarget(req.path);
    if (!target) {
      return sendJson(res, 400, {
        success: false,
        error: "Missing or invalid id. Use /revision/{courtId} or /revision/match/{matchId}.",
      });
    }

    const { status, body } = await buildScoreResponse(target);

    if (status !== 200) {
      return sendJson(res, status, body);
    }

    return sendJson(res, 200, {
      success: true,
      courtId: body.courtId,
      matchId: body.matchId,
      revision: body.revision,
    });
  } catch (err) {
    console.error("getCourtScoreRevision failed:", err);
    res.set("Cache-Control", "no-store");
    return sendJson(res, 500, { success: false, error: "Error" });
  }
}

module.exports = { getCourtScoreRevision };
