const { onCall, onRequest } = require("firebase-functions/v2/https");

const { onEventCreate } = require("./triggers/onEventCreate");
const { onCourtDeleted, onDeviceDeleted } = require("./triggers/onClubMemberDeleted");
const { resetCourt } = require("./callables/resetCourt");
const { changeoverCourt } = require("./callables/changeoverCourt");
const { updateScoringOptions } = require("./callables/updateScoringOptions");
const { getDetailedScore } = require("./callables/getDetailedScore");
const { createClub } = require("./callables/createClub");
const { createCourt } = require("./callables/createCourt");
const { updateClub } = require("./callables/updateClub");
const { deleteClub } = require("./callables/deleteClub");
const { manageMatch } = require("./callables/manageMatch");
const { manageTournament } = require("./callables/manageTournament");
const { wrapCallable } = require("./services/errors");

const { REGION } = require("./services/constants");
const { postEvent } = require("./http/postEvent");
const { getCourtScore } = require("./http/getCourtScore");
const { getCourtScoreRevision } = require("./http/getCourtScoreRevision");
const { getCourtStats } = require("./http/getCourtStats");
const { getCourtMomentum } = require("./http/getCourtMomentum");

exports.onEventCreate = onEventCreate;
exports.onCourtDeleted = onCourtDeleted;
exports.onDeviceDeleted = onDeviceDeleted;

exports.resetCourt = onCall({ region: REGION }, wrapCallable(resetCourt));
exports.changeoverCourt = onCall({ region: REGION }, changeoverCourt);
exports.updateScoringOptions = onCall({ region: REGION }, wrapCallable(updateScoringOptions));
exports.getDetailedScore = onCall({ region: REGION }, wrapCallable(getDetailedScore));
exports.manageMatch = onCall({ region: REGION }, wrapCallable(manageMatch));
exports.manageTournament = onCall({ region: REGION }, wrapCallable(manageTournament));
exports.createClub = onCall({ region: REGION }, createClub);
exports.createCourt = onCall({ region: REGION }, wrapCallable(createCourt));
exports.updateClub = onCall({ region: REGION }, updateClub);
exports.deleteClub = onCall({ region: REGION }, deleteClub);

exports.postEvent = onRequest({ region: REGION, invoker: "public" }, postEvent);

exports.getCourtScore = onRequest(
  { region: REGION, maxInstances: 2, invoker: "public" },
  getCourtScore,
);

exports.getCourtScoreRevision = onRequest(
  { region: REGION, maxInstances: 2, invoker: "public" },
  getCourtScoreRevision,
);

exports.getCourtStats = onRequest(
  { region: REGION, maxInstances: 2, invoker: "public" },
  getCourtStats,
);

exports.getCourtMomentum = onRequest(
  { region: REGION, maxInstances: 2, invoker: "public" },
  getCourtMomentum,
);
