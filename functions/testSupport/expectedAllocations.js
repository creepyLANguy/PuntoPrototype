const crypto = require("crypto");
const { COLLECTIONS, ID_ALPHABET, ID_LENGTHS } = require("../services/ids");

const REFERENCE_COLLECTIONS = {
  courtId: "courts",
  currentCourtId: "courts",
  lastCourtId: "courts",
  sourceCourtId: "courts",
  targetCourtId: "courts",
  activeMatchId: "matches",
  lastMatchId: "matches",
  occupiedByMatchId: "matches",
  matchId: "matches",
  clubId: "clubs",
  tournamentId: "tournaments",
};

function seededAllocationId(path) {
  return crypto.createHash("sha256").update(path).digest("base64url").slice(0, 16);
}

function seedAllocationTokens(docs) {
  const seeded = Object.fromEntries(
    Object.entries(docs).map(([path, data]) => {
      const [collection, id, child] = path.split("/");
      const managedRoot = Object.values(COLLECTIONS).includes(collection) && id && !child;
      return [path, managedRoot ? { allocationId: seededAllocationId(path), ...data } : data];
    }),
  );
  // Bind only initial fixture references. Explicit missing/stale companions
  // remain untouched, and absent targets are never given a generation.
  return Object.fromEntries(
    Object.entries(seeded).map(([path, data]) => {
      const fixture = { ...data };
      for (const [field, collection] of Object.entries(REFERENCE_COLLECTIONS)) {
        const tokenField = field.replace(/Id$/, "AllocationId");
        if (Object.hasOwn(fixture, tokenField)) continue;
        const id = fixture[field];
        if (typeof id !== "string" || !id) continue;
        const allocationId = seeded[`${collection}/${id}`]?.allocationId;
        if (typeof allocationId === "string" && allocationId) {
          fixture[tokenField] = allocationId;
        }
      }
      return [path, fixture];
    }),
  );
}

// Capture the client's snapshots when composing a request, never inside a
// production callback or retry. Explicit expectations (including {}) stay pinned.
function withExpectedAllocations(db, data) {
  if (Object.hasOwn(data, "expectedAllocations")) return data;
  const expectedAllocations = {};
  for (const [type, collection] of Object.entries(COLLECTIONS)) {
    const ids = [data[`${type}Id`]];
    if (type === "court") {
      for (const field of ["courtIds", "courtPool"]) {
        if (Array.isArray(data[field])) ids.push(...data[field]);
      }
    }
    for (const id of ids) {
      // Leave malformed and nonexistent IDs to the callable's validation.
      if (
        typeof id !== "string" ||
        id.length !== ID_LENGTHS[type] ||
        [...id].some((char) => !ID_ALPHABET.includes(char))
      ) {
        continue;
      }
      const snapshot = db.snapshot(`${collection}/${id}`);
      if (!snapshot.exists) continue;
      const allocationId = snapshot.data().allocationId;
      if (typeof allocationId !== "string" || !allocationId) {
        throw new Error(`Fixture ${collection}/${id} has no allocation token.`);
      }
      expectedAllocations[type] ||= {};
      expectedAllocations[type][id] = allocationId;
    }
  }
  return { ...data, expectedAllocations };
}

module.exports = { seededAllocationId, seedAllocationTokens, withExpectedAllocations };
