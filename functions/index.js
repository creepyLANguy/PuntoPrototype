const { onCall, onRequest } = require("firebase-functions/v2/https");

const { onEventCreate } = require("./triggers/onEventCreate");
const { resetCourt } = require("./callables/resetCourt");
const { updateScoringOptions } = require("./callables/updateScoringOptions");
const { getDetailedScore } = require("./callables/getDetailedScore");

const { REGION } = require("./services/constants");
const { postEvent } = require("./http/postEvent");
const { getCourtScore } = require("./http/getCourtScore");
const { getCourtScoreRevision } = require("./http/getCourtScoreRevision");
const { getCourtStats } = require("./http/getCourtStats");
const { getCourtMomentum } = require("./http/getCourtMomentum");

exports.onEventCreate = onEventCreate;

exports.resetCourt = onCall({ region: REGION }, resetCourt);
exports.updateScoringOptions = onCall({ region: REGION }, updateScoringOptions);
exports.getDetailedScore = onCall({ region: REGION }, getDetailedScore);

exports.postEvent = onRequest({ region: REGION }, postEvent);

exports.getCourtScore = onRequest({ region: REGION, maxInstances: 2 }, getCourtScore);

exports.getCourtScoreRevision = onRequest(
  { region: REGION, maxInstances: 2 },
  getCourtScoreRevision,
);

exports.getCourtStats = onRequest({ region: REGION, maxInstances: 2 }, getCourtStats);

exports.getCourtMomentum = onRequest({ region: REGION, maxInstances: 2 }, getCourtMomentum);
