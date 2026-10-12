const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { removeDeletedMember } = require("../services/clubService");
const { REGION } = require("../services/constants");
const { withOperationScope } = require("../infrastructure/dataGuard");

// A deleted court leaves every club that listed it. Cleanup re-checks each
// club so delayed deliveries do not affect unrelated memberships.
const handleCourtDeleted = (event) => removeDeletedMember("courts", event.params.courtId);

exports.handleCourtDeleted = handleCourtDeleted;

exports.onCourtDeleted = onDocumentDeleted(
  { document: "courts/{courtId}", region: REGION, retry: true },
  withOperationScope(handleCourtDeleted),
);

exports.onDeviceDeleted = onDocumentDeleted(
  { document: "devices/{deviceId}", region: REGION, retry: true },
  withOperationScope((event) => removeDeletedMember("devices", event.params.deviceId)),
);
