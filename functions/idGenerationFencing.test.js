const { FakeFirestore } = require("./testSupport/fakeFirestore");

let mockDb;
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

const ALPHABET = "abcdefghjkmnpqrstuxyz";
let db;
let ids;
let guard;

beforeEach(() => {
  jest.resetModules();
  mockDb = new FakeFirestore();
  db = require("./infrastructure/firebase").db;
  ids = require("./services/ids");
  guard = require("./infrastructure/dataGuard");
});

function candidateSource(...candidates) {
  const indexes = candidates.flatMap((id) => [...id].map((char) => ALPHABET.indexOf(char)));
  let index = 0;
  return () => {
    if (index >= indexes.length) throw new Error("Unexpected ID allocation.");
    return indexes[index++];
  };
}

async function createResource(type, id, data = {}) {
  return ids.runIdTransaction(db, async (tx) => {
    const allocatedId = await ids.allocateId(tx, type, {
      randomInt: candidateSource(id),
    });
    tx.create(db.doc(`${ids.COLLECTIONS[type]}/${allocatedId}`), data);
    return allocatedId;
  });
}

test("allocations create tokenized roots without a retention ledger", async () => {
  const first = await createResource("court", "aaaaa", { name: "First" });
  const second = await ids.runIdTransaction(db, async (tx) => {
    const id = await ids.allocateId(tx, "court", {
      randomInt: candidateSource("aaaaa", "bbbbb"),
    });
    tx.create(db.doc(`courts/${id}`), { name: "Second" });
    return id;
  });

  expect(first).toBe("aaaaa");
  expect(second).toBe("bbbbb");
  expect(mockDb.get("courts/aaaaa")).toMatchObject({
    name: "First",
    allocationId: expect.any(String),
  });
  expect(mockDb.get("courts/bbbbb")).toMatchObject({
    name: "Second",
    allocationId: expect.any(String),
  });
  expect([...mockDb.docs.keys()].some((path) => path.startsWith("_idLedger/"))).toBe(false);
});

test("managed roots require an allocation and a deleted ID can be assigned again", async () => {
  await expect(db.doc("courts/zzzzz").create({ allocationId: "forged" })).rejects.toMatchObject({
    code: "FAILED_PRECONDITION",
  });

  await createResource("court", "zzzzz", { name: "Old" });
  const oldAllocationId = mockDb.get("courts/zzzzz").allocationId;
  await mockDb.doc("courts/zzzzz").delete();
  await expect(
    db.doc("courts/zzzzz").set({ name: "Late edit" }, { merge: true }),
  ).rejects.toMatchObject({
    code: "FAILED_PRECONDITION",
    details: { code: "ROOT_MISSING" },
  });

  await createResource("court", "zzzzz", { name: "New" });
  expect(mockDb.get("courts/zzzzz")).toMatchObject({
    name: "New",
    allocationId: expect.any(String),
  });
  expect(mockDb.get("courts/zzzzz").allocationId).not.toBe(oldAllocationId);
});

test("operations and delayed score events remain fenced by allocation generation", async () => {
  const matchId = await createResource("match", "aaaaaa", {
    status: "live",
    scoreVersion: 0,
  });
  const oldAllocationId = mockDb.get(`matches/${matchId}`).allocationId;
  let signalRead;
  let resume;
  const readDone = new Promise((resolve) => {
    signalRead = resolve;
  });
  const paused = new Promise((resolve) => {
    resume = resolve;
  });

  const operation = guard.runInOperationScope(async () => {
    await db.doc(`matches/${matchId}`).get();
    signalRead();
    await paused;
    await expect(
      db.doc(`matches/${matchId}`).set({ name: "Stale edit" }, { merge: true }),
    ).rejects.toMatchObject({ details: { code: "STALE_GENERATION" } });
  });
  await readDone;
  await mockDb.doc(`matches/${matchId}`).delete();
  await createResource("match", matchId, { status: "live", scoreVersion: 0 });
  resume();
  await operation;
  const currentAllocationId = mockDb.get(`matches/${matchId}`).allocationId;
  expect(currentAllocationId).not.toBe(oldAllocationId);

  const { processScoreEvent } = require("./services/scoreService");
  const deliver = async (eventId, allocationId) => {
    const event = {
      eventType: "POINT_TEAM_A",
      createdAt: { seconds: 10, nanoseconds: 0 },
      scoreVersion: 0,
      matchId,
      allocationId,
    };
    mockDb.docs.set(`matches/${matchId}/events/${eventId}`, event);
    await guard.runInOperationScope(() =>
      processScoreEvent({
        params: { matchId, eventId },
        data: { data: () => event },
      }),
    );
  };
  await deliver("stale", oldAllocationId);
  expect(mockDb.get(`matches/${matchId}/score/current`)).toBeUndefined();
  await deliver("current", currentAllocationId);
  expect(mockDb.get(`matches/${matchId}/score/current`)).toBeDefined();
});
