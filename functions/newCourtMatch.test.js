const { FakeFirestore } = require("./testSupport/fakeFirestore");
const {
  seedAllocationTokens,
  withExpectedAllocations,
} = require("./testSupport/expectedAllocations");

let mockDb;
jest.mock("./infrastructure/firebase", () => {
  const { createGuardedFirestore } = jest.requireActual("./infrastructure/dataGuard");
  const guarded = new WeakMap();
  return {
    get db() {
      if (!guarded.has(mockDb)) guarded.set(mockDb, createGuardedFirestore(mockDb));
      return guarded.get(mockDb);
    },
    FieldPath: { documentId: () => "__name__" },
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  };
});

let manageMatch;
let guard;
let processScoreEvent;
const courtId = "abcde";
const matchId = "abcdef";
const credentials = { courtPassword: "court-control" };

beforeEach(() => {
  jest.resetModules();
  mockDb = new FakeFirestore(
    seedAllocationTokens({
      "admin/goodies": { skeletonKey: "test-admin" },
      "courts/abcde": {
        name: "Court One",
        status: "private",
        password: credentials.courtPassword,
        scoringMode: "fixedTotalPoints",
        scoringOptions: { scoringMode: "fixedTotalPoints", pointsTarget: 24 },
        activeMatchId: matchId,
        lastMatchId: matchId,
        beaconSidesSwapped: true,
      },
    }),
  );
  const { prepareMatch } = require("./services/matchService");
  const prepared = prepareMatch({ matchId, status: "live", name: "Original match" });
  mockDb.write(`matches/${matchId}`, {
    ...prepared.match,
    allocationId: "original-match-allocation",
    currentCourtId: courtId,
    lastCourtId: courtId,
    teamNames: { A: "Alice and Amy", B: "Bob and Ben" },
    playerNames: { A1: "Alice", A2: "Amy", B1: "Bob", B2: "Ben" },
    scoreVersion: 3,
  });
  mockDb.write(`matches/${matchId}/score/current`, prepared.score);
  guard = require("./infrastructure/dataGuard");
  manageMatch = guard.withOperationScope(require("./callables/manageMatch").manageMatch);
  ({ processScoreEvent } = require("./services/scoreService"));
  jest.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function request(extra = {}, auth) {
  return {
    data: withExpectedAllocations(mockDb, {
      operation: "newCourtMatch",
      courtId,
      matchId,
      credentials,
      ...extra,
    }),
    ...(auth ? { auth } : {}),
  };
}

async function point(id, seconds, team = "A", extra = {}, process = true) {
  const event = {
    eventType: `POINT_TEAM_${team}`,
    createdAt: { seconds, nanoseconds: 0 },
    matchId,
    allocationId: mockDb.get(`matches/${matchId}`).allocationId,
    scoreVersion: 3,
    ...extra,
  };
  mockDb.write(`matches/${matchId}/events/${id}`, event);
  if (process) {
    await guard.runInOperationScope(() =>
      processScoreEvent({ params: { matchId, eventId: id }, data: { data: () => event } }),
    );
  }
  return event;
}

function allDocs() {
  return structuredClone([...mockDb.docs.entries()]);
}

test.each([{}, { courtPassword: "wrong" }, { hostKey: "spectator" }])(
  "spectators/missing/wrong court credentials are denied without writes: %j",
  async (credentials) => {
    const before = allDocs();
    await expect(manageMatch(request({ credentials }))).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(allDocs()).toEqual(before);
  },
);

test.each([{ adminKey: "test-admin" }, { courtPassword: "court-control" }])(
  "court controllers and platform admins can atomically start a fresh match: %j",
  async (credentials) => {
    await point("point1", 100);
    await point("point2", 101, "B");
    await point("point3", 102);
    // A stale list summary is not authoritative.
    mockDb.write(
      `matches/${matchId}`,
      { scoreSummary: { A: { totalPoints: 999 } } },
      { merge: true },
    );
    mockDb.write(`matches/${matchId}/checkpoints/keep`, { scoreVersion: 3, marker: "retain" });
    const original = mockDb.get(`matches/${matchId}`);
    const originalScore = mockDb.get(`matches/${matchId}/score/current`);
    const originalEvents = mockDb.list(`matches/${matchId}/events`);
    const originalCheckpoints = mockDb.list(`matches/${matchId}/checkpoints`);

    const result = await manageMatch(request({ credentials }));
    expect(result).toMatchObject({
      success: true,
      courtId,
      scoreVersion: 0,
      allocationId: expect.any(String),
      created: true,
    });
    expect(result.matchId).toMatch(/^[abcdefghjkmnpqrstuxyz]{6}$/);
    expect(result.matchId).not.toBe(matchId);
    expect(mockDb.get(`matches/${matchId}`)).toMatchObject({
      status: "completed",
      currentCourtId: null,
      allocationId: original.allocationId,
      name: original.name,
      teamNames: original.teamNames,
      playerNames: original.playerNames,
      scoreVersion: 3,
      scoringOptions: original.scoringOptions,
      result: { winner: "A", points: { A: 2, B: 1 } },
      scoreSummary: { A: { totalPoints: 2 }, B: { totalPoints: 1 } },
    });
    expect(mockDb.get(`matches/${matchId}/score/current`)).toEqual(originalScore);
    expect(mockDb.list(`matches/${matchId}/events`)).toEqual(originalEvents);
    expect(mockDb.list(`matches/${matchId}/checkpoints`)).toEqual(originalCheckpoints);
    expect(mockDb.list(`matches/${matchId}/archives`)).toHaveLength(0);
    expect(mockDb.get(`matches/${result.matchId}`)).toMatchObject({
      allocationId: result.allocationId,
      kind: "casual",
      status: "live",
      currentCourtId: courtId,
      scoreVersion: 0,
      visibility: "private",
      scoringOptions: { scoringMode: "fixedTotalPoints", pointsTarget: 24 },
      tournamentId: null,
    });
    expect(mockDb.get(`matches/${result.matchId}`).name).not.toBe(original.name);
    expect(mockDb.get(`matches/${result.matchId}`).teamNames).not.toEqual(original.teamNames);
    expect(mockDb.get(`matches/${result.matchId}/score/current`)).toMatchObject({
      A: { totalPoints: 0, points: 0 },
      B: { totalPoints: 0, points: 0 },
      lastProcessedEventId: null,
    });
    expect(mockDb.get("courts/abcde")).toMatchObject({
      activeMatchId: result.matchId,
      lastMatchId: result.matchId,
      activeMatchAllocationId: result.allocationId,
      beaconSidesSwapped: false,
      password: "court-control",
    });
  },
);

test.each(["completed", "cancelled"])("a last %s match is never rewritten", async (status) => {
  await point("point1", 100);
  mockDb.write(
    `matches/${matchId}`,
    { status, currentCourtId: null, result: { preserved: true } },
    { merge: true },
  );
  mockDb.write("courts/abcde", { activeMatchId: null }, { merge: true });
  const original = allDocs().filter(([path]) => path.startsWith(`matches/${matchId}`));
  const result = await manageMatch(request());
  expect(allDocs().filter(([path]) => path.startsWith(`matches/${matchId}`))).toEqual(original);
  expect(mockDb.get("courts/abcde").activeMatchId).toBe(result.matchId);
});

test.each([
  ["live", { tournamentId: "abcdefg" }],
  ["completed", { tournamentId: "abcdefg" }],
  ["cancelled", { kind: "tournament" }],
])("even admins cannot replace a %s tournament match: %j", async (status, tournamentFields) => {
  mockDb.write(`matches/${matchId}`, { status, ...tournamentFields }, { merge: true });
  if (status !== "live") mockDb.write("courts/abcde", { activeMatchId: null }, { merge: true });
  const before = allDocs();
  await expect(manageMatch(request({ credentials: { adminKey: "test-admin" } }))).rejects.toThrow(
    /Tournament/,
  );
  expect(allDocs()).toEqual(before);
});

test.each([
  ["closed court", () => mockDb.write("courts/abcde", { status: "closed" }, { merge: true })],
  [
    "changed active match",
    () => mockDb.write("courts/abcde", { activeMatchId: "ghjkmn" }, { merge: true }),
  ],
  [
    "changed last match",
    () =>
      mockDb.write("courts/abcde", { activeMatchId: null, lastMatchId: "ghjkmn" }, { merge: true }),
  ],
  [
    "moved live match",
    () => mockDb.write(`matches/${matchId}`, { currentCourtId: "efghj" }, { merge: true }),
  ],
])("%s fails without changes", async (_label, change) => {
  change();
  const before = allDocs();
  await expect(manageMatch(request())).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
  expect(allDocs()).toEqual(before);
});

test.each(["courtId", "matchId"])("%s is required", async (field) => {
  const before = allDocs();
  const input = request();
  delete input.data[field];
  await expect(manageMatch(input)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(allDocs()).toEqual(before);
});

test("both allocation tokens are required, and stale generations abort without writes", async () => {
  for (const type of ["court", "match"]) {
    const input = request();
    delete input.data.expectedAllocations[type];
    const before = allDocs();
    await expect(manageMatch(input)).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
    expect(allDocs()).toEqual(before);
  }
  const stale = request();
  mockDb.write(`matches/${matchId}`, { allocationId: "replacement-generation" }, { merge: true });
  const before = allDocs();
  await expect(manageMatch(stale)).rejects.toMatchObject({ details: { code: "STALE_GENERATION" } });
  expect(allDocs()).toEqual(before);
});

test.each(["completed", "cancelled"])(
  "a stale last %s match generation is fenced",
  async (status) => {
    mockDb.write(`matches/${matchId}`, { status, currentCourtId: null }, { merge: true });
    mockDb.write("courts/abcde", { activeMatchId: null }, { merge: true });
    const stale = request();
    mockDb.write(`matches/${matchId}`, { allocationId: "replacement-generation" }, { merge: true });
    const before = allDocs();
    await expect(manageMatch(stale)).rejects.toMatchObject({
      details: { code: "STALE_GENERATION" },
    });
    expect(allDocs()).toEqual(before);
  },
);

test("pending points block replacement until scoring catches up", async () => {
  const event = await point("pending", 100, "A", {}, false);
  const before = allDocs();
  await expect(manageMatch(request())).rejects.toMatchObject({
    code: "FAILED_PRECONDITION",
    details: { code: "SCORE_PENDING" },
  });
  expect(allDocs()).toEqual(before);
  await guard.runInOperationScope(() =>
    processScoreEvent({ params: { matchId, eventId: "pending" }, data: { data: () => event } }),
  );
  await manageMatch(request());
  expect(mockDb.get(`matches/${matchId}`).result.points.A).toBe(1);
});

test("out-of-order pending points cannot hide behind the latest processed event", async () => {
  await point("latest", 200);
  const event = await point("delayed", 100, "B", {}, false);
  const before = allDocs();
  await expect(manageMatch(request())).rejects.toMatchObject({
    details: { code: "SCORE_PENDING" },
  });
  expect(allDocs()).toEqual(before);
  await guard.runInOperationScope(() =>
    processScoreEvent({ params: { matchId, eventId: "delayed" }, data: { data: () => event } }),
  );
  await manageMatch(request());
  expect(mockDb.get(`matches/${matchId}`).result.points).toEqual({ A: 1, B: 1 });
});

test("stale score versions, generations and non-scoring events do not block replacement", async () => {
  await point("oldVersion", 100, "A", { scoreVersion: 2 }, false);
  await point("oldGeneration", 101, "A", { allocationId: "old-generation" }, false);
  await point("spectator", 102, "A", { eventType: "SPECTATE" }, false);
  await expect(manageMatch(request())).resolves.toMatchObject({ success: true });
  const archived = mockDb.get(`matches/${matchId}`);
  expect(archived.status).toBe("cancelled");
  expect(archived.result).toBeNull();
  expect(archived.currentCourtId).toBeNull();
});

test("an unscored live match is cancelled, not completed, with history preserved", async () => {
  const originalScore = mockDb.get(`matches/${matchId}/score/current`);
  const result = await manageMatch(request());
  expect(mockDb.get(`matches/${matchId}`)).toMatchObject({
    status: "cancelled",
    currentCourtId: null,
    allocationId: "original-match-allocation",
    scoreSummary: { A: { totalPoints: 0 }, B: { totalPoints: 0 } },
  });
  expect(mockDb.get(`matches/${matchId}`).result).toBeNull();
  expect(mockDb.get(`matches/${matchId}`).cancelledAt).toBeDefined();
  expect(mockDb.get(`matches/${matchId}/score/current`)).toEqual(originalScore);
  expect(mockDb.get("courts/abcde").activeMatchId).toBe(result.matchId);
  expect(mockDb.get(`matches/${result.matchId}`).status).toBe("live");
});

test("a scored live match is completed with its persisted result", async () => {
  await point("point1", 100);
  await manageMatch(request());
  expect(mockDb.get(`matches/${matchId}`)).toMatchObject({
    status: "completed",
    result: { points: { A: 1, B: 0 } },
  });
});

test("a scoring-options replay ending on an operational event does not block replacement", async () => {
  await point("point1", 100);
  await point("spectator", 200, "A", { eventType: "SPECTATE" }, false);
  const updateScoringOptions = guard.withOperationScope(
    require("./callables/updateScoringOptions").updateScoringOptions,
  );
  await updateScoringOptions({
    data: withExpectedAllocations(mockDb, { matchId, credentials, scoringOptions: {} }),
  });
  const originalScore = mockDb.get(`matches/${matchId}/score/current`);
  expect(originalScore.lastProcessedEventId).toBe("spectator");
  await expect(manageMatch(request())).resolves.toMatchObject({ success: true });
  expect(mockDb.get(`matches/${matchId}/score/current`)).toEqual(originalScore);
  expect(mockDb.get(`matches/${matchId}`).result.points.A).toBe(1);
});

test("changeover controls do not block replacement or modify the historical score", async () => {
  await point("point1", 100);
  const changeoverCourt = guard.withOperationScope(
    require("./callables/changeoverCourt").changeoverCourt,
  );
  await changeoverCourt({ data: withExpectedAllocations(mockDb, { courtId }) });
  const originalScore = mockDb.get(`matches/${matchId}/score/current`);
  await expect(manageMatch(request())).resolves.toMatchObject({ success: true });
  expect(mockDb.get(`matches/${matchId}/score/current`)).toEqual(originalScore);
  expect(mockDb.get("courts/abcde").beaconSidesSwapped).toBe(false);
});

test("concurrent requests create exactly one new match and reject the stale request", async () => {
  const input = request();
  const results = await Promise.allSettled([manageMatch(input), manageMatch(input)]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected").reason).toMatchObject({
    details: { code: "STALE_MATCH" },
  });
  const current = mockDb.get("courts/abcde").activeMatchId;
  expect(mockDb.list("matches")).toHaveLength(2);
  expect(mockDb.get(`matches/${current}`).status).toBe("live");
  expect(mockDb.get(`matches/${matchId}`).status).toBe("cancelled");
});

test("allocation exhaustion rolls back completion and court attachment", async () => {
  const crypto = require("crypto");
  const alphabet = require("./services/ids").ID_ALPHABET;
  let index = 0;
  jest.spyOn(crypto, "randomInt").mockImplementation(() => alphabet.indexOf(matchId[index++ % 6]));
  const before = allDocs();
  await expect(manageMatch(request())).rejects.toMatchObject({ code: "ABORTED" });
  expect(allDocs()).toEqual(before);
});

test("a score-create failure rolls back all new-match writes and old completion", async () => {
  jest.spyOn(require("crypto"), "randomInt").mockReturnValue(0);
  mockDb.write("matches/aaaaaa/score/current", { orphan: true });
  const before = allDocs();
  await expect(manageMatch(request())).rejects.toMatchObject({ code: 6 });
  expect(allDocs()).toEqual(before);
});

test("password rotation during a transaction invalidates the earlier authorization", async () => {
  const snapshot = mockDb.snapshot.bind(mockDb);
  let rotated = false;
  jest.spyOn(mockDb, "snapshot").mockImplementation((path) => {
    const result = snapshot(path);
    if (path === `matches/${matchId}/score/current` && !rotated) {
      rotated = true;
      mockDb.write("courts/abcde", { password: "rotated-control" }, { merge: true });
    }
    return result;
  });
  await expect(manageMatch(request())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(mockDb.list("matches")).toHaveLength(1);
  expect(mockDb.get(`matches/${matchId}`).status).toBe("live");
  expect(mockDb.get("courts/abcde").activeMatchId).toBe(matchId);
});

test("a point inserted during replacement forces retry instead of being lost", async () => {
  const collection = mockDb.collection.bind(mockDb);
  let inserted = false;
  jest.spyOn(mockDb, "collection").mockImplementation((path) => {
    const query = collection(path);
    if (path === `matches/${matchId}/events`) {
      const get = query.get.bind(query);
      query.get = async () => {
        const snapshot = await get();
        if (!inserted) {
          inserted = true;
          await point("racing", 100, "A", {}, false);
        }
        return snapshot;
      };
    }
    return query;
  });
  await expect(manageMatch(request())).rejects.toMatchObject({
    details: { code: "SCORE_PENDING" },
  });
  expect(mockDb.get("courts/abcde").activeMatchId).toBe(matchId);
  expect(mockDb.get(`matches/${matchId}`).status).toBe("live");
  expect(mockDb.list("matches")).toHaveLength(1);
});
