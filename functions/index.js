const { onCall, onRequest } = require("firebase-functions/v2/https");

const { onEventCreate } = require("./triggers/onEventCreate");
const { onCourtDeleted, onDeviceDeleted } = require("./triggers/onClubMemberDeleted");
const { withOperationScope } = require("./infrastructure/dataGuard");
const { db } = require("./infrastructure/firebase");
const { readCredentials, requireAdmin } = require("./services/authService");
const { validateId } = require("./services/ids");
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
const { wrapCallable, mapRetryableErrors } = require("./services/errors");

const { REGION } = require("./services/constants");
const { postEvent } = require("./http/postEvent");
const { getCourtScore } = require("./http/getCourtScore");
const { getCourtScoreRevision } = require("./http/getCourtScoreRevision");
const { getCourtStats } = require("./http/getCourtStats");
const { getCourtMomentum } = require("./http/getCourtMomentum");

// Every handler runs in its own operation scope so the guarded Firestore can
// fence its writes against ID generations it observed (see dataGuard.js).
const scoped = withOperationScope;

// Trigger modules scope their own handlers (wrapping the CloudFunction here
// would drop its deployment metadata).
exports.onEventCreate = onEventCreate;
exports.onCourtDeleted = onCourtDeleted;
exports.onDeviceDeleted = onDeviceDeleted;

exports.resetCourt = onCall({ region: REGION }, scoped(wrapCallable(resetCourt)));
exports.changeoverCourt = onCall({ region: REGION }, scoped(mapRetryableErrors(changeoverCourt)));
exports.updateScoringOptions = onCall(
  { region: REGION },
  scoped(wrapCallable(updateScoringOptions)),
);
exports.getDetailedScore = onCall({ region: REGION }, scoped(wrapCallable(getDetailedScore)));
exports.manageMatch = onCall({ region: REGION }, scoped(wrapCallable(manageMatch)));
exports.manageTournament = onCall({ region: REGION }, scoped(wrapCallable(manageTournament)));
exports.createClub = onCall({ region: REGION }, scoped(createClub));
exports.createCourt = onCall({ region: REGION }, scoped(wrapCallable(createCourt)));
exports.updateClub = onCall({ region: REGION }, scoped(updateClub));
exports.deleteClub = onCall({ region: REGION }, scoped(deleteClub));
exports.deleteCourt = onCall(
  { region: REGION },
  scoped(
    wrapCallable(async (request) => {
      await requireAdmin(readCredentials(request));
      const courtId = validateId("court", request.data?.courtId);
      await db.doc(`courts/${courtId}`).delete();
      return { courtId, deleted: true };
    }),
  ),
);

exports.postEvent = onRequest({ region: REGION, invoker: "public" }, scoped(postEvent));

exports.getCourtScore = onRequest(
  { region: REGION, maxInstances: 2, invoker: "public" },
  scoped(getCourtScore),
);

exports.getCourtScoreRevision = onRequest(
  { region: REGION, maxInstances: 2, invoker: "public" },
  scoped(getCourtScoreRevision),
);

exports.getCourtStats = onRequest(
  { region: REGION, maxInstances: 2, invoker: "public" },
  scoped(getCourtStats),
);

exports.getCourtMomentum = onRequest(
  { region: REGION, maxInstances: 2, invoker: "public" },
  scoped(getCourtMomentum),
);
