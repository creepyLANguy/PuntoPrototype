// ID retention (allocation ledger + oldest-first culling) configuration and
// Firestore locations. Kept free of Firebase imports so the ID allocator and
// the guarded Firestore wrapper can both depend on it.
//
//   _idMaintenance/control                         global maintenance gate
//   _idMaintenance/control/jobs/{jobId}            cull job (lease, phases)
//   _idMaintenance/control/jobs/{jobId}/victims/{index}
//   _idLedger/{type}                               per-type accounting ledger
//   _idLedger/{type}/allocations/{id}              one record per occupied ID
//   CULLED_{TYPE}/{id}_{allocationId}              immutable archive
//   CULLED_{TYPE}/{id}_{allocationId}/documents/{sha256(path)}
const ID_TYPES = Object.freeze(["club", "court", "match", "tournament"]);

const ROOT_COLLECTIONS = Object.freeze({
  club: "clubs",
  court: "courts",
  match: "matches",
  tournament: "tournaments",
});

const ARCHIVE_COLLECTIONS = Object.freeze({
  club: "CULLED_CLUBS",
  court: "CULLED_COURTS",
  match: "CULLED_MATCHES",
  tournament: "CULLED_TOURNAMENTS",
});

// Documents keyed by a tournament id outside tournaments/{id}. They belong to
// that tournament generation and are archived and deleted with it.
const TOURNAMENT_SIDECARS = Object.freeze([
  "tournamentViews",
  "tournamentPrivateViews",
  "tournamentDirectory",
  "tournamentSecrets",
]);

const DEFAULT_RETENTION_POLICIES = Object.freeze({
  club: Object.freeze({ trigger: 96000, target: 40000 }),
  court: Object.freeze({ trigger: 1900000, target: 750000 }),
  match: Object.freeze({ trigger: 42000000, target: 16000000 }),
  tournament: Object.freeze({ trigger: 899000000, target: 335000000 }),
});

let activePolicies = DEFAULT_RETENTION_POLICIES;

function validatePolicy(type, policy) {
  if (
    !policy ||
    !Number.isSafeInteger(policy.trigger) ||
    !Number.isSafeInteger(policy.target) ||
    policy.target < 0 ||
    policy.trigger <= policy.target
  ) {
    throw new Error(`Invalid ${type} retention policy: target must be below trigger.`);
  }
  return Object.freeze({ trigger: policy.trigger, target: policy.target });
}

// Test and operations hook: replace some policies (others keep their default).
function setRetentionPolicies(overrides = {}) {
  const next = { ...DEFAULT_RETENTION_POLICIES };
  for (const [type, policy] of Object.entries(overrides)) {
    if (!ID_TYPES.includes(type)) throw new Error(`Unknown ID type ${type}.`);
    next[type] = validatePolicy(type, policy);
  }
  activePolicies = Object.freeze(next);
  return activePolicies;
}

function resetRetentionPolicies() {
  activePolicies = DEFAULT_RETENTION_POLICIES;
}

function getRetentionPolicy(type) {
  const policy = activePolicies[type];
  if (!policy) throw new Error(`Unknown ID type ${type}.`);
  return policy;
}

const GATE_PATH = "_idMaintenance/control";
const JOBS_COLLECTION = `${GATE_PATH}/jobs`;

const retentionPaths = {
  gate: () => GATE_PATH,
  job: (jobId) => `${JOBS_COLLECTION}/${jobId}`,
  victim: (jobId, index) =>
    `${JOBS_COLLECTION}/${jobId}/victims/${String(index).padStart(12, "0")}`,
  ledger: (type) => `_idLedger/${type}`,
  allocations: (type) => `_idLedger/${type}/allocations`,
  allocation: (type, id) => `_idLedger/${type}/allocations/${id}`,
  archive: (type, archiveKey) => `${ARCHIVE_COLLECTIONS[type]}/${archiveKey}`,
  archiveDocuments: (type, archiveKey) => `${ARCHIVE_COLLECTIONS[type]}/${archiveKey}/documents`,
};

function archiveKeyFor(id, allocationId) {
  return `${id}_${allocationId || "unallocated"}`;
}

function typeForRootCollection(collection) {
  return ID_TYPES.find((type) => ROOT_COLLECTIONS[type] === collection) || null;
}

module.exports = {
  ID_TYPES,
  ROOT_COLLECTIONS,
  ARCHIVE_COLLECTIONS,
  TOURNAMENT_SIDECARS,
  DEFAULT_RETENTION_POLICIES,
  GATE_PATH,
  JOBS_COLLECTION,
  retentionPaths,
  archiveKeyFor,
  typeForRootCollection,
  getRetentionPolicy,
  setRetentionPolicies,
  resetRetentionPolicies,
};
