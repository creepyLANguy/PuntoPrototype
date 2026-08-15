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
    return {
      kind: "doc",
      path,
      id: path.split("/").pop()
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
});
