const { FakeFirestore } = require("./testSupport/fakeFirestore");

let mockDb;
jest.mock("firebase-functions/v2/https", () => {
  class HttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  return { HttpsError };
});
jest.mock("./infrastructure/firebase", () => {
  const { createGuardedFirestore } = jest.requireActual("./infrastructure/dataGuard");
  const guarded = new WeakMap();
  return {
    get db() {
      if (!guarded.has(mockDb)) guarded.set(mockDb, createGuardedFirestore(mockDb));
      return guarded.get(mockDb);
    },
    FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
  };
});

let service;
let ids;
let call;
let withExpectedAllocations;

beforeEach(() => {
  jest.resetModules();
  mockDb = new FakeFirestore({
    "clubs/hjkm": {
      allocationId: "club-token",
      name: "Social Club",
      state: "open",
      courtIds: ["abcde"],
    },
    "courts/abcde": {
      allocationId: "court-token",
      name: "Court One",
      status: "open",
      clubId: "hjkm",
    },
  });
  ids = require("./services/ids");
  service = require("./services/tournamentService");
  const { withOperationScope } = require("./infrastructure/dataGuard");
  const { wrapCallable } = require("./services/errors");
  const { manageTournament } = require("./callables/manageTournament");
  ({ withExpectedAllocations } = require("./testSupport/expectedAllocations"));
  call = withOperationScope(wrapCallable(manageTournament));
  jest.spyOn(Date, "now").mockReturnValue(1800000000000);
});

afterEach(() => jest.restoreAllMocks());

const input = (extra = {}) => ({
  name: "Friday Social",
  clubId: "hjkm",
  courtPool: ["abcde"],
  format: { id: "americano", config: { scoring: { pointsTarget: 36 } } },
  participants: [{ displayName: "Alice" }],
  participantText: "Ben\nChris\nDan",
  scheduling: { defaultMatchDurationMinutes: 15, defaultChangeoverMinutes: 2 },
  ...extra,
});
const request = (operation, data = {}, credentials = {}) =>
  call({
    data: withExpectedAllocations(mockDb, { operation, ...data, credentials }),
  });
const root = (id) => mockDb.get(`tournaments/${id}`);
const publicView = (id) => mockDb.get(`tournamentViews/${id}`);
const privateView = (id) => mockDb.get(`tournamentPrivateViews/${id}`);
const directory = (id) => mockDb.get(`tournamentDirectory/${id}`);
const withoutUpdatedAt = ({ updatedAt: _updatedAt, ...doc }) => doc;

test("fresh creation returns the committed allocation token and credentials", async () => {
  const created = await request("createTournament", input({ requestId: "fresh" }));
  const stored = root(created.tournamentId);
  expect(created).toMatchObject({
    success: true,
    duplicate: false,
    allocationId: expect.any(String),
    hostKey: expect.any(String),
    accessCode: null,
  });
  expect(created.allocationId).toBe(stored.allocationId);
  expect(mockDb.get("tournamentCreations/fresh")).toMatchObject({
    tournamentId: created.tournamentId,
    tournamentAllocationId: created.allocationId,
  });
  expect(publicView(created.tournamentId)).toMatchObject({
    allocationId: created.allocationId,
    revision: 1,
    participants: [
      { displayName: "Alice" },
      { displayName: "Ben" },
      { displayName: "Chris" },
      { displayName: "Dan" },
    ],
  });
  expect(directory(created.tournamentId)).toMatchObject({
    allocationId: created.allocationId,
    clubName: "Social Club",
  });
  expect(mockDb.get(`tournamentSecrets/${created.tournamentId}`)).toMatchObject({
    hostKeyHash: ids.hashSecret(created.hostKey),
    accessCodeHash: null,
  });
  expect(JSON.stringify(publicView(created.tournamentId))).not.toContain(created.hostKey);
  expect(mockDb.transactionAttempts).toBe(1);
});

test("duplicate creation returns the verified root token without rotating secrets or allocating", async () => {
  const created = await request("createTournament", input({ requestId: "duplicate" }));
  const before = structuredClone([...mockDb.docs]);
  const duplicate = await request("createTournament", input({ requestId: "duplicate" }));
  expect(duplicate).toEqual({
    success: true,
    duplicate: true,
    tournamentId: created.tournamentId,
    allocationId: created.allocationId,
  });
  expect([...mockDb.docs]).toEqual(before);
});

