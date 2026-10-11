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

const COURT = "aaaaa";
const TARGET = "bbbbb";
const MATCH = "aaaaaa";
const DEVICE = "acting-device";
const REGISTERING = "registering-device";
const DEVICE_PATH = `devices/${DEVICE}`;
const EVENTS = ["REGISTER", "SPECTATE", "POINT_TEAM_A", "POINT_TEAM_B", "UNDO", "RESET"];

let db;
let guard;
let postEvent;

beforeEach(() => {
  jest.resetModules();
  mockDb = new FakeFirestore({
    "_idMaintenance/control": { active: false },
    [`courts/${COURT}`]: {
      allocationId: "source-generation",
      activeMatchId: MATCH,
      activeMatchAllocationId: "match-generation",
      beaconSidesSwapped: false,
      status: "available",
    },
    [`courts/${TARGET}`]: { allocationId: "target-generation", status: "available" },
    [DEVICE_PATH]: {
      courtId: COURT,
      courtAllocationId: "source-generation",
      deviceSKU: "Original",
    },
    [`devices/${REGISTERING}`]: { name: "Existing device" },
  });
  guard = require("./infrastructure/dataGuard");
  db = require("./infrastructure/firebase").db;
  ({ postEvent } = require("./http/postEvent"));
  const prepared = require("./services/matchService").prepareMatch({
    matchId: MATCH,
    status: "live",
  });
  mockDb.write(`matches/${MATCH}`, {
    ...prepared.match,
    allocationId: "match-generation",
    currentCourtId: COURT,
    currentCourtAllocationId: "source-generation",
    scoreVersion: 4,
  });
  mockDb.write(`matches/${MATCH}/score/current`, prepared.score);
});

afterEach(() => jest.restoreAllMocks());

function state() {
  return structuredClone([...mockDb.docs.entries()]);
}

async function request(eventType, extra = {}) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
  await postEvent(
    {
      method: "POST",
      body: {
        deviceId: DEVICE,
        eventType,
        courtId: TARGET,
        registeringDeviceId: REGISTERING,
        ...extra,
      },
    },
    res,
  );
  return res;
}

// Simulate the entire maintenance window between observations and a write:
// archive, unlink, delete, reuse and reassign, with the gate already reopened.
function cullAndReuseCourt(id = COURT) {
  const path = `courts/${id}`;
  const original = mockDb.get(path);
  mockDb.write("_idMaintenance/control", { active: true });
  mockDb.write(`CULLED_COURTS/${id}_${original.allocationId}`, original);
  for (const [docPath, data] of mockDb.docs.entries()) {
    if (docPath === path || docPath.startsWith(`${path}/`)) mockDb.docs.delete(docPath);
    else if (data.courtId === id) {
      mockDb.write(docPath, { courtId: null, courtAllocationId: null }, { merge: true });
    } else if (data.currentCourtId === id) {
      mockDb.write(
        docPath,
        { currentCourtId: null, currentCourtAllocationId: null },
        { merge: true },
      );
    }
  }
  mockDb.write(path, {
    allocationId: `${original.allocationId}-reused`,
    status: "available",
    marker: "New assignment",
  });
  mockDb.write(
    DEVICE_PATH,
    { courtId: id, courtAllocationId: `${original.allocationId}-reused` },
    { merge: true },
  );
  mockDb.write("_idMaintenance/control", { active: false });
  return state();
}

function afterSnapshot(path, effect) {
  const snapshot = mockDb.snapshot.bind(mockDb);
  let fired = false;
  jest.spyOn(mockDb, "snapshot").mockImplementation((requestedPath) => {
    const result = snapshot(requestedPath);
    if (!fired && requestedPath === path) {
      fired = true;
      effect();
    }
    return result;
  });
}

function beforeTransaction(effect, transactionNumber = 1) {
  const run = mockDb.runTransaction.bind(mockDb);
  let calls = 0;
  jest.spyOn(mockDb, "runTransaction").mockImplementation((callback, options) => {
    if (++calls === transactionNumber) effect();
    return run(callback, options);
  });
}

