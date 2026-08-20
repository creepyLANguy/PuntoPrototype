const {
  DEFAULT_SCORING_OPTIONS,
  replayEvents,
  toLiveScorePayload
} = require("./scoringEngine");

let mockDb = null;

jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (_config, handler) => handler
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: (_config, handler) => handler,
  onRequest: (_config, handler) => handler
}));

jest.mock("firebase-admin", () =>
{
  const firestore = () => mockDb;
  firestore.FieldPath = {
    documentId: () => "__name__"
  };
  firestore.FieldValue = {
    serverTimestamp: () => ({ __serverTimestamp: true })
  };

  return {
    initializeApp: jest.fn(),
    firestore
  };
});

function timestamp(seconds, nanoseconds = 0)
{
  return { seconds, nanoseconds };
}

function comparePrimitive(left, right)
{
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareTimestamp(left, right)
{
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  const secondsDiff = comparePrimitive(left.seconds, right.seconds);
  if (secondsDiff !== 0) return secondsDiff;
  return comparePrimitive(left.nanoseconds, right.nanoseconds);
}

function compareValue(left, right)
{
  if (left && right && typeof left.seconds === "number" && typeof right.seconds === "number")
  {
    return compareTimestamp(left, right);
  }

  return comparePrimitive(left, right);
}

class FakeFirestore
{
  constructor(initialDocs = {})
  {
    this.docs = new Map(
      Object.entries(initialDocs).map(([path, data]) => [path, structuredClone(data)])
    );
  }

  doc(path)
  {
    const store = this;
    return {
      kind: "doc",
      path,
      id: path.split("/").pop(),
      get: async () => store.getDocSnapshot(path),
      set: async (data, options = {}) =>
      {
        const existing = store.docs.get(path);
        const next = options.merge && existing !== undefined
          ? { ...structuredClone(existing), ...structuredClone(data) }
          : structuredClone(data);
        store.docs.set(path, next);
      }
    };
  }

  collection(path)
  {
    return new FakeQuery(this, path);
  }

  async runTransaction(callback)
  {
    const writes = [];
    const tx = {
      get: async (target) => this.getTarget(target),
      set: (ref, data) =>
      {
        writes.push({ type: "set", path: ref.path, data: structuredClone(data) });
      },
      delete: (ref) =>
      {
        writes.push({ type: "delete", path: ref.path });
      }
    };

    await callback(tx);

    writes.forEach((write) =>
    {
      if (write.type === "delete")
      {
        this.docs.delete(write.path);
        return;
      }

      this.docs.set(write.path, write.data);
    });
  }

  async getTarget(target)
  {
    if (target.kind === "doc")
    {
      return this.getDocSnapshot(target.path);
    }

    return this.getQuerySnapshot(target);
  }

  getDocSnapshot(path)
  {
    const data = this.docs.get(path);
    return {
      exists: data !== undefined,
      id: path.split("/").pop(),
      ref: this.doc(path),
      data: () => (data === undefined ? undefined : structuredClone(data))
    };
  }

  getQuerySnapshot(query)
  {
    const prefix = `${query.path}/`;
    let docs = [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({
        id: path.slice(prefix.length),
        path,
        data: structuredClone(data)
      }));

    if (query.orders.length > 0)
    {
      docs.sort((left, right) =>
      {
        for (const order of query.orders)
        {
          const field = order.field === "__name__" ? "id" : order.field;
          const directionFactor = order.direction === "desc" ? -1 : 1;
          const comparison = compareValue(left[field] ?? left.data[field], right[field] ?? right.data[field]);
          if (comparison !== 0)
          {
            return comparison * directionFactor;
          }
        }

        return 0;
      });
    }

    if (query.startAfterValues)
    {
      docs = docs.filter((doc) =>
      {
        for (let i = 0; i < query.orders.length; i++)
        {
          const order = query.orders[i];
          const field = order.field === "__name__" ? "id" : order.field;
          const directionFactor = order.direction === "desc" ? -1 : 1;
          const docValue = doc[field] ?? doc.data[field];
          const boundaryValue = query.startAfterValues[i];
          const comparison = compareValue(docValue, boundaryValue) * directionFactor;

          if (comparison > 0) return true;
          if (comparison < 0) return false;
        }

        return false;
      });
    }

    if (typeof query.limitCount === "number")
    {
      docs = docs.slice(0, query.limitCount);
    }

    return {
      docs: docs.map((doc) => ({
        id: doc.id,
        ref: this.doc(doc.path),
        data: () => structuredClone(doc.data)
      })),
      forEach: (callback) =>
      {
        docs.forEach((doc) =>
        {
          callback({
            id: doc.id,
            ref: this.doc(doc.path),
            data: () => structuredClone(doc.data)
          });
        });
      }
    };
  }
}

class FakeQuery
{
  constructor(db, path, orders = [], startAfterValues = null, limitCount = null)
  {
    this.kind = "query";
    this.db = db;
    this.path = path;
    this.orders = orders;
    this.startAfterValues = startAfterValues;
    this.limitCount = limitCount;
  }

  orderBy(field, direction = "asc")
  {
    return new FakeQuery(
      this.db,
      this.path,
      [...this.orders, { field, direction }],
      this.startAfterValues,
      this.limitCount
    );
  }

  startAfter(...values)
  {
    return new FakeQuery(
      this.db,
      this.path,
      this.orders,
      values,
      this.limitCount
    );
  }

  limit(count)
  {
    return new FakeQuery(
      this.db,
      this.path,
      this.orders,
      this.startAfterValues,
      count
    );
  }

  doc(id)
  {
    this.db.autoIdCounter = (this.db.autoIdCounter || 0) + 1;
    const docId = id || `auto-${this.db.autoIdCounter}`;
    return this.db.doc(`${this.path}/${docId}`);
  }

  async get()
  {
    return this.db.getQuerySnapshot(this);
  }
}

describe("onEventCreate", () =>
{
  let consoleDebugSpy;

  beforeEach(() =>
  {
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() =>
  {
    consoleDebugSpy.mockRestore();
  });

  test("fully replays delayed point events that sort before the latest checkpoint", async () =>
  {
    const courtId = "court-1";
    const scorePath = `courts/${courtId}/score/current`;
    const courtPath = `courts/${courtId}`;
    const checkpointsPath = `courts/${courtId}/scoreCheckpoints`;
    const eventsPath = `courts/${courtId}/events`;

    const e1 = { id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 };
    const e2 = { id: "e2", eventType: "POINT_TEAM_A", createdAt: timestamp(2), scoreVersion: 0 };
    const e3 = { id: "e3", eventType: "POINT_TEAM_A", createdAt: timestamp(3), scoreVersion: 0 };
    const delayed = { id: "e0", eventType: "POINT_TEAM_A", createdAt: timestamp(3, 500), scoreVersion: 0 };
    const e4 = { id: "e4", eventType: "POINT_TEAM_B", createdAt: timestamp(4), scoreVersion: 0 };
    const e5 = { id: "e5", eventType: "POINT_TEAM_B", createdAt: timestamp(5), scoreVersion: 0 };

    const checkpointScore = toLiveScorePayload(replayEvents([e1, e2, e3, e4], DEFAULT_SCORING_OPTIONS));
    const persistedScore = toLiveScorePayload(replayEvents([e1, e2, e3, e4, e5], DEFAULT_SCORING_OPTIONS));
    const fullReplayScore = toLiveScorePayload(replayEvents([e1, e2, e3, delayed, e4, e5], DEFAULT_SCORING_OPTIONS));

    mockDb = new FakeFirestore({
      [courtPath]: {
        scoreVersion: 0,
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS
      },
      [scorePath]: {
        ...persistedScore,
        lastEventId: "e5",
        lastProcessedEventId: "e5",
        lastProcessedCreatedAt: e5.createdAt
      },
      [`${checkpointsPath}/cp1`]: {
        score: checkpointScore,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
        lastEventId: "e4",
        lastCreatedAt: e4.createdAt
      },
      [`${eventsPath}/e1`]: e1,
      [`${eventsPath}/e2`]: e2,
      [`${eventsPath}/e3`]: e3,
      [`${eventsPath}/e0`]: delayed,
      [`${eventsPath}/e4`]: e4,
      [`${eventsPath}/e5`]: e5
    });

    let onEventCreate;
    jest.isolateModules(() =>
    {
      ({ onEventCreate } = require("./index"));
    });

    await onEventCreate({
      params: { courtId, eventId: delayed.id },
      data: {
        data: () => structuredClone(delayed)
      }
    });

    const nextScore = mockDb.docs.get(scorePath);

    expect(nextScore.A.games).toBe(fullReplayScore.A.games);
    expect(nextScore.A.points).toBe(fullReplayScore.A.points);
    expect(nextScore.B.points).toBe(fullReplayScore.B.points);
    expect(nextScore.A.games).toBe(1);
    expect(nextScore.lastEventId).toBe("e5");
    expect(nextScore.lastProcessedEventId).toBe("e5");
    expect(nextScore.lastProcessedCreatedAt).toEqual(e5.createdAt);
  });

  test("replays ignore scoring events left over from an older scoreVersion", async () =>
  {
    const courtId = "court-1";
    const scorePath = `courts/${courtId}/score/current`;
    const courtPath = `courts/${courtId}`;
    const eventsPath = `courts/${courtId}/events`;

    // A stale event written in-flight against the pre-reset scoreVersion must
    // not pollute the full-replay path, mirroring the direct-path guard.
    const stale = { id: "s1", eventType: "POINT_TEAM_B", createdAt: timestamp(1), scoreVersion: 0 };
    const fresh1 = { id: "f1", eventType: "POINT_TEAM_A", createdAt: timestamp(2), scoreVersion: 1 };
    const delayed = { id: "f0", eventType: "POINT_TEAM_A", createdAt: timestamp(2, 500), scoreVersion: 1 };
    const fresh2 = { id: "f2", eventType: "POINT_TEAM_A", createdAt: timestamp(3), scoreVersion: 1 };

    const expectedScore = toLiveScorePayload(
      replayEvents([fresh1, delayed, fresh2], DEFAULT_SCORING_OPTIONS)
    );

    mockDb = new FakeFirestore({
      [courtPath]: {
        scoreVersion: 1,
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS
      },
      [scorePath]: {
        ...toLiveScorePayload(replayEvents([fresh1, fresh2], DEFAULT_SCORING_OPTIONS)),
        lastEventId: "f2",
        lastProcessedEventId: "f2",
        lastProcessedCreatedAt: fresh2.createdAt
      },
      [`${eventsPath}/s1`]: stale,
      [`${eventsPath}/f1`]: fresh1,
      [`${eventsPath}/f0`]: delayed,
      [`${eventsPath}/f2`]: fresh2
    });

    let onEventCreate;
    jest.isolateModules(() =>
    {
      ({ onEventCreate } = require("./index"));
    });

    await onEventCreate({
      params: { courtId, eventId: delayed.id },
      data: {
        data: () => structuredClone(delayed)
      }
    });

    const nextScore = mockDb.docs.get(scorePath);

    expect(nextScore.A.points).toBe(expectedScore.A.points);
    expect(nextScore.B.points).toBe(expectedScore.B.points);
    expect(nextScore.B.points).toBe(0);
  });
});

describe("postEvent", () =>
{
  test("stamps device scoring events with the court's active scoreVersion", async () =>
  {
    const courtId = "court-1";
    const deviceId = "device-1";

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId },
      [`courts/${courtId}`]: {
        scoreVersion: 3,
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS
      }
    });

    let postEvent;
    jest.isolateModules(() =>
    {
      ({ postEvent } = require("./index"));
    });

    const res = {
      statusCode: null,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; }
    };

    await postEvent(
      { method: "POST", body: { deviceId, eventType: "POINT_TEAM_A" } },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);

    const eventEntry = [...mockDb.docs.entries()]
      .find(([path]) => path.startsWith(`courts/${courtId}/events/`));
    expect(eventEntry).toBeDefined();
    expect(eventEntry[1].eventType).toBe("POINT_TEAM_A");
    expect(eventEntry[1].scoreVersion).toBe(3);
  });

  test("stamps scoreVersion 0 when the court has never been reset", async () =>
  {
    const courtId = "court-2";
    const deviceId = "device-2";

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId },
      [`courts/${courtId}`]: {
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS
      }
    });

    let postEvent;
    jest.isolateModules(() =>
    {
      ({ postEvent } = require("./index"));
    });

    const res = {
      statusCode: null,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; }
    };

    await postEvent(
      { method: "POST", body: { deviceId, eventType: "UNDO" } },
      res
    );

    expect(res.statusCode).toBe(200);

    const eventEntry = [...mockDb.docs.entries()]
      .find(([path]) => path.startsWith(`courts/${courtId}/events/`));
    expect(eventEntry).toBeDefined();
    expect(eventEntry[1].scoreVersion).toBe(0);
  });
});

