const crypto = require("crypto");
const { invalid, conflict } = require("./errors");

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

// Must be called in the caller's transaction read phase; callers commit with tx.create.
async function allocateId(tx, type, { db, randomInt = crypto.randomInt } = {}) {
  if (!Object.hasOwn(ID_LENGTHS, type)) throw invalid("Unknown ID type.");
  if (!db) db = require("../infrastructure/firebase").db;
  let reserved = reservations.get(tx);
  if (!reserved) {
    reserved = new Set();
    reservations.set(tx, reserved);
  }
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
  allocateId,
  randomId,
  newSecret,
  hashSecret,
  secretsMatch,
};