function expectStale(res) {
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({
    success: false,
    error: "This record was replaced. Refresh and retry.",
  });
}

describe("stored device assignment fencing", () => {
  test.each(EVENTS)(
    "rejects %s after the old device read and complete court reuse",
    async (type) => {
      let reused;
      afterSnapshot(DEVICE_PATH, () => {
        reused = cullAndReuseCourt();
      });
      const res = await request(type, { deviceSKU: "Beacon" });
      expectStale(res);
      expect(state()).toEqual(reused);
      expect(mockDb.transactionAttempts).toBe(type === "SPECTATE" ? 1 : 0);
    },
  );

  test.each(EVENTS)(
    "rejects %s when court reuse finishes before its first transaction",
    async (type) => {
      let reused;
      beforeTransaction(() => {
        reused = cullAndReuseCourt();
      });
      const res = await request(type);
      expectStale(res);
      expect(state()).toEqual(reused);
    },
  );

  test.each(EVENTS)("fences device-only SKU writes for %s before the event write", async (type) => {
    let reused;
    beforeTransaction(() => {
      reused = cullAndReuseCourt();
    });
    const res = await request(type, { deviceSKU: "Beacon" });
    expectStale(res);
    expect(state()).toEqual(reused);
    expect(mockDb.get(DEVICE_PATH).deviceSKU).toBe("Original");
  });

  test.each(
    EVENTS.flatMap((type) =>
      (type === "SPECTATE" ? [undefined] : [undefined, "stale-token"]).map((token) => [
        type,
        token,
      ]),
    ),
  )("rejects %s with missing or stale companion %s without any writes", async (type, token) => {
    const device = mockDb.get(DEVICE_PATH);
    if (token === undefined) delete device.courtAllocationId;
    else device.courtAllocationId = token;
    mockDb.write(DEVICE_PATH, device);
    const before = state();
    const res = await request(type, { deviceSKU: "Beacon" });
    expectStale(res);
    expect(state()).toEqual(before);
    expect(mockDb.transactionAttempts).toBe(0);
  });

  test("REGISTER succeeds in the same generation and stamps the assignment and audit", async () => {
    const res = await request("REGISTER", { deviceSKU: "Beacon" });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockDb.get(`devices/${REGISTERING}`)).toEqual({
      name: "Existing device",
      courtId: COURT,
      courtAllocationId: "source-generation",
    });
    expect(mockDb.get(DEVICE_PATH).deviceSKU).toBe("Beacon");
    expect(mockDb.list(`courts/${COURT}/deviceEvents`)).toEqual([
      expect.objectContaining({
        eventType: "REGISTER",
        targetCourtId: COURT,
        targetCourtAllocationId: "source-generation",
      }),
    ]);
  });

  test.each(["POINT_TEAM_A", "POINT_TEAM_B", "UNDO"])(
    "%s succeeds with same-generation court and match tokens",
    async (type) => {
      const res = await request(type);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockDb.list(`matches/${MATCH}/events`)).toEqual([
        expect.objectContaining({
          eventType: type,
          courtId: COURT,
          courtAllocationId: "source-generation",
          matchId: MATCH,
          matchAllocationId: "match-generation",
          allocationId: "match-generation",
          scoreVersion: 4,
        }),
      ]);
    },
  );

  test("RESET succeeds without weakening the stored court fence", async () => {
    const res = await request("RESET");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockDb.get(`matches/${MATCH}`).scoreVersion).toBe(5);
    expect(mockDb.get(DEVICE_PATH).courtAllocationId).toBe("source-generation");
  });

  test.each(["none", "completed"])(
    "scoring creates a correctly fenced casual match when the active match is %s",
    async (active) => {
      if (active === "none") {
        mockDb.write(
          `courts/${COURT}`,
          { activeMatchId: null, activeMatchAllocationId: null },
          { merge: true },
        );
      } else {
        mockDb.write(`matches/${MATCH}`, { status: "completed" }, { merge: true });
      }
      const res = await request("POINT_TEAM_A");
      expect(res.status).toHaveBeenCalledWith(200);
      const { matchId } = res.json.mock.calls[0][0];
      expect(matchId).not.toBe(MATCH);
      const generation = mockDb.get(`matches/${matchId}`).allocationId;
      expect(generation).toEqual(expect.any(String));
      expect(mockDb.get(`courts/${COURT}`).activeMatchAllocationId).toBe(generation);
      expect(mockDb.list(`matches/${matchId}/events`)[0]).toMatchObject({
        courtAllocationId: "source-generation",
        allocationId: generation,
        matchAllocationId: generation,
        scoreVersion: 0,
      });
    },
  );

  test("SPECTATE stamps both source and target generations", async () => {
    const res = await request("SPECTATE");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockDb.get(DEVICE_PATH)).toMatchObject({
      courtId: TARGET,
      courtAllocationId: "target-generation",
    });
    expect(mockDb.list(`courts/${TARGET}/deviceEvents`)).toEqual([
      expect.objectContaining({
        sourceCourtId: COURT,
        sourceCourtAllocationId: "source-generation",
        targetCourtId: TARGET,
        targetCourtAllocationId: "target-generation",
      }),
    ]);
  });

  test("an unassigned device can SPECTATE without an invented source token", async () => {
    mockDb.write(DEVICE_PATH, { courtId: null, courtAllocationId: null });
    const res = await request("SPECTATE");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockDb.list(`courts/${TARGET}/deviceEvents`)[0]).toMatchObject({
      sourceCourtId: null,
      sourceCourtAllocationId: null,
      targetCourtAllocationId: "target-generation",
    });
  });

  test.each(["missing", "stale"])(
    "SPECTATE relocates a fresh %s source assignment without retaining its invalid reference",
    async (source) => {
      if (source === "missing") mockDb.docs.delete(`courts/${COURT}`);
      else {
        mockDb.write(`courts/${COURT}`, { allocationId: "source-reused" }, { merge: true });
      }
      const originalSource = mockDb.get(`courts/${COURT}`);
      const res = await request("SPECTATE", { deviceSKU: "Beacon" });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockDb.get(DEVICE_PATH)).toMatchObject({
        courtId: TARGET,
        courtAllocationId: "target-generation",
        deviceSKU: "Beacon",
      });
      expect(mockDb.get(`courts/${COURT}`)).toEqual(originalSource);
      expect(mockDb.list(`courts/${TARGET}/deviceEvents`)).toEqual([
        expect.objectContaining({
          sourceCourtId: null,
          sourceCourtAllocationId: null,
          targetCourtId: TARGET,
          targetCourtAllocationId: "target-generation",
        }),
      ]);
    },
  );

  test("SPECTATE with a deleted source cannot overwrite a concurrent device reassignment", async () => {
    mockDb.docs.delete(`courts/${COURT}`);
    let reassigned;
    beforeTransaction(() => {
      mockDb.write(
        DEVICE_PATH,
        { courtId: TARGET, courtAllocationId: "target-generation", deviceSKU: "New device" },
        { merge: true },
      );
      reassigned = state();
    });
    const res = await request("SPECTATE", { deviceSKU: "Beacon" });
    expectStale(res);
    expect(state()).toEqual(reassigned);
  });

  test("SPECTATE with a deleted source still fences target reuse before SKU or assignment writes", async () => {
    mockDb.docs.delete(`courts/${COURT}`);
    let reused;
    afterSnapshot(`courts/${TARGET}`, () => {
      mockDb.write(`courts/${TARGET}`, { allocationId: "target-reused" }, { merge: true });
      reused = state();
    });
    const res = await request("SPECTATE", { deviceSKU: "Beacon" });
    expectStale(res);
    expect(state()).toEqual(reused);
  });

  test("SPECTATE with a deleted source and missing target does not write the SKU", async () => {
    mockDb.docs.delete(`courts/${COURT}`);
    mockDb.docs.delete(`courts/${TARGET}`);
    const before = state();
    const res = await request("SPECTATE", { deviceSKU: "Beacon" });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(state()).toEqual(before);
  });

  test.each(EVENTS)(
    "%s rejects a concurrent device reassignment even when its old court generation remains live",
    async (type) => {
      let reassigned;
      beforeTransaction(() => {
        mockDb.write(
          DEVICE_PATH,
          { courtId: TARGET, courtAllocationId: "target-generation" },
          { merge: true },
        );
        reassigned = state();
      });
      const res = await request(type, { deviceSKU: "Beacon" });
      expectStale(res);
      expect(state()).toEqual(reassigned);
    },
  );

  test("SPECTATE rejects a target reused after its snapshot, before assignment", async () => {
    let reused;
    afterSnapshot(`courts/${TARGET}`, () => {
      reused = cullAndReuseCourt(TARGET);
    });
    const res = await request("SPECTATE");
    expectStale(res);
    expect(state()).toEqual(reused);
  });

  test("SPECTATE retains the source fence through its final target audit write", async () => {
    let reused;
    beforeTransaction(() => {
      reused = cullAndReuseCourt();
    }, 2);
    const res = await request("SPECTATE");
    expectStale(res);
    expect(state()).toEqual(reused);
    expect(mockDb.list(`courts/${TARGET}/deviceEvents`)).toEqual([]);
  });

  test.each(["POINT_TEAM_A", "RESET"])(
    "%s rejects a match reused before its first match read",
    async (type) => {
      let reused;
      afterSnapshot(`courts/${COURT}`, () => {
        mockDb.write(`matches/${MATCH}`, {
          ...mockDb.get(`matches/${MATCH}`),
          allocationId: "match-reused",
        });
        mockDb.write(
          `courts/${COURT}`,
          { activeMatchAllocationId: "match-reused" },
          { merge: true },
        );
        reused = state();
      });
      const res = await request(type);
      expectStale(res);
      expect(state()).toEqual(reused);
    },
  );

  test("an active maintenance gate still returns the retryable HTTP contract", async () => {
    mockDb.write("_idMaintenance/control", { active: true });
    const before = state();
    const res = await request("REGISTER");
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith("Retry-After", "30");
    expect(state()).toEqual(before);
  });
});

