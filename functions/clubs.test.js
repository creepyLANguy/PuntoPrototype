// Clubs: the membership rules (pure) and the club callables / deletion
// triggers running against an in-memory Firestore.
let mockDb = null;
const { FakeFirestore: TransactionalFirestore } = require("./testSupport/fakeFirestore");
const { ID_ALPHABET, ID_LENGTHS } = require("./services/ids");

jest.mock("firebase-functions/v2/https", () => ({
  onCall: (_config, handler) => handler,
  onRequest: (_config, handler) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (_config, handler) => handler,
  onDocumentDeleted: (_config, handler) => handler,
}));

jest.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_config, handler) => handler,
}));

jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  firestore: () => mockDb,
}));

jest.mock("firebase-admin/firestore", () => ({
  FieldPath: { documentId: () => "__name__" },
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
    arrayRemove: (...values) => ({ __arrayRemove: values }),
  },
}));

const {
  CLUB_NAME_MAX_LENGTH,
  MAX_CLUB_COURTS,
  MAX_CLUB_DEVICES,
  CLUB_STATES,
  DEFAULT_CLUB_STATE,
  ClubError,
  normalizeClubId,
  normalizeClubName,
  normalizeClubState,
  normalizeMemberIds,
  planMembershipChange,
} = require("./domain/clubs/membership");

// In-memory Firestore with the surface the club service uses. Transactions
// enforce Firestore's rule that every read happens before the first write.
class FakeFirestore extends TransactionalFirestore {
  constructor(docs = {}) {
    super(docs);
    this.docs = new Map(Object.entries(docs).map(([path, data]) => [path, structuredClone(data)]));
    this.queries = [];
    // Every committed write, in order: { type: "set" | "delete", path }.
    this.writes = [];
    // Set to make the next transaction fail with this error.
    this.failNextTransaction = null;
  }

  applyWrite(path, data, options = {}) {
    this.writes.push({ type: "set", path });
    const existing = this.docs.get(path);
    const base = options.merge && existing ? structuredClone(existing) : {};
    for (const [key, value] of Object.entries(data)) {
      if (value && value.__arrayRemove) {
        const current = Array.isArray(base[key]) ? base[key] : [];
        base[key] = current.filter((item) => !value.__arrayRemove.includes(item));
      } else {
        base[key] = structuredClone(value);
      }
    }
    this.docs.set(path, base);
  }

  snapshot(path) {
    const data = this.docs.get(path);
    return {
      exists: data !== undefined,
      id: path.split("/").pop(),
      ref: this.doc(path),
      data: () => (data === undefined ? undefined : structuredClone(data)),
    };
  }

  doc(path) {
    return {
      kind: "doc",
      path,
      id: path.split("/").pop(),
      get: async () => this.snapshot(path),
      set: async (data, options) => this.applyWrite(path, data, options),
    };
  }

  collection(path) {
    const store = this;
    const filters = [];
    const query = {
      kind: "query",
      where(field, op, value) {
        filters.push({ field, op, value });
        return query;
      },
      get: async () => store.runQuery(path, filters),
    };
    return query;
  }

  runQuery(path, filters) {
    this.queries.push({ path, filters: structuredClone(filters) });
    const prefix = `${path}/`;
    const docs = [...this.docs.keys()]
      .filter(
        (docPath) => docPath.startsWith(prefix) && !docPath.slice(prefix.length).includes("/"),
      )
      .filter((docPath) =>
        filters.every(({ field, op, value }) => {
          const record = this.docs.get(docPath);
          if (op === "==") return record[field] === value;
          const list = record[field];
          if (!Array.isArray(list)) return false;
          if (op === "array-contains") return list.includes(value);
          if (op === "array-contains-any") {
            if (value.length > 30) throw new Error("array-contains-any supports at most 30 values");
            return value.some((item) => list.includes(item));
          }
          throw new Error(`unsupported operator ${op}`);
        }),
      )
      .map((docPath) => this.snapshot(docPath));
    return { docs, size: docs.length, forEach: (callback) => docs.forEach(callback) };
  }

