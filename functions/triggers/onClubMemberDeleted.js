const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { removeDeletedMember } = require("../services/clubService");
const { REGION } = require("../services/constants");

// A deleted court or device leaves every club that listed it.
exports.onCourtDeleted = onDocumentDeleted(
  { document: "courts/{courtId}", region: REGION, retry: true },
  (event) => removeDeletedMember("courts", event.params.courtId),
);

exports.onDeviceDeleted = onDocumentDeleted(
  { document: "devices/{deviceId}", region: REGION, retry: true },
  (event) => removeDeletedMember("devices", event.params.deviceId),
);
