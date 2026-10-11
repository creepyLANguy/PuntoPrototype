const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { removeDeletedMember } = require("../services/clubService");
const { accountRootDeletion } = require("../services/retentionService");
const { REGION } = require("../services/constants");
const { withOperationScope } = require("../infrastructure/dataGuard");

function deletedData(event) {
  const snapshot = event?.data;
  if (!snapshot || typeof snapshot.data !== "function") return null;
  return snapshot.data() || null;
}

// A deleted court releases its ID ledger record and leaves every club that
// listed it. Delayed deliveries never touch a reused court: the club cleanup
// re-checks, per club transaction, that no court of that id exists now.
async function handleCourtDeleted(event) {
  const courtId = event.params.courtId;
  await accountRootDeletion("court", courtId, deletedData(event));
  return removeDeletedMember("courts", courtId);
}

exports.handleCourtDeleted = handleCourtDeleted;

exports.onCourtDeleted = onDocumentDeleted(
  { document: "courts/{courtId}", region: REGION, retry: true },
  withOperationScope(handleCourtDeleted),
);

exports.onDeviceDeleted = onDocumentDeleted(
  { document: "devices/{deviceId}", region: REGION, retry: true },
  withOperationScope((event) => removeDeletedMember("devices", event.params.deviceId)),
);