test("a stale creation marker cannot return a token for a nonexistent root", async () => {
  mockDb.docs.set("tournamentCreations/missing", {
    tournamentId: "abcdefg",
    tournamentAllocationId: "expired",
  });
  await expect(request("createTournament", input({ requestId: "missing" }))).rejects.toMatchObject({
    code: "not-found",
    details: { code: "NOT_FOUND" },
  });
  expect(mockDb.list("tournaments")).toEqual([]);
});

test.each([
  { tournamentId: "abcdefg", allocationId: "reused" },
  { tournamentId: "bcdefgh", allocationId: "original" },
])("a duplicate verifies the root identity and generation: %j", async (stored) => {
  mockDb.docs.set("tournamentCreations/stale", {
    tournamentId: "abcdefg",
    tournamentAllocationId: "original",
  });
  mockDb.docs.set("tournaments/abcdefg", stored);
  await expect(request("createTournament", input({ requestId: "stale" }))).rejects.toMatchObject({
    code: "aborted",
    details: { code: "STALE_GENERATION" },
  });
});

test("a legacy creation marker resolves its token from the existing root, not the marker", async () => {
  mockDb.docs.set("tournamentCreations/legacy", { tournamentId: "abcdefg" });
  mockDb.docs.set("tournaments/abcdefg", {
    tournamentId: "abcdefg",
    allocationId: "existing",
  });
  expect(await request("createTournament", input({ requestId: "legacy" }))).toEqual({
    success: true,
    duplicate: true,
    tournamentId: "abcdefg",
    allocationId: "existing",
  });
});

test.each(["public", "private"])(
  "normal %s creation commits readable models and credentials atomically",
  async (visibility) => {
    await request("createTournament", input({ requestId: "first" }));
    const commits = jest.spyOn(mockDb, "commitOperations");
    const created = await request(
      "createTournament",
      input({
        requestId: "second",
        visibility,
      }),
    );
    expect(created).toMatchObject({
      success: true,
      duplicate: false,
      allocationId: root(created.tournamentId).allocationId,
      hostKey: expect.any(String),
      accessCode: visibility === "private" ? expect.any(String) : null,
    });
    expect(commits).toHaveBeenCalledTimes(1);
    const committedPaths = commits.mock.calls[0][0].map((op) => op.path);
    expect(committedPaths).toEqual(
      expect.arrayContaining([
        `tournaments/${created.tournamentId}`,
        `tournamentSecrets/${created.tournamentId}`,
        `tournamentViews/${created.tournamentId}`,
        "tournamentCreations/second",
      ]),
    );
    const secret = mockDb.get(`tournamentSecrets/${created.tournamentId}`);
    expect(secret.hostKeyHash).toBe(ids.hashSecret(created.hostKey));
    expect(secret.accessCodeHash).toBe(
      created.accessCode ? ids.hashSecret(created.accessCode) : null,
    );
    const readable = await request(
      "getTournamentView",
      { tournamentId: created.tournamentId },
      { hostKey: created.hostKey },
    );
    expect(readable.view).toMatchObject({
      allocationId: created.allocationId,
      status: "draft",
      visibility,
      club: { clubId: "hjkm", name: "Social Club" },
      courts: [{ courtId: "abcde", name: "Court One" }],
      participants: [
        { displayName: "Alice" },
        { displayName: "Ben" },
        { displayName: "Chris" },
        { displayName: "Dan" },
      ],
      rounds: [],
      fixtures: [],
      revision: 1,
      setupValidation: { errors: [], warnings: [] },
    });
    expect(
      await request(
        "verifyHost",
        { tournamentId: created.tournamentId },
        {
          hostKey: created.hostKey,
        },
      ),
    ).toMatchObject({ success: true, isHost: true });
    if (visibility === "private") {
      expect(privateView(created.tournamentId)).toEqual(readable.view);
      expect(directory(created.tournamentId)).toBeUndefined();
      expect(publicView(created.tournamentId)).not.toHaveProperty("participants");
      await expect(
        request("getTournamentView", { tournamentId: created.tournamentId }),
      ).rejects.toMatchObject({ code: "permission-denied" });
      expect(
        (
          await request("getTournamentView", {
            tournamentId: created.tournamentId,
            accessCode: created.accessCode,
          })
        ).view,
      ).toEqual(readable.view);
    } else {
      expect(directory(created.tournamentId)).toMatchObject({
        tournamentId: created.tournamentId,
        visibility: "public",
      });
      expect(privateView(created.tournamentId)).toBeUndefined();
    }
    expect(
      await request("createTournament", input({ requestId: "second", visibility })),
    ).toMatchObject({
      duplicate: true,
      tournamentId: created.tournamentId,
      allocationId: created.allocationId,
    });
  },
);