describe("getCourtScore", () =>
{
  function makeRes()
  {
    return {
      statusCode: null,
      payload: null,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; },
      set(name, value) { this.headers[name] = value; return this; },
      send(body) { this.payload = body; return this; }
    };
  }

  test("returns the current score with display labels, server, and CDN cache headers", async () =>
  {
    const courtId = "court-1";
    const score = toLiveScorePayload(replayEvents(
      [
        { id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1) },
        { id: "e2", eventType: "POINT_TEAM_A", createdAt: timestamp(2) },
        { id: "e3", eventType: "POINT_TEAM_A", createdAt: timestamp(3) }
      ],
      DEFAULT_SCORING_OPTIONS
    ));

    mockDb = new FakeFirestore({
      [`courts/${courtId}`]: {
        teamNames: { A: "Smashers", B: "Lobbers" },
        playerNames: { A1: "Ann", A2: "Al", B1: "Bo", B2: "Bea" },
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS
      },
      [`courts/${courtId}/score/current`]: score
    });

    let getCourtScore;
    jest.isolateModules(() =>
    {
      ({ getCourtScore } = require("./index"));
    });

    const res = makeRes();
    await getCourtScore({ method: "GET", path: `/a/${courtId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.courtId).toBe(courtId);
    expect(res.payload.teamNames).toEqual({ A: "Smashers", B: "Lobbers" });
    expect(res.payload.playerNames.A1).toBe("Ann");
    expect(res.payload.teams.A.points).toBe(3);
    expect(res.payload.teams.A.pointsDisplay).toBe("40");
    expect(res.payload.teams.B.pointsDisplay).toBe("0");
    expect(res.payload.scoringMode).toBe("standard");
    expect(res.payload.server).toBe("A1");
    expect(res.payload.matchComplete).toBe(false);
    expect(typeof res.payload.revision).toBe("string");
    expect(res.headers["Cache-Control"]).toBe("public, max-age=4, s-maxage=4");
  });

  test("returns 404 for an unknown court", async () =>
  {
    mockDb = new FakeFirestore({});

    let getCourtScore;
    jest.isolateModules(() =>
    {
      ({ getCourtScore } = require("./index"));
    });

    const res = makeRes();
    await getCourtScore({ method: "GET", path: "/a/no-such-court" }, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload.success).toBe(false);
  });

  test("serves repeat requests from the in-memory cache instead of Firestore", async () =>
  {
    const courtId = "court-cache";

    mockDb = new FakeFirestore({
      [`courts/${courtId}`]: {
        teamNames: { A: "First", B: "Second" },
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS
      }
    });

    let getCourtScore;
    jest.isolateModules(() =>
    {
      ({ getCourtScore } = require("./index"));
    });

    const first = makeRes();
    await getCourtScore({ method: "GET", path: `/a/${courtId}` }, first);
    expect(first.statusCode).toBe(200);
    expect(first.payload.teamNames.A).toBe("First");

    // Mutate the backing store; a cached response must still be returned.
    mockDb.docs.set(`courts/${courtId}`, { teamNames: { A: "Changed", B: "Second" } });

    const second = makeRes();
    await getCourtScore({ method: "GET", path: `/a/${courtId}` }, second);
    expect(second.statusCode).toBe(200);
    expect(second.payload.teamNames.A).toBe("First");
  });

  test("rejects requests without a usable courtId", async () =>
  {
    mockDb = new FakeFirestore({});

    let getCourtScore;
    jest.isolateModules(() =>
    {
      ({ getCourtScore } = require("./index"));
    });

    const res = makeRes();
    await getCourtScore({ method: "GET", path: "/a" }, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
  });

  test("revision endpoint returns a tiny payload that tracks score changes", async () =>
  {
    const courtId = "court-rev";
    const baseCourt = {
      teamNames: { A: "Smashers", B: "Lobbers" },
      scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
      scoringOptions: DEFAULT_SCORING_OPTIONS
    };

    mockDb = new FakeFirestore({
      [`courts/${courtId}`]: baseCourt,
      [`courts/${courtId}/score/current`]: toLiveScorePayload(replayEvents(
        [{ id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1) }],
        DEFAULT_SCORING_OPTIONS
      ))
    });

    let getCourtScore;
    let getCourtScoreRevision;
    jest.isolateModules(() =>
    {
      ({ getCourtScore, getCourtScoreRevision } = require("./index"));
    });

    const revisionRes = makeRes();
    await getCourtScoreRevision({ method: "GET", path: `/r/${courtId}` }, revisionRes);

    expect(revisionRes.statusCode).toBe(200);
    expect(Object.keys(revisionRes.payload).sort()).toEqual(["courtId", "revision", "success"]);

    // The revision poll primes the shared cache, so the follow-up full fetch
    // must report the exact same revision it advertised.
    const scoreRes = makeRes();
    await getCourtScore({ method: "GET", path: `/a/${courtId}` }, scoreRes);
    expect(scoreRes.payload.revision).toBe(revisionRes.payload.revision);

    mockDb.docs.set(`courts/${courtId}/score/current`, toLiveScorePayload(replayEvents(
      [
        { id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1) },
        { id: "e2", eventType: "POINT_TEAM_B", createdAt: timestamp(2) }
      ],
      DEFAULT_SCORING_OPTIONS
    )));

    jest.isolateModules(() =>
    {
      ({ getCourtScoreRevision } = require("./index"));
    });

    const changedRes = makeRes();
    await getCourtScoreRevision({ method: "GET", path: `/r/${courtId}` }, changedRes);
    expect(changedRes.payload.revision).not.toBe(revisionRes.payload.revision);
  });

  test("revision endpoint reports 404 for an unknown court", async () =>
  {
    mockDb = new FakeFirestore({});

    let getCourtScoreRevision;
    jest.isolateModules(() =>
    {
      ({ getCourtScoreRevision } = require("./index"));
    });

    const res = makeRes();
    await getCourtScoreRevision({ method: "GET", path: "/r/no-such-court" }, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload.success).toBe(false);
  });
});

describe("getCourtStats", () =>
{
  function makeRes()
  {
    return {
      statusCode: null,
      payload: null,
      headers: {},
      status(code) { this.statusCode = code; return this; },
      json(body) { this.payload = body; return this; },
      set(name, value) { this.headers[name] = value; return this; },
      send(body) { this.payload = body; return this; }
    };
  }

  test("replays the event stream into aggregate stats without the point-by-point streams", async () =>
  {
    const courtId = "court-stats";
    const events = [
      { eventType: "POINT_TEAM_A", createdAt: timestamp(1) },
      { eventType: "POINT_TEAM_A", createdAt: timestamp(2) },
      { eventType: "POINT_TEAM_B", createdAt: timestamp(3) },
      { eventType: "POINT_TEAM_A", createdAt: timestamp(4) },
      { eventType: "POINT_TEAM_A", createdAt: timestamp(5) }
    ];

    const seed = {
      [`courts/${courtId}`]: {
        teamNames: { A: "Smashers", B: "Lobbers" },
        playerNames: { A1: "Ann", A2: "Al", B1: "Bo", B2: "Bea" },
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS
      }
    };
    events.forEach((event, index) =>
    {
      seed[`courts/${courtId}/events/e${index + 1}`] = event;
    });
    mockDb = new FakeFirestore(seed);

    let getCourtStats;
    jest.isolateModules(() =>
    {
      ({ getCourtStats } = require("./index"));
    });

    const res = makeRes();
    await getCourtStats({ method: "GET", path: `/s/${courtId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.courtId).toBe(courtId);
    expect(res.payload.totalPoints).toBe(5);
    expect(res.payload.advancedStats.teamStats.A.pointsWon).toBe(4);
    expect(res.payload.advancedStats.teamStats.B.pointsWon).toBe(1);
    expect(res.payload.advancedStats.matchStats.totalPoints).toBe(5);
    expect(res.payload.playerNames.A1).toBe("Ann");

    // The heavy per-point streams stay private to the scoreboard callable.
    expect(res.payload.pointHistory).toBeUndefined();
    expect(res.payload.momentumTimeline).toBeUndefined();
    expect(res.payload.setPointMarkers).toBeUndefined();

    expect(res.headers["Cache-Control"]).toBe("public, max-age=10, s-maxage=10");
  });

  test("serves repeat requests from the in-memory cache instead of replaying events", async () =>
  {
    const courtId = "court-stats-cache";
    mockDb = new FakeFirestore({
      [`courts/${courtId}`]: {
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS
      },
      [`courts/${courtId}/events/e1`]: { eventType: "POINT_TEAM_A", createdAt: timestamp(1) }
    });

    let getCourtStats;
    jest.isolateModules(() =>
    {
      ({ getCourtStats } = require("./index"));
    });

    const first = makeRes();
    await getCourtStats({ method: "GET", path: `/s/${courtId}` }, first);
    expect(first.statusCode).toBe(200);
    expect(first.payload.totalPoints).toBe(1);

    // New events land; the cached aggregate must still be returned within the TTL.
    mockDb.docs.set(`courts/${courtId}/events/e2`, { eventType: "POINT_TEAM_B", createdAt: timestamp(2) });

    const second = makeRes();
    await getCourtStats({ method: "GET", path: `/s/${courtId}` }, second);
    expect(second.statusCode).toBe(200);
    expect(second.payload.totalPoints).toBe(1);
  });

  test("returns 404 for an unknown court", async () =>
  {
    mockDb = new FakeFirestore({});

    let getCourtStats;
    jest.isolateModules(() =>
    {
      ({ getCourtStats } = require("./index"));
    });

    const res = makeRes();
    await getCourtStats({ method: "GET", path: "/s/no-such-court" }, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload.success).toBe(false);
  });
});
