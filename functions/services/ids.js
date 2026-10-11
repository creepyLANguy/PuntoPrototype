const crypto = require("crypto");
const { invalid, conflict, precondition, maintenance } = require("./errors");
const { GATE_PATH, retentionPaths, getRetentionPolicy } = require("./retentionConfig");

const ID_ALPHABET = "abcdefghjkmnpqrstuxyz";
const ID_LENGTHS = Object.freeze({ court: 5, tournament: 7, match: 6, club: 4 });
const MAX_ID_ALLOCATION_ATTEMPTS = 5;
const COLLECTIONS = Object.freeze({
  court: "courts",
  tournament: "tournaments",
  match: "matches",
  club: "clubs",
});
const reservations = new WeakMap();
const facades = new WeakMap();

// Immutable generation token stored on each root and its ledger record. Uses
// randomBytes so ID candidate sources (randomInt) stay independent.
const newAllocationId = () => crypto.randomBytes(12).toString("base64url");

function emptyLedger(type) {
  return { type, sequence: 0, live: 0, released: 0, cullJobId: null };
}

// Wraps the transaction handed to runIdTransaction callbacks: creating an
// allocated root stamps its allocationId and marks the allocation as used, so
// only roots that are really created get ledger records.
function idTransactionFacade(tx) {
  let facade = facades.get(tx);
  if (facade) return facade;
  facade = {
    get: (target) => tx.get(target),
    set: (...args) => {
      tx.set(...args);
      return facade;
    },
    update: (...args) => {
      tx.update(...args);
      return facade;
    },
    delete: (...args) => {
      tx.delete(...args);
      return facade;
    },
    create: (ref, data) => {
      const context = reservations.get(facade);
      const allocation = context?.active ? context.allocations.get(ref.path) : null;
      if (allocation && !allocation.created) {
        allocation.created = true;
        tx.create(ref, { ...data, allocationId: allocation.allocationId });
      } else {
        tx.create(ref, data);
      }
      return facade;
    },
  };
  facades.set(tx, facade);
  return facade;
}

function finalizeAllocations(tx, context) {
  const byType = new Map();
  context.allocations.forEach((allocation) => {
    if (!allocation.created) return;
    if (!byType.has(allocation.type)) byType.set(allocation.type, []);
    byType.get(allocation.type).push(allocation);
  });
  if (!byType.size) return;
  const { db, gate } = context;
  const nowMs = Date.now();
  const cullTypes = {};
  const ledgerWrites = [];
  byType.forEach((allocations, type) => {
    const ledger = context.ledgerData.get(type);
    const policy = getRetentionPolicy(type);
    let sequence = ledger.sequence;
    allocations.forEach((allocation) => {
      sequence += 1;
      tx.create(db.doc(retentionPaths.allocation(type, allocation.id)), {
        type,
        id: allocation.id,
        allocationId: allocation.allocationId,
        sequence,
        state: "live",
        allocatedAtMs: nowMs,
      });
    });
    const live = ledger.live + allocations.length;
    const occupied = live + ledger.released;
    const next = {
      type,
      sequence,
      live,
      released: ledger.released,
      trigger: policy.trigger,
      target: policy.target,
      cullJobId: null,
      updatedAtMs: nowMs,
    };
    if (occupied >= policy.trigger) {
      cullTypes[type] = { cullCount: occupied - policy.target, occupiedAtStart: occupied };
    }
    ledgerWrites.push(next);
  });
  const jobId = Object.keys(cullTypes).length ? `${nowMs}-${newAllocationId()}` : null;
  ledgerWrites.forEach((ledger) => {
    if (cullTypes[ledger.type]) ledger.cullJobId = jobId;
    tx.set(db.doc(retentionPaths.ledger(ledger.type)), ledger);
  });
  if (!jobId) return;
  // Starting the cull commits atomically with the allocation that crossed the
  // trigger: the gate blocks further allocations and every live write.
  tx.create(db.doc(retentionPaths.job(jobId)), {
    jobId,
    status: "pending",
    createdAtMs: nowMs,
    types: Object.keys(cullTypes),
    plan: cullTypes,
    attempt: 0,
    lease: null,
    nextVictim: 0,
    victimCount: 0,
    selection: {},
  });
  tx.set(db.doc(GATE_PATH), {
    active: true,
    jobId,
    types: Object.keys(cullTypes),
    epoch: (gate.epoch || 0) + 1,
    activatedAtMs: nowMs,
    completedAtMs: null,
    lastJobId: gate.lastJobId || null,
  });
}

// The Admin SDK reuses its Transaction across retries: reset reservations at
// callback entry, not when a Transaction object is first encountered.
function runIdTransaction(db, callback, options) {
  return db.runTransaction(async (rawTx) => {
    const tx = idTransactionFacade(rawTx);
    const context = {
      reserved: new Set(),
      active: true,
      db,
      gate: null,
      gatePromise: null,
      ledgerPromises: new Map(),
      ledgerData: new Map(),
      allocations: new Map(),
    };
    reservations.set(tx, context);
    reservations.set(rawTx, context);
    try {
      const result = await callback(tx);
      finalizeAllocations(rawTx, context);
      return result;
    } finally {
      context.active = false;
      if (reservations.get(tx) === context) reservations.delete(tx);
      if (reservations.get(rawTx) === context) reservations.delete(rawTx);
    }
  }, options);
}

