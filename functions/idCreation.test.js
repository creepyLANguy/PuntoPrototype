const crypto = require("crypto");
const { FakeFirestore } = require("./testSupport/fakeFirestore");
const {
  seededAllocationId,
  seedAllocationTokens,
  withExpectedAllocations,
} = require("./testSupport/expectedAllocations");

let mockDb;
jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (_config, handler) => handler,
  onDocumentDeleted: (_config, handler) => handler,
}));
jest.mock("firebase-functions/v2/https", () => ({
  onCall: (_config, handler) => handler,
  onRequest: (_config, handler) => handler,
}));
// Services see the production guarded singleton over the in-memory store.
jest.mock("./infrastructure/firebase", () => {
  const { createGuardedFirestore } = jest.requireActual("./infrastructure/dataGuard");
  const guarded = new WeakMap();
  return {
    get db() {
      if (!guarded.has(mockDb)) guarded.set(mockDb, createGuardedFirestore(mockDb));
      return guarded.get(mockDb);
    },
    get rawDb() {
      return mockDb;
    },
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
    FieldPath: { documentId: () => "__name__" },
  };
});

let api;
let matchService;
beforeEach(() => {
  jest.resetModules();
  mockDb = new FakeFirestore(
    seedAllocationTokens({
      "admin/goodies": { skeletonKey: "test-admin" },
      "courts/abcde": { name: "Court A", status: "open", password: "court-pass" },
      "courts/efghj": { name: "Court B", status: "open", password: "court-pass" },
    }),
  );
  api = require("./index");
  matchService = require("./services/matchService");
});
afterEach(() => jest.restoreAllMocks());

const court = (data, credentials = { adminKey: "test-admin" }) =>
  api.createCourt({ data: withExpectedAllocations(mockDb, { ...data, credentials }) });
const club = (data) => api.createClub({ data: withExpectedAllocations(mockDb, data) });
const historicalRoot = (path) => ({
  historical: true,
  allocationId: seededAllocationId(path),
});
const match = (data) =>
  api.manageMatch({
    data: withExpectedAllocations(mockDb, {
      operation: "createMatch",
      ...data,
      credentials: { adminKey: "test-admin" },
    }),
  });
const tournament = (operation, data) =>
  api.manageTournament({
    data: withExpectedAllocations(mockDb, {
      operation,
      ...data,
      credentials: { adminKey: "test-admin" },
    }),
  });
const ensureCourtMatch = () =>
  api.manageMatch({
    data: withExpectedAllocations(mockDb, { operation: "ensureCourtMatch", courtId: "abcde" }),
  });

