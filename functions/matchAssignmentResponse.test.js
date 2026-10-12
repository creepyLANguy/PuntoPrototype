const { FakeFirestore } = require("./testSupport/fakeFirestore");

let mockDb;
jest.mock("./infrastructure/firebase", () => ({
  get db() {
    return mockDb;
  },
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));

let ensureCourtMatch;

beforeEach(() => {
  jest.resetModules();
  mockDb = new FakeFirestore({
    "courts/abcde": { name: "Court", status: "open", allocationId: "court-assignment" },
  });
  ({ ensureCourtMatch } = require("./services/matchService"));
});

test("fresh and idempotent court-match responses identify the same allocation", async () => {
  const created = await ensureCourtMatch({ courtId: "abcde" });
  const allocationId = mockDb.get(`matches/${created.matchId}`).allocationId;
  expect(created).toMatchObject({ created: true, allocationId });
  expect(await ensureCourtMatch({ courtId: "abcde" })).toMatchObject({
    created: false,
    matchId: created.matchId,
    allocationId,
  });
  expect(mockDb.list("matches")).toHaveLength(1);
});

test("an existing active match returns its previously assigned token without allocation", async () => {
  mockDb.write("courts/abcde", { activeMatchId: "abcdef" }, { merge: true });
  mockDb.write("matches/abcdef", {
    allocationId: "existing-match-assignment",
    status: "live",
    currentCourtId: "abcde",
    scoreVersion: 3,
  });
  expect(await ensureCourtMatch({ courtId: "abcde" })).toEqual({
    matchId: "abcdef",
    allocationId: "existing-match-assignment",
    scoreVersion: 3,
    created: false,
  });
  expect(mockDb.get("_idLedger/match")).toBeUndefined();
});