  async runTransaction(callback) {
    return super.runTransaction(callback);
  }

  write(path, data, options) {
    this.applyWrite(path, data, options);
  }
}

function loadFunctions(docs) {
  mockDb = new FakeFirestore(docs);
  let functions;
  let service;
  jest.isolateModules(() => {
    functions = require("./index");
    service = require("./services/clubService");
  });
  return { functions, db: mockDb, service };
}

const call = (handler, data) => handler({ data });
const doc = (db, path) => db.docs.get(path);

describe("club rules", () => {
  test("club names are trimmed, whitespace-collapsed and required", () => {
    expect(normalizeClubName("  Padel   Club  Central ")).toBe("Padel Club Central");
    for (const bad of [undefined, null, 42, "", "   "]) {
      expect(() => normalizeClubName(bad)).toThrow("Club name is required.");
    }
    expect(normalizeClubName("x".repeat(CLUB_NAME_MAX_LENGTH))).toHaveLength(CLUB_NAME_MAX_LENGTH);
    expect(() => normalizeClubName("x".repeat(CLUB_NAME_MAX_LENGTH + 1))).toThrow(ClubError);
  });

  test("member ids are trimmed and de-duplicated, keeping case and order", () => {
    expect(normalizeMemberIds([" abcde ", "SN-1", "abcde", "sn-1"], "devices")).toEqual([
      "abcde",
      "SN-1",
      "sn-1",
    ]);
    expect(normalizeMemberIds(undefined, "courts")).toEqual([]);
  });

  test("malformed or oversized member lists are rejected", () => {
    expect(() => normalizeMemberIds("abcde", "courts")).toThrow("court ids must be a list.");
    for (const bad of ["", "  ", 7, null, "a/b"]) {
      const error = (() => {
        try {
          normalizeMemberIds([bad], "courts");
        } catch (caught) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(ClubError);
      expect(error.code).toBe("invalid-argument");
    }
    const tooMany = Array.from(
      { length: MAX_CLUB_COURTS + 1 },
      (_, i) =>
        `aaa${ID_ALPHABET[Math.floor(i / ID_ALPHABET.length)]}${ID_ALPHABET[i % ID_ALPHABET.length]}`,
    );
    expect(() => normalizeMemberIds(tooMany, "courts")).toThrow(
      `A club can have at most ${MAX_CLUB_COURTS} courts.`,
    );
  });

  test("club state defaults to maintenance and only accepts known states", () => {
    expect(normalizeClubState()).toBe(DEFAULT_CLUB_STATE);
    expect(normalizeClubState(" OPEN ")).toBe(CLUB_STATES.OPEN);
    expect(normalizeClubState("maintenance")).toBe(CLUB_STATES.MAINTENANCE);
    expect(normalizeClubState("closed")).toBe(CLUB_STATES.CLOSED);
    expect(() => normalizeClubState("private")).toThrow(ClubError);
    expect(() => normalizeClubState(42)).toThrow(ClubError);
  });

  test("club ids require exactly four lowercase ID letters without normalization", () => {
    expect(normalizeClubId("hjkm")).toBe("hjkm");
    for (const bad of [undefined, "", "a/b", 12, " ABCDEFGHJK ", "fghjkm", "abcdefghj2"]) {
      expect(() => normalizeClubId(bad)).toThrow("A valid clubId is required.");
    }
  });

  test("allocated club ids use the common ID alphabet and club length", async () => {
    const { service } = loadFunctions({});
    const { clubId } = await service.createClub({ name: "Example Club" });
    expect(clubId).toHaveLength(ID_LENGTHS.club);
    expect([...clubId].every((char) => ID_ALPHABET.includes(char))).toBe(true);
  });

  test("the plan assigns new members, releases dropped ones and moves claimed ones", () => {
    const plan = planMembershipChange({
      clubId: "mine",
      previousIds: ["kept", "dropped", "claimed-since"],
      nextIds: ["kept", "new", "from-other", "listed-elsewhere", "ghost"],
      members: new Map([
        ["kept", { clubId: "mine" }],
        ["dropped", { clubId: "mine" }],
        ["claimed-since", { clubId: "other" }],
        ["new", {}],
        ["from-other", { clubId: "other" }],
        ["listed-elsewhere", { clubId: "mine" }],
        ["ghost", undefined],
      ]),
      holders: new Map([
        ["from-other", new Set(["other"])],
        ["listed-elsewhere", new Set(["stale"])],
      ]),
    });

    expect(plan.missingIds).toEqual(["ghost"]);
    expect(plan.assign).toEqual(["new", "from-other"]);
    expect(plan.release).toEqual(["dropped"]);
    expect(plan.moved).toEqual([
      { id: "from-other", fromClubId: "other" },
      { id: "listed-elsewhere", fromClubId: "stale" },
    ]);
    expect(Object.fromEntries(plan.removeFromClubs)).toEqual({
      other: ["from-other"],
      stale: ["listed-elsewhere"],
    });
  });
});

describe("createClub", () => {
  test("creates the club and links its courts and devices to it", async () => {
    const { service, db } = loadFunctions({
      "courts/abcde": { name: "Court 1" },
      "courts/efghj": { name: "Court 2", clubId: null },
      "devices/HUB-1": { courtId: "abcde" },
    });

    const values = [0, 0, 0, 0, 0, 0];
    const result = await service.createClub(
      { name: " Central  Padel ", courtIds: ["abcde", "efghj"], deviceIds: ["HUB-1"] },
      { randomInt: () => values.shift() ?? 0 },
    );

    expect(result).toEqual({
      clubId: "aaaa",
      name: "Central Padel",
      state: DEFAULT_CLUB_STATE,
      courtIds: ["abcde", "efghj"],
      deviceIds: ["HUB-1"],
      moved: { courts: [], devices: [] },
      closedTournamentIds: [],
    });
    expect(doc(db, "clubs/aaaa")).toEqual({
      allocationId: expect.any(String),
      name: "Central Padel",
      courtIds: ["abcde", "efghj"],
      deviceIds: ["HUB-1"],
      state: DEFAULT_CLUB_STATE,
      createdAt: { __serverTimestamp: true },
      updatedAt: { __serverTimestamp: true },
    });
    expect(doc(db, "courts/abcde")).toEqual({ name: "Court 1", clubId: "aaaa" });
    expect(doc(db, "courts/efghj")).toEqual({ name: "Court 2", clubId: "aaaa" });
    expect(doc(db, "devices/HUB-1")).toEqual({ courtId: "abcde", clubId: "aaaa" });
  });

  test("a generated id that is already taken is replaced by a fresh one", async () => {
    const { service, db } = loadFunctions({ "clubs/aaaa": { name: "Taken" } });
    const ids = [..."aaaa", ..."bbbb"].map((char) => ID_ALPHABET.indexOf(char));

    const result = await service.createClub({ name: "Second" }, { randomInt: () => ids.shift() });

    expect(result.clubId).toBe("bbbb");
    expect(doc(db, "clubs/aaaa")).toEqual({ name: "Taken" });
    expect(doc(db, "clubs/bbbb").name).toBe("Second");
  });

  test("the callable rejects unknown members and writes nothing", async () => {
    const { functions, db } = loadFunctions({ "courts/abcde": { name: "Court 1" } });
    const before = structuredClone([...db.docs]);

    await expect(
      call(functions.createClub, { name: "Club", courtIds: ["abcde", "zzzzz"] }),
    ).rejects.toMatchObject({ code: "not-found", message: "Unknown court id(s): zzzzz." });
    expect([...db.docs]).toEqual(before);
  });

  test("the callable reports invalid input as invalid-argument", async () => {
    const { functions } = loadFunctions({});
    await expect(call(functions.createClub, { name: "   " })).rejects.toMatchObject({
      code: "invalid-argument",
      message: "Club name is required.",
    });
    await expect(call(functions.createClub, {})).rejects.toMatchObject({
      code: "invalid-argument",
    });
  });

  test("closing a club cascades to its courts, devices, active matches and tournaments", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaab": {
        name: "Club One",
        state: CLUB_STATES.OPEN,
        courtIds: ["abcde"],
        deviceIds: ["HUB-1"],
      },
      "courts/abcde": {
        name: "A",
        clubId: "aaab",
        status: "open",
        activeMatchId: "fghjkm",
      },
      "devices/HUB-1": { clubId: "aaab" },
      "matches/fghjkm": {
        status: "live",
        currentCourtId: "abcde",
      },
      "matches/jkmnpq": {
        status: "scheduled",
        currentCourtId: null,
        tournamentId: "abcdefg",
      },
      "tournaments/abcdefg": {
        tournamentId: "abcdefg",
        name: "Saturday Tournament",
        status: "published",
        clubId: "aaab",
        revision: 3,
      },
      "tournaments/abcdefg/fixtures/f1": {
        fixtureId: "f1",
        status: "scheduled",
        matchId: "jkmnpq",
      },
    });

    await call(functions.updateClub, {
      clubId: "aaab",
      name: "Club One",
      state: CLUB_STATES.CLOSED,
      courtIds: ["abcde"],
      deviceIds: [],
    });

    expect(doc(db, "clubs/aaab")).toMatchObject({
      state: CLUB_STATES.CLOSED,
      courtIds: ["abcde"],
      deviceIds: [],
    });
    expect(doc(db, "courts/abcde")).toMatchObject({
      status: "closed",
      clubId: "aaab",
      activeMatchId: null,
    });
    expect(doc(db, "devices/HUB-1").clubId).toBeNull();
    expect(doc(db, "matches/fghjkm")).toMatchObject({
      status: "live",
      currentCourtId: null,
    });
    expect(doc(db, "matches/jkmnpq")).toMatchObject({
      status: "cancelled",
      currentCourtId: null,
    });
    expect(doc(db, "tournaments/abcdefg").status).toBe("cancelled");
    expect(doc(db, "tournaments/abcdefg/fixtures/f1").status).toBe("cancelled");
  });

  test("moving an open club to maintenance does not cascade its entities", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaab": {
        name: "Club One",
        state: CLUB_STATES.OPEN,
        courtIds: ["abcde"],
        deviceIds: ["HUB-1"],
      },
      "courts/abcde": {
        name: "A",
        clubId: "aaab",
        status: "open",
        activeMatchId: "fghjkm",
      },
      "devices/HUB-1": { clubId: "aaab" },
      "matches/fghjkm": { status: "live", currentCourtId: "abcde" },
    });

    await call(functions.updateClub, {
      clubId: "aaab",
      name: "Club One",
      state: CLUB_STATES.MAINTENANCE,
      courtIds: ["abcde"],
      deviceIds: ["HUB-1"],
    });

    expect(doc(db, "clubs/aaab").state).toBe(CLUB_STATES.MAINTENANCE);
    expect(doc(db, "courts/abcde")).toMatchObject({ status: "open", activeMatchId: "fghjkm" });
    expect(doc(db, "devices/HUB-1").clubId).toBe("aaab");
    expect(doc(db, "matches/fghjkm").currentCourtId).toBe("abcde");
  });

  test("members of another club are moved to the new club", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaad": {
        name: "Old Club",
        state: DEFAULT_CLUB_STATE,
        courtIds: ["abcde", "efghj"],
        deviceIds: ["HUB-1"],
      },
      "courts/abcde": { clubId: "aaad" },
      "courts/efghj": { clubId: "aaad" },
      "devices/HUB-1": { clubId: "aaad" },
    });

    const result = await call(functions.createClub, {
      name: "New Club",
      courtIds: ["abcde"],
      deviceIds: ["HUB-1"],
    });

    expect(result.moved).toEqual({
      courts: [{ id: "abcde", fromClubId: "aaad", fromClubName: "Old Club" }],
      devices: [{ id: "HUB-1", fromClubId: "aaad", fromClubName: "Old Club" }],
    });
    expect(doc(db, "clubs/aaad")).toMatchObject({ courtIds: ["efghj"], deviceIds: [] });
    expect(doc(db, "courts/abcde").clubId).toBe(result.clubId);
    expect(doc(db, "courts/efghj").clubId).toBe("aaad");
    expect(doc(db, "devices/HUB-1").clubId).toBe(result.clubId);
  });
});

