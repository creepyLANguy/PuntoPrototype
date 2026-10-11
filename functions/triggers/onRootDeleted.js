const { onDocumentDeleted } = require("firebase-functions/v2/firestore");
const { accountRootDeletion } = require("../services/retentionService");
const { REGION } = require("../services/constants");

// Manual root deletes keep the ID ledger exact: the allocation record moves
// from live to released (exactly once; stale or culled generations no-op).
// Courts are accounted by onCourtDeleted together with the club cleanup.
function accountingTrigger(type, collection) {
  const param = `${type}Id`;
  return onDocumentDeleted(
    { document: `${collection}/{${param}}`, region: REGION, retry: true },
    (event) => {
      const snapshot = event?.data;
      const data = snapshot && typeof snapshot.data === "function" ? snapshot.data() : null;
      return accountRootDeletion(type, event.params[param], data);
    },
  );
}

exports.onClubDeleted = accountingTrigger("club", "clubs");
exports.onMatchDeleted = accountingTrigger("match", "matches");
exports.onTournamentDeleted = accountingTrigger("tournament", "tournaments");
