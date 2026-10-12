// ID retention: ledger accounting, maintenance gate, resumable cull worker,
// archive/unlink/delete/release and generation fencing, with small injected
// retention policies.
const crypto = require("crypto");
const { FakeFirestore } = require("./testSupport/fakeFirestore");

let mockDb;
jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (_config, handler) => handler,
  onDocumentDeleted: (_config, handler) => handler,
}));
jest.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_config, handler) => handler,
}));
jest.mock("firebase-functions/v2/https", () => {
  class HttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  return {
    HttpsError,
    onCall: (_config, handler) => handler,
    onRequest: (_config, handler) => handler,
  };
});
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
    FieldValue: {
      serverTimestamp: () => ({ __serverTimestamp: true }),
      arrayRemove: (...values) => ({ __arrayRemove: values }),
    },
    FieldPath: { documentId: () => "__name__" },
  };
});

const POLICIES = {
  club: { trigger: 3, target: 1 },
  court: { trigger: 3, target: 1 },
  match: { trigger: 4, target: 2 },
  tournament: { trigger: 2, target: 1 },
};

let ids;
let config;
let retention;
let guard;
let firebase;
let paths;

beforeEach(() => {
  jest.resetModules();
  mockDb = new FakeFirestore();
  ids = require("./services/ids");
  config = require("./services/retentionConfig");
  retention = require("./services/retentionService");
  guard = require("./infrastructure/dataGuard");
  firebase = require("./infrastructure/firebase");
  paths = config.retentionPaths;
  config.setRetentionPolicies(POLICIES);
});
afterEach(() => {
  config.resetRetentionPolicies();
  jest.restoreAllMocks();
});

const ALPHABET = "abcdefghjkmnpqrstuxyz";

function candidateSource(...candidates) {
  const indexes = candidates.flatMap((id) => [...id].map((char) => ALPHABET.indexOf(char)));
  return jest.spyOn(crypto, "randomInt").mockImplementation(() => {
    if (!indexes.length) throw new Error("Unexpected ID allocation.");
    return indexes.shift();
  });
}

function rootPath(type, id) {
  return `${ids.COLLECTIONS[type]}/${id}`;
}

// Allocates every ID in the read phase, then creates the roots.
async function allocate(type, data = {}, count = 1) {
  const db = firebase.db;
  return ids.runIdTransaction(db, async (tx) => {
    const created = [];
    for (let i = 0; i < count; i++) created.push(await ids.allocateId(tx, type));
    created.forEach((id) => tx.create(db.doc(rootPath(type, id)), { ...data }));
    return count === 1 ? created[0] : created;
  });
}

const ledger = (type) => mockDb.get(paths.ledger(type));
const record = (type, id) => mockDb.get(paths.allocation(type, id));
const gate = () => mockDb.get(config.GATE_PATH);
const job = () => mockDb.get(paths.job(gate().jobId ?? gate().lastJobId));
const pathsUnder = (prefix) =>
  [...mockDb.docs.keys()].filter((path) => path === prefix || path.startsWith(`${prefix}/`));

async function runToCompletion(options = {}) {
  let result;
  for (let i = 0; i < 1000; i++) {
    result = await retention.runRetentionWorker({
      db: mockDb,
      workerId: "worker-a",
      batchSize: 2,
      ...options,
    });
    if (result.status === "completed" || result.status === "idle") return result;
  }
  throw new Error(`Worker did not finish: ${JSON.stringify(result)}`);
}

function expectMaintenance(promise) {
  return expect(promise).rejects.toMatchObject({
    code: "UNAVAILABLE",
    details: { code: "MAINTENANCE", retryable: true },
  });
}