describe("updateClub", () => {
  const seed = () => ({
    "clubs/aaab": {
      name: "Club One",
      state: CLUB_STATES.OPEN,
      courtIds: ["abcde", "efghj"],
      deviceIds: ["HUB-1"],
    },
    "clubs/aaac": {
      name: "Club Two",
      state: CLUB_STATES.OPEN,
      courtIds: ["jkmnp"],
      deviceIds: ["PULSE-9"],
    },
    "courts/abcde": { name: "A", clubId: "aaab" },
    "courts/efghj": { name: "E", clubId: "aaab" },
    "courts/jkmnp": { name: "J", clubId: "aaac" },
    "courts/pqrst": { name: "P" },
    "devices/HUB-1": { clubId: "aaab" },
    "devices/PULSE-9": { clubId: "aaac" },
    "devices/BEACON-3": {},
  });

  test("replaces the members: dropped ones are released, new ones linked", async () => {
    const { functions, db } = loadFunctions(seed());

    const result = await call(functions.updateClub, {
      clubId: "aaab",
      name: "Club One Renamed",
      courtIds: ["efghj", "pqrst"],
      deviceIds: ["BEACON-3"],
    });

    expect(result).toEqual({
      clubId: "aaab",
      name: "Club One Renamed",
      state: CLUB_STATES.OPEN,
      courtIds: ["efghj", "pqrst"],
      deviceIds: ["BEACON-3"],
      moved: { courts: [], devices: [] },
      closedTournamentIds: [],
    });
    expect(doc(db, "clubs/aaab")).toMatchObject({
      name: "Club One Renamed",
      courtIds: ["efghj", "pqrst"],
      deviceIds: ["BEACON-3"],
    });
    expect(doc(db, "clubs/aaab").createdAt).toBeUndefined();
    expect(doc(db, "courts/abcde").clubId).toBeNull();
    expect(doc(db, "courts/efghj").clubId).toBe("aaab");
    expect(doc(db, "courts/pqrst").clubId).toBe("aaab");
    expect(doc(db, "devices/HUB-1").clubId).toBeNull();
    expect(doc(db, "devices/BEACON-3").clubId).toBe("aaab");
    expect(doc(db, "clubs/aaac")).toEqual(seed()["clubs/aaac"]);
  });

  test("taking a member from another club removes it from that club", async () => {
    const { functions, db } = loadFunctions(seed());

    const result = await call(functions.updateClub, {
      clubId: "aaab",
      name: "Club One",
      state: CLUB_STATES.OPEN,
      courtIds: ["abcde", "efghj", "jkmnp"],
      deviceIds: ["HUB-1", "PULSE-9"],
    });

    expect(result.moved).toEqual({
      courts: [{ id: "jkmnp", fromClubId: "aaac", fromClubName: "Club Two" }],
      devices: [{ id: "PULSE-9", fromClubId: "aaac", fromClubName: "Club Two" }],
    });
    expect(doc(db, "clubs/aaac")).toMatchObject({ courtIds: [], deviceIds: [] });
    expect(doc(db, "courts/jkmnp").clubId).toBe("aaab");
    expect(doc(db, "devices/PULSE-9").clubId).toBe("aaab");
  });

  test("a member never sits in two club lists, even when its clubId is stale", async () => {
    const docs = seed();
    // jkmn is listed by the other club but its own document lost the clubId.
    delete docs["courts/jkmnp"].clubId;
    const { functions, db } = loadFunctions(docs);

    await call(functions.updateClub, {
      clubId: "aaab",
      name: "Club One",
      courtIds: ["jkmnp"],
      deviceIds: [],
    });

    expect(doc(db, "clubs/aaab").courtIds).toEqual(["jkmnp"]);
    expect(doc(db, "clubs/aaac").courtIds).toEqual([]);
    expect(doc(db, "courts/jkmnp").clubId).toBe("aaab");
  });

  test("a dropped member already claimed by another club keeps that club", async () => {
    const docs = seed();
    docs["courts/efghj"].clubId = "aaac";
    const { functions, db } = loadFunctions(docs);

    await call(functions.updateClub, {
      clubId: "aaab",
      name: "Club One",
      courtIds: ["abcde"],
      deviceIds: ["HUB-1"],
    });

    expect(doc(db, "courts/efghj").clubId).toBe("aaac");
  });

  test("ids of deleted members are dropped from the club without error", async () => {
    const docs = seed();
    delete docs["courts/efghj"];
    const { functions, db } = loadFunctions(docs);

    await call(functions.updateClub, {
      clubId: "aaab",
      name: "Club One",
      courtIds: ["abcde"],
      deviceIds: ["HUB-1"],
    });

    expect(doc(db, "clubs/aaab").courtIds).toEqual(["abcde"]);
    expect(db.docs.has("courts/efghj")).toBe(false);
  });

  test("large member lists are looked up in batches of 30", async () => {
    const docs = { "clubs/aaab": { name: "Club One", courtIds: [], deviceIds: [] } };
    const courtIds = Array.from(
      { length: 35 },
      (_, i) =>
        `aaa${ID_ALPHABET[Math.floor(i / ID_ALPHABET.length)]}${ID_ALPHABET[i % ID_ALPHABET.length]}`,
    );
    for (const id of courtIds) docs[`courts/${id}`] = {};
    docs["clubs/aaac"] = { name: "Club Two", courtIds: [courtIds[33]], deviceIds: [] };
    docs[`courts/${courtIds[33]}`] = { clubId: "aaac" };
    const { functions, db } = loadFunctions(docs);

    const result = await call(functions.updateClub, {
      clubId: "aaab",
      name: "Club One",
      courtIds,
      deviceIds: [],
    });

    const courtQueries = db.queries.filter((query) => query.filters[0].field === "courtIds");
    expect(courtQueries.map((query) => query.filters[0].value.length)).toEqual([30, 5]);
    expect(result.moved.courts).toEqual([
      { id: courtIds[33], fromClubId: "aaac", fromClubName: "Club Two" },
    ]);
    expect(doc(db, "clubs/aaac").courtIds).toEqual([]);
  });

  test("an unknown club is reported as not-found", async () => {
    const { functions } = loadFunctions(seed());
    await expect(
      call(functions.updateClub, { clubId: "zzzz", name: "X", courtIds: [], deviceIds: [] }),
    ).rejects.toMatchObject({ code: "not-found", message: "Club zzzz not found." });
  });
});

