const crypto = require("crypto");
const { invalid, conflict, precondition } = require("./errors");

const ID_ALPHABET = "abcdefghjkmnpqrstuxyz";
const ID_LENGTHS = Object.freeze({ court: 4, tournament: 6, match: 8, club: 10 });
const MAX_ID_ALLOCATION_ATTEMPTS = 5;
const COLLECTIONS = Object.freeze({
  court: "courts",
  tournament: "tournaments",
  match: "matches",
  club: "clubs",
});
const reservations = new WeakMap();

// The Admin SDK reuses its Transaction across retries: reset reservations at
// callback entry, not when a Transaction object is first encountered.
function runIdTransaction(db, callback, options) {
  return db.runTransaction(async (tx) => {
    const context = { reserved: new Set(), active: true };
    reservations.set(tx, context);
    try {
      return await callback(tx);
    } finally {
      context.active = false;
      if (reservations.get(tx) === context) reservations.delete(tx);
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

// Allocate in runIdTransaction's read phase; callers persist with tx.create.
async function allocateId(tx, type, { db, randomInt = crypto.randomInt } = {}) {
  if (!Object.hasOwn(ID_LENGTHS, type)) throw invalid("Unknown ID type.");
  const { reserved } = allocationContext(tx);
  if (!db) db = require("../infrastructure/firebase").db;
  for (let attempt = 0; attempt < MAX_ID_ALLOCATION_ATTEMPTS; attempt++) {
    const id = randomId(ID_LENGTHS[type], randomInt);
    const path = `${COLLECTIONS[type]}/${id}`;
    if (reserved.has(path)) continue;
    // Reserve synchronously: parallel allocations on one tx must not share a candidate.
    reserved.add(path);
    try {
      const snapshot = await tx.get(db.doc(path));
      if (!snapshot.exists) return id;
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
  MAX_ID_ALLOCATION_ATTEMPTS,
  validateId,
  runIdTransaction,
  deferIdTransactionWrites,
  allocateId,
  randomId,
  newSecret,
  hashSecret,
  secretsMatch,
};
