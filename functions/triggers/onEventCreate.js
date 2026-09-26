const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { processScoreEvent } = require("../services/scoreService");
const { REGION } = require("../services/constants");

exports.onEventCreate = onDocumentCreated(
  {
    document: "courts/{courtId}/events/{eventId}",
    region: REGION,
    retry: true,
  },
  processScoreEvent,
);