describe("deleteClub", () => {
  test("deletes the club and clears clubId on the members it still owns", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaab": { name: "Club One", courtIds: ["abcde", "efghj"], deviceIds: ["HUB-1"] },
      "courts/abcde": { name: "A", clubId: "aaab" },
      "courts/efghj": { name: "E", clubId: "aaac" },
      "devices/HUB-1": { clubId: "aaab" },
    });

    const result = await call(functions.deleteClub, { clubId: "aaab" });

    expect(result).toEqual({ clubId: "aaab", releasedCount: 2 });
    expect(db.docs.has("clubs/aaab")).toBe(false);
    expect(doc(db, "courts/abcde")).toEqual({ name: "A", clubId: null });
    expect(doc(db, "courts/efghj").clubId).toBe("aaac");
    expect(doc(db, "devices/HUB-1").clubId).toBeNull();
  });

  test("an unknown club is reported as not-found", async () => {
    const { functions } = loadFunctions({});
    await expect(call(functions.deleteClub, { clubId: "zzzz" })).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

describe("member deletion triggers", () => {
  test("a deleted court or device leaves every club that listed it", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaab": { name: "One", courtIds: ["abcde", "efghj"], deviceIds: ["HUB-1"] },
      "clubs/aaac": { name: "Two", courtIds: ["abcde"], deviceIds: [] },
    });

    await functions.onCourtDeleted({ params: { courtId: "abcde" } });
    await functions.onDeviceDeleted({ params: { deviceId: "HUB-1" } });

    expect(doc(db, "clubs/aaab")).toMatchObject({ courtIds: ["efghj"], deviceIds: [] });
    expect(doc(db, "clubs/aaac")).toMatchObject({ courtIds: [] });
  });
});