function allocationContext(tx) {
  const context = reservations.get(tx);
  if (!context?.active) {
    throw precondition("ID allocation requires an active runIdTransaction callback.");
  }
  return context;
}

function deferIdTransactionWrites(transaction) {
  const context = allocationContext(transaction);
  const writes = [];
  const tx = {
    get: (ref) => transaction.get(ref),
    set: (...args) => writes.push(() => transaction.set(...args)),
    create: (...args) => writes.push(() => transaction.create(...args)),
    update: (...args) => writes.push(() => transaction.update(...args)),
    delete: (...args) => writes.push(() => transaction.delete(...args)),
  };
  reservations.set(tx, context);
  return {
    tx,
    flushWrites: () => {
      allocationContext(tx);
      writes.forEach((write) => write());
      writes.length = 0;
    },
  };
}

// Reads the maintenance gate and the type's ledger once per attempt. New IDs
// are refused while a cull is pending so the ledger reaches its target exactly.
function loadLedger(tx, context, type) {
  const { db } = context;
  if (!context.gatePromise) {
    context.gatePromise = tx.get(db.doc(GATE_PATH)).then((snapshot) => {
      context.gate = (snapshot.exists && snapshot.data()) || {};
      return context.gate;
    });
  }
  if (!context.ledgerPromises.has(type)) {
    context.ledgerPromises.set(
      type,
      Promise.all([context.gatePromise, tx.get(db.doc(retentionPaths.ledger(type)))]).then(
        ([gate, snapshot]) => {
          const ledger = { ...emptyLedger(type), ...((snapshot.exists && snapshot.data()) || {}) };
          context.ledgerData.set(type, ledger);
          if (gate.active === true || ledger.cullJobId) throw maintenance();
          return ledger;
        },
      ),
    );
  }
  return context.ledgerPromises.get(type);
}

function validateId(type, id) {
  const length = ID_LENGTHS[type];
  if (!Object.hasOwn(ID_LENGTHS, type)) throw invalid("Unknown ID type.");
  if (
    typeof id !== "string" ||
    id.length !== length ||
    [...id].some((letter) => !ID_ALPHABET.includes(letter))
  ) {
    throw invalid(`A valid ${type} id must contain exactly ${length} lowercase ID letters.`);
  }
  return id;
}

// Non-addressable identifiers (participants, devices, fixtures) use this alphabet too.
function randomId(length, randomInt = crypto.randomInt) {
  if (!Number.isInteger(length) || length <= 0) throw invalid("Invalid ID length.");
  let id = "";
  for (let i = 0; i < length; i++) {
    const index = randomInt(ID_ALPHABET.length);
    if (!Number.isInteger(index) || index < 0 || index >= ID_ALPHABET.length) {
      throw invalid("Invalid random ID source.");
    }
    id += ID_ALPHABET[index];
  }
  return id;
}

// Allocate in runIdTransaction's read phase; callers persist with tx.create,
// which stamps the root's allocationId. An ID is free only when neither the
// root nor its ledger record exists (released IDs stay reserved until culled).
async function allocateId(tx, type, { db, randomInt = crypto.randomInt } = {}) {
  if (!Object.hasOwn(ID_LENGTHS, type)) throw invalid("Unknown ID type.");
  const context = allocationContext(tx);
  const { reserved } = context;
  if (!context.db) context.db = db || require("../infrastructure/firebase").db;
  if (!db) db = context.db;
  await loadLedger(tx, context, type);
  for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt++) {
    const id = randomId(ID_LENGTHS[type], randomInt);
    const path = `${COLLECTIONS[type]}/${id}`;
    if (reserved.has(path)) continue;
    // Reserve synchronously: parallel allocations on one tx must not share a candidate.
    reserved.add(path);
    try {
      const [root, record] = await Promise.all([
        tx.get(db.doc(path)),
        tx.get(db.doc(retentionPaths.allocation(type, id))),
      ]);
      if (!root.exists && !record.exists) {
        if (!context.active) throw precondition("ID allocation transaction already ended.");
        context.allocations.set(path, {
          type,
          id,
          allocationId: newAllocationId(),
          created: false,
        });
        return id;
      }
    } catch (error) {
      reserved.delete(path);
      throw error;
    }
    reserved.delete(path);
  }
  throw conflict(`Could not allocate a unique ${type} id. Please try again.`);
}

const newSecret = () => crypto.randomBytes(18).toString("base64url");

function hashSecret(secret) {
  return crypto.createHash("sha256").update(String(secret)).digest("hex");
}

function secretsMatch(secret, expectedHash) {
  if (typeof secret !== "string" || !secret || typeof expectedHash !== "string") return false;
  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  ID_ALPHABET,
  ID_LENGTHS,
  COLLECTIONS,
  MAX_ID_ALLOCATION_ATTEMPTS,
  newAllocationId,
  validateId,
  runIdTransaction,
  deferIdTransactionWrites,
  allocateId,
  randomId,
  newSecret,
  hashSecret,
  secretsMatch,
};
