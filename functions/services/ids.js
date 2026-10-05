const crypto = require("crypto");

// Same unambiguous alphabet as court and club ids, so ids are easy to read
// out and type.
const ID_ALPHABET = "abcdefghjkmnpqrstuxyz";
const ID_ALPHABET_WITH_DIGITS = "abcdefghjkmnpqrstuxyz23456789";

function randomId(length, alphabet = ID_ALPHABET_WITH_DIGITS) {
  let id = "";
  for (let i = 0; i < length; i++) {
    id += alphabet[crypto.randomInt(alphabet.length)];
  }
  return id;
}

const newMatchId = () => randomId(8);
const newTournamentId = () => randomId(6, ID_ALPHABET);
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

module.exports = { randomId, newMatchId, newTournamentId, newSecret, hashSecret, secretsMatch };
