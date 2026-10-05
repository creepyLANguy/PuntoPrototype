// Clubs: the membership rules (pure) and the club callables / deletion
// triggers running against an in-memory Firestore.
let mockDb = null;

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
  CLUB_ID_ALPHABET,
  CLUB_ID_LENGTH,
  CLUB_NAME_MAX_LENGTH,
  MAX_CLUB_COURTS,
  MAX_CLUB_DEVICES,
  CLUB_STATES,
  DEFAULT_CLUB_STATE,
  ClubError,
  generateClubId,
  normalizeClubId,
  normalizeClubName,
  normalizeClubState,
  normalizeMemberIds,
  planMembershipChange,
} = require("./domain/clubs/membership");

// In-memory Firestore with the surface the club service uses. Transactions
// enforce Firestore's rule that every read happens before the first write.
class FakeFirestore {
  constructor(docs = {}) {
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
          const list = this.docs.get(docPath)[field];
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
    if (this.failNextTransaction) {
      const error = this.failNextTransaction;
      this.failNextTransaction = null;
      throw error;
    }
    const writes = [];
    const tx = {
      get: async (target) => {
        if (writes.length > 0)
          throw new Error("Firestore transactions require all reads before writes");
        return target.kind === "doc" ? this.snapshot(target.path) : target.get();
      },
      set: (ref, data, options) => writes.push({ type: "set", path: ref.path, data, options }),
      delete: (ref) => writes.push({ type: "delete", path: ref.path }),
    };

    const result = await callback(tx);
    for (const write of writes) {
      if (write.type === "delete") {
        this.writes.push({ type: "delete", path: write.path });
        this.docs.delete(write.path);
      } else this.applyWrite(write.path, write.data, write.options);
    }
    return result;
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
    expect(normalizeMemberIds([" abcd ", "SN-1", "abcd", "sn-1"], "devices")).toEqual([
      "abcd",
      "SN-1",
      "sn-1",
    ]);
    expect(normalizeMemberIds(undefined, "courts")).toEqual([]);
  });

  test("malformed or oversized member lists are rejected", () => {
    expect(() => normalizeMemberIds("abcd", "courts")).toThrow("court ids must be a list.");
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
    const tooMany = Array.from({ length: MAX_CLUB_COURTS + 1 }, (_, i) => `c${i}`);
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

  test("club ids are normalised to lower case and must be usable as a document id", () => {
    expect(normalizeClubId(" ABCDEF ")).toBe("abcdef");
    for (const bad of [undefined, "", "a/b", 12]) {
      expect(() => normalizeClubId(bad)).toThrow("A valid clubId is required.");
    }
  });

  test("generated club ids use the court id alphabet", () => {
    const values = [0, 0.99, 0.5, 0.25, 0.75, 0.1];
    let i = 0;
    const id = generateClubId(() => values[i++]);
    expect(id).toHaveLength(CLUB_ID_LENGTH);
    expect([...id].every((char) => CLUB_ID_ALPHABET.includes(char))).toBe(true);
    expect(id[0]).toBe(CLUB_ID_ALPHABET[0]);
    expect(id[1]).toBe(CLUB_ID_ALPHABET[CLUB_ID_ALPHABET.length - 1]);
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
      "courts/abcd": { name: "Court 1" },
      "courts/efgh": { name: "Court 2", clubId: null },
      "devices/HUB-1": { courtId: "abcd" },
    });

    const values = [0, 0, 0, 0, 0, 0];
    const result = await service.createClub(
      { name: " Central  Padel ", courtIds: ["abcd", "efgh"], deviceIds: ["HUB-1"] },
      { random: () => values.shift() ?? 0 },
    );

    expect(result).toEqual({
      clubId: "aaaaaa",
      name: "Central Padel",
      state: DEFAULT_CLUB_STATE,
      courtIds: ["abcd", "efgh"],
      deviceIds: ["HUB-1"],
      moved: { courts: [], devices: [] },
      closedTournamentIds: [],
    });
    expect(doc(db, "clubs/aaaaaa")).toEqual({
      name: "Central Padel",
      courtIds: ["abcd", "efgh"],
      deviceIds: ["HUB-1"],
      state: DEFAULT_CLUB_STATE,
      createdAt: { __serverTimestamp: true },
      updatedAt: { __serverTimestamp: true },
    });
    expect(doc(db, "courts/abcd")).toEqual({ name: "Court 1", clubId: "aaaaaa" });
    expect(doc(db, "courts/efgh")).toEqual({ name: "Court 2", clubId: "aaaaaa" });
    expect(doc(db, "devices/HUB-1")).toEqual({ courtId: "abcd", clubId: "aaaaaa" });
  });

  test("a generated id that is already taken is replaced by a fresh one", async () => {
    const { service, db } = loadFunctions({ "clubs/aaaaaa": { name: "Taken" } });
    const ids = [..."aaaaaa", ..."bbbbbb"].map(
      (char) => (CLUB_ID_ALPHABET.indexOf(char) + 0.5) / CLUB_ID_ALPHABET.length,
    );

    const result = await service.createClub({ name: "Second" }, { random: () => ids.shift() });

    expect(result.clubId).toBe("bbbbbb");
    expect(doc(db, "clubs/aaaaaa")).toEqual({ name: "Taken" });
    expect(doc(db, "clubs/bbbbbb").name).toBe("Second");
  });

  test("the callable rejects unknown members and writes nothing", async () => {
    const { functions, db } = loadFunctions({ "courts/abcd": { name: "Court 1" } });
    const before = structuredClone([...db.docs]);

    await expect(
      call(functions.createClub, { name: "Club", courtIds: ["abcd", "zzzz"] }),
    ).rejects.toMatchObject({ code: "not-found", message: "Unknown court id(s): zzzz." });
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
      "clubs/club01": {
        name: "Club One",
        state: CLUB_STATES.OPEN,
        courtIds: ["abcd"],
        deviceIds: ["HUB-1"],
      },
      "courts/abcd": {
        name: "A",
        clubId: "club01",
        status: "open",
        activeMatchId: "live-match",
      },
      "devices/HUB-1": { clubId: "club01" },
      "matches/live-match": {
        status: "live",
        currentCourtId: "abcd",
      },
      "matches/tournament-match": {
        status: "scheduled",
        currentCourtId: null,
        tournamentId: "club-tournament",
      },
      "tournaments/club-tournament": {
        tournamentId: "club-tournament",
        name: "Saturday Tournament",
        status: "published",
        clubId: "club01",
        revision: 3,
      },
      "tournaments/club-tournament/fixtures/f1": {
        fixtureId: "f1",
        status: "scheduled",
        matchId: "tournament-match",
      },
    });

    await call(functions.updateClub, {
      clubId: "club01",
      name: "Club One",
      state: CLUB_STATES.CLOSED,
      courtIds: ["abcd"],
      deviceIds: [],
    });

    expect(doc(db, "clubs/club01")).toMatchObject({
      state: CLUB_STATES.CLOSED,
      courtIds: ["abcd"],
      deviceIds: [],
    });
    expect(doc(db, "courts/abcd")).toMatchObject({
      status: "closed",
      clubId: "club01",
      activeMatchId: null,
    });
    expect(doc(db, "devices/HUB-1").clubId).toBeNull();
    expect(doc(db, "matches/live-match")).toMatchObject({
      status: "live",
      currentCourtId: null,
    });
    expect(doc(db, "matches/tournament-match")).toMatchObject({
      status: "cancelled",
      currentCourtId: null,
    });
    expect(doc(db, "tournaments/club-tournament").status).toBe("cancelled");
    expect(doc(db, "tournaments/club-tournament/fixtures/f1").status).toBe("cancelled");
  });

  test("moving an open club to maintenance does not cascade its entities", async () => {
    const { functions, db } = loadFunctions({
      "clubs/club01": {
        name: "Club One",
        state: CLUB_STATES.OPEN,
        courtIds: ["abcd"],
        deviceIds: ["HUB-1"],
      },
      "courts/abcd": {
        name: "A",
        clubId: "club01",
        status: "open",
        activeMatchId: "live-match",
      },
      "devices/HUB-1": { clubId: "club01" },
      "matches/live-match": { status: "live", currentCourtId: "abcd" },
    });

    await call(functions.updateClub, {
      clubId: "club01",
      name: "Club One",
      state: CLUB_STATES.MAINTENANCE,
      courtIds: ["abcd"],
      deviceIds: ["HUB-1"],
    });

    expect(doc(db, "clubs/club01").state).toBe(CLUB_STATES.MAINTENANCE);
    expect(doc(db, "courts/abcd")).toMatchObject({ status: "open", activeMatchId: "live-match" });
    expect(doc(db, "devices/HUB-1").clubId).toBe("club01");
    expect(doc(db, "matches/live-match").currentCourtId).toBe("abcd");
  });

  test("members of another club are moved to the new club", async () => {
    const { functions, db } = loadFunctions({
      "clubs/other1": {
      name: "Old Club",
      state: DEFAULT_CLUB_STATE,
      courtIds: ["abcd", "efgh"],
      deviceIds: ["HUB-1"],
    },
      "courts/abcd": { clubId: "other1" },
      "courts/efgh": { clubId: "other1" },
      "devices/HUB-1": { clubId: "other1" },
    });

    const result = await call(functions.createClub, {
      name: "New Club",
      courtIds: ["abcd"],
      deviceIds: ["HUB-1"],
    });

    expect(result.moved).toEqual({
      courts: [{ id: "abcd", fromClubId: "other1", fromClubName: "Old Club" }],
      devices: [{ id: "HUB-1", fromClubId: "other1", fromClubName: "Old Club" }],
    });
    expect(doc(db, "clubs/other1")).toMatchObject({ courtIds: ["efgh"], deviceIds: [] });
    expect(doc(db, "courts/abcd").clubId).toBe(result.clubId);
    expect(doc(db, "courts/efgh").clubId).toBe("other1");
    expect(doc(db, "devices/HUB-1").clubId).toBe(result.clubId);
  });
});

