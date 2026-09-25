const {
  prepareScoreApiRequest,
  buildCourtScoreResponse,
  extractScoreApiCourtId,
} = require("../services/publicApiService");
function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function getCourtScoreRevision(req, res) {
  if (!prepareScoreApiRequest(req, res, 4)) {
    return;
  }

  try {
    const courtId = extractScoreApiCourtId(req.path);
    if (!courtId) {
      return sendJson(res, 400, {
        success: false,
        error: "Missing or invalid courtId. Use /revision/{courtId}.",
      });
    }

    const { status, body } = await buildCourtScoreResponse(courtId);

    if (status !== 200) {
      return sendJson(res, status, body);
    }

    return sendJson(res, 200, {
      success: true,
      courtId,
      revision: body.revision,
    });
  } catch (err) {
    console.error("getCourtScoreRevision failed:", err);
    res.set("Cache-Control", "no-store");
    return sendJson(res, 500, { success: false, error: "Error" });
  }
}

module.exports = { getCourtScoreRevision };