test.each([
  "americano",
  "mexicano",
  "teamAmericano",
  "teamMexicano",
  "roundRobin",
  "swiss",
  "singleElimination",
  "doubleElimination",
  "groupKnockout",
  "kingCourt",
])("atomic initial %s models preserve normal recalculation semantics", async (formatId) => {
  const { getFormat } = require("./domain/tournaments/formats");
  const teamMode = getFormat(formatId).entryMode !== "individual";
  const teams = ["North", "South", "East", "West"].map((name, index) => ({
    name,
    players: [`Player ${index * 2 + 1}`, `Player ${index * 2 + 2}`],
  }));
  const created = await request(
    "createTournament",
    input({
      format: { id: formatId, config: {} },
      participants: teamMode ? [] : input().participants,
      participantText: teamMode ? "" : input().participantText,
      teams: teamMode ? teams : [],
    }),
  );
  const initialView = withoutUpdatedAt(publicView(created.tournamentId));
  const initialDirectory = withoutUpdatedAt(directory(created.tournamentId));
  await request(
    "recalculateTournament",
    { tournamentId: created.tournamentId },
    {
      hostKey: created.hostKey,
    },
  );
  expect(withoutUpdatedAt(publicView(created.tournamentId))).toEqual(initialView);
  expect(withoutUpdatedAt(directory(created.tournamentId))).toEqual(initialDirectory);
  expect(mockDb.list(`tournaments/${created.tournamentId}/teams`)).toHaveLength(teamMode ? 4 : 0);
  expect(mockDb.list(`tournaments/${created.tournamentId}/rounds`)).toEqual([]);
  expect(mockDb.list("matches")).toEqual([]);
});

test("read-model planning failures reject creation and roll back its credentials", async () => {
  const { getFormat } = require("./domain/tournaments/formats");
  jest.spyOn(getFormat("americano"), "getRulesSummary").mockImplementation(() => {
    throw new Error("read model failed");
  });
  const before = structuredClone([...mockDb.docs]);
  await expect(
    service.createTournament(input({ requestId: "failure" }), {
      actor: { type: "host" },
    }),
  ).rejects.toThrow("read model failed");
  expect([...mockDb.docs]).toEqual(before);
});

test("recalculation stamps a newly ready bracket match instead of retaining its null token", async () => {
  const created = await request(
    "createTournament",
    input({
      format: { id: "singleElimination", config: {} },
      participants: [],
      participantText: "",
      teams: [1, 2, 3, 4].map((number) => ({
        name: `Team ${number}`,
        players: [`Player ${number}A`, `Player ${number}B`],
      })),
    }),
  );
  const host = { hostKey: created.hostKey };
  await request("generateRound", { tournamentId: created.tournamentId }, host);
  const fixtures = mockDb.list(`tournaments/${created.tournamentId}/fixtures`);
  const semis = fixtures.filter((fixture) => fixture.roundNumber === 1);
  const final = fixtures.find((fixture) => fixture.roundNumber === 2);
  expect(final).toMatchObject({ matchId: null, matchAllocationId: null });
  const sides = { A: semis[0].sides.A, B: semis[1].sides.B };
  const path = `tournaments/${created.tournamentId}/fixtures/${final.id}`;
  mockDb.docs.set(path, {
    ...mockDb.get(path),
    sides,
    participantIds: [...sides.A.participantIds, ...sides.B.participantIds],
    teamIds: [sides.A.teamId, sides.B.teamId],
  });
  await request("recalculateTournament", { tournamentId: created.tournamentId }, host);
  const assigned = mockDb.get(path);
  expect(assigned.matchId).toEqual(expect.any(String));
  expect(assigned.matchAllocationId).toBe(mockDb.get(`matches/${assigned.matchId}`).allocationId);
  expect(assigned.matchAllocationId).toEqual(expect.any(String));
});

test("a read-model storage failure rejects the request and rolls back the allocation", async () => {
  await request("createTournament", input({ requestId: "first" }));
  const before = structuredClone([...mockDb.docs]);
  const write = mockDb.write.bind(mockDb);
  jest.spyOn(mockDb, "write").mockImplementation((path, ...args) => {
    if (path.startsWith("tournamentViews/")) throw new Error("storage failed");
    return write(path, ...args);
  });
  const logged = jest.spyOn(console, "error").mockImplementation(() => {});
  await expect(request("createTournament", input({ requestId: "failure" }))).rejects.toMatchObject({
    code: "internal",
  });
  expect(logged).toHaveBeenCalledWith("Unexpected operation failure:", expect.any(Error));
  expect([...mockDb.docs]).toEqual(before);
});