describe("updateClub", () => {
  const seed = () => ({
    "clubs/club01": { name: "Club One", state: CLUB_STATES.OPEN, courtIds: ["abcd", "efgh"], deviceIds: ["HUB-1"] },
    "clubs/club02": { name: "Club Two", state: CLUB_STATES.OPEN, courtIds: ["jkmn"], deviceIds: ["PULSE-9"] },
    "courts/abcd": { name: "A", clubId: "club01" },
    "courts/efgh": { name: "E", clubId: "club01" },
    "courts/jkmn": { name: "J", clubId: "club02" },
    "courts/pqrs": { name: "P" },
    "devices/HUB-1": { clubId: "club01" },
    "devices/PULSE-9": { clubId: "club02" },
    "devices/BEACON-3": {},
  });

  test("replaces the members: dropped ones are released, new ones linked", async () => {
    const { functions, db } = loadFunctions(seed());

    const result = await call(functions.updateClub, {
      clubId: "CLUB01",
      name: "Club One Renamed",
      courtIds: ["efgh", "pqrs"],
      deviceIds: ["BEACON-3"],
    });

    expect(result).toEqual({
      clubId: "club01",
      name: "Club One Renamed",
      state: CLUB_STATES.OPEN,
      courtIds: ["efgh", "pqrs"],
      deviceIds: ["BEACON-3"],
      moved: { courts: [], devices: [] },
      closedTournamentIds: [],
    });
    expect(doc(db, "clubs/club01")).toMatchObject({
      name: "Club One Renamed",
      courtIds: ["efgh", "pqrs"],
      deviceIds: ["BEACON-3"],
    });
    expect(doc(db, "clubs/club01").createdAt).toBeUndefined();
    expect(doc(db, "courts/abcd").clubId).toBeNull();
    expect(doc(db, "courts/efgh").clubId).toBe("club01");
    expect(doc(db, "courts/pqrs").clubId).toBe("club01");
    expect(doc(db, "devices/HUB-1").clubId).toBeNull();
    expect(doc(db, "devices/BEACON-3").clubId).toBe("club01");
    expect(doc(db, "clubs/club02")).toEqual(seed()["clubs/club02"]);
  });

  test("taking a member from another club removes it from that club", async () => {
    const { functions, db } = loadFunctions(seed());

    const result = await call(functions.updateClub, {
      clubId: "club01",
      name: "Club One",
      state: CLUB_STATES.OPEN,
      courtIds: ["abcd", "efgh", "jkmn"],
      deviceIds: ["HUB-1", "PULSE-9"],
    });

    expect(result.moved).toEqual({
      courts: [{ id: "jkmn", fromClubId: "club02", fromClubName: "Club Two" }],
      devices: [{ id: "PULSE-9", fromClubId: "club02", fromClubName: "Club Two" }],
    });
    expect(doc(db, "clubs/club02")).toMatchObject({ courtIds: [], deviceIds: [] });
    expect(doc(db, "courts/jkmn").clubId).toBe("club01");
    expect(doc(db, "devices/PULSE-9").clubId).toBe("club01");
  });

  test("a member never sits in two club lists, even when its clubId is stale", async () => {
    const docs = seed();
    // jkmn is listed by club02 but its own document lost the clubId.
    delete docs["courts/jkmn"].clubId;
    const { functions, db } = loadFunctions(docs);

    await call(functions.updateClub, {
      clubId: "club01",
      name: "Club One",
      courtIds: ["jkmn"],
      deviceIds: [],
    });

    expect(doc(db, "clubs/club01").courtIds).toEqual(["jkmn"]);
    expect(doc(db, "clubs/club02").courtIds).toEqual([]);
    expect(doc(db, "courts/jkmn").clubId).toBe("club01");
  });

  test("a dropped member already claimed by another club keeps that club", async () => {
    const docs = seed();
    docs["courts/efgh"].clubId = "club02";
    const { functions, db } = loadFunctions(docs);

    await call(functions.updateClub, {
      clubId: "club01",
      name: "Club One",
      courtIds: ["abcd"],
      deviceIds: ["HUB-1"],
    });

    expect(doc(db, "courts/efgh").clubId).toBe("club02");
  });

  test("ids of deleted members are dropped from the club without error", async () => {
    const docs = seed();
    delete docs["courts/efgh"];
    const { functions, db } = loadFunctions(docs);

    await call(functions.updateClub, {
      clubId: "club01",
      name: "Club One",
      courtIds: ["abcd"],
      deviceIds: ["HUB-1"],
    });

    expect(doc(db, "clubs/club01").courtIds).toEqual(["abcd"]);
    expect(db.docs.has("courts/efgh")).toBe(false);
  });

  test("large member lists are looked up in batches of 30", async () => {
    const docs = { "clubs/club01": { name: "Club One", courtIds: [], deviceIds: [] } };
    const courtIds = Array.from({ length: 35 }, (_, i) => `c${String(i).padStart(2, "0")}`);
    for (const id of courtIds) docs[`courts/${id}`] = {};
    docs["clubs/club02"] = { name: "Club Two", courtIds: ["c33"], deviceIds: [] };
    docs["courts/c33"] = { clubId: "club02" };
    const { functions, db } = loadFunctions(docs);

    const result = await call(functions.updateClub, {
      clubId: "club01",
      name: "Club One",
      courtIds,
      deviceIds: [],
    });

    const courtQueries = db.queries.filter((query) => query.filters[0].field === "courtIds");
    expect(courtQueries.map((query) => query.filters[0].value.length)).toEqual([30, 5]);
    expect(result.moved.courts).toEqual([
      { id: "c33", fromClubId: "club02", fromClubName: "Club Two" },
    ]);
    expect(doc(db, "clubs/club02").courtIds).toEqual([]);
  });

  test("an unknown club is reported as not-found", async () => {
    const { functions } = loadFunctions(seed());
    await expect(
      call(functions.updateClub, { clubId: "nope00", name: "X", courtIds: [], deviceIds: [] }),
    ).rejects.toMatchObject({ code: "not-found", message: "Club nope00 not found." });
  });
});