describe("guarded reference companion writes", () => {
  const references = [
    ["courtId", `courts/${COURT}`, "source-generation"],
    ["currentCourtId", `courts/${COURT}`, "source-generation"],
    ["lastCourtId", `courts/${COURT}`, "source-generation"],
    ["sourceCourtId", `courts/${COURT}`, "source-generation"],
    ["targetCourtId", `courts/${TARGET}`, "target-generation"],
    ["activeMatchId", `matches/${MATCH}`, "match-generation"],
    ["lastMatchId", `matches/${MATCH}`, "match-generation"],
    ["matchId", `matches/${MATCH}`, "match-generation"],
    ["occupiedByMatchId", `matches/${MATCH}`, "match-generation"],
    ["clubId", "clubs/aaaa", "club-generation"],
    ["tournamentId", "tournaments/aaaaaaa", "tournament-generation"],
  ];

  test.each(references)(
    "rejects an explicitly stale %s token instead of silently upgrading it",
    async (field, path, allocationId) => {
      if (!mockDb.get(path)) mockDb.write(path, { allocationId });
      const tokenField = field.replace(/Id$/, "AllocationId");
      const before = state();
      await expect(
        db.doc("devices/reference").set({
          [field]: path.split("/")[1],
          [tokenField]: "old-generation",
        }),
      ).rejects.toMatchObject({ details: { code: "STALE_GENERATION", path } });
      expect(state()).toEqual(before);
    },
  );

  test.each(references)(
    "canonically stamps legitimate %s writes and clears its token on detach",
    async (field, path, allocationId) => {
      if (!mockDb.get(path)) mockDb.write(path, { allocationId });
      const tokenField = field.replace(/Id$/, "AllocationId");
      const ref = db.doc("devices/reference");
      await ref.set({ [field]: path.split("/")[1] });
      expect(mockDb.get(ref.path)[tokenField]).toBe(allocationId);
      await ref.set({ [field]: null }, { merge: true });
      expect(mockDb.get(ref.path)).toEqual({ [field]: null, [tokenField]: null });
    },
  );

  test("a null reference clears even an explicitly stale supplied companion", async () => {
    await db.doc(DEVICE_PATH).update({ courtId: null, courtAllocationId: "stale-token" });
    expect(mockDb.get(DEVICE_PATH)).toMatchObject({ courtId: null, courtAllocationId: null });
  });

  test.each([
    [`courts/${TARGET}/deviceEvents/source`, "sourceCourtId", COURT, "source-generation"],
    [`courts/${TARGET}/deviceEvents/target`, "targetCourtId", TARGET, "target-generation"],
    [`matches/${MATCH}/audits/occupied`, "occupiedByMatchId", MATCH, "match-generation"],
  ])(
    "%s centrally stamps, validates and clears its %s companion",
    async (path, field, id, allocationId) => {
      const ref = db.doc(path);
      const tokenField = field.replace(/Id$/, "AllocationId");
      await ref.set({ [field]: id });
      expect(mockDb.get(path)).toEqual({ [field]: id, [tokenField]: allocationId });
      const before = state();
      await expect(
        ref.set({ [field]: id, [tokenField]: "stale-generation" }, { merge: true }),
      ).rejects.toMatchObject({ details: { code: "STALE_GENERATION" } });
      expect(state()).toEqual(before);
      await ref.update({ [field]: null });
      expect(mockDb.get(path)).toEqual({ [field]: null, [tokenField]: null });
    },
  );

  test("normal match detach clears both stored assignment companions", async () => {
    await require("./services/matchService").detachMatch({ matchId: MATCH });
    expect(mockDb.get(`matches/${MATCH}`)).toMatchObject({
      currentCourtId: null,
      currentCourtAllocationId: null,
    });
    expect(mockDb.get(`courts/${COURT}`)).toMatchObject({
      activeMatchId: null,
      activeMatchAllocationId: null,
    });
  });

  test("normal displacement clears the old companion and stamps the replacement", async () => {
    const { matchId } = await require("./services/matchService").createMatchDocument({
      courtId: COURT,
    });
    expect(mockDb.get(`matches/${MATCH}`)).toMatchObject({
      status: "cancelled",
      currentCourtId: null,
      currentCourtAllocationId: null,
    });
    expect(mockDb.get(`matches/${matchId}`)).toMatchObject({
      currentCourtId: COURT,
      currentCourtAllocationId: "source-generation",
    });
    expect(mockDb.get(`courts/${COURT}`)).toMatchObject({
      activeMatchId: matchId,
      activeMatchAllocationId: mockDb.get(`matches/${matchId}`).allocationId,
    });
  });

  test("a mismatching token aborts every queued write atomically", async () => {
    const before = state();
    await expect(
      db.runTransaction(async (tx) => {
        tx.set(db.doc("devices/unrelated"), { name: "Must not commit" });
        tx.set(db.doc(DEVICE_PATH), {
          courtId: COURT,
          courtAllocationId: "stale-token",
        });
      }),
    ).rejects.toMatchObject({ details: { code: "STALE_GENERATION" } });
    expect(state()).toEqual(before);
  });

  test("a pinned stored generation protects metadata-only writes without a root reference", async () => {
    let reused;
    await expect(
      guard.runInOperationScope(async () => {
        guard.pinRootGeneration(`courts/${COURT}`, "source-generation");
        reused = cullAndReuseCourt();
        await db.doc(DEVICE_PATH).set({ deviceSKU: "Beacon" }, { merge: true });
      }),
    ).rejects.toMatchObject({ details: { code: "STALE_GENERATION" } });
    expect(state()).toEqual(reused);
  });
});
