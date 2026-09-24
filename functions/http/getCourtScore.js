const { prepareScoreApiRequest, buildCourtScoreResponse, extractScoreApiCourtId } = require("../services/publicApiService");
function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function getCourtScore(req, res) {

    if (!prepareScoreApiRequest(req, res, 4)) {
      return;
    }

    try {
      const courtId = extractScoreApiCourtId(req.path);
      if (!courtId) {
        return sendJson(res, 400, {
          success: false,
          error: "Missing or invalid courtId. Use /score/{courtId}.",
        });
      }

      const { status, body } = await buildCourtScoreResponse(courtId);
      return sendJson(res, status, body);
    } catch (err) {
      console.error("getCourtScore failed:", err);
      res.set("Cache-Control", "no-store");
      return sendJson(res, 500, { success: false, error: "Error" });
    }
  
}

module.exports = { getCourtScore };
