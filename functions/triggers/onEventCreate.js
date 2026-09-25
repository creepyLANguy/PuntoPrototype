const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { processScoreEvent } = require("../services/scoreService");

exports.onEventCreate = onDocumentCreated(
  {
    document: "courts/{courtId}/events/{eventId}",
    region: "africa-south1",
    retry: true,
  },
  processScoreEvent,
);
