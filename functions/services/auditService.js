// Audit trail (spec section 43). Records summarise what changed without
// passwords, keys or unnecessary personal data.
const { db, FieldValue } = require("../infrastructure/firebase");
const { paths } = require("./firestorePaths");

function buildAuditRecord({
  operation,
  tournamentId = null,
  roundId = null,
  fixtureId = null,
  matchId = null,
  courtId = null,
  actor = null,
  beforeSummary = null,
  afterSummary = null,
  reason = null,
}) {
  return {
    operation,
    tournamentId,
    roundId,
    fixtureId,
    matchId,
    courtId,
    actor: actor ? { type: actor.type || "unknown", uid: actor.uid || null } : null,
    timestamp: FieldValue.serverTimestamp(),
    beforeSummary,
    afterSummary,
    reason: typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 500) : null,
  };
}

// Tournament operations are audited on the tournament; casual match
// operations on the match.
function auditCollectionPath(record) {
  if (record.tournamentId) return paths.tournamentAudits(record.tournamentId);
  if (record.matchId) return paths.matchAudits(record.matchId);
  return null;
}

function writeAudit(tx, input) {
  const record = buildAuditRecord(input);
  const collectionPath = auditCollectionPath(record);
  if (!collectionPath) return null;
  const ref = db.collection(collectionPath).doc();
  if (tx) {
    tx.set(ref, record);
  } else {
    return ref.set(record).then(() => ref.id);
  }
  return ref.id;
}

module.exports = { buildAuditRecord, writeAudit };