describe("callable allocation expectations", () => {
  test("fixture references bind existing generations without repairing missing or stale tokens", () => {
    const docs = seedAllocationTokens({
      "courts/abcde": {
        activeMatchId: "aaaaaa",
        lastMatchId: "aaaaaa",
        occupiedByMatchId: "aaaaaa",
        clubId: "aaaa",
      },
      "matches/aaaaaa": {
        matchId: "aaaaaa",
        currentCourtId: "abcde",
        lastCourtId: "abcde",
        tournamentId: "aaaaaaa",
      },
      "clubs/aaaa": {},
      "tournaments/aaaaaaa": { allocationId: "observed-tournament" },
      "devices/current": { courtId: "abcde", sourceCourtId: "abcde", targetCourtId: "efghj" },
      "devices/missing": { courtId: "abcde", courtAllocationId: null },
      "devices/stale": { courtId: "abcde", courtAllocationId: "old-court" },
      "matches/bbbbbb": { currentCourtId: "efghj" },
    });
    expect(docs["courts/abcde"]).toMatchObject({
      activeMatchAllocationId: seededAllocationId("matches/aaaaaa"),
      lastMatchAllocationId: seededAllocationId("matches/aaaaaa"),
      occupiedByMatchAllocationId: seededAllocationId("matches/aaaaaa"),
      clubAllocationId: seededAllocationId("clubs/aaaa"),
    });
    expect(docs["matches/aaaaaa"]).toMatchObject({
      matchAllocationId: seededAllocationId("matches/aaaaaa"),
      currentCourtAllocationId: seededAllocationId("courts/abcde"),
      lastCourtAllocationId: seededAllocationId("courts/abcde"),
      tournamentAllocationId: "observed-tournament",
    });
    expect(docs["devices/current"].courtAllocationId).toBe(seededAllocationId("courts/abcde"));
    expect(docs["devices/current"].sourceCourtAllocationId).toBe(
      seededAllocationId("courts/abcde"),
    );
    expect(docs["devices/current"]).not.toHaveProperty("targetCourtAllocationId");
    expect(docs["devices/missing"].courtAllocationId).toBeNull();
    expect(docs["devices/stale"].courtAllocationId).toBe("old-court");
    expect(docs["matches/bbbbbb"]).not.toHaveProperty("currentCourtAllocationId");
    expect(
      withExpectedAllocations(new FakeFirestore(docs), { courtId: "efghj" }).expectedAllocations,
    ).toEqual({});
  });

  test.each([undefined, {}])(
    "a missing court token (%j) cannot create a casual match",
    async (tokens) => {
      const data = { operation: "ensureCourtMatch", courtId: "abcde" };
      if (tokens !== undefined) data.expectedAllocations = tokens;
      const before = [...mockDb.docs.entries()];
      await expect(api.manageMatch({ data })).rejects.toMatchObject({
        code: "FAILED_PRECONDITION",
        message: "An expected allocation token is required.",
      });
      expect([...mockDb.docs.entries()]).toEqual(before);
    },
  );

  test("a composed request keeps its observed court token after ID reuse", async () => {
    const data = withExpectedAllocations(mockDb, {
      operation: "ensureCourtMatch",
      courtId: "abcde",
    });
    const originalToken = data.expectedAllocations.court.abcde;
    mockDb.write("courts/abcde", {
      name: "Replacement Court",
      status: "open",
      allocationId: seededAllocationId("courts/abcde:replacement"),
    });
    expect(withExpectedAllocations(mockDb, data)).toBe(data);
    expect(data.expectedAllocations.court.abcde).toBe(originalToken);
    const before = [...mockDb.docs.entries()];
    await expect(api.manageMatch({ data })).rejects.toMatchObject({
      code: "ABORTED",
      details: { code: "STALE_GENERATION", path: "courts/abcde" },
    });
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("transaction retry never refreshes a court token after concurrent ID reuse", async () => {
    const data = withExpectedAllocations(mockDb, {
      operation: "ensureCourtMatch",
      courtId: "abcde",
    });
    const replacement = {
      name: "Replacement Court",
      status: "open",
      allocationId: seededAllocationId("courts/abcde:replacement"),
    };
    const source = candidateSource("aaaaaa", "aaaaaa");
    const runTransaction = mockDb.runTransaction.bind(mockDb);
    let replaced = false;
    jest.spyOn(mockDb, "runTransaction").mockImplementation((callback, options) =>
      runTransaction(async (tx) => {
        const result = await callback(tx);
        if (!replaced) {
          replaced = true;
          mockDb.write("courts/abcde", replacement);
        }
        return result;
      }, options),
    );
    const before = [...mockDb.docs.entries()].map(([path, value]) => [
      path,
      path === "courts/abcde" ? replacement : value,
    ]);
    await expect(api.manageMatch({ data })).rejects.toMatchObject({
      code: "ABORTED",
      details: { code: "STALE_GENERATION", path: "courts/abcde" },
    });
    expect(source).toHaveBeenCalledTimes(12);
    expect(mockDb.transactionAttempts).toBe(2);
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test.each(["missing", "stale"])("a %s match token cannot reset a reused match", async (kind) => {
    const { matchId } = await match({ name: "Original Match", courtId: "abcde" });
    const data = withExpectedAllocations(mockDb, {
      operation: "resetMatch",
      matchId,
      credentials: { adminKey: "test-admin" },
    });
    if (kind === "missing") data.expectedAllocations = {};
    else {
      mockDb.write(
        `matches/${matchId}`,
        {
          allocationId: seededAllocationId(`matches/${matchId}:replacement`),
        },
        { merge: true },
      );
    }
    const before = [...mockDb.docs.entries()];
    await expect(api.manageMatch({ data })).rejects.toMatchObject(
      kind === "missing"
        ? { code: "FAILED_PRECONDITION", message: "An expected allocation token is required." }
        : { code: "ABORTED", details: { code: "STALE_GENERATION", path: `matches/${matchId}` } },
    );
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test.each(["missing", "stale"])("a %s tournament token cannot generate a round", async (kind) => {
    const { tournamentId } = await createTournament();
    const data = withExpectedAllocations(mockDb, {
      operation: "generateRound",
      tournamentId,
      credentials: { adminKey: "test-admin" },
    });
    if (kind === "missing") data.expectedAllocations = {};
    else {
      mockDb.write(
        `tournaments/${tournamentId}`,
        {
          allocationId: seededAllocationId(`tournaments/${tournamentId}:replacement`),
        },
        { merge: true },
      );
    }
    const before = [...mockDb.docs.entries()];
    await expect(api.manageTournament({ data })).rejects.toMatchObject(
      kind === "missing"
        ? { code: "FAILED_PRECONDITION", message: "An expected allocation token is required." }
        : {
            code: "ABORTED",
            details: { code: "STALE_GENERATION", path: `tournaments/${tournamentId}` },
          },
    );
    expect([...mockDb.docs.entries()]).toEqual(before);
  });
});

function candidateSource(...ids) {
  const alphabet = "abcdefghjkmnpqrstuxyz";
  const indexes = ids.flatMap((id) => [...id].map((char) => alphabet.indexOf(char)));
  return jest.spyOn(crypto, "randomInt").mockImplementation(() => {
    if (!indexes.length) throw new Error("Unexpected ID allocation.");
    return indexes.shift();
  });
}

function retryFirstCreationAttempt() {
  const runTransaction = mockDb.runTransaction.bind(mockDb);
  let failed = false;
  return jest.spyOn(mockDb, "runTransaction").mockImplementation((callback, options) =>
    runTransaction(async (tx) => {
      const result = await callback(tx);
      if (!failed) {
        failed = true;
        const error = new Error("SDK-style retry after queued writes.");
        error.code = 10;
        throw error;
      }
      return result;
    }, options),
  );
}

describe("production allocation callbacks reset SDK-reused transactions", () => {
  test.each([
    ["court", "jkmnp", () => court({ name: "Court C", password: "different" }), "courts"],
    ["club", "aaaa", () => club({ name: "New Club" }), "clubs"],
    ["manual match", "aaaaaa", () => match({ name: "New Match" }), "matches"],
    ["casual match", "aaaaaa", () => ensureCourtMatch(), "matches"],
    [
      "tournament",
      "aaaaaaa",
      () =>
        createTournament({
          participantText: null,
          courtPool: [],
        }),
      "tournaments",
    ],
  ])("%s can reuse a rolled-back candidate on retry", async (_type, id, create, collection) => {
    retryFirstCreationAttempt();
    const source = candidateSource(id, id);
    await create();
    expect(source).toHaveBeenCalledTimes(id.length * 2);
    expect(mockDb.get(`${collection}/${id}`)).toBeDefined();
    if (collection !== "courts") expect(mockDb.list(collection)).toHaveLength(1);
  });

  test("round generation reuses all rolled-back candidates on the same Transaction", async () => {
    const { tournamentId } = await createTournament();
    retryFirstCreationAttempt();
    candidateSource("aaaaaa", "bbbbbb", "aaaaaa", "bbbbbb");
    await tournament("generateRound", { tournamentId });
    expect(
      mockDb
        .list("matches")
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(["aaaaaa", "bbbbbb"]);
  });

  test("fixture creation reuses its rolled-back candidate on the same Transaction", async () => {
    const { tournamentId } = await createTournament();
    await tournament("generateRound", { tournamentId });
    const fixture = mockDb.list(`tournaments/${tournamentId}/fixtures`)[0];
    mockDb.write(
      `tournaments/${tournamentId}/fixtures/${fixture.id}`,
      { matchId: null },
      { merge: true },
    );
    retryFirstCreationAttempt();
    candidateSource("aaaaaa", "aaaaaa");
    const result = await tournament("createFixtureMatch", { tournamentId, fixtureId: fixture.id });
    expect(result.matchId).toBe("aaaaaa");
    expect(mockDb.get("matches/aaaaaa")).toBeDefined();
  });

  test("recalculation reuses its rolled-back batch on the same Transaction", async () => {
    const { tournamentId } = await createTournament();
    await tournament("generateRound", { tournamentId });
    const fixtures = mockDb.list(`tournaments/${tournamentId}/fixtures`);
    fixtures.forEach((fixture) => {
      mockDb.write(
        `tournaments/${tournamentId}/fixtures/${fixture.id}`,
        { matchId: null },
        { merge: true },
      );
    });
    retryFirstCreationAttempt();
    candidateSource("aaaaaa", "bbbbbb", "aaaaaa", "bbbbbb");
    const result = await tournament("recalculateTournament", { tournamentId });
    expect(result.matchesCreated).toBe(2);
    expect(
      mockDb
        .list(`tournaments/${tournamentId}/fixtures`)
        .map((entry) => entry.matchId)
        .sort(),
    ).toEqual(["aaaaaa", "bbbbbb"]);
  });
});

describe("court creation boundary", () => {
  test("exports admin-only createCourt with the existing flat court shape", async () => {
    mockDb.write(
      "clubs/aaaa",
      seedAllocationTokens({ "clubs/aaaa": { name: "Existing Club" } })["clubs/aaaa"],
    );
    const before = mockDb.docs.size;
    await expect(court({ name: "New Court", password: "different" }, {})).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(mockDb.docs.size).toBe(before);
    const result = await court({
      name: " New Court ",
      password: "different",
      status: "private",
      scoringOptions: { scoringMode: "straight", deuceMode: "golden" },
      activeMatchId: "injected",
      clubId: "aaaa",
    });
    expect(result.courtId).toMatch(/^[abcdefghjkmnpqrstuxyz]{5}$/);
    expect(mockDb.get(`courts/${result.courtId}`)).toMatchObject({
      name: "New Court",
      password: "different",
      status: "private",
      scoringMode: "straight",
      scoringOptions: { scoringMode: "straight", deuceMode: "golden" },
      activeMatchId: null,
      clubId: null,
      beaconSidesSwapped: false,
    });
  });

  test("accepts the admin Firebase custom claim", async () => {
    const result = await api.createCourt({
      auth: { uid: "test-uid", token: { admin: true } },
      data: { name: "New Court", password: "different" },
    });
    expect(mockDb.get(`courts/${result.courtId}`)).toBeDefined();
  });

  test.each([
    { name: "" },
    { name: 1 },
    { name: "a".repeat(81) },
    { name: "<script>" },
    { password: "abc" },
    { password: {} },
    { password: "Court C" },
    { status: "legacy" },
    { scoringOptions: [] },
    { scoringMode: "legacy" },
    { scoringOptions: { scoringMode: "legacy" } },
    { scoringOptions: { pointsTarget: "36" } },
    { scoringOptions: { serving: { order: ["A1"] } } },
    { scoringOptions: { serving: { enabled: "true" } } },
    { scoringOptions: { completion: { rule: "legacy" } } },
    { scoringOptions: { unsafe: true } },
    { beaconEnabled: "true" },
    { courtId: "aaaaa" },
  ])("rejects unsafe court inputs without writes: %j", async (patch) => {
    const before = [...mockDb.docs.entries()];
    await expect(court({ name: "Court C", password: "different", ...patch })).rejects.toMatchObject(
      { code: "INVALID_ARGUMENT" },
    );
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("retries court collisions without replacing an existing court", async () => {
    candidateSource("abcde", "jkmnp");
    const existing = mockDb.get("courts/abcde");
    const result = await court({ name: "Court C", password: "different" });
    expect(result).toEqual({
      courtId: "jkmnp",
      allocationId: mockDb.get("courts/jkmnp").allocationId,
    });
    expect(result.allocationId).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(mockDb.get("courts/abcde")).toEqual(existing);
  });

  test("court allocation failure after five collisions leaves no writes", async () => {
    const source = candidateSource(...Array(5).fill("abcde"));
    const before = [...mockDb.docs.entries()];
    await expect(court({ name: "Court C", password: "different" })).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(source).toHaveBeenCalledTimes(5 * 5);
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("concurrent courts sharing a candidate retry without replacing either court", async () => {
    candidateSource("aaaaa", "aaaaa", "bbbbb");
    const results = await Promise.all([
      court({ name: "Court C", password: "different" }),
      court({ name: "Court D", password: "different" }),
    ]);
    expect(results.map((result) => result.courtId)).toEqual(["aaaaa", "bbbbb"]);
    expect(mockDb.get("courts/aaaaa").name).toBe("Court C");
    expect(mockDb.get("courts/bbbbb").name).toBe("Court D");
    expect(mockDb.transactionAttempts).toBe(3);
  });
});

describe("match creation is canonical and create-only", () => {
  test("creation rejects supplied IDs instead of replacing them", async () => {
    const before = [...mockDb.docs.entries()];
    await expect(matchService.createMatchDocument({ matchId: "fghjkm" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(match({ matchId: "fghjkm" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(
      api.manageMatch({
        data: { operation: "ensureCourtMatch", courtId: "abcde", matchId: "fghjkm" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("prepareMatch requires an explicit canonical allocated ID", () => {
    expect(() => matchService.prepareMatch({})).toThrow();
    expect(() => matchService.prepareMatch({ matchId: "legacy" })).toThrow();
    expect(matchService.prepareMatch({ matchId: "fghjkm" }).matchId).toBe("fghjkm");
  });

  test("manual match collision preserves the old match and its score", async () => {
    mockDb.write("matches/aaaaaa", historicalRoot("matches/aaaaaa"));
    mockDb.write("matches/aaaaaa/score/current", { historyScore: true });
    candidateSource("aaaaaa", "bbbbbb");
    expect(await match({ name: "New Match" })).toMatchObject({ matchId: "bbbbbb" });
    expect(mockDb.get("matches/aaaaaa")).toEqual(historicalRoot("matches/aaaaaa"));
    expect(mockDb.get("matches/aaaaaa/score/current")).toEqual({ historyScore: true });
  });

  test("casual ensureCourtMatch collisions use the same allocator", async () => {
    mockDb.write("matches/aaaaaa", historicalRoot("matches/aaaaaa"));
    candidateSource("aaaaaa", "bbbbbb");
    const created = await ensureCourtMatch();
    expect(created.matchId).toBe("bbbbbb");
    expect(mockDb.get("matches/aaaaaa")).toEqual(historicalRoot("matches/aaaaaa"));
    expect(mockDb.get("courts/abcde").activeMatchId).toBe("bbbbbb");
  });

  test("concurrent ensure calls return one match after a transaction retry", async () => {
    candidateSource("aaaaaa", "aaaaaa");
    const result = await Promise.all([ensureCourtMatch(), ensureCourtMatch()]);
    expect(result.map((entry) => entry.matchId)).toEqual(["aaaaaa", "aaaaaa"]);
    expect(result.map((entry) => entry.created).sort()).toEqual([false, true]);
    expect(mockDb.list("matches")).toHaveLength(1);
    expect(mockDb.transactionAttempts).toBe(3);
  });

  test("a failed court attachment does not persist a partially created match", async () => {
    mockDb.write("courts/abcde", { status: "closed" }, { merge: true });
    const before = [...mockDb.docs.entries()];
    await expect(match({ courtId: "abcde" })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("writePreparedMatch never overwrites an existing match or score", async () => {
    mockDb.write("matches/aaaaaa", historicalRoot("matches/aaaaaa"));
    const prepared = matchService.prepareMatch({ matchId: "aaaaaa" });
    const before = [...mockDb.docs.entries()];
    await expect(
      mockDb.runTransaction(async (tx) => {
        matchService.writePreparedMatch(tx, prepared);
      }),
    ).rejects.toMatchObject({ code: 6 });
    expect([...mockDb.docs.entries()]).toEqual(before);
    mockDb.docs.delete("matches/aaaaaa");
    mockDb.write("matches/aaaaaa/score/current", { historyScore: true });
    const orphaned = [...mockDb.docs.entries()];
    await expect(
      mockDb.runTransaction(async (tx) => {
        matchService.writePreparedMatch(tx, prepared);
      }),
    ).rejects.toMatchObject({ code: 6 });
    expect([...mockDb.docs.entries()]).toEqual(orphaned);
  });

  test("concurrent manual matches sharing a candidate both survive retry", async () => {
    candidateSource("aaaaaa", "aaaaaa", "bbbbbb");
    const results = await Promise.all([match({ name: "First" }), match({ name: "Second" })]);
    expect(results.map((result) => result.matchId)).toEqual(["aaaaaa", "bbbbbb"]);
    expect(mockDb.get("matches/aaaaaa").name).toBe("First");
    expect(mockDb.get("matches/bbbbbb").name).toBe("Second");
    expect(mockDb.transactionAttempts).toBe(3);
  });
});

async function createTournament(extra = {}) {
  return tournament("createTournament", {
    name: "Collision Test",
    format: { id: "americano" },
    courtPool: ["abcde", "efghj"],
    participantText: ["Alice", "Ben", "Chris", "Dan", "Eva", "Finn", "Gina", "Hugo"].join("\n"),
    scheduling: { targetRoundCount: 1 },
    ...extra,
  });
}

describe("tournament allocation and batch match creation", () => {
  test("tournament collision retries within the idempotent creation transaction", async () => {
    mockDb.write("tournaments/aaaaaaa", historicalRoot("tournaments/aaaaaaa"));
    const source = jest.spyOn(crypto, "randomInt");
    let calls = 0;
    source.mockImplementation(() => (++calls <= 7 ? 0 : 1));
    const created = await createTournament({ requestId: "same-request" });
    expect(created.tournamentId).toBe("bbbbbbb");
    expect(mockDb.get("tournaments/aaaaaaa")).toEqual(historicalRoot("tournaments/aaaaaaa"));
    const before = mockDb.list("tournaments").length;
    const duplicate = await createTournament({ requestId: "same-request" });
    expect(duplicate).toMatchObject({ duplicate: true, tournamentId: "bbbbbbb" });
    expect(mockDb.list("tournaments")).toHaveLength(before);
  });

  test("concurrent creation with the same request commits one tournament", async () => {
    const results = await Promise.all([
      createTournament({ requestId: "concurrent-request" }),
      createTournament({ requestId: "concurrent-request" }),
    ]);
    expect(results[0].tournamentId).toBe(results[1].tournamentId);
    expect(results.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(mockDb.list("tournaments")).toHaveLength(1);
    expect(mockDb.list(`tournaments/${results[0].tournamentId}/participants`)).toHaveLength(8);
  });

  test("tournament creation exhaustion makes no roster or secret writes", async () => {
    mockDb.write("tournaments/aaaaaaa", historicalRoot("tournaments/aaaaaaa"));
    const before = [...mockDb.docs.entries()];
    const source = candidateSource(...Array(5).fill("aaaaaaa"));
    await expect(createTournament()).rejects.toMatchObject({ code: "ABORTED" });
    expect(source).toHaveBeenCalledTimes(7 * 5);
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("multi-match round collision reads precede writes and reserve distinct IDs", async () => {
    const { tournamentId } = await createTournament();
    mockDb.write("matches/aaaaaa", historicalRoot("matches/aaaaaa"));
    candidateSource("aaaaaa", "bbbbbb", "bbbbbb", "cccccc");
    const generated = await tournament("generateRound", { tournamentId });
    expect(generated.matches).toBe(2);
    const ids = mockDb
      .list(`tournaments/${tournamentId}/fixtures`)
      .map((fixture) => fixture.matchId);
    expect(ids.sort()).toEqual(["bbbbbb", "cccccc"]);
    expect(mockDb.get("matches/aaaaaa")).toEqual(historicalRoot("matches/aaaaaa"));
    expect(mockDb.list("matches")).toHaveLength(3);
  });

  test("concurrent round generation is idempotent after the transaction retries", async () => {
    const { tournamentId } = await createTournament();
    const generated = await Promise.all([
      tournament("generateRound", { tournamentId, expectedRoundNumber: 1 }),
      tournament("generateRound", { tournamentId, expectedRoundNumber: 1 }),
    ]);
    expect(generated.map((result) => result.duplicate).sort()).toEqual([false, true]);
    expect(mockDb.list("matches")).toHaveLength(2);
    expect(mockDb.list(`tournaments/${tournamentId}/fixtures`)).toHaveLength(2);
    expect(mockDb.list(`tournaments/${tournamentId}/rounds`)).toHaveLength(1);
  });

  test("batch collision exhaustion rolls back all matches, fixtures, and rounds", async () => {
    const { tournamentId } = await createTournament();
    const before = [...mockDb.docs.entries()];
    candidateSource("aaaaaa", ...Array(5).fill("aaaaaa"));
    await expect(tournament("generateRound", { tournamentId })).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect([...mockDb.docs.entries()]).toEqual(before);
    expect(mockDb.list("matches")).toHaveLength(0);
    expect(mockDb.list(`tournaments/${tournamentId}/fixtures`)).toHaveLength(0);
  });

  describe("club creation shares the canonical allocator", () => {
    test("concurrent club collisions and court ownership changes commit atomically", async () => {
      candidateSource("aaaa", "aaaa", "bbbb");
      const results = await Promise.all([
        club({ name: "First Club", courtIds: ["abcde"] }),
        club({ name: "Second Club", courtIds: ["abcde"] }),
      ]);
      expect(results.map((result) => result.clubId)).toEqual(["aaaa", "bbbb"]);
      expect(mockDb.get("clubs/aaaa")).toMatchObject({ name: "First Club", courtIds: [] });
      expect(mockDb.get("clubs/bbbb")).toMatchObject({
        name: "Second Club",
        courtIds: ["abcde"],
      });
      expect(mockDb.get("courts/abcde").clubId).toBe("bbbb");
    });

    test.each(["c1", "ABCD", " abcd ", "abc2", "abcdefg", "../admin", 4])(
      "rejects malformed court membership ID %j without writes",
      async (courtId) => {
        const before = [...mockDb.docs.entries()];
        await expect(
          require("./services/clubService").createClub({ name: "Example", courtIds: [courtId] }),
        ).rejects.toMatchObject({ code: "invalid-argument" });
        expect([...mockDb.docs.entries()]).toEqual(before);
      },
    );
  });

  test("regeneration allocates all replacement matches before applying scheduled writes", async () => {
    const { tournamentId } = await createTournament();
    await tournament("generateRound", { tournamentId });
    const fixtures = mockDb.list(`tournaments/${tournamentId}/fixtures`);
    fixtures.forEach((fixture) => {
      mockDb.write(`matches/${fixture.matchId}`, { status: "cancelled" }, { merge: true });
    });
    candidateSource("aaaaaa", "aaaaaa", "bbbbbb");
    await tournament("recalculateTournament", { tournamentId });
    const replacement = mockDb.list(`tournaments/${tournamentId}/fixtures`);
    expect(replacement.map((fixture) => fixture.matchId).sort()).toEqual(["aaaaaa", "bbbbbb"]);
    fixtures.forEach((fixture) =>
      expect(mockDb.get(`matches/${fixture.matchId}`).status).toBe("cancelled"),
    );
  });

  test("fixture-specific match creation also retries collisions", async () => {
    const { tournamentId } = await createTournament();
    await tournament("generateRound", { tournamentId });
    const fixture = mockDb.list(`tournaments/${tournamentId}/fixtures`)[0];
    mockDb.write(
      `tournaments/${tournamentId}/fixtures/${fixture.id}`,
      { matchId: null },
      { merge: true },
    );
    mockDb.write("matches/aaaaaa", historicalRoot("matches/aaaaaa"));
    candidateSource("aaaaaa", "bbbbbb");
    const result = await tournament("createFixtureMatch", { tournamentId, fixtureId: fixture.id });
    expect(result.matchId).toBe("bbbbbb");
    expect(mockDb.get("matches/aaaaaa")).toEqual(historicalRoot("matches/aaaaaa"));
  });

  test.each([
    { tournamentId: "legacy" },
    { clubId: "legacy" },
    { courtId: "legacy" },
    { courtPool: ["abcde", "legacy"] },
    { courtPool: ["ABCD"] },
    { courtPool: [1] },
  ])("rejects legacy or untyped tournament parameters: %j", async (patch) => {
    const before = [...mockDb.docs.entries()];
    await expect(createTournament(patch)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect([...mockDb.docs.entries()]).toEqual(before);
  });
});