describe("deleteClub", () => {
  test("deletes the club and clears clubId on the members it still owns", async () => {
    const { functions, db } = loadFunctions({
      "clubs/club01": { name: "Club One", courtIds: ["abcd", "efgh"], deviceIds: ["HUB-1"] },
      "courts/abcd": { name: "A", clubId: "club01" },
      "courts/efgh": { name: "E", clubId: "club02" },
      "devices/HUB-1": { clubId: "club01" },
    });

    const result = await call(functions.deleteClub, { clubId: "club01" });

    expect(result).toEqual({ clubId: "club01", releasedCount: 2 });
    expect(db.docs.has("clubs/club01")).toBe(false);
    expect(doc(db, "courts/abcd")).toEqual({ name: "A", clubId: null });
    expect(doc(db, "courts/efgh").clubId).toBe("club02");
    expect(doc(db, "devices/HUB-1").clubId).toBeNull();
  });

  test("an unknown club is reported as not-found", async () => {
    const { functions } = loadFunctions({});
    await expect(call(functions.deleteClub, { clubId: "nope00" })).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

describe("member deletion triggers", () => {
  test("a deleted court or device leaves every club that listed it", async () => {
    const { functions, db } = loadFunctions({
      "clubs/club01": { name: "One", courtIds: ["abcd", "efgh"], deviceIds: ["HUB-1"] },
      "clubs/club02": { name: "Two", courtIds: ["abcd"], deviceIds: [] },
    });

    await functions.onCourtDeleted({ params: { courtId: "abcd" } });
    await functions.onDeviceDeleted({ params: { deviceId: "HUB-1" } });

    expect(doc(db, "clubs/club01")).toMatchObject({ courtIds: ["efgh"], deviceIds: [] });
    expect(doc(db, "clubs/club02")).toMatchObject({ courtIds: [] });
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
    for (const id of ["aaaaaa"]) docs[`clubs/${id}`] = { name: "Taken" };
    const { service, db } = loadFunctions(docs);

    await expect(
      service.createClub({ name: "Unlucky" }, { random: () => 0 }),
    ).rejects.toMatchObject({
      code: "aborted",
    });
    expect([...db.docs.keys()]).toEqual(["clubs/aaaaaa"]);
  });

  test("an update naming an unknown member is rejected and writes nothing", async () => {
    const { functions, db } = loadFunctions({
      "clubs/club01": { name: "One", courtIds: ["abcd"], deviceIds: [] },
      "clubs/club02": { name: "Two", courtIds: ["efgh"], deviceIds: [] },
      "courts/abcd": { clubId: "club01" },
      "courts/efgh": { clubId: "club02" },
    });
    const before = structuredClone([...db.docs]);

    await expect(
      call(functions.updateClub, {
        clubId: "club01",
        name: "One",
        courtIds: ["efgh"],
        deviceIds: ["NOPE-1"],
      }),
    ).rejects.toMatchObject({ code: "not-found", message: "Unknown device id(s): NOPE-1." });
    expect([...db.docs]).toEqual(before);
    expect(db.writes).toEqual([]);
  });

  test("saving unchanged members only rewrites the club document", async () => {
    const { functions, db } = loadFunctions({
      "clubs/club01": { name: "One", courtIds: ["abcd"], deviceIds: ["HUB-1"] },
      "courts/abcd": { clubId: "club01" },
      "devices/HUB-1": { clubId: "club01" },
    });

    await call(functions.updateClub, {
      clubId: "club01",
      name: "One Renamed",
      courtIds: ["abcd"],
      deviceIds: ["HUB-1"],
    });

    expect(db.writes).toEqual([{ type: "set", path: "clubs/club01" }]);
    expect(doc(db, "clubs/club01").name).toBe("One Renamed");
  });

  test("a member pointing at a club that no longer exists is simply taken over", async () => {
    const { functions, db } = loadFunctions({
      "clubs/club01": { name: "One", courtIds: [], deviceIds: [] },
      "courts/abcd": { clubId: "vanished" },
    });

    const result = await call(functions.updateClub, {
      clubId: "club01",
      name: "One",
      courtIds: ["abcd"],
      deviceIds: [],
    });

    expect(result.moved.courts).toEqual([
      { id: "abcd", fromClubId: "vanished", fromClubName: null },
    ]);
    expect(db.docs.has("clubs/vanished")).toBe(false);
    expect(doc(db, "courts/abcd").clubId).toBe("club01");
  });

  test("deleting a club tolerates members whose documents were deleted", async () => {
    const { functions, db } = loadFunctions({
      "clubs/club01": { name: "One", courtIds: ["gone"], deviceIds: ["HUB-1"] },
      "devices/HUB-1": { clubId: "club01" },
    });

    await expect(call(functions.deleteClub, { clubId: "club01" })).resolves.toEqual({
      clubId: "club01",
      releasedCount: 1,
    });
    expect(db.docs.has("courts/gone")).toBe(false);
    expect(db.docs.has("clubs/club01")).toBe(false);
  });

  test("the callables accept a request without data as invalid input", async () => {
    const { functions } = loadFunctions({});
    for (const handler of [functions.createClub, functions.updateClub, functions.deleteClub]) {
      await expect(handler({})).rejects.toMatchObject({ code: "invalid-argument" });
    }
  });

  test("unexpected failures are not disguised as club errors", async () => {
    const { functions, db } = loadFunctions({ "courts/abcd": {} });
    const failure = new Error("Firestore unavailable");
    db.failNextTransaction = failure;

    await expect(call(functions.createClub, { name: "Club", courtIds: ["abcd"] })).rejects.toBe(
      failure,
    );
  });

  test("a deleted member that no club lists causes no writes", async () => {
    const { functions, db } = loadFunctions({
      "clubs/club01": { name: "One", courtIds: ["abcd"], deviceIds: [] },
    });

    await functions.onCourtDeleted({ params: { courtId: "zzzz" } });
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
        "deleteClub",
        "getCourtMomentum",
        "getCourtScore",
        "getCourtScoreRevision",
        "getCourtStats",
        "getDetailedScore",
        "manageMatch",
        "manageTournament",
        "onCourtDeleted",
        "onDeviceDeleted",
        "onEventCreate",
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
