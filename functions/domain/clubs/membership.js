// Club rules: input normalisation, club id generation and the plan for moving
// courts and devices between clubs. Pure functions; the club service applies
// the plan inside a Firestore transaction.
//
// A court or device belongs to at most one club. The club document lists its
// members (courtIds / deviceIds) and every member document carries the same
// relationship as clubId, so the member document is the single place a
// transaction has to lock to change it.

const CLUB_NAME_MAX_LENGTH = 80;
const MAX_CLUB_COURTS = 100;
const MAX_CLUB_DEVICES = 100;
const CLUB_ID_LENGTH = 6;
// The court id alphabet (no easily confused letters), so club ids are just as
// easy to read out and type into a search box.
const CLUB_ID_ALPHABET = "abcdefghjkmnpqrstuxyz";

const CLUB_STATES = Object.freeze({
  OPEN: "open",
  MAINTENANCE: "maintenance",
  CLOSED: "closed",
});
const DEFAULT_CLUB_STATE = CLUB_STATES.MAINTENANCE;

const MEMBER_KINDS = {
  courts: { collection: "courts", listField: "courtIds", label: "court", max: MAX_CLUB_COURTS },
  devices: {
    collection: "devices",
    listField: "deviceIds",
    label: "device",
    max: MAX_CLUB_DEVICES,
  },
};

// `code` is a callable error code (invalid-argument, not-found, ...), so the
// callable layer can pass the error to the client unchanged.
class ClubError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ClubError";
    this.code = code;
  }
}

const invalid = (message) => new ClubError("invalid-argument", message);

function normalizeClubState(state) {
  if (state === undefined || state === null || state === "") return DEFAULT_CLUB_STATE;
  if (typeof state !== "string") {
    throw invalid("Club state must be one of: open, maintenance, closed.");
  }

  const normalized = state.trim().toLowerCase();
  if (!Object.values(CLUB_STATES).includes(normalized)) {
    throw invalid("Club state must be one of: open, maintenance, closed.");
  }
  return normalized;
}

function normalizeClubName(name) {
  if (typeof name !== "string") {
    throw invalid("Club name is required.");
  }

  const normalized = name.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw invalid("Club name is required.");
  }
  if (normalized.length > CLUB_NAME_MAX_LENGTH) {
    throw invalid(`Club name must be at most ${CLUB_NAME_MAX_LENGTH} characters.`);
  }
  return normalized;
}

// Trims, drops duplicates (keeping first-seen order) and enforces the size
// limit. Ids are otherwise kept as given: device ids are case-sensitive.
function normalizeMemberIds(ids, kind) {
  const { label, max } = MEMBER_KINDS[kind];

  if (ids === undefined || ids === null) return [];
  if (!Array.isArray(ids)) {
    throw invalid(`${label} ids must be a list.`);
  }

  const seen = new Set();
  const normalized = [];
  for (const id of ids) {
    if (typeof id !== "string" || !id.trim() || id.includes("/")) {
      throw invalid(`Invalid ${label} id: ${JSON.stringify(id)}.`);
    }
    const trimmed = id.trim();
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      normalized.push(trimmed);
    }
  }

  if (normalized.length > max) {
    throw invalid(`A club can have at most ${max} ${label}s.`);
  }
  return normalized;
}

function normalizeClubId(clubId) {
  if (typeof clubId !== "string" || !clubId.trim() || clubId.includes("/")) {
    throw invalid("A valid clubId is required.");
  }
  return clubId.trim().toLowerCase();
}

function generateClubId(random = Math.random) {
  let id = "";
  for (let i = 0; i < CLUB_ID_LENGTH; i++) {
    id += CLUB_ID_ALPHABET[Math.floor(random() * CLUB_ID_ALPHABET.length)];
  }
  return id;
}

// Works out every write needed to give club `clubId` exactly `nextIds` as its
// members of one kind.
//
//   previousIds  the members the club document currently lists
//   members      Map id -> member document data (undefined when missing) for
//                every id in previousIds and nextIds
//   holders      Map id -> Set of other club ids whose documents list the id
//
// Returns { missingIds, assign, release, moved, removeFromClubs }:
//   missingIds       next members whose documents do not exist (the caller
//                    rejects the request)
//   assign           member ids whose clubId must be set to clubId
//   release          member ids whose clubId must be cleared
//   moved            [{ id, fromClubId }] members taken from another club
//   removeFromClubs  Map other club id -> member ids to drop from its list
function planMembershipChange({ clubId, previousIds, nextIds, members, holders }) {
  const next = new Set(nextIds);
  const missingIds = nextIds.filter((id) => members.get(id) === undefined);

  const assign = [];
  const moved = [];
  const removeFromClubs = new Map();
  const removeFrom = (otherClubId, id) => {
    if (!removeFromClubs.has(otherClubId)) removeFromClubs.set(otherClubId, new Set());
    removeFromClubs.get(otherClubId).add(id);
  };

  for (const id of nextIds) {
    const member = members.get(id);
    if (member === undefined) continue;

    const otherClubs = new Set(holders.get(id) || []);
    const currentClubId = typeof member.clubId === "string" ? member.clubId : null;
    if (currentClubId && currentClubId !== clubId) otherClubs.add(currentClubId);
    otherClubs.delete(clubId);

    for (const otherClubId of otherClubs) removeFrom(otherClubId, id);
    if (otherClubs.size > 0) {
      const fromClubId =
        currentClubId && currentClubId !== clubId ? currentClubId : [...otherClubs][0];
      moved.push({ id, fromClubId });
    }
    if (currentClubId !== clubId) assign.push(id);
  }

  // Members dropped from this club. A member that another club has since
  // claimed keeps that club's clubId.
  const release = previousIds.filter((id) => {
    if (next.has(id)) return false;
    const member = members.get(id);
    return member !== undefined && (member.clubId === clubId || member.clubId == null);
  });

  return {
    missingIds,
    assign,
    release,
    moved,
    removeFromClubs: new Map([...removeFromClubs].map(([id, ids]) => [id, [...ids]])),
  };
}

module.exports = {
  CLUB_NAME_MAX_LENGTH,
  MAX_CLUB_COURTS,
  MAX_CLUB_DEVICES,
  CLUB_ID_ALPHABET,
  CLUB_ID_LENGTH,
  CLUB_STATES,
  DEFAULT_CLUB_STATE,
  MEMBER_KINDS,
  ClubError,
  normalizeClubName,
  normalizeClubState,
  normalizeMemberIds,
  normalizeClubId,
  generateClubId,
  planMembershipChange,
};