describe("allocation ledger", () => {
  test("stamps an immutable allocationId on the root and its ledger record", async () => {
    const id = await allocate("court", { name: "One" });
    const root = mockDb.get(rootPath("court", id));
    expect(root).toEqual({ name: "One", allocationId: expect.any(String) });
    expect(record("court", id)).toEqual({
      type: "court",
      id,
      allocationId: root.allocationId,
      sequence: 1,
      state: "live",
      allocatedAtMs: expect.any(Number),
    });
    expect(ledger("court")).toMatchObject({
      type: "court",
      sequence: 1,
      live: 1,
      released: 0,
      trigger: 3,
      target: 1,
      cullJobId: null,
    });
    await expect(
      firebase.db.doc(rootPath("court", id)).set({ allocationId: "forged" }, { merge: true }),
    ).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
  });

  test("one below the trigger starts no cull; reaching it exactly starts one atomically", async () => {
    await allocate("club");
    await allocate("club");
    expect(ledger("club")).toMatchObject({ live: 2, cullJobId: null });
    expect(gate()).toBeUndefined();
    expect(pathsUnder(config.JOBS_COLLECTION)).toEqual([]);

    await allocate("club");
    const control = gate();
    expect(control).toMatchObject({ active: true, types: ["club"], epoch: 1 });
    expect(ledger("club")).toMatchObject({ live: 3, sequence: 3, cullJobId: control.jobId });
    expect(job()).toMatchObject({
      status: "pending",
      types: ["club"],
      plan: { club: { cullCount: 2, occupiedAtStart: 3 } },
    });

    // Allocations of every type are blocked while the cull is pending.
    await expectMaintenance(allocate("club"));
    await expectMaintenance(allocate("court"));
    expect(ledger("club").live).toBe(3);
    expect(ledger("court")).toBeUndefined();
  });

  test("a multi-allocation commit that overshoots plans the exact excess", async () => {
    const created = await allocate("club", {}, 5);
    expect(new Set(created).size).toBe(5);
    expect(created.map((id) => record("club", id).sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(ledger("club")).toMatchObject({ live: 5, sequence: 5 });
    expect(job().plan.club).toEqual({ cullCount: 4, occupiedAtStart: 5 });

    await runToCompletion();
    expect(ledger("club")).toMatchObject({ live: 1, released: 0, culled: 4, cullJobId: null });
    expect(mockDb.list("clubs").map((club) => club.id)).toEqual([created[4]]);
    expect(mockDb.list(paths.allocations("club")).map((entry) => entry.id)).toEqual([created[4]]);
  });

  test("failed callbacks, unused allocations and collisions are never counted", async () => {
    await expect(
      ids.runIdTransaction(firebase.db, async (tx) => {
        const id = await ids.allocateId(tx, "court");
        tx.create(firebase.db.doc(rootPath("court", id)), {});
        throw new Error("callback failed");
      }),
    ).rejects.toThrow("callback failed");
    await ids.runIdTransaction(firebase.db, (tx) => ids.allocateId(tx, "court"));
    expect(ledger("court")).toBeUndefined();
    expect(pathsUnder("_idLedger")).toEqual([]);

    // A legacy root and a released (root-less) record both block their IDs.
    mockDb.docs.set("courts/aaaaa", { legacy: true });
    mockDb.docs.set(paths.allocation("court", "bbbbb"), {
      type: "court",
      id: "bbbbb",
      allocationId: "old",
      state: "released",
      sequence: 0,
    });
    candidateSource("aaaaa", "bbbbb", "ccccc");
    const id = await allocate("court");
    expect(id).toBe("ccccc");
    expect(ledger("court")).toMatchObject({ sequence: 1, live: 1 });
  });

  test("SDK conflict retries count a created root once", async () => {
    const runTransaction = mockDb.runTransaction.bind(mockDb);
    let failed = false;
    jest.spyOn(mockDb, "runTransaction").mockImplementation((callback, options) =>
      runTransaction(async (tx) => {
        const result = await callback(tx);
        if (!failed) {
          failed = true;
          throw Object.assign(new Error("retry"), { code: 10 });
        }
        return result;
      }, options),
    );
    const id = await allocate("match");
    expect(ledger("match")).toMatchObject({ sequence: 1, live: 1 });
    expect(record("match", id).sequence).toBe(1);
  });

  test("concurrent allocations serialize on the ledger with unique sequences", async () => {
    config.setRetentionPolicies({ court: { trigger: 10, target: 2 } });
    const created = await Promise.all([1, 2, 3, 4].map(() => allocate("court")));
    expect(new Set(created).size).toBe(4);
    expect(ledger("court")).toMatchObject({ sequence: 4, live: 4 });
    expect(created.map((id) => record("court", id).sequence).sort()).toEqual([1, 2, 3, 4]);
  });

  test("concurrent allocations crossing the trigger open exactly one cull", async () => {
    await allocate("club");
    const results = await Promise.allSettled([allocate("club"), allocate("club")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(ledger("club").live).toBe(3);
    const jobs = mockDb.list(config.JOBS_COLLECTION);
    expect(jobs).toHaveLength(1);
    expect(gate().jobId).toBe(jobs[0].id);

    const blocked = await Promise.allSettled([allocate("club"), allocate("club")]);
    expect(blocked.every((result) => result.status === "rejected")).toBe(true);
    expect(mockDb.list(config.JOBS_COLLECTION)).toHaveLength(1);
  });
});

describe("cull worker", () => {
  async function seedCourtCull() {
    candidateSource("aaaaa", "bbbbb");
    const [oldest, second] = [await allocate("court"), await allocate("court")];
    const allocationId = mockDb.get("courts/aaaaa").allocationId;
    mockDb.docs.set("courts/aaaaa/settings/main", { theme: "dark", savedAtMs: 1234 });
    // Missing ancestor: only the grandchild exists.
    mockDb.docs.set("courts/aaaaa/history/h1/points/p1", {
      point: 1,
      at: { seconds: 5, nanoseconds: 6 },
    });
    mockDb.docs.set("matches/mmmmmm", {
      currentCourtId: "aaaaa",
      lastCourtId: "aaaaa",
      allocationId: "m-gen",
    });
    mockDb.docs.set("matches/mmmmmm/events/e1", { courtId: "aaaaa", eventType: "POINT_TEAM_A" });
    mockDb.docs.set("devices/dev1", { courtId: "aaaaa", clubId: null });
    mockDb.docs.set("clubs/cccc", { courtIds: ["aaaaa", "bbbbb", "keepx"], allocationId: "c" });
    mockDb.docs.set("tournaments/ttttttt", { courtPool: ["bbbbb", "keepx"], allocationId: "t" });
    mockDb.docs.set("tournaments/ttttttt/fixtures/f1", { courtId: "aaaaa", matchId: "mmmmmm" });
    mockDb.docs.set("tournaments/ttttttt/participants/p1", {
      assignedCourtIds: ["aaaaa", "keepx"],
    });
    mockDb.docs.set("tournamentViews/ttttttt", {
      fixtures: [{ courtId: "aaaaa", label: "Court A" }],
      courtPool: ["bbbbb", "keepx"],
    });
    mockDb.docs.set("devices/dev1/deviceEvents/x", {
      sourceCourtId: "aaaaa",
      targetCourtId: "bbbbb",
    });
    mockDb.docs.set("clubs/cccc/audits/a1", {
      courtId: "aaaaa",
      beforeSummary: { courtId: "aaaaa" },
      afterSummary: { courtId: "keepx" },
    });
    candidateSource("ccccc");
    const newest = await allocate("court");
    return { oldest, second, newest, allocationId };
  }

  test("archives full trees, unlinks every reference, deletes and releases to the exact target", async () => {
    const { oldest, second, newest, allocationId } = await seedCourtCull();
    expect(job().plan.court).toEqual({ cullCount: 2, occupiedAtStart: 3 });
    const archivedTree = {
      "courts/aaaaa": mockDb.get("courts/aaaaa"),
      "courts/aaaaa/settings/main": mockDb.get("courts/aaaaa/settings/main"),
      "courts/aaaaa/history/h1/points/p1": mockDb.get("courts/aaaaa/history/h1/points/p1"),
    };

    const result = await runToCompletion();
    expect(result.status).toBe("completed");

    // Originals and every descendant are gone; the newest court survives.
    expect(pathsUnder(`courts/${oldest}`)).toEqual([]);
    expect(pathsUnder(`courts/${second}`)).toEqual([]);
    expect(mockDb.get(`courts/${newest}`)).toBeDefined();

    // The archive keeps complete data under an immutable generation key.
    const key = config.archiveKeyFor(oldest, allocationId);
    expect(key).toBe(`aaaaa_${allocationId}`);
    expect(mockDb.get(paths.archive("court", key))).toMatchObject({
      type: "court",
      id: oldest,
      allocationId,
      status: "complete",
      rootExists: true,
      documentCount: 3,
      deletedCount: 3,
    });
    const archived = mockDb.list(paths.archiveDocuments("court", key));
    expect(Object.fromEntries(archived.map((doc) => [doc.path, doc.data]))).toEqual(archivedTree);

    // References are unlinked (previous values preserved in the archive).
    expect(mockDb.get("matches/mmmmmm")).toMatchObject({
      currentCourtId: null,
      lastCourtId: null,
      allocationId: "m-gen",
    });
    expect(mockDb.get("matches/mmmmmm/events/e1").courtId).toBeNull();
    expect(mockDb.get("devices/dev1").courtId).toBeNull();
    expect(mockDb.get("clubs/cccc").courtIds).toEqual(["keepx"]);
    expect(mockDb.get("tournaments/ttttttt").courtPool).toEqual(["keepx"]);
    expect(mockDb.get("tournaments/ttttttt/fixtures/f1")).toEqual({
      courtId: null,
      matchId: "mmmmmm",
    });
    expect(mockDb.get("tournaments/ttttttt/participants/p1").assignedCourtIds).toEqual(["keepx"]);
    expect(mockDb.get("tournamentViews/ttttttt")).toEqual({
      fixtures: [{ courtId: null, label: "Court A" }],
      courtPool: ["keepx"],
    });
    expect(mockDb.get("devices/dev1/deviceEvents/x")).toEqual({
      sourceCourtId: null,
      targetCourtId: null,
    });
    expect(mockDb.get("clubs/cccc/audits/a1")).toEqual({
      courtId: null,
      beforeSummary: { courtId: null },
      afterSummary: { courtId: "keepx" },
    });
    const unlinks = mockDb.list(`${paths.archive("court", key)}/unlinks`);
    expect(unlinks.find((entry) => entry.path === "matches/mmmmmm").before).toMatchObject({
      currentCourtId: "aaaaa",
    });

    // The ledger lands exactly on target and the gate reopens with a new epoch.
    expect(ledger("court")).toMatchObject({
      live: 1,
      released: 0,
      culled: 2,
      cullJobId: null,
      lastCullJobId: job().jobId,
    });
    expect(mockDb.list(paths.allocations("court")).map((entry) => entry.id)).toEqual([newest]);
    expect(gate()).toMatchObject({ active: false, jobId: null, epoch: 2 });
    expect(job()).toMatchObject({ status: "completed", victimCount: 2, nextVictim: 2 });
    expect(await retention.runRetentionWorker({ db: mockDb })).toEqual({
      status: "idle",
      steps: 0,
    });

    // The ID is reusable with a new generation; the old archive is untouched.
    candidateSource("aaaaa");
    expect(await allocate("court", { name: "Reused" })).toBe("aaaaa");
    const reused = mockDb.get("courts/aaaaa");
    expect(reused.allocationId).not.toBe(allocationId);
    expect(record("court", "aaaaa")).toMatchObject({ sequence: 4, state: "live" });
    expect(mockDb.get(paths.archive("court", key)).allocationId).toBe(allocationId);
  });

  test("tournament culls archive sidecars, creations and nested subcollections", async () => {
    candidateSource("aaaaaaa");
    const tournamentId = await allocate("tournament", { name: "Cup", clubId: null });
    const allocationId = mockDb.get(`tournaments/${tournamentId}`).allocationId;
    const tree = {
      [`tournaments/${tournamentId}/rounds/r1/fixtures/f1`]: { matchId: "mmmmmm" },
      [`tournaments/${tournamentId}/participants/p1`]: { name: "Ann" },
      [`tournamentViews/${tournamentId}`]: { public: true },
      [`tournamentPrivateViews/${tournamentId}`]: { private: true },
      [`tournamentDirectory/${tournamentId}`]: { listed: true },
      [`tournamentSecrets/${tournamentId}`]: { hash: "h" },
      [`tournamentSecrets/${tournamentId}/keys/k1`]: { key: "nested" },
    };
    Object.entries(tree).forEach(([path, data]) => mockDb.docs.set(path, data));
    mockDb.docs.set("tournamentCreations/request-1", { tournamentId, uid: "u" });
    mockDb.docs.set("matches/mmmmmm", {
      tournamentId,
      roundId: "r1",
      fixtureId: "f1",
      allocationId: "m",
    });
    candidateSource("bbbbbbb");
    await allocate("tournament");
    expect(job().plan.tournament.cullCount).toBe(1);

    await runToCompletion({ batchSize: 1 });

    const key = config.archiveKeyFor(tournamentId, allocationId);
    const archived = Object.fromEntries(
      mockDb.list(paths.archiveDocuments("tournament", key)).map((doc) => [doc.path, doc.data]),
    );
    expect(archived).toEqual({
      ...tree,
      [`tournaments/${tournamentId}`]: {
        name: "Cup",
        clubId: null,
        clubAllocationId: null,
        allocationId,
      },
      "tournamentCreations/request-1": { tournamentId, uid: "u" },
    });
    Object.keys(archived).forEach((path) => expect(mockDb.get(path)).toBeUndefined());
    expect(mockDb.get("matches/mmmmmm")).toEqual({
      tournamentId: null,
      roundId: null,
      fixtureId: null,
      allocationId: "m",
    });
    expect(mockDb.get("tournaments/bbbbbbb")).toBeDefined();
    expect(ledger("tournament")).toMatchObject({ live: 1, culled: 1, cullJobId: null });
  });

  test("match culls unlink courts and fixtures from the old generation", async () => {
    candidateSource("aaaaaa", "bbbbbb", "cccccc", "dddddd");
    for (let i = 0; i < 3; i++) await allocate("match", { status: "live" });
    mockDb.docs.set("courts/kkkkk", { activeMatchId: "aaaaaa", lastMatchId: "bbbbbb" });
    mockDb.docs.set("tournaments/ttttttt/fixtures/f1", { matchId: "aaaaaa", courtId: "kkkkk" });
    mockDb.docs.set("tournamentPrivateViews/ttttttt", { fixtures: [{ matchId: "aaaaaa" }] });
    await allocate("match", { status: "live" });
    expect(job().plan.match.cullCount).toBe(2);
    await runToCompletion();
    expect(mockDb.get("courts/kkkkk")).toEqual({ activeMatchId: null, lastMatchId: null });
    expect(mockDb.get("tournaments/ttttttt/fixtures/f1")).toEqual({
      matchId: null,
      courtId: "kkkkk",
    });
    expect(mockDb.get("tournamentPrivateViews/ttttttt")).toEqual({
      fixtures: [{ matchId: null }],
    });
    expect(mockDb.list("matches").map((match) => match.id)).toEqual(["cccccc", "dddddd"]);
  });

  test("club culls unlink courts, devices, tournaments and directory entries", async () => {
    candidateSource("aaaa", "bbbb", "cccc");
    await allocate("club");
    mockDb.docs.set("courts/kkkkk", { clubId: "aaaa" });
    mockDb.docs.set("devices/dev1", { clubId: "aaaa", courtId: "kkkkk" });
    mockDb.docs.set("tournaments/ttttttt", { clubId: "aaaa" });
    mockDb.docs.set("tournamentDirectory/ttttttt", { clubId: "aaaa", clubName: "Old club" });
    await allocate("club");
    await allocate("club");
    await runToCompletion();
    expect(mockDb.get("courts/kkkkk")).toEqual({ clubId: null });
    expect(mockDb.get("devices/dev1")).toEqual({ clubId: null, courtId: "kkkkk" });
    expect(mockDb.get("tournaments/ttttttt")).toEqual({ clubId: null });
    expect(mockDb.get("tournamentDirectory/ttttttt")).toEqual({ clubId: null, clubName: null });
  });

  test.each([
    ["match", "activeMatchId"],
    ["match", "lastMatchId"],
    ["club", "clubId"],
  ])(
    "%s culls clean %s court snapshots in unrelated tournaments before old IDs become reusable",
    async (type, courtField) => {
      const match = type === "match";
      const oldId = match ? "aaaaaa" : "aaaa";
      const survivors = match ? ["bbbbbb", "cccccc", "dddddd"] : ["bbbb", "cccc"];
      candidateSource(oldId, ...survivors);
      await allocate(type);
      const allocationId = record(type, oldId).allocationId;
      const fields = match
        ? {
            [courtField]: oldId,
            [courtField.replace(/Id$/, "AllocationId")]: allocationId,
          }
        : { clubId: oldId, clubAllocationId: allocationId, clubName: "Old club" };
      mockDb.docs.set("courts/kkkkk", { allocationId: "court-generation", ...fields });
      // No fixture points to this casual match, and the tournament is owned by
      // a different club. Only the court pool connects the view to the victim.
      mockDb.docs.set("tournaments/ttttttt", {
        allocationId: "tournament-generation",
        courtPool: ["kkkkk"],
        clubId: "unrelated",
      });
      const collections = ["tournamentViews", "tournamentPrivateViews", "tournamentDirectory"];
      collections.forEach((collection) =>
        mockDb.docs.set(`${collection}/ttttttt`, {
          clubId: "unrelated",
          courts: [{ courtId: "kkkkk", ...fields }],
        }),
      );
      for (const id of survivors) expect(await allocate(type)).toBe(id);
      const jobId = job().jobId;
      for (let step = 0; step < 30; step++) {
        await retention.runRetentionWorker({
          db: mockDb,
          workerId: "first",
          maxSteps: 1,
          batchSize: 1,
        });
        if (mockDb.get(paths.victim(jobId, 0))?.unlinkAfter) break;
      }
      expect(mockDb.get(paths.victim(jobId, 0)).unlinkAfter).toBe("ttttttt");
      expect(mockDb.get(paths.victim(jobId, 0)).unlinkViews.paths).toEqual([
        "tournamentViews/ttttttt",
      ]);
      expect(record(type, oldId).state).toBe("culling");
      expect(gate().active).toBe(true);
      await expectMaintenance(allocate(type));
      await runToCompletion({ workerId: "resumed", maxSteps: 1 });
      const cleared = Object.fromEntries(Object.keys(fields).map((field) => [field, null]));
      collections.forEach((collection) => {
        const path = `${collection}/ttttttt`;
        expect(mockDb.get(path)).toEqual({
          clubId: "unrelated",
          courts: [{ courtId: "kkkkk", ...cleared }],
        });
        const archived = mockDb
          .list(`${paths.archive(type, config.archiveKeyFor(oldId, allocationId))}/unlinks`)
          .find((entry) => entry.path === path);
        expect(archived.before.courts).toEqual([{ courtId: "kkkkk", ...fields }]);
      });
      expect(record(type, oldId)).toBeUndefined();
      candidateSource(oldId);
      expect(await allocate(type)).toBe(oldId);
      expect(record(type, oldId).allocationId).not.toBe(allocationId);
    },
  );

  test.each(["court", "match", "club"])(
    "%s culls scrub orphaned view copies after current roots replace their references",
    async (type) => {
      const candidates = {
        court: ["aaaaa", "bbbbb", "ccccc"],
        match: ["aaaaaa", "bbbbbb", "cccccc", "dddddd"],
        club: ["aaaa", "bbbb", "cccc"],
      }[type];
      const [oldId, ...laterIds] = candidates;
      const replacement = candidates[2];
      candidateSource(...candidates);
      await allocate(type);
      const allocationId = record(type, oldId).allocationId;
      const copied = (id, generation) =>
        type === "match"
          ? {
              activeMatchId: id,
              lastMatchId: id,
              activeMatchAllocationId: generation,
              lastMatchAllocationId: generation,
            }
          : type === "club"
            ? { clubId: id, clubAllocationId: generation, clubName: `Club ${id}` }
            : { courtId: id, courtAllocationId: generation, courtName: `Court ${id}` };
      const stale = copied(oldId, allocationId);
      const current = copied(replacement, "new-generation");
      // Both casual-match pointers / the club have changed without rebuilding
      // views. Even the tournament's original court pool has disappeared.
      mockDb.docs.set("courts/kkkkk", { ...current, allocationId: "court-generation" });
      mockDb.docs.set("tournaments/ttttttt", { courtPool: [], clubId: "unrelated" });
      const collections = ["tournamentViews", "tournamentPrivateViews", "tournamentDirectory"];
      const before = {
        clubId: "unrelated",
        courts: [{ ...stale }, { ...current }],
        unchanged: { label: "keep" },
      };
      for (const tournament of ["orphan", "ttttttt"]) {
        collections.forEach((collection) =>
          mockDb.docs.set(`${collection}/${tournament}`, structuredClone(before)),
        );
      }
      for (const id of laterIds) expect(await allocate(type)).toBe(id);
      expect(mockDb.get("courts/kkkkk")).toEqual({ ...current, allocationId: "court-generation" });
      const jobId = job().jobId;
      for (let step = 0; step < 40; step++) {
        await retention.runRetentionWorker({
          db: mockDb,
          workerId: "scan-first",
          maxSteps: 1,
          batchSize: 1,
        });
        if (mockDb.get(paths.victim(jobId, 0))?.unlinkAfter) break;
      }
      expect(mockDb.get(paths.victim(jobId, 0)).unlinkAfter).toBe("orphan");
      expect(record(type, oldId).state).toBe("culling");
      await runToCompletion({ workerId: "scan-resumed", maxSteps: 1 });
      const cleared = Object.fromEntries(Object.keys(stale).map((key) => [key, null]));
      for (const tournament of ["orphan", "ttttttt"]) {
        for (const collection of collections) {
          const path = `${collection}/${tournament}`;
          expect(mockDb.get(path)).toEqual({ ...before, courts: [cleared, current] });
          const archived = mockDb
            .list(`${paths.archive(type, config.archiveKeyFor(oldId, allocationId))}/unlinks`)
            .find((entry) => entry.path === path);
          expect(archived.before).toEqual(before);
        }
      }
      expect(mockDb.get("courts/kkkkk")).toEqual({ ...current, allocationId: "court-generation" });
      expect(record(type, oldId)).toBeUndefined();
      candidateSource(oldId);
      expect(await allocate(type)).toBe(oldId);
      expect(record(type, oldId).allocationId).not.toBe(allocationId);
    },
  );

  test("bounded single steps resume across workers to the same final state", async () => {
    const { oldest, newest } = await seedCourtCull();
    const workers = ["w1", "w2", "w3"];
    let steps = 0;
    for (let i = 0; i < 500; i++) {
      const result = await retention.runRetentionWorker({
        db: mockDb,
        workerId: workers[i % workers.length],
        maxSteps: 1,
        batchSize: 1,
      });
      steps += result.steps;
      if (result.status === "completed") break;
      expect(result).toMatchObject({ status: "progress", steps: 1 });
      expect(job().lease).toBeNull();
    }
    expect(steps).toBeGreaterThan(10);
    expect(job()).toMatchObject({ status: "completed" });
    expect(job().attempt).toBeGreaterThan(10);
    expect(pathsUnder(`courts/${oldest}`)).toEqual([]);
    expect(mockDb.list("courts").map((court) => court.id)).toEqual([newest]);
    expect(ledger("court")).toMatchObject({ live: 1, released: 0 });
    expect(gate().active).toBe(false);
  });

  test("a live lease blocks other workers and a crashed worker is resumed after expiry", async () => {
    const { oldest } = await seedCourtCull();
    const runTransaction = mockDb.runTransaction.bind(mockDb);
    let calls = 0;
    const spy = jest.spyOn(mockDb, "runTransaction").mockImplementation((callback, options) => {
      calls += 1;
      if (calls === 6) return Promise.reject(new Error("worker crashed"));
      return runTransaction(callback, options);
    });
    const now = 1_000_000;
    await expect(
      retention.runRetentionWorker({ db: mockDb, workerId: "w1", now: () => now, leaseMs: 1000 }),
    ).rejects.toThrow("worker crashed");
    spy.mockRestore();
    const crashed = job();
    expect(crashed.lease).toEqual({ owner: "w1", expiresAtMs: now + 1000 });

    const busy = await retention.runRetentionWorker({
      db: mockDb,
      workerId: "w2",
      now: () => now + 500,
    });
    expect(busy).toEqual({ status: "busy", jobId: crashed.jobId, steps: 0 });
    expect(job()).toEqual(crashed);

    const resumed = await runToCompletion({ workerId: "w2", now: () => now + 5000 });
    expect(resumed.status).toBe("completed");
    expect(job().attempt).toBe(crashed.attempt + 1);
    expect(pathsUnder(`courts/${oldest}`)).toEqual([]);
    expect(ledger("court")).toMatchObject({ live: 1, culled: 2 });
  });

  test("a worker that lost its lease writes nothing", async () => {
    await seedCourtCull();
    const runTransaction = mockDb.runTransaction.bind(mockDb);
    let calls = 0;
    jest.spyOn(mockDb, "runTransaction").mockImplementation((callback, options) => {
      calls += 1;
      if (calls === 2) {
        const current = job();
        mockDb.docs.set(paths.job(current.jobId), {
          ...current,
          attempt: current.attempt + 1,
          lease: { owner: "thief", expiresAtMs: Date.now() + 60000 },
        });
      }
      return runTransaction(callback, options);
    });
    const before = new Map(mockDb.docs);
    const result = await retention.runRetentionWorker({ db: mockDb, workerId: "w1" });
    expect(result).toMatchObject({ status: "lease-lost", steps: 0 });
    const jobPath = paths.job(job().jobId);
    const withoutJob = (docs) => [...docs].filter(([path]) => path !== jobPath);
    expect(withoutJob(mockDb.docs)).toEqual(withoutJob(before));
    expect(job().victimCount).toBe(0);
    expect(job().lease.owner).toBe("thief");
  });

  test("sequence pagination resumes after a crash without prioritizing newer released records", async () => {
    config.setRetentionPolicies({ court: { trigger: 7, target: 3 } });
    const created = ["ggggg", "fffff", "eeeee", "ddddd", "ccccc", "bbbbb", "aaaaa"];
    candidateSource(...created);
    for (const id of created.slice(0, -1)) {
      expect(await allocate("court")).toBe(id);
    }
    for (const id of [created[5], created[1]]) {
      const data = mockDb.get(`courts/${id}`);
      await firebase.db.doc(`courts/${id}`).delete();
      await retention.accountRootDeletion("court", id, data);
    }
    expect(record("court", created[1]).sequence).toBe(2);
    expect(record("court", created[5]).sequence).toBe(6);
    expect(await allocate("court")).toBe(created[6]);
    expect(job().plan.court).toEqual({ cullCount: 4, occupiedAtStart: 7 });

    const runTransaction = mockDb.runTransaction.bind(mockDb);
    let calls = 0;
    const spy = jest.spyOn(mockDb, "runTransaction").mockImplementation((callback, options) => {
      calls += 1;
      if (calls === 3) return Promise.reject(new Error("selection crashed"));
      return runTransaction(callback, options);
    });
    const options = { db: mockDb, batchSize: 2, leaseMs: 100, now: () => 1000 };
    await expect(retention.runRetentionWorker({ ...options, workerId: "crashed" })).rejects.toThrow(
      "selection crashed",
    );
    spy.mockRestore();
    const crashed = job();
    expect(crashed.selection.court).toMatchObject({ selected: 2, cursor: 2, done: false });
    expect(crashed.victimCount).toBe(2);
    expect([0, 1].map((index) => mockDb.get(paths.victim(crashed.jobId, index)).id)).toEqual(
      created.slice(0, 2),
    );

    expect(
      await retention.runRetentionWorker({ ...options, workerId: "resumed", now: () => 1050 }),
    ).toEqual({ status: "busy", jobId: crashed.jobId, steps: 0 });
    expect(job()).toEqual(crashed);
    expect(
      await retention.runRetentionWorker({
        ...options,
        workerId: "resumed",
        now: () => 1101,
        maxSteps: 1,
      }),
    ).toMatchObject({ status: "progress", steps: 1 });
    expect(job().selection.court).toMatchObject({ selected: 4, cursor: 4, done: true });
    expect(
      [0, 1, 2, 3].map((index) => mockDb.get(paths.victim(crashed.jobId, index)).sequence),
    ).toEqual([1, 2, 3, 4]);
    await runToCompletion({ workerId: "resumed", batchSize: 2, now: () => 1102 });
    expect(
      mockDb
        .list(paths.allocations("court"))
        .map((entry) => entry.sequence)
        .sort(),
    ).toEqual([5, 6, 7]);
    expect(
      mockDb
        .list("courts")
        .map((entry) => entry.id)
        .sort(),
    ).toEqual(["aaaaa", "ccccc"]);
    expect(record("court", created[5])).toMatchObject({ sequence: 6, state: "released" });
    expect(ledger("court")).toMatchObject({ sequence: 7, live: 2, released: 1, culled: 4 });
  });

  test("selection advances its cursor past culling records without duplicating victims", async () => {
    await seedCourtCull();
    await retention.runRetentionWorker({
      db: mockDb,
      workerId: "first",
      batchSize: 1,
      maxSteps: 1,
    });
    const selected = job();
    expect(selected.selection.court).toMatchObject({ selected: 1, cursor: 1 });
    expect(record("court", "aaaaa").state).toBe("culling");
    mockDb.docs.set(paths.job(selected.jobId), {
      ...selected,
      selection: { court: { ...selected.selection.court, cursor: null } },
    });

    await retention.runRetentionWorker({
      db: mockDb,
      workerId: "resumed",
      batchSize: 1,
      maxSteps: 1,
    });
    expect(job().selection.court).toMatchObject({ selected: 1, cursor: 1, done: false });
    expect(job().victimCount).toBe(1);
    await retention.runRetentionWorker({
      db: mockDb,
      workerId: "resumed",
      batchSize: 1,
      maxSteps: 1,
    });
    expect(job().selection.court).toMatchObject({ selected: 2, cursor: 2, done: true });
    expect(job().victimCount).toBe(2);
    expect([0, 1].map((index) => mockDb.get(paths.victim(selected.jobId, index)).id)).toEqual([
      "aaaaa",
      "bbbbb",
    ]);
    await runToCompletion({ batchSize: 1 });
    expect(ledger("court")).toMatchObject({ live: 1, released: 0, culled: 2 });
  });

  test("refuses incomplete Firestore clients instead of skipping accounting", async () => {
    const partial = {
      runTransaction: () => {},
      doc: () => ({}),
      collection: () => ({}),
      getAll: () => {},
    };
    await expect(retention.runRetentionWorker({ db: partial })).rejects.toThrow(
      "ID retention requires Firestore db.collectionGroup()",
    );
    await expect(
      retention.runRetentionWorker({
        db: { ...partial, collectionGroup: () => ({}), doc: () => ({}) },
      }),
    ).rejects.toThrow("DocumentReference.listCollections()");
    await expect(retention.runRetentionWorker({ db: mockDb, batchSize: 500 })).rejects.toThrow(
      "batchSize",
    );
  });
});

describe("maintenance gate and generation fencing", () => {
  test("every guarded backend write is refused while a cull is pending", async () => {
    await allocate("club");
    await allocate("club");
    mockDb.docs.set("devices/dev1", { name: "Tablet" });
    await allocate("club");
    const db = firebase.db;
    await expectMaintenance(db.doc("devices/dev1").set({ name: "x" }, { merge: true }));
    await expectMaintenance(db.doc("anything/else").set({ value: 1 }));
    await expectMaintenance(db.doc("devices/dev1").delete());
    const batch = db.batch();
    batch.set(db.doc("devices/dev2"), { name: "y" });
    await expectMaintenance(batch.commit());
    await expectMaintenance(
      db.runTransaction(async (tx) => {
        await tx.get(db.doc("devices/dev1"));
        tx.update(db.doc("devices/dev1"), { name: "z" });
      }),
    );
    expect(mockDb.get("devices/dev1")).toEqual({ name: "Tablet" });
    expect(mockDb.get("devices/dev2")).toBeUndefined();

    await runToCompletion();
    await db.doc("devices/dev1").set({ name: "after" }, { merge: true });
    expect(mockDb.get("devices/dev1")).toEqual({ name: "after" });
  });

  test("roots can only be created through the ID ledger", async () => {
    await expect(firebase.db.doc("courts/zzzzz").create({ name: "Forged" })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION",
    });
    await expect(
      firebase.db.runTransaction(async (tx) => tx.create(firebase.db.doc("clubs/zzzz"), {})),
    ).rejects.toMatchObject({ code: "FAILED_PRECONDITION" });
    expect(mockDb.get("courts/zzzzz")).toBeUndefined();
  });

  test("late writes never recreate a vanished root or touch its descendants", async () => {
    const id = await allocate("court", { name: "Gone" });
    await mockDb.doc(`courts/${id}`).delete();
    const db = firebase.db;
    const rootMissing = { code: "FAILED_PRECONDITION", details: { code: "ROOT_MISSING" } };
    await expect(
      db.doc(`courts/${id}`).set({ status: "open" }, { merge: true }),
    ).rejects.toMatchObject(rootMissing);
    await expect(db.doc(`courts/${id}`).update({ status: "open" })).rejects.toMatchObject(
      rootMissing,
    );
    await expect(db.doc(`courts/${id}/settings/main`).set({ x: 1 })).rejects.toMatchObject(
      rootMissing,
    );
    mockDb.docs.set("tournaments/ttttttt", { allocationId: "x" });
    await mockDb.doc("tournaments/ttttttt").delete();
    await expect(db.doc("tournamentViews/ttttttt").set({ stale: true })).rejects.toMatchObject(
      rootMissing,
    );
    await db.doc(`courts/${id}/settings/main`).delete();
    expect(pathsUnder(`courts/${id}`)).toEqual([]);
    expect(mockDb.get("tournamentViews/ttttttt")).toBeUndefined();
  });

  test("an operation that observed an old generation cannot write to or reference the reused root", async () => {
    const db = firebase.db;
    candidateSource("aaaaa", "bbbbb", "ccccc");
    await allocate("court", { name: "Old" });
    await allocate("court");
    mockDb.docs.set("devices/dev1", { name: "Tablet" });

    let signalRead;
    let resume;
    const readDone = new Promise((resolve) => {
      signalRead = resolve;
    });
    const paused = new Promise((resolve) => {
      resume = resolve;
    });
    const operation = guard.runInOperationScope(async () => {
      const observed = await db.doc("courts/aaaaa").get();
      expect(observed.data().name).toBe("Old");
      signalRead();
      await paused;

      const stale = { code: "ABORTED", details: { code: "STALE_GENERATION" } };
      await expect(
        db.doc("courts/aaaaa").set({ name: "Old edit" }, { merge: true }),
      ).rejects.toMatchObject(stale);
      await expect(
        db.doc("devices/dev1").set({ courtId: "aaaaa" }, { merge: true }),
      ).rejects.toMatchObject(stale);
      await expect(
        db.runTransaction(async (tx) => {
          const snapshot = await tx.get(db.doc("courts/aaaaa"));
          tx.set(db.doc("courts/aaaaa"), { name: `${snapshot.data().name}!` }, { merge: true });
        }),
      ).rejects.toMatchObject(stale);
    });
    await readDone;
    // Meanwhile, in other operations, the cull runs and the ID is reused.
    await allocate("court");
    await runToCompletion();
    candidateSource("aaaaa");
    await allocate("court", { name: "New" });
    resume();
    await operation;
    expect(mockDb.get("courts/aaaaa").name).toBe("New");
    expect(mockDb.get("devices/dev1")).toEqual({ name: "Tablet" });

    // A fresh operation sees the new generation and may write normally.
    await guard.runInOperationScope(async () => {
      await db.doc("courts/aaaaa").get();
      await db.doc("courts/aaaaa").set({ name: "New edit" }, { merge: true });
    });
    expect(mockDb.get("courts/aaaaa").name).toBe("New edit");
  });

  test("delayed score events for another match generation are ignored", async () => {
    const { processScoreEvent } = require("./services/scoreService");
    candidateSource("aaaaaa");
    await allocate("match", { status: "live", scoreVersion: 0 });
    const current = mockDb.get("matches/aaaaaa").allocationId;
    const deliver = async (eventId, allocationId) => {
      const event = {
        eventType: "POINT_TEAM_A",
        createdAt: { seconds: 10, nanoseconds: 0 },
        scoreVersion: 0,
        matchId: "aaaaaa",
        allocationId,
      };
      mockDb.docs.set(`matches/aaaaaa/events/${eventId}`, event);
      await guard.runInOperationScope(() =>
        processScoreEvent({ params: { matchId: "aaaaaa", eventId }, data: { data: () => event } }),
      );
    };
    const scoreWrites = () =>
      pathsUnder("matches/aaaaaa").filter((path) => !path.includes("/events/"));

    const before = scoreWrites().map((path) => [path, mockDb.get(path)]);
    await deliver("stale", "previous-generation");
    await deliver("legacy", null);
    expect(scoreWrites().map((path) => [path, mockDb.get(path)])).toEqual(before);

    await deliver("current", current);
    expect(scoreWrites().map((path) => [path, mockDb.get(path)])).not.toEqual(before);
  });

  test("API caches bypass during maintenance and clear when the epoch changes", async () => {
    const api = require("./services/publicApiService");
    await api.syncApiCacheGeneration(10_000);
    api.scoreApiCache.set("court:aaaaa", 200, { cached: true });
    api.statsApiCache.set("aaaaa", 200, { cached: true });
    await api.syncApiCacheGeneration(10_500);
    expect(api.scoreApiCache.get("court:aaaaa")).toMatchObject({ body: { cached: true } });

    mockDb.docs.set(config.GATE_PATH, { active: true, epoch: 1, jobId: "j" });
    await api.syncApiCacheGeneration(20_000);
    expect(api.scoreApiCache.get("court:aaaaa")).toBeNull();
    api.scoreApiCache.set("court:aaaaa", 200, { during: true });
    expect(api.scoreApiCache.get("court:aaaaa")).toBeNull();

    mockDb.docs.set(config.GATE_PATH, { active: false, epoch: 2, jobId: null });
    await api.syncApiCacheGeneration(30_000);
    expect(api.scoreApiCache.get("court:aaaaa")).toBeNull();
    expect(api.statsApiCache.get("aaaaa")).toBeNull();
    api.scoreApiCache.set("court:aaaaa", 200, { fresh: true });
    expect(api.scoreApiCache.get("court:aaaaa")).toMatchObject({ body: { fresh: true } });
  });

  test("callable handlers surface maintenance and stale generation as retryable errors", async () => {
    const errors = require("./services/errors");
    const maintenanceHandler = errors.mapRetentionErrors(async () => {
      throw errors.maintenance();
    });
    await expect(maintenanceHandler()).rejects.toMatchObject({
      code: "unavailable",
      details: { code: "MAINTENANCE", retryable: true },
    });
    const staleHandler = errors.mapRetentionErrors(async () => {
      throw errors.staleGeneration("courts/aaaaa");
    });
    await expect(staleHandler()).rejects.toMatchObject({
      code: "aborted",
      details: { code: "STALE_GENERATION", path: "courts/aaaaa" },
    });
  });
});

describe("manual delete accounting and delete triggers", () => {
  test("a manual delete releases its ID exactly once; stale deliveries no-op", async () => {
    const id = await allocate("club", { name: "Mine" });
    const data = mockDb.get(`clubs/${id}`);
    await firebase.db.doc(`clubs/${id}`).delete();

    expect(await retention.accountRootDeletion("club", id, data)).toEqual({
      status: "released",
    });
    expect(await retention.accountRootDeletion("club", id, data)).toEqual({
      status: "released",
    });
    expect(
      await retention.accountRootDeletion("club", id, { ...data, allocationId: "other" }),
    ).toEqual({ status: "stale" });
    expect(await retention.accountRootDeletion("club", id, { name: "legacy" })).toEqual({
      status: "unmanaged",
    });
    expect(ledger("club")).toMatchObject({ live: 0, released: 1, sequence: 1 });
    expect(record("club", id)).toMatchObject({
      state: "released",
      sequence: 1,
      allocationId: data.allocationId,
    });
    expect(record("club", id).releasedSequence).toBeUndefined();

    // A released ID stays reserved until a cull frees it.
    candidateSource(id, "zzzz");
    expect(await allocate("club")).toBe("zzzz");
  });

  test("deliveries for a root that still exists are ignored", async () => {
    const id = await allocate("match");
    const data = mockDb.get(`matches/${id}`);
    expect(await retention.accountRootDeletion("match", id, data)).toEqual({ status: "stale" });
    expect(ledger("match")).toMatchObject({ live: 1, released: 0 });
  });

  test("the oldest released and live assignments are culled in sequence order", async () => {
    candidateSource("aaaa", "bbbb", "cccc");
    await allocate("club");
    const released = mockDb.get("clubs/aaaa");
    await firebase.db.doc("clubs/aaaa").delete();
    await retention.accountRootDeletion("club", "aaaa", released);
    await allocate("club");
    expect(gate()).toBeUndefined();
    await allocate("club");
    expect(job().plan.club).toEqual({ cullCount: 2, occupiedAtStart: 3 });
    await runToCompletion();
    expect(ledger("club")).toMatchObject({ live: 1, released: 0, culled: 2 });
    expect(mockDb.list("clubs").map((club) => club.id)).toEqual(["cccc"]);
    expect(
      mockDb.get(paths.archive("club", config.archiveKeyFor("aaaa", released.allocationId))),
    ).toMatchObject({ priorState: "released", rootExists: false, status: "complete" });
  });

  test("accounting waits for an active cull and then resolves without double counting", async () => {
    candidateSource("aaaa", "bbbb", "cccc");
    await allocate("club");
    await allocate("club");
    const deleted = mockDb.get("clubs/bbbb");
    await firebase.db.doc("clubs/bbbb").delete();
    // The delete commits, then a cull starts before its trigger runs.
    await allocate("club");
    await expectMaintenance(retention.accountRootDeletion("club", "bbbb", deleted));
    expect(ledger("club")).toMatchObject({ live: 3, released: 0 });

    await runToCompletion();
    // bbbb was among the oldest and was culled; the retried delivery no-ops.
    expect(await retention.accountRootDeletion("club", "bbbb", deleted)).toEqual({
      status: "stale",
    });
    expect(ledger("club")).toMatchObject({ live: 1, released: 0 });
  });

  test("root delete triggers account through the guarded singleton", async () => {
    const api = require("./index");
    const clubId = await allocate("club");
    const matchId = await allocate("match");
    const tournamentId = await allocate("tournament");
    const event = (param, id, data) => ({ params: { [param]: id }, data: { data: () => data } });
    const snapshots = {
      club: mockDb.get(`clubs/${clubId}`),
      match: mockDb.get(`matches/${matchId}`),
      tournament: mockDb.get(`tournaments/${tournamentId}`),
    };
    await mockDb.doc(`clubs/${clubId}`).delete();
    await mockDb.doc(`matches/${matchId}`).delete();
    await mockDb.doc(`tournaments/${tournamentId}`).delete();
    await api.onClubDeleted(event("clubId", clubId, snapshots.club));
    await api.onMatchDeleted(event("matchId", matchId, snapshots.match));
    await api.onTournamentDeleted(event("tournamentId", tournamentId, snapshots.tournament));
    expect(ledger("club")).toMatchObject({ live: 0, released: 1 });
    expect(ledger("match")).toMatchObject({ live: 0, released: 1 });
    expect(ledger("tournament")).toMatchObject({ live: 0, released: 1 });
  });

  test("a delayed court delete trigger never touches a reused court", async () => {
    const { handleCourtDeleted } = require("./triggers/onClubMemberDeleted");
    candidateSource("aaaaa", "bbbbb", "ccccc");
    await allocate("court");
    const oldCourt = mockDb.get("courts/aaaaa");
    mockDb.docs.set("clubs/hhhh", { courtIds: ["aaaaa"], allocationId: "club-gen" });
    await mockDb.doc("courts/aaaaa").delete();
    await allocate("court");
    await allocate("court");
    await runToCompletion();
    // The cull unlinked the old membership; the ID is reused and re-listed.
    expect(mockDb.get("clubs/hhhh").courtIds).toEqual([]);
    candidateSource("aaaaa");
    await allocate("court", { name: "New" });
    mockDb.docs.set("clubs/hhhh", { courtIds: ["aaaaa"], allocationId: "club-gen" });
    const ledgerBefore = ledger("court");

    const event = { params: { courtId: "aaaaa" }, data: { data: () => oldCourt } };
    await guard.runInOperationScope(() => handleCourtDeleted(event));
    expect(mockDb.get("clubs/hhhh").courtIds).toEqual(["aaaaa"]);
    expect(mockDb.get("courts/aaaaa").name).toBe("New");
    expect(ledger("court")).toEqual(ledgerBefore);
  });

  test("a court delete trigger releases the ID and leaves the clubs", async () => {
    const { handleCourtDeleted } = require("./triggers/onClubMemberDeleted");
    const courtId = await allocate("court");
    const court = mockDb.get(`courts/${courtId}`);
    mockDb.docs.set("clubs/hhhh", { courtIds: [courtId, "keepx"], allocationId: "club-gen" });
    await firebase.db.doc(`courts/${courtId}`).delete();
    const event = { params: { courtId }, data: { data: () => court } };
    await guard.runInOperationScope(() => handleCourtDeleted(event));
    await guard.runInOperationScope(() => handleCourtDeleted(event));
    expect(mockDb.get("clubs/hhhh").courtIds).toEqual(["keepx"]);
    expect(ledger("court")).toMatchObject({ live: 0, released: 1 });
  });
});

describe("retention policy configuration", () => {
  test("defaults match the confirmed production policies and validate overrides", () => {
    config.resetRetentionPolicies();
    expect(config.DEFAULT_RETENTION_POLICIES).toEqual({
      club: { trigger: 96000, target: 40000 },
      court: { trigger: 1900000, target: 750000 },
      match: { trigger: 42000000, target: 16000000 },
      tournament: { trigger: 899000000, target: 335000000 },
    });
    expect(config.getRetentionPolicy("court")).toEqual({ trigger: 1900000, target: 750000 });
    expect(() => config.setRetentionPolicies({ club: { trigger: 5, target: 5 } })).toThrow();
    expect(() => config.setRetentionPolicies({ club: { trigger: 5, target: -1 } })).toThrow();
    expect(() => config.setRetentionPolicies({ club: { trigger: 1.5, target: 0 } })).toThrow();
  });
});
