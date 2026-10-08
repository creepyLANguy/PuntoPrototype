const crypto = require("crypto");
const { FakeFirestore } = require("./testSupport/fakeFirestore");

let mockDb;
jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (_config, handler) => handler,
  onDocumentDeleted: (_config, handler) => handler,
}));
jest.mock("firebase-functions/v2/https", () => ({
  onCall: (_config, handler) => handler,
  onRequest: (_config, handler) => handler,
}));
jest.mock("./infrastructure/firebase", () => ({
  get db() {
    return mockDb;
  },
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  FieldPath: { documentId: () => "__name__" },
}));

let api;
let matchService;
beforeEach(() => {
  jest.resetModules();
  mockDb = new FakeFirestore({
    "admin/goodies": { skeletonKey: "test-admin" },
    "courts/abcd": { name: "Court A", status: "open", password: "court-pass" },
    "courts/efgh": { name: "Court B", status: "open", password: "court-pass" },
  });
  api = require("./index");
  matchService = require("./services/matchService");
});
afterEach(() => jest.restoreAllMocks());

const court = (data, credentials = { adminKey: "test-admin" }) =>
  api.createCourt({ data: { ...data, credentials } });
const match = (data) =>
  api.manageMatch({
    data: { operation: "createMatch", ...data, credentials: { adminKey: "test-admin" } },
  });
const tournament = (operation, data) =>
  api.manageTournament({ data: { operation, ...data, credentials: { adminKey: "test-admin" } } });

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
    ["court", "jkmn", () => court({ name: "Court C", password: "different" }), "courts"],
    ["club", "aaaaaaaaaa", () => api.createClub({ data: { name: "New Club" } }), "clubs"],
    ["manual match", "aaaaaaaa", () => match({ name: "New Match" }), "matches"],
    [
      "casual match",
      "aaaaaaaa",
      () =>
        api.manageMatch({
          data: { operation: "ensureCourtMatch", courtId: "abcd" },
        }),
      "matches",
    ],
    [
      "tournament",
      "aaaaaa",
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
    candidateSource("aaaaaaaa", "bbbbbbbb", "aaaaaaaa", "bbbbbbbb");
    await tournament("generateRound", { tournamentId });
    expect(
      mockDb
        .list("matches")
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(["aaaaaaaa", "bbbbbbbb"]);
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
    candidateSource("aaaaaaaa", "aaaaaaaa");
    const result = await tournament("createFixtureMatch", { tournamentId, fixtureId: fixture.id });
    expect(result.matchId).toBe("aaaaaaaa");
    expect(mockDb.get("matches/aaaaaaaa")).toBeDefined();
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
    candidateSource("aaaaaaaa", "bbbbbbbb", "aaaaaaaa", "bbbbbbbb");
    const result = await tournament("recalculateTournament", { tournamentId });
    expect(result.matchesCreated).toBe(2);
    expect(
      mockDb
        .list(`tournaments/${tournamentId}/fixtures`)
        .map((entry) => entry.matchId)
        .sort(),
    ).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });
});

