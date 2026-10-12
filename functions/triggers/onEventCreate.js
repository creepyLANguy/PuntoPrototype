const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { processScoreEvent } = require("../services/scoreService");
const { REGION } = require("../services/constants");
const { withOperationScope } = require("../infrastructure/dataGuard");

exports.onEventCreate = onDocumentCreated(
  {
    document: "matches/{matchId}/events/{eventId}",
    region: REGION,
    retry: true,
  },
  withOperationScope(processScoreEvent),
);