describe("club rules - edge cases", () => {
  test("the device limit is enforced separately from the court limit", () => {
    const devices = Array.from({ length: MAX_CLUB_DEVICES }, (_, i) => `D${i}`);
    expect(normalizeMemberIds(devices, "devices")).toHaveLength(MAX_CLUB_DEVICES);
    expect(() => normalizeMemberIds([...devices, "one-more"], "devices")).toThrow(
      `A club can have at most ${MAX_CLUB_DEVICES} devices.`,
    );
  });

  test("saving the members a club already has plans no changes", () => {
    const plan = planMembershipChange({
      clubId: "mine",
      previousIds: ["a", "b"],
      nextIds: ["a", "b"],
      members: new Map([
        ["a", { clubId: "mine" }],
        ["b", { clubId: "mine" }],
      ]),
      holders: new Map(),
    });
    expect(plan).toEqual({
      missingIds: [],
      assign: [],
      release: [],
      moved: [],
      removeFromClubs: new Map(),
    });
  });

  test("a dropped member without a clubId is released, one claimed elsewhere is not", () => {
    const plan = planMembershipChange({
      clubId: "mine",
      previousIds: ["no-club-id", "claimed", "gone"],
      nextIds: [],
      members: new Map([
        ["no-club-id", {}],
        ["claimed", { clubId: "other" }],
        ["gone", undefined],
      ]),
      holders: new Map(),
    });
    expect(plan.release).toEqual(["no-club-id"]);
  });
});