describe("court creation boundary", () => {
  test("exports admin-only createCourt with the existing flat court shape", async () => {
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
      clubId: "injected",
    });
    expect(result.courtId).toMatch(/^[abcdefghjkmnpqrstuxyz]{4}$/);
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
    { courtId: "aaaa" },
  ])("rejects unsafe court inputs without writes: %j", async (patch) => {
    const before = [...mockDb.docs.entries()];
    await expect(court({ name: "Court C", password: "different", ...patch })).rejects.toMatchObject(
      { code: "INVALID_ARGUMENT" },
    );
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("retries court collisions without replacing an existing court", async () => {
    candidateSource("abcd", "jkmn");
    const existing = mockDb.get("courts/abcd");
    const result = await court({ name: "Court C", password: "different" });
    expect(result).toEqual({ courtId: "jkmn" });
    expect(mockDb.get("courts/abcd")).toEqual(existing);
  });

  test("court allocation failure after five collisions leaves no writes", async () => {
    const source = candidateSource(...Array(5).fill("abcd"));
    const before = [...mockDb.docs.entries()];
    await expect(court({ name: "Court C", password: "different" })).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect(source).toHaveBeenCalledTimes(4 * 5);
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("concurrent courts sharing a candidate retry without replacing either court", async () => {
    candidateSource("aaaa", "aaaa", "bbbb");
    const results = await Promise.all([
      court({ name: "Court C", password: "different" }),
      court({ name: "Court D", password: "different" }),
    ]);
    expect(results.map((result) => result.courtId)).toEqual(["aaaa", "bbbb"]);
    expect(mockDb.get("courts/aaaa").name).toBe("Court C");
    expect(mockDb.get("courts/bbbb").name).toBe("Court D");
    expect(mockDb.transactionAttempts).toBe(3);
  });
});

describe("match creation is canonical and create-only", () => {
  test("creation rejects supplied IDs instead of replacing them", async () => {
    const before = [...mockDb.docs.entries()];
    await expect(matchService.createMatchDocument({ matchId: "abcdefgh" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(match({ matchId: "abcdefgh" })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await expect(
      api.manageMatch({
        data: { operation: "ensureCourtMatch", courtId: "abcd", matchId: "abcdefgh" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("prepareMatch requires an explicit canonical allocated ID", () => {
    expect(() => matchService.prepareMatch({})).toThrow();
    expect(() => matchService.prepareMatch({ matchId: "legacy" })).toThrow();
    expect(matchService.prepareMatch({ matchId: "abcdefgh" }).matchId).toBe("abcdefgh");
  });

  test("manual match collision preserves the old match and its score", async () => {
    mockDb.write("matches/aaaaaaaa", { historical: true });
    mockDb.write("matches/aaaaaaaa/score/current", { historyScore: true });
    candidateSource("aaaaaaaa", "bbbbbbbb");
    expect(await match({ name: "New Match" })).toMatchObject({ matchId: "bbbbbbbb" });
    expect(mockDb.get("matches/aaaaaaaa")).toEqual({ historical: true });
    expect(mockDb.get("matches/aaaaaaaa/score/current")).toEqual({ historyScore: true });
  });

  test("casual ensureCourtMatch collisions use the same allocator", async () => {
    mockDb.write("matches/aaaaaaaa", { historical: true });
    candidateSource("aaaaaaaa", "bbbbbbbb");
    const created = await api.manageMatch({
      data: { operation: "ensureCourtMatch", courtId: "abcd" },
    });
    expect(created.matchId).toBe("bbbbbbbb");
    expect(mockDb.get("matches/aaaaaaaa")).toEqual({ historical: true });
    expect(mockDb.get("courts/abcd").activeMatchId).toBe("bbbbbbbb");
  });

  test("concurrent ensure calls return one match after a transaction retry", async () => {
    candidateSource("aaaaaaaa", "aaaaaaaa");
    const result = await Promise.all([
      api.manageMatch({ data: { operation: "ensureCourtMatch", courtId: "abcd" } }),
      api.manageMatch({ data: { operation: "ensureCourtMatch", courtId: "abcd" } }),
    ]);
    expect(result.map((entry) => entry.matchId)).toEqual(["aaaaaaaa", "aaaaaaaa"]);
    expect(result.map((entry) => entry.created).sort()).toEqual([false, true]);
    expect(mockDb.list("matches")).toHaveLength(1);
    expect(mockDb.transactionAttempts).toBe(3);
  });

  test("a failed court attachment does not persist a partially created match", async () => {
    mockDb.write("courts/abcd", { status: "closed" }, { merge: true });
    const before = [...mockDb.docs.entries()];
    await expect(match({ courtId: "abcd" })).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("writePreparedMatch never overwrites an existing match or score", async () => {
    mockDb.write("matches/aaaaaaaa", { historical: true });
    const prepared = matchService.prepareMatch({ matchId: "aaaaaaaa" });
    const before = [...mockDb.docs.entries()];
    await expect(
      mockDb.runTransaction(async (tx) => {
        matchService.writePreparedMatch(tx, prepared);
      }),
    ).rejects.toMatchObject({ code: 6 });
    expect([...mockDb.docs.entries()]).toEqual(before);
    mockDb.docs.delete("matches/aaaaaaaa");
    mockDb.write("matches/aaaaaaaa/score/current", { historyScore: true });
    const orphaned = [...mockDb.docs.entries()];
    await expect(
      mockDb.runTransaction(async (tx) => {
        matchService.writePreparedMatch(tx, prepared);
      }),
    ).rejects.toMatchObject({ code: 6 });
    expect([...mockDb.docs.entries()]).toEqual(orphaned);
  });

  test("concurrent manual matches sharing a candidate both survive retry", async () => {
    candidateSource("aaaaaaaa", "aaaaaaaa", "bbbbbbbb");
    const results = await Promise.all([match({ name: "First" }), match({ name: "Second" })]);
    expect(results.map((result) => result.matchId)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(mockDb.get("matches/aaaaaaaa").name).toBe("First");
    expect(mockDb.get("matches/bbbbbbbb").name).toBe("Second");
    expect(mockDb.transactionAttempts).toBe(3);
  });
});

async function createTournament(extra = {}) {
  return tournament("createTournament", {
    name: "Collision Test",
    format: { id: "americano" },
    courtPool: ["abcd", "efgh"],
    participantText: ["Alice", "Ben", "Chris", "Dan", "Eva", "Finn", "Gina", "Hugo"].join("\n"),
    scheduling: { targetRoundCount: 1 },
    ...extra,
  });
}

describe("tournament allocation and batch match creation", () => {
  test("tournament collision retries within the idempotent creation transaction", async () => {
    mockDb.write("tournaments/aaaaaa", { historical: true });
    const source = jest.spyOn(crypto, "randomInt");
    let calls = 0;
    source.mockImplementation(() => (++calls <= 6 ? 0 : 1));
    const created = await createTournament({ requestId: "same-request" });
    expect(created.tournamentId).toBe("bbbbbb");
    expect(mockDb.get("tournaments/aaaaaa")).toEqual({ historical: true });
    const before = mockDb.list("tournaments").length;
    const duplicate = await createTournament({ requestId: "same-request" });
    expect(duplicate).toMatchObject({ duplicate: true, tournamentId: "bbbbbb" });
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
    mockDb.write("tournaments/aaaaaa", { historical: true });
    const before = [...mockDb.docs.entries()];
    const source = candidateSource(...Array(5).fill("aaaaaa"));
    await expect(createTournament()).rejects.toMatchObject({ code: "ABORTED" });
    expect(source).toHaveBeenCalledTimes(6 * 5);
    expect([...mockDb.docs.entries()]).toEqual(before);
  });

  test("multi-match round collision reads precede writes and reserve distinct IDs", async () => {
    const { tournamentId } = await createTournament();
    mockDb.write("matches/aaaaaaaa", { historical: true });
    candidateSource("aaaaaaaa", "bbbbbbbb", "bbbbbbbb", "cccccccc");
    const generated = await tournament("generateRound", { tournamentId });
    expect(generated.matches).toBe(2);
    const ids = mockDb
      .list(`tournaments/${tournamentId}/fixtures`)
      .map((fixture) => fixture.matchId);
    expect(ids.sort()).toEqual(["bbbbbbbb", "cccccccc"]);
    expect(mockDb.get("matches/aaaaaaaa")).toEqual({ historical: true });
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
    candidateSource("aaaaaaaa", ...Array(5).fill("aaaaaaaa"));
    await expect(tournament("generateRound", { tournamentId })).rejects.toMatchObject({
      code: "ABORTED",
    });
    expect([...mockDb.docs.entries()]).toEqual(before);
    expect(mockDb.list("matches")).toHaveLength(0);
    expect(mockDb.list(`tournaments/${tournamentId}/fixtures`)).toHaveLength(0);
  });

  describe("club creation shares the canonical allocator", () => {
    test("concurrent club collisions and court ownership changes commit atomically", async () => {
      candidateSource("aaaaaaaaaa", "aaaaaaaaaa", "bbbbbbbbbb");
      const results = await Promise.all([
        api.createClub({ data: { name: "First Club", courtIds: ["abcd"] } }),
        api.createClub({ data: { name: "Second Club", courtIds: ["abcd"] } }),
      ]);
      expect(results.map((result) => result.clubId)).toEqual(["aaaaaaaaaa", "bbbbbbbbbb"]);
      expect(mockDb.get("clubs/aaaaaaaaaa")).toMatchObject({ name: "First Club", courtIds: [] });
      expect(mockDb.get("clubs/bbbbbbbbbb")).toMatchObject({
        name: "Second Club",
        courtIds: ["abcd"],
      });
      expect(mockDb.get("courts/abcd").clubId).toBe("bbbbbbbbbb");
    });

    test.each(["c1", "ABCD", " abcd ", "abc2", "abcdef", "../admin", 4])(
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
    candidateSource("aaaaaaaa", "aaaaaaaa", "bbbbbbbb");
    await tournament("recalculateTournament", { tournamentId });
    const replacement = mockDb.list(`tournaments/${tournamentId}/fixtures`);
    expect(replacement.map((fixture) => fixture.matchId).sort()).toEqual(["aaaaaaaa", "bbbbbbbb"]);
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
    mockDb.write("matches/aaaaaaaa", { historical: true });
    candidateSource("aaaaaaaa", "bbbbbbbb");
    const result = await tournament("createFixtureMatch", { tournamentId, fixtureId: fixture.id });
    expect(result.matchId).toBe("bbbbbbbb");
    expect(mockDb.get("matches/aaaaaaaa")).toEqual({ historical: true });
  });

  test.each([
    { tournamentId: "legacy" },
    { clubId: "legacy" },
    { courtId: "legacy" },
    { courtPool: ["abcd", "legacy"] },
    { courtPool: ["ABCD"] },
    { courtPool: [1] },
  ])("rejects legacy or untyped tournament parameters: %j", async (patch) => {
    const before = [...mockDb.docs.entries()];
    await expect(createTournament(patch)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect([...mockDb.docs.entries()]).toEqual(before);
  });
});
