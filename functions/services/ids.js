const crypto = require("crypto");
const { invalid, conflict, precondition } = require("./errors");

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
const allocatedRoots = new WeakMap();

// Immutable generation tokens keep reassigned IDs distinct. Uses randomBytes so
// ID candidate sources (randomInt) stay independent.
const newAllocationId = () => crypto.randomBytes(12).toString("base64url");

// Wraps the transaction handed to runIdTransaction callbacks: creating an
// allocated root stamps its allocationId, so only roots that are really created
// receive a generation token.
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
        const allocatedData = { ...data, allocationId: allocation.allocationId };
        allocatedRoots.set(allocatedData, {
          path: ref.path,
          allocationId: allocation.allocationId,
        });
        tx.create(ref, allocatedData);
      } else {
        tx.create(ref, data);
      }
      return facade;
    },
  };
  facades.set(tx, facade);
  return facade;
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
      allocations: new Map(),
    };
    reservations.set(tx, context);
    reservations.set(rawTx, context);
    try {
      const result = await callback(tx);
      if (result && typeof result === "object") {
        for (const allocation of context.allocations.values()) {
          if (allocation.created && result[`${allocation.type}Id`] === allocation.id) {
            result.allocationId = allocation.allocationId;
            if (result.view) result.view.allocationId = allocation.allocationId;
          }
        }
      }
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

function consumeAllocatedRoot(data, path) {
  const allocation = data && allocatedRoots.get(data);
  if (allocation) allocatedRoots.delete(data);
  return allocation?.path === path && allocation.allocationId === data.allocationId;
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
// which stamps the root's allocationId. Existing roots reserve their IDs.
async function allocateId(tx, type, { db, randomInt = crypto.randomInt } = {}) {
  if (!Object.hasOwn(ID_LENGTHS, type)) throw invalid("Unknown ID type.");
  const context = allocationContext(tx);
  const { reserved } = context;
  if (!db) db = typeof context.db?.doc === "function" ? context.db : null;
  if (!db) db = require("../infrastructure/firebase").db;
  for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt++) {
    const id = randomId(ID_LENGTHS[type], randomInt);
    const path = `${COLLECTIONS[type]}/${id}`;
    if (reserved.has(path)) continue;
    // Reserve synchronously: parallel allocations on one tx must not share a candidate.
    reserved.add(path);
    try {
      const root = await tx.get(db.doc(path));
      if (!root.exists) {
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
  consumeAllocatedRoot,
  validateId,
  runIdTransaction,
  deferIdTransactionWrites,
  allocateId,
  randomId,
  newSecret,
  hashSecret,
  secretsMatch,
};