describe("club persistence - edge cases", () => {
  test("creating gives up with aborted after five id collisions", async () => {
    const docs = {};
    for (const id of ["aaaa"]) docs[`clubs/${id}`] = { name: "Taken" };
    const { service, db } = loadFunctions(docs);

    await expect(
      service.createClub({ name: "Unlucky" }, { randomInt: () => 0 }),
    ).rejects.toMatchObject({
      code: "aborted",
    });
    expect([...db.docs.keys()]).toEqual(["clubs/aaaa"]);
  });

  test("an update naming an unknown member is rejected and writes nothing", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaab": { name: "One", courtIds: ["abcde"], deviceIds: [] },
      "clubs/aaac": { name: "Two", courtIds: ["efghj"], deviceIds: [] },
      "courts/abcde": { clubId: "aaab" },
      "courts/efghj": { clubId: "aaac" },
    });
    const before = structuredClone([...db.docs]);

    await expect(
      call(functions.updateClub, {
        clubId: "aaab",
        name: "One",
        courtIds: ["efghj"],
        deviceIds: ["NOPE-1"],
      }),
    ).rejects.toMatchObject({ code: "not-found", message: "Unknown device id(s): NOPE-1." });
    expect([...db.docs]).toEqual(before);
    expect(db.writes).toEqual([]);
  });

  test("saving unchanged members only rewrites the club document", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaab": { name: "One", courtIds: ["abcde"], deviceIds: ["HUB-1"] },
      "courts/abcde": { clubId: "aaab" },
      "devices/HUB-1": { clubId: "aaab" },
    });

    await call(functions.updateClub, {
      clubId: "aaab",
      name: "One Renamed",
      courtIds: ["abcde"],
      deviceIds: ["HUB-1"],
    });

    expect(db.writes).toEqual([{ type: "set", path: "clubs/aaab" }]);
    expect(doc(db, "clubs/aaab").name).toBe("One Renamed");
  });

  test("a member pointing at a club that no longer exists is simply taken over", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaab": { name: "One", courtIds: [], deviceIds: [] },
      "courts/abcde": { clubId: "xxxx" },
    });

    const result = await call(functions.updateClub, {
      clubId: "aaab",
      name: "One",
      courtIds: ["abcde"],
      deviceIds: [],
    });

    expect(result.moved.courts).toEqual([{ id: "abcde", fromClubId: "xxxx", fromClubName: null }]);
    expect(db.docs.has("clubs/xxxx")).toBe(false);
    expect(doc(db, "courts/abcde").clubId).toBe("aaab");
  });

  test("deleting a club tolerates members whose documents were deleted", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaab": { name: "One", courtIds: ["pqrst"], deviceIds: ["HUB-1"] },
      "devices/HUB-1": { clubId: "aaab" },
    });

    await expect(call(functions.deleteClub, { clubId: "aaab" })).resolves.toEqual({
      clubId: "aaab",
      releasedCount: 1,
    });
    expect(db.docs.has("courts/pqrst")).toBe(false);
    expect(db.docs.has("clubs/aaab")).toBe(false);
  });

  test("the callables accept a request without data as invalid input", async () => {
    const { functions } = loadFunctions({});
    for (const handler of [functions.createClub, functions.updateClub, functions.deleteClub]) {
      await expect(handler({})).rejects.toMatchObject({ code: "invalid-argument" });
    }
  });

  test("unexpected failures are not disguised as club errors", async () => {
    const { functions, db } = loadFunctions({ "courts/abcde": {} });
    const failure = new Error("Firestore unavailable");
    db.failNextTransaction = failure;

    await expect(call(functions.createClub, { name: "Club", courtIds: ["abcde"] })).rejects.toBe(
      failure,
    );
  });

  test("a deleted member that no club lists causes no writes", async () => {
    const { functions, db } = loadFunctions({
      "clubs/aaab": { name: "One", courtIds: ["abcde"], deviceIds: [] },
    });

    await functions.onCourtDeleted({ params: { courtId: "zzzzz" } });
    expect(db.writes).toEqual([]);
  });
});

describe("Cloud Functions exports", () => {
  test("the club functions are exported next to every existing function", () => {
    const { functions } = loadFunctions({});
    expect(Object.keys(functions).sort()).toEqual(
      [
        "changeoverCourt",
        "createClub",
        "createCourt",
        "deleteClub",
        "getCourtMomentum",
        "getCourtScore",
        "getCourtScoreRevision",
        "getCourtStats",
        "getDetailedScore",
        "idRetentionWorker",
        "manageMatch",
        "manageTournament",
        "onClubDeleted",
        "onCourtDeleted",
        "onDeviceDeleted",
        "onEventCreate",
        "onMatchDeleted",
        "onRetentionJobCreated",
        "onTournamentDeleted",
        "postEvent",
        "resetCourt",
        "updateClub",
        "updateScoringOptions",
      ].sort(),
    );
    for (const name of Object.keys(functions)) {
      expect(typeof functions[name]).toBe("function");
    }
  });
});
