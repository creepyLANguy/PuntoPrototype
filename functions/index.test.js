const { DEFAULT_SCORING_OPTIONS, replayEvents, toLiveScorePayload } = require("./scoringEngine");
const { FakeFirestore: TransactionalFirestore } = require("./testSupport/fakeFirestore");

let mockDb = null;

jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (_config, handler) => handler,
  onDocumentDeleted: (_config, handler) => handler,
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: (_config, handler) => handler,
  onRequest: (_config, handler) => handler,
}));

jest.mock("firebase-functions/v2/scheduler", () => ({
  onSchedule: (_config, handler) => handler,
}));

jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  firestore: () => mockDb,
}));

// index.js takes FieldPath/FieldValue from the modular entry point rather than
// the admin namespace, because the functions emulator strips them off the
// latter. Mock the same surface the production classes expose.
jest.mock("firebase-admin/firestore", () => ({
  FieldPath: {
    documentId: () => "__name__",
  },
  FieldValue: {
    serverTimestamp: () => ({ __serverTimestamp: true }),
  },
}));

function timestamp(seconds, nanoseconds = 0) {
  return { seconds, nanoseconds };
}

function makeMatchDoc({
  matchId,
  courtId = null,
  scoreVersion = 0,
  scoringOptions = DEFAULT_SCORING_OPTIONS,
  status = "live",
  name = null,
  teamNames = { A: "Team A", B: "Team B" },
  playerNames = { A1: "", A2: "", B1: "", B2: "" },
  ...overrides
}) {
  return {
    matchId,
    name,
    kind: "casual",
    visibility: "public",
    status,
    currentCourtId: courtId,
    lastCourtId: courtId,
    lastCourtName: courtId,
    teamNames,
    playerNames,
    scoringOptions,
    scoringMode: scoringOptions.scoringMode,
    scoreVersion,
    scoreSummary: null,
    result: null,
    tournamentId: null,
    roundId: null,
    fixtureId: null,
    createdAt: timestamp(0),
    updatedAt: timestamp(0),
    startedAt: status === "live" ? timestamp(0) : null,
    completedAt: status === "completed" ? timestamp(0) : null,
    cancelledAt: status === "cancelled" ? timestamp(0) : null,
    ...overrides,
  };
}

function seedMatchDocs({
  courtId,
  matchId = "aaaaag",
  scoreVersion = 0,
  scoringOptions = DEFAULT_SCORING_OPTIONS,
  score = toLiveScorePayload(defaultScoreFor(scoringOptions)),
  events = [],
  court = {},
  match = {},
}) {
  const seed = {
    [`matches/${matchId}`]: makeMatchDoc({
      matchId,
      courtId,
      scoreVersion,
      scoringOptions,
      ...match,
    }),
    [`matches/${matchId}/score/current`]: score,
  };

  if (courtId) {
    seed[`courts/${courtId}`] = {
      name: `Court ${courtId}`,
      password: "courtpass",
      status: "open",
      activeMatchId: matchId,
      lastMatchId: matchId,
      ...court,
    };
  }

  events.forEach((event) => {
    seed[`matches/${matchId}/events/${event.id}`] = event;
  });

  return seed;
}

function defaultScoreFor(scoringOptions) {
  return replayEvents([], scoringOptions);
}

function comparePrimitive(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function compareTimestamp(left, right) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  const secondsDiff = comparePrimitive(left.seconds, right.seconds);
  if (secondsDiff !== 0) return secondsDiff;
  return comparePrimitive(left.nanoseconds, right.nanoseconds);
}

function compareValue(left, right) {
  if (left && right && typeof left.seconds === "number" && typeof right.seconds === "number") {
    return compareTimestamp(left, right);
  }

  return comparePrimitive(left, right);
}

class FakeFirestore extends TransactionalFirestore {
  constructor(initialDocs = {}) {
    super(initialDocs);
    this.docs = new Map(
      Object.entries(initialDocs).map(([path, data]) => [path, structuredClone(data)]),
    );
  }

  doc(path) {
    const store = this;
    return {
      kind: "doc",
      path,
      id: path.split("/").pop(),
      get: async () => store.getDocSnapshot(path),
      set: async (data, options = {}) => {
        const existing = store.docs.get(path);
        const next =
          options.merge && existing !== undefined
            ? { ...structuredClone(existing), ...structuredClone(data) }
            : structuredClone(data);
        store.docs.set(path, next);
      },
    };
  }

  collection(path) {
    return new FakeQuery(this, path);
  }

  batch() {
    const store = this;
    const ops = [];
    return {
      set: (ref, data) => ops.push({ type: "set", path: ref.path, data: structuredClone(data) }),
      delete: (ref) => ops.push({ type: "delete", path: ref.path }),
      commit: async () => {
        ops.forEach((op) => {
          if (op.type === "delete") {
            store.docs.delete(op.path);
            return;
          }
          store.docs.set(op.path, op.data);
        });
      },
    };
  }

  async runTransaction(callback) {
    return super.runTransaction(callback);
  }

  materialize(value) {
    return structuredClone(value);
  }

  async getTarget(target) {
    if (target.kind === "doc") {
      return this.getDocSnapshot(target.path);
    }

    return this.getQuerySnapshot(target);
  }

  getDocSnapshot(path) {
    const data = this.docs.get(path);
    return {
      exists: data !== undefined,
      id: path.split("/").pop(),
      ref: this.doc(path),
      data: () => (data === undefined ? undefined : structuredClone(data)),
    };
  }

  getQuerySnapshot(query) {
    const prefix = `${query.path}/`;
    let docs = [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({
        id: path.slice(prefix.length),
        path,
        data: structuredClone(data),
      }));

    if (query.orders.length > 0) {
      docs.sort((left, right) => {
        for (const order of query.orders) {
          const field = order.field === "__name__" ? "id" : order.field;
          const directionFactor = order.direction === "desc" ? -1 : 1;
          const comparison = compareValue(
            left[field] ?? left.data[field],
            right[field] ?? right.data[field],
          );
          if (comparison !== 0) {
            return comparison * directionFactor;
          }
        }

        return 0;
      });
    }

    if (query.startAfterValues || query.startAtValues) {
      const startValues = query.startAfterValues || query.startAtValues;
      const inclusive = Boolean(query.startAtValues);

      docs = docs.filter((doc) => {
        for (let i = 0; i < query.orders.length; i++) {
          const order = query.orders[i];
          const field = order.field === "__name__" ? "id" : order.field;
          const directionFactor = order.direction === "desc" ? -1 : 1;
          const docValue = doc[field] ?? doc.data[field];
          const boundaryValue = startValues[i];
          const comparison = compareValue(docValue, boundaryValue) * directionFactor;

          if (comparison > 0) return true;
          if (comparison < 0) return false;
        }

        return inclusive;
      });
    }

    if (typeof query.limitCount === "number") {
      docs = docs.slice(0, query.limitCount);
    }

    return {
      docs: docs.map((doc) => ({
        id: doc.id,
        ref: this.doc(doc.path),
        data: () => structuredClone(doc.data),
      })),
      forEach: (callback) => {
        docs.forEach((doc) => {
          callback({
            id: doc.id,
            ref: this.doc(doc.path),
            data: () => structuredClone(doc.data),
          });
        });
      },
    };
  }
}

class FakeQuery {
  constructor(
    db,
    path,
    orders = [],
    startAfterValues = null,
    startAtValues = null,
    limitCount = null,
  ) {
    this.kind = "query";
    this.db = db;
    this.path = path;
    this.orders = orders;
    this.startAfterValues = startAfterValues;
    this.startAtValues = startAtValues;
    this.limitCount = limitCount;
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(
      this.db,
      this.path,
      [...this.orders, { field, direction }],
      this.startAfterValues,
      this.startAtValues,
      this.limitCount,
    );
  }

  startAfter(...values) {
    return new FakeQuery(
      this.db,
      this.path,
      this.orders,
      values,
      this.startAtValues,
      this.limitCount,
    );
  }

  startAt(...values) {
    return new FakeQuery(
      this.db,
      this.path,
      this.orders,
      this.startAfterValues,
      values,
      this.limitCount,
    );
  }

  limit(count) {
    return new FakeQuery(
      this.db,
      this.path,
      this.orders,
      this.startAfterValues,
      this.startAtValues,
      count,
    );
  }

  doc(id) {
    this.db.autoIdCounter = (this.db.autoIdCounter || 0) + 1;
    const docId = id || `auto-${this.db.autoIdCounter}`;
    return this.db.doc(`${this.path}/${docId}`);
  }

  async get() {
    return this.db.getQuerySnapshot(this);
  }
}

describe("onEventCreate", () => {
  let consoleDebugSpy;

  beforeEach(() => {
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
  });

  test("fully replays delayed point events that sort before the latest checkpoint", async () => {
    const courtId = "aaaad";
    const matchId = "aaaaag";
    const scorePath = `matches/${matchId}/score/current`;
    const matchPath = `matches/${matchId}`;
    const checkpointsPath = `matches/${matchId}/scoreCheckpoints`;
    const eventsPath = `matches/${matchId}/events`;

    const e1 = { id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 };
    const e2 = { id: "e2", eventType: "POINT_TEAM_A", createdAt: timestamp(2), scoreVersion: 0 };
    const e3 = { id: "e3", eventType: "POINT_TEAM_A", createdAt: timestamp(3), scoreVersion: 0 };
    const delayed = {
      id: "e0",
      eventType: "POINT_TEAM_A",
      createdAt: timestamp(3, 500),
      scoreVersion: 0,
    };
    const e4 = { id: "e4", eventType: "POINT_TEAM_B", createdAt: timestamp(4), scoreVersion: 0 };
    const e5 = { id: "e5", eventType: "POINT_TEAM_B", createdAt: timestamp(5), scoreVersion: 0 };

    const checkpointScore = toLiveScorePayload(
      replayEvents([e1, e2, e3, e4], DEFAULT_SCORING_OPTIONS),
    );
    const persistedScore = toLiveScorePayload(
      replayEvents([e1, e2, e3, e4, e5], DEFAULT_SCORING_OPTIONS),
    );
    const fullReplayScore = toLiveScorePayload(
      replayEvents([e1, e2, e3, delayed, e4, e5], DEFAULT_SCORING_OPTIONS),
    );

    mockDb = new FakeFirestore({
      [matchPath]: makeMatchDoc({
        matchId,
        scoreVersion: 0,
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
      }),
      [scorePath]: {
        ...persistedScore,
        lastEventId: "e5",
        lastProcessedEventId: "e5",
        lastProcessedCreatedAt: e5.createdAt,
      },
      [`${checkpointsPath}/cp1`]: {
        score: checkpointScore,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
        lastEventId: "e4",
        lastCreatedAt: e4.createdAt,
        scoreVersion: 0,
      },
      [`${eventsPath}/e1`]: e1,
      [`${eventsPath}/e2`]: e2,
      [`${eventsPath}/e3`]: e3,
      [`${eventsPath}/e0`]: delayed,
      [`${eventsPath}/e4`]: e4,
      [`${eventsPath}/e5`]: e5,
    });

    let onEventCreate;
    jest.isolateModules(() => {
      ({ onEventCreate } = require("./index"));
    });

    await onEventCreate({
      params: { matchId, eventId: delayed.id },
      data: {
        data: () => structuredClone(delayed),
      },
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

  test("replays ignore scoring events left over from an older scoreVersion", async () => {
    const courtId = "aaaad";
    const matchId = "aaaaag";
    const scorePath = `matches/${matchId}/score/current`;
    const matchPath = `matches/${matchId}`;
    const eventsPath = `matches/${matchId}/events`;

    // A stale event written in-flight against the pre-reset scoreVersion must
    // not pollute the full-replay path, mirroring the direct-path guard.
    const stale = { id: "s1", eventType: "POINT_TEAM_B", createdAt: timestamp(1), scoreVersion: 0 };
    const fresh1 = {
      id: "f1",
      eventType: "POINT_TEAM_A",
      createdAt: timestamp(2),
      scoreVersion: 1,
    };
    const delayed = {
      id: "f0",
      eventType: "POINT_TEAM_A",
      createdAt: timestamp(2, 500),
      scoreVersion: 1,
    };
    const fresh2 = {
      id: "f2",
      eventType: "POINT_TEAM_A",
      createdAt: timestamp(3),
      scoreVersion: 1,
    };

    const expectedScore = toLiveScorePayload(
      replayEvents([fresh1, delayed, fresh2], DEFAULT_SCORING_OPTIONS),
    );

    mockDb = new FakeFirestore({
      [matchPath]: makeMatchDoc({
        matchId,
        scoreVersion: 1,
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
      }),
      [scorePath]: {
        ...toLiveScorePayload(replayEvents([fresh1, fresh2], DEFAULT_SCORING_OPTIONS)),
        lastEventId: "f2",
        lastProcessedEventId: "f2",
        lastProcessedCreatedAt: fresh2.createdAt,
      },
      [`${eventsPath}/s1`]: stale,
      [`${eventsPath}/f1`]: fresh1,
      [`${eventsPath}/f0`]: delayed,
      [`${eventsPath}/f2`]: fresh2,
    });

    let onEventCreate;
    jest.isolateModules(() => {
      ({ onEventCreate } = require("./index"));
    });

    await onEventCreate({
      params: { matchId, eventId: delayed.id },
      data: {
        data: () => structuredClone(delayed),
      },
    });

    const nextScore = mockDb.docs.get(scorePath);

    expect(nextScore.A.points).toBe(expectedScore.A.points);
    expect(nextScore.B.points).toBe(expectedScore.B.points);
    expect(nextScore.B.points).toBe(0);
  });

  test("fixed-total automatic side changes broadcast through the court changeover event", async () => {
    const courtId = "aaaaf";
    const matchId = "aaaaac";
    const scoringOptions = {
      scoringMode: "fixedTotalPoints",
      deuceMode: "standard",
      tiebreakMode: "off",
      pointsTarget: 36,
      serving: {
        enabled: true,
        order: ["A1", "B1", "A2", "B2"],
        serveBlockLength: 1,
        sideSwapRule: "after_all_players_serve_once",
      },
      completion: {
        rule: "exact_total_points",
        tieResolution: "allow_draw",
      },
    };

    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        scoringOptions,
        score: toLiveScorePayload(replayEvents([], scoringOptions)),
      }),
    });

    let onEventCreate;
    jest.isolateModules(() => {
      ({ onEventCreate } = require("./index"));
    });

    const process = async (index, eventType) => {
      const event = {
        id: `auto-${index}`,
        eventType: eventType || (index % 2 === 0 ? "POINT_TEAM_A" : "POINT_TEAM_B"),
        createdAt: timestamp(index),
        scoreVersion: 0,
      };
      mockDb.docs.set(`matches/${matchId}/events/${event.id}`, event);
      await onEventCreate({
        params: { matchId, eventId: event.id },
        data: { data: () => structuredClone(event) },
      });
    };

    for (let index = 1; index <= 4; index += 1) {
      await process(index);
    }

    const firstCourtChangeover = mockDb.docs.get(`courts/${courtId}`);
    expect(firstCourtChangeover.beaconSidesSwapped).toBe(true);
    expect(firstCourtChangeover.changeoverEvent).toMatchObject({
      source: "automatic_scoring",
    });
    const firstEventId = firstCourtChangeover.changeoverEvent.id;

    for (let index = 5; index <= 8; index += 1) {
      await process(index);
    }

    const secondCourtChangeover = mockDb.docs.get(`courts/${courtId}`);
    expect(secondCourtChangeover.beaconSidesSwapped).toBe(false);
    expect(secondCourtChangeover.changeoverEvent).toMatchObject({
      source: "automatic_scoring",
    });
    expect(secondCourtChangeover.changeoverEvent.id).not.toBe(firstEventId);

    for (let index = 9; index <= 35; index += 1) {
      await process(index);
    }
    const beforeFinalPoint = structuredClone(mockDb.docs.get(`courts/${courtId}`));
    await process(36);
    expect(mockDb.docs.get(`matches/${matchId}/score/current`)).toMatchObject({
      matchComplete: true,
      result: "draw",
    });
    expect(mockDb.docs.get(`courts/${courtId}`)).toEqual(beforeFinalPoint);
    await process(37, "UNDO");
    expect(mockDb.docs.get(`matches/${matchId}/score/current`).matchComplete).toBe(false);
    expect(mockDb.docs.get(`courts/${courtId}`)).toEqual(beforeFinalPoint);
    await process(38);
    expect(mockDb.docs.get(`matches/${matchId}/score/current`).matchComplete).toBe(true);
    expect(mockDb.docs.get(`courts/${courtId}`)).toEqual(beforeFinalPoint);
  });

  test.each([
    ["allow_draw", "POINT_TEAM_A"],
    ["allow_draw", "POINT_TEAM_B"],
    ["golden_point", "POINT_TEAM_B"],
  ])(
    "fixed-total target suppresses changeovers with %s and a final %s",
    async (tieResolution, finalEventType) => {
      const courtId = "aaaan";
      const matchId = "aaaaae";
      const scoringOptions = {
        scoringMode: "fixedTotalPoints",
        pointsTarget: 12,
        serving: { serveBlockLength: 1, sideSwapRule: "after_all_players_serve_once" },
        completion: { tieResolution },
      };
      const events = Array.from({ length: 11 }, (_, index) => ({
        id: `point-${index}`,
        eventType: index % 2 === 0 ? "POINT_TEAM_A" : "POINT_TEAM_B",
        createdAt: timestamp(index + 1),
        scoreVersion: 0,
      }));
      mockDb = new FakeFirestore(
        seedMatchDocs({
          courtId,
          matchId,
          scoringOptions,
          events,
          score: toLiveScorePayload(replayEvents(events, scoringOptions)),
        }),
      );
      const before = structuredClone(mockDb.docs.get(`courts/${courtId}`));
      let onEventCreate;
      jest.isolateModules(() => {
        ({ onEventCreate } = require("./index"));
      });
      const process = async (id, eventType, time) => {
        const event = { id, eventType, createdAt: timestamp(time), scoreVersion: 0 };
        mockDb.docs.set(`matches/${matchId}/events/${id}`, event);
        await onEventCreate({
          params: { matchId, eventId: id },
          data: { data: () => structuredClone(event) },
        });
      };
      await process("final", finalEventType, 12);
      const tied = mockDb.docs.get(`matches/${matchId}/score/current`);
      expect(tied.A.points + tied.B.points).toBe(12);
      expect(tied.matchComplete).toBe(tieResolution === "allow_draw");
      expect(mockDb.docs.get(`courts/${courtId}`)).toEqual(before);
      if (tieResolution === "golden_point") {
        await process("golden", "POINT_TEAM_A", 13);
        expect(mockDb.docs.get(`matches/${matchId}/score/current`)).toMatchObject({
          matchComplete: true,
          result: "A",
        });
        expect(mockDb.docs.get(`courts/${courtId}`)).toEqual(before);
      }
    },
  );

  test("scoring events on a completed match are ignored", async () => {
    const matchId = "aaaaag";
    const scorePath = `matches/${matchId}/score/current`;
    const event = {
      id: "e1",
      eventType: "POINT_TEAM_A",
      createdAt: timestamp(1),
      scoreVersion: 0,
    };
    const emptyScore = toLiveScorePayload(replayEvents([], DEFAULT_SCORING_OPTIONS));

    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        matchId,
        score: emptyScore,
        events: [event],
        match: { status: "completed", completedAt: timestamp(2) },
      }),
    });

    let onEventCreate;
    jest.isolateModules(() => {
      ({ onEventCreate } = require("./index"));
    });

    await onEventCreate({
      params: { matchId, eventId: event.id },
      data: {
        data: () => structuredClone(event),
      },
    });

    expect(mockDb.docs.get(scorePath)).toEqual(emptyScore);
    expect(mockDb.docs.get(`matches/${matchId}`).scoreSummary).toBeNull();
  });
});

describe("onEventCreate - undo vs checkpoints", () => {
  let consoleDebugSpy;

  beforeEach(() => {
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
  });

  // 24 straight points for A = a 6-0 set in standard scoring; the final point
  // (p023) is the set-winning point where production writes a checkpoint.
  function buildSetWinPointEvents(startSeconds = 1) {
    const events = [];
    for (let i = 0; i < 24; i++) {
      events.push({
        id: `p${String(i).padStart(3, "0")}`,
        eventType: "POINT_TEAM_A",
        createdAt: timestamp(startSeconds + i),
        scoreVersion: 0,
      });
    }
    return events;
  }

  function seedEventDocs(state, eventsPath, events) {
    events.forEach((event) => {
      state[`${eventsPath}/${event.id}`] = event;
    });
  }

  test("a point after an undo at a checkpoint boundary does not resurrect the undone set", async () => {
    const courtId = "aaabd";
    const matchId = "aaaaag";
    const scorePath = `matches/${matchId}/score/current`;
    const matchPath = `matches/${matchId}`;
    const checkpointsPath = `matches/${matchId}/scoreCheckpoints`;
    const eventsPath = `matches/${matchId}/events`;

    const setEvents = buildSetWinPointEvents();
    const undoEvent = { id: "u1", eventType: "UNDO", createdAt: timestamp(25), scoreVersion: 0 };
    const nextPoint = {
      id: "z1",
      eventType: "POINT_TEAM_B",
      createdAt: timestamp(26),
      scoreVersion: 0,
    };

    // State as production leaves it after the undo was correctly processed:
    // the set-completion checkpoint still sits exactly at the undone point.
    const checkpointScore = toLiveScorePayload(replayEvents(setEvents, DEFAULT_SCORING_OPTIONS));
    const postUndoScore = toLiveScorePayload(
      replayEvents([...setEvents, undoEvent], DEFAULT_SCORING_OPTIONS),
    );
    const expectedScore = toLiveScorePayload(
      replayEvents([...setEvents, undoEvent, nextPoint], DEFAULT_SCORING_OPTIONS),
    );

    const initialState = {
      [matchPath]: makeMatchDoc({
        matchId,
        scoreVersion: 0,
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
      }),
      [scorePath]: {
        ...postUndoScore,
        lastEventId: "u1",
        lastProcessedEventId: "u1",
        lastProcessedCreatedAt: undoEvent.createdAt,
      },
      [`${checkpointsPath}/cp1`]: {
        score: checkpointScore,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
        lastEventId: "p023",
        lastCreatedAt: timestamp(24),
        scoreVersion: 0,
      },
    };
    seedEventDocs(initialState, eventsPath, [...setEvents, undoEvent, nextPoint]);
    mockDb = new FakeFirestore(initialState);

    let onEventCreate;
    jest.isolateModules(() => {
      ({ onEventCreate } = require("./index"));
    });

    await onEventCreate({
      params: { matchId, eventId: nextPoint.id },
      data: {
        data: () => structuredClone(nextPoint),
      },
    });

    const nextScore = mockDb.docs.get(scorePath);

    // The undone set-winning point must stay undone: still 5-0 in games with
    // A at game point, plus B's fresh point - never a completed 6-0 set.
    expect(nextScore.A.sets).toBe(expectedScore.A.sets);
    expect(nextScore.A.sets).toBe(0);
    expect(nextScore.A.games).toBe(5);
    expect(nextScore.A.points).toBe(3);
    expect(nextScore.B.points).toBe(1);
    expect(nextScore.completedSets).toEqual([]);
  });

  test("processing an UNDO writes a fresh checkpoint anchored at the undo event", async () => {
    const courtId = "aaabe";
    const matchId = "aaaaag";
    const scorePath = `matches/${matchId}/score/current`;
    const matchPath = `matches/${matchId}`;
    const checkpointsPath = `matches/${matchId}/scoreCheckpoints`;
    const eventsPath = `matches/${matchId}/events`;

    const setEvents = buildSetWinPointEvents();
    const undoEvent = { id: "u1", eventType: "UNDO", createdAt: timestamp(25), scoreVersion: 0 };

    const postSetScore = toLiveScorePayload(replayEvents(setEvents, DEFAULT_SCORING_OPTIONS));

    const initialState = {
      [matchPath]: makeMatchDoc({
        matchId,
        scoreVersion: 0,
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
      }),
      [scorePath]: {
        ...postSetScore,
        lastEventId: "p023",
        lastProcessedEventId: "p023",
        lastProcessedCreatedAt: timestamp(24),
      },
      [`${checkpointsPath}/cp1`]: {
        score: postSetScore,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
        lastEventId: "p023",
        lastCreatedAt: timestamp(24),
        scoreVersion: 0,
      },
    };
    seedEventDocs(initialState, eventsPath, [...setEvents, undoEvent]);
    mockDb = new FakeFirestore(initialState);

    let onEventCreate;
    jest.isolateModules(() => {
      ({ onEventCreate } = require("./index"));
    });

    await onEventCreate({
      params: { matchId, eventId: undoEvent.id },
      data: {
        data: () => structuredClone(undoEvent),
      },
    });

    const nextScore = mockDb.docs.get(scorePath);
    expect(nextScore.A.sets).toBe(0);
    expect(nextScore.A.games).toBe(5);
    expect(nextScore.A.points).toBe(3);
    expect(nextScore.lastEventId).toBe("u1");

    const undoCheckpoint = [...mockDb.docs.entries()]
      .filter(([path]) => path.startsWith(`${checkpointsPath}/`))
      .map(([, data]) => data)
      .find((data) => data.lastEventId === "u1");

    expect(undoCheckpoint).toBeDefined();
    expect(undoCheckpoint.lastCreatedAt).toEqual(undoEvent.createdAt);
    expect(undoCheckpoint.score.A.sets).toBe(0);
    expect(undoCheckpoint.score.A.games).toBe(5);
    // Checkpoints must never persist the replay-only undo stack.
    expect(undoCheckpoint.score.history).toBeUndefined();
  });

  test("undo after a scoring-mode change is not resurrected by the next point", async () => {
    const courtId = "aaabf";
    const matchId = "aaaaag";
    const scorePath = `matches/${matchId}/score/current`;
    const matchPath = `matches/${matchId}`;
    const eventsPath = `matches/${matchId}/events`;

    const e1 = { id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 };
    const e2 = { id: "e2", eventType: "POINT_TEAM_A", createdAt: timestamp(2), scoreVersion: 0 };
    const e3 = { id: "e3", eventType: "POINT_TEAM_A", createdAt: timestamp(3), scoreVersion: 0 };

    const initialState = {
      [matchPath]: makeMatchDoc({
        matchId,
        courtId,
        scoreVersion: 0,
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
      }),
      [`courts/${courtId}`]: {
        name: "Undo Court",
        password: "courtpass",
        status: "open",
        activeMatchId: matchId,
        lastMatchId: matchId,
      },
      [scorePath]: {
        ...toLiveScorePayload(replayEvents([e1, e2, e3], DEFAULT_SCORING_OPTIONS)),
        lastEventId: "e3",
        lastProcessedEventId: "e3",
        lastProcessedCreatedAt: e3.createdAt,
      },
    };
    seedEventDocs(initialState, eventsPath, [e1, e2, e3]);
    mockDb = new FakeFirestore(initialState);

    let onEventCreate;
    let updateScoringOptions;
    jest.isolateModules(() => {
      ({ onEventCreate, updateScoringOptions } = require("./index"));
    });

    // Switch modes mid-match: this re-replays the log under the new options
    // and writes a checkpoint anchored at the current last event (e3).
    await updateScoringOptions({
      data: {
        courtId,
        scoringMode: "straight",
        scoringOptions: {
          scoringMode: "straight",
          deuceMode: "standard",
          tiebreakMode: "sixAllSeven",
        },
        credentials: { courtPassword: "courtpass" },
      },
    });

    expect(mockDb.docs.get(scorePath).A.points).toBe(3);

    // Undo right after the mode change - the undo sits exactly at the new
    // checkpoint's boundary.
    const undoEvent = { id: "u1", eventType: "UNDO", createdAt: timestamp(5), scoreVersion: 0 };
    mockDb.docs.set(`${eventsPath}/u1`, structuredClone(undoEvent));
    await onEventCreate({
      params: { matchId, eventId: undoEvent.id },
      data: {
        data: () => structuredClone(undoEvent),
      },
    });

    expect(mockDb.docs.get(scorePath).A.points).toBe(2);

    // The next point must build on the undone score, not resurrect the
    // undone point from the checkpoint boundary.
    const nextPoint = {
      id: "z1",
      eventType: "POINT_TEAM_B",
      createdAt: timestamp(6),
      scoreVersion: 0,
    };
    mockDb.docs.set(`${eventsPath}/z1`, structuredClone(nextPoint));
    await onEventCreate({
      params: { matchId, eventId: nextPoint.id },
      data: {
        data: () => structuredClone(nextPoint),
      },
    });

    const finalScore = mockDb.docs.get(scorePath);
    expect(finalScore.A.points).toBe(2);
    expect(finalScore.B.points).toBe(1);
  });
});

describe("postEvent", () => {
  function makePostRes() {
    return {
      statusCode: null,
      payload: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.payload = body;
        return this;
      },
      set() {
        return this;
      },
      send(body) {
        this.body = body;
        return this;
      },
    };
  }

  test("serves CORS preflight for the Device Lab origins without touching Firestore", async () => {
    mockDb = new FakeFirestore({});

    let postEvent;
    jest.isolateModules(() => {
      ({ postEvent } = require("./index"));
    });

    const headers = {};
    const res = {
      statusCode: null,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      set(key, value) {
        headers[key] = value;
        return this;
      },
      send(body) {
        this.body = body;
        return this;
      },
    };

    await postEvent(
      {
        method: "OPTIONS",
        headers: { origin: "https://qa.padelpush.co.za" },
      },
      res,
    );

    expect(res.statusCode).toBe(204);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://qa.padelpush.co.za");
    expect(headers["Access-Control-Allow-Methods"]).toBe("POST, OPTIONS");
    expect(headers["Access-Control-Allow-Headers"]).toBe("Content-Type");
  });

  test("stamps device scoring events with the active match scoreVersion", async () => {
    const courtId = "aaaad";
    const matchId = "aaaaag";
    const deviceId = "device-1";

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId },
      ...seedMatchDocs({ courtId, matchId, scoreVersion: 3 }),
    });

    let postEvent;
    jest.isolateModules(() => {
      ({ postEvent } = require("./index"));
    });

    const res = makePostRes();
    await postEvent({ method: "POST", body: { deviceId, eventType: "POINT_TEAM_A" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ success: true, courtId, matchId });

    const eventEntry = [...mockDb.docs.entries()].find(([path]) =>
      path.startsWith(`matches/${matchId}/events/`),
    );
    expect(eventEntry).toBeDefined();
    expect(eventEntry[1].eventType).toBe("POINT_TEAM_A");
    expect(eventEntry[1].courtId).toBe(courtId);
    expect(eventEntry[1].scoreVersion).toBe(3);
  });

  test("requires the authorized reset flow for tournament matches", async () => {
    const courtId = "aaabc";
    const matchId = "aaaaaf";
    const deviceId = "device-tournament";

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId },
      ...seedMatchDocs({
        courtId,
        matchId,
        match: { tournamentId: "abcdefg", fixtureId: "fixture-1" },
      }),
    });

    let postEvent;
    jest.isolateModules(() => {
      ({ postEvent } = require("./index"));
    });

    const res = makePostRes();
    await postEvent({ method: "POST", body: { deviceId, eventType: "RESET" } }, res);

    expect(res.statusCode).toBe(403);
    expect(res.payload).toMatchObject({
      success: false,
      error: "Tournament matches must be reset through the authorized reset flow.",
    });
    expect(
      [...mockDb.docs.keys()].some((path) => path.startsWith(`matches/${matchId}/events/`)),
    ).toBe(false);
  });

  test("resets casual device matches through the versioned reset operation", async () => {
    const courtId = "aaaaj";
    const matchId = "aaaaad";
    const deviceId = "device-casual-reset";
    const oldEvent = {
      id: "old-point",
      eventType: "POINT_TEAM_A",
      scoreVersion: 3,
      createdAt: timestamp(1),
    };

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId },
      ...seedMatchDocs({
        courtId,
        matchId,
        scoreVersion: 3,
        events: [oldEvent],
        score: { ...defaultScoreFor(DEFAULT_SCORING_OPTIONS), A: { points: 15 } },
      }),
    });

    let postEvent;
    jest.isolateModules(() => {
      ({ postEvent } = require("./index"));
    });

    const res = makePostRes();
    await postEvent({ method: "POST", body: { deviceId, eventType: "RESET" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ success: true, matchId, courtId });
    expect(mockDb.docs.get(`matches/${matchId}`).scoreVersion).toBe(4);
    expect(mockDb.docs.get(`matches/${matchId}/score/current`).A.points).toBe(0);
    expect(mockDb.docs.has(`matches/${matchId}/events/old-point`)).toBe(false);
    expect(
      [...mockDb.docs.entries()].some(
        ([path, data]) =>
          path.startsWith(`matches/${matchId}/archive/`) && data.eventType === "POINT_TEAM_A",
      ),
    ).toBe(true);
    expect(
      [...mockDb.docs.keys()].some((path) => path.startsWith(`matches/${matchId}/events/`)),
    ).toBe(false);
  });

  test("creates a casual match when the court has none", async () => {
    const courtId = "aaaam";
    const deviceId = "device-empty";

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId },
      [`courts/${courtId}`]: {
        name: "Empty Court",
        password: "courtpass",
        status: "open",
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
      },
    });

    let postEvent;
    jest.isolateModules(() => {
      ({ postEvent } = require("./index"));
    });

    const res = makePostRes();
    await postEvent({ method: "POST", body: { deviceId, eventType: "POINT_TEAM_A" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.matchId).toBeTruthy();
    expect(res.payload.courtId).toBe(courtId);
    expect(mockDb.docs.get(`courts/${courtId}`).activeMatchId).toBe(res.payload.matchId);
    expect(mockDb.docs.get(`matches/${res.payload.matchId}`)).toMatchObject({
      status: "live",
      currentCourtId: courtId,
      kind: "casual",
    });
    const eventEntry = [...mockDb.docs.entries()].find(([path]) =>
      path.startsWith(`matches/${res.payload.matchId}/events/`),
    );
    expect(eventEntry[1]).toMatchObject({ eventType: "POINT_TEAM_A", courtId, scoreVersion: 0 });
  });

  test("ignores a non-live active match by creating a new casual match", async () => {
    const courtId = "aaaak";
    const oldMatchId = "aaaaaa";
    const deviceId = "device-completed";

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId },
      ...seedMatchDocs({
        courtId,
        matchId: oldMatchId,
        court: { activeMatchId: oldMatchId, lastMatchId: oldMatchId },
        match: { status: "completed", completedAt: timestamp(10) },
      }),
    });

    let postEvent;
    jest.isolateModules(() => {
      ({ postEvent } = require("./index"));
    });

    const res = makePostRes();
    await postEvent({ method: "POST", body: { deviceId, eventType: "POINT_TEAM_B" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.matchId).toBeTruthy();
    expect(res.payload.matchId).not.toBe(oldMatchId);
    expect(mockDb.docs.get(`matches/${oldMatchId}`).status).toBe("completed");
    expect(mockDb.docs.get(`courts/${courtId}`).activeMatchId).toBe(res.payload.matchId);
    expect(mockDb.docs.get(`matches/${res.payload.matchId}`)).toMatchObject({
      status: "live",
      currentCourtId: courtId,
    });
  });

  test("swaps Beacon point events only when court changeover is active", async () => {
    const courtId = "aaaag";
    const matchId = "aaaaag";
    const deviceId = "beacon-1";

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId, deviceSKU: "Beacon" },
      ...seedMatchDocs({
        courtId,
        matchId,
        scoreVersion: 4,
        court: { beaconSidesSwapped: true },
      }),
    });

    let postEvent;
    jest.isolateModules(() => {
      ({ postEvent } = require("./index"));
    });

    const pointA = makePostRes();
    await postEvent(
      { method: "POST", body: { deviceId, eventType: "POINT_TEAM_A", deviceSKU: "Beacon" } },
      pointA,
    );

    const pointB = makePostRes();
    await postEvent(
      { method: "POST", body: { deviceId, eventType: "POINT_TEAM_B", deviceSKU: "Beacon" } },
      pointB,
    );

    const events = [...mockDb.docs.entries()]
      .filter(([path]) => path.startsWith(`matches/${matchId}/events/`))
      .map(([, data]) => data);

    expect(events.map((event) => event.eventType)).toEqual(["POINT_TEAM_B", "POINT_TEAM_A"]);
    expect(events.every((event) => event.beaconSidesSwapped === true)).toBe(true);
    expect(events[0].sourceEventType).toBe("POINT_TEAM_A");
    expect(events[1].sourceEventType).toBe("POINT_TEAM_B");
  });

  test("changeover does not invert Pulse events", async () => {
    const courtId = "aaaat";
    const matchId = "aaaaag";
    const deviceId = "pulse-1";

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId, deviceSKU: "Pulse" },
      ...seedMatchDocs({
        courtId,
        matchId,
        scoreVersion: 1,
        court: { beaconSidesSwapped: true },
      }),
    });

    let postEvent;
    jest.isolateModules(() => {
      ({ postEvent } = require("./index"));
    });

    const res = makePostRes();
    await postEvent(
      { method: "POST", body: { deviceId, eventType: "POINT_TEAM_A", deviceSKU: "Pulse" } },
      res,
    );

    const eventEntry = [...mockDb.docs.entries()].find(([path]) =>
      path.startsWith(`matches/${matchId}/events/`),
    );
    expect(eventEntry[1].eventType).toBe("POINT_TEAM_A");
    expect(eventEntry[1].sourceEventType).toBeUndefined();
  });

  test("stamps scoreVersion 0 when the match has never been reset", async () => {
    const courtId = "aaaae";
    const matchId = "aaaaag";
    const deviceId = "device-2";

    mockDb = new FakeFirestore({
      [`devices/${deviceId}`]: { courtId },
      ...seedMatchDocs({ courtId, matchId }),
    });

    let postEvent;
    jest.isolateModules(() => {
      ({ postEvent } = require("./index"));
    });

    const res = makePostRes();
    await postEvent({ method: "POST", body: { deviceId, eventType: "UNDO" } }, res);

    expect(res.statusCode).toBe(200);

    const eventEntry = [...mockDb.docs.entries()].find(([path]) =>
      path.startsWith(`matches/${matchId}/events/`),
    );
    expect(eventEntry).toBeDefined();
    expect(eventEntry[1].scoreVersion).toBe(0);
  });
});

describe("changeoverCourt", () => {
  test.each([
    ["completed match", { status: "completed" }, {}, false],
    ["cancelled match", { status: "cancelled" }, {}, false],
    ["finished tiebreak", { scoringMode: "tiebreakTen" }, { matchComplete: true }, false],
    [
      "fixed points at target",
      {
        scoringMode: "fixedTotalPoints",
        scoringOptions: {
          scoringMode: "fixedTotalPoints",
          pointsTarget: 12,
          completion: { tieResolution: "golden_point" },
        },
      },
      { A: { points: 6 }, B: { points: 6 }, matchComplete: false },
      false,
    ],
    [
      "fixed points after golden point",
      {
        scoringMode: "fixedTotalPoints",
        scoringOptions: {
          scoringMode: "fixedTotalPoints",
          pointsTarget: 12,
        },
      },
      { A: { points: 7 }, B: { points: 6 }, matchComplete: true },
      true,
    ],
  ])("rejects a changeover for a %s", async (_label, match, score, lastMatchOnly) => {
    const courtId = "aaaac";
    const matchId = "aaaaab";
    const docs = seedMatchDocs({ courtId, matchId, match, score });
    if (lastMatchOnly) {
      docs[`courts/${courtId}`].activeMatchId = null;
      docs[`courts/${courtId}`].lastMatchId = matchId;
    }
    mockDb = new FakeFirestore(docs);
    const before = structuredClone(mockDb.docs.get(`courts/${courtId}`));
    let changeoverCourt;
    jest.isolateModules(() => {
      ({ changeoverCourt } = require("./index"));
    });
    await expect(changeoverCourt({ data: { courtId } })).rejects.toThrow("Match has concluded");
    expect(mockDb.docs.get(`courts/${courtId}`)).toEqual(before);
  });

  test("allows a fixed-points changeover after an early majority win below the target", async () => {
    const courtId = "aaabg";
    mockDb = new FakeFirestore(
      seedMatchDocs({
        courtId,
        matchId: "aaaaah",
        scoringOptions: { scoringMode: "fixedTotalPoints", pointsTarget: 12 },
        score: { A: { points: 7 }, B: { points: 2 }, matchComplete: false },
      }),
    );
    let changeoverCourt;
    jest.isolateModules(() => {
      ({ changeoverCourt } = require("./index"));
    });
    await expect(changeoverCourt({ data: { courtId } })).resolves.toMatchObject({
      success: true,
      beaconSidesSwapped: true,
    });
  });

  test("atomically toggles the current Beacon side mapping without altering other court fields", async () => {
    const courtId = "aaaab";
    mockDb = new FakeFirestore({
      [`courts/${courtId}`]: {
        name: "Changeover",
        scoreVersion: 7,
        beaconSidesSwapped: false,
        status: "open",
      },
    });

    let changeoverCourt;
    jest.isolateModules(() => {
      ({ changeoverCourt } = require("./index"));
    });

    const firstResult = await changeoverCourt({
      data: { courtId },
    });

    expect(firstResult).toEqual({
      success: true,
      courtId,
      beaconSidesSwapped: true,
      changeoverEventId: "auto-1",
    });
    expect(mockDb.docs.get(`courts/${courtId}`)).toEqual({
      name: "Changeover",
      scoreVersion: 7,
      beaconSidesSwapped: true,
      status: "open",
      changeoverEvent: {
        id: "auto-1",
        createdAt: { __serverTimestamp: true },
      },
    });

    const secondResult = await changeoverCourt({
      data: { courtId },
    });

    expect(secondResult.success).toBe(true);
    expect(secondResult.courtId).toBe(courtId);
    expect(secondResult.beaconSidesSwapped).toBe(false);
    expect(secondResult.changeoverEventId).toBe("auto-2");
    expect(mockDb.docs.get(`courts/${courtId}`).beaconSidesSwapped).toBe(false);
  });

  test("rejects a missing court", async () => {
    mockDb = new FakeFirestore({});

    let changeoverCourt;
    jest.isolateModules(() => {
      ({ changeoverCourt } = require("./index"));
    });

    await expect(changeoverCourt({ data: { courtId: "aaabj" } })).rejects.toThrow(
      "Court not found",
    );
  });
});

describe("Cloud Functions exports", () => {
  test("exports the public, callable, and match/tournament entry points", () => {
    mockDb = new FakeFirestore({});

    jest.isolateModules(() => {
      const functions = require("./index");
      expect(functions).toEqual(
        expect.objectContaining({
          onEventCreate: expect.any(Function),
          postEvent: expect.any(Function),
          getCourtScore: expect.any(Function),
          getCourtScoreRevision: expect.any(Function),
          getCourtStats: expect.any(Function),
          getCourtMomentum: expect.any(Function),
          resetCourt: expect.any(Function),
          updateScoringOptions: expect.any(Function),
          manageMatch: expect.any(Function),
          manageTournament: expect.any(Function),
        }),
      );
    });
  });
});

describe("getCourtScore", () => {
  function makeRes() {
    return {
      statusCode: null,
      payload: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.payload = body;
        return this;
      },
      set(name, value) {
        this.headers[name] = value;
        return this;
      },
      send(body) {
        this.payload = body;
        return this;
      },
    };
  }

  test("returns the current score with display labels, server, and CDN cache headers", async () => {
    const courtId = "aaaad";
    const matchId = "aaaaag";
    const score = toLiveScorePayload(
      replayEvents(
        [
          { id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 },
          { id: "e2", eventType: "POINT_TEAM_A", createdAt: timestamp(2), scoreVersion: 0 },
          { id: "e3", eventType: "POINT_TEAM_A", createdAt: timestamp(3), scoreVersion: 0 },
        ],
        DEFAULT_SCORING_OPTIONS,
      ),
    );

    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        score,
        court: { name: "Court One" },
        match: {
          teamNames: { A: "Smashers", B: "Lobbers" },
          playerNames: { A1: "Ann", A2: "Al", B1: "Bo", B2: "Bea" },
        },
      }),
    });

    let getCourtScore;
    jest.isolateModules(() => {
      ({ getCourtScore } = require("./index"));
    });

    const res = makeRes();
    await getCourtScore({ method: "GET", path: `/score/${courtId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.courtId).toBe(courtId);
    expect(res.payload.courtName).toBe("Court One");
    expect(res.payload.matchId).toBe(matchId);
    expect(res.payload.teamNames).toEqual({ A: "Smashers", B: "Lobbers" });
    expect(res.payload.playerNames.A1).toBe("Ann");
    expect(res.payload.match).toMatchObject({ matchId, courtId, courtName: "Court One" });
    expect(res.payload.teams.A.points).toBe(3);
    expect(res.payload.teams.A.pointsDisplay).toBe("40");
    expect(res.payload.teams.B.pointsDisplay).toBe("0");
    expect(res.payload.scoringMode).toBe("standard");
    expect(res.payload.server).toBe("A1");
    expect(res.payload.matchComplete).toBe(false);
    expect(typeof res.payload.revision).toBe("string");
    expect(res.headers["Cache-Control"]).toBe("public, max-age=4, s-maxage=4");
  });

  test("/score/match/{matchId} works and uses the match name as title", async () => {
    const courtId = "aaaas";
    const matchId = "aaaaak";

    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        court: { name: "Show Court" },
        match: { name: "Club Championship Final" },
      }),
    });

    let getCourtScore;
    jest.isolateModules(() => {
      ({ getCourtScore } = require("./index"));
    });

    const res = makeRes();
    await getCourtScore({ method: "GET", path: `/score/match/${matchId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      courtId,
      courtName: "Show Court",
      matchId,
      matchName: "Club Championship Final",
      title: "Club Championship Final",
    });
  });

  test("returns 404 for an unknown court", async () => {
    mockDb = new FakeFirestore({});

    let getCourtScore;
    jest.isolateModules(() => {
      ({ getCourtScore } = require("./index"));
    });

    const res = makeRes();
    await getCourtScore({ method: "GET", path: "/score/aaabk" }, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload).toEqual({ success: false, error: "Court not found." });
  });

  test("serves repeat requests from the in-memory cache instead of Firestore", async () => {
    const courtId = "aaaah";
    const matchId = "aaaaag";

    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        match: { teamNames: { A: "First", B: "Second" } },
      }),
    });

    let getCourtScore;
    jest.isolateModules(() => {
      ({ getCourtScore } = require("./index"));
    });

    const first = makeRes();
    await getCourtScore({ method: "GET", path: `/score/${courtId}` }, first);
    expect(first.statusCode).toBe(200);
    expect(first.payload.teamNames.A).toBe("First");

    mockDb.docs.set(`matches/${matchId}`, {
      ...mockDb.docs.get(`matches/${matchId}`),
      teamNames: { A: "Changed", B: "Second" },
    });

    const second = makeRes();
    await getCourtScore({ method: "GET", path: `/score/${courtId}` }, second);
    expect(second.statusCode).toBe(200);
    expect(second.payload.teamNames.A).toBe("First");
  });

  test("rejects requests without a usable courtId", async () => {
    mockDb = new FakeFirestore({});

    let getCourtScore;
    jest.isolateModules(() => {
      ({ getCourtScore } = require("./index"));
    });

    const res = makeRes();
    await getCourtScore({ method: "GET", path: "/a" }, res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
  });

  test("revision endpoint returns a tiny payload that tracks score changes", async () => {
    const courtId = "aaaau";
    const matchId = "aaaaag";

    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        score: toLiveScorePayload(
          replayEvents(
            [{ id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 }],
            DEFAULT_SCORING_OPTIONS,
          ),
        ),
        match: { teamNames: { A: "Smashers", B: "Lobbers" } },
      }),
    });

    let getCourtScore;
    let getCourtScoreRevision;
    jest.isolateModules(() => {
      ({ getCourtScore, getCourtScoreRevision } = require("./index"));
    });

    const revisionRes = makeRes();
    await getCourtScoreRevision({ method: "GET", path: `/revision/${courtId}` }, revisionRes);

    expect(revisionRes.statusCode).toBe(200);
    expect(Object.keys(revisionRes.payload).sort()).toEqual([
      "courtId",
      "matchId",
      "revision",
      "success",
    ]);
    expect(revisionRes.payload.matchId).toBe(matchId);

    const scoreRes = makeRes();
    await getCourtScore({ method: "GET", path: `/score/${courtId}` }, scoreRes);
    expect(scoreRes.payload.revision).toBe(revisionRes.payload.revision);

    mockDb.docs.set(
      `matches/${matchId}/score/current`,
      toLiveScorePayload(
        replayEvents(
          [
            { id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 },
            { id: "e2", eventType: "POINT_TEAM_B", createdAt: timestamp(2), scoreVersion: 0 },
          ],
          DEFAULT_SCORING_OPTIONS,
        ),
      ),
    );

    jest.isolateModules(() => {
      ({ getCourtScoreRevision } = require("./index"));
    });

    const changedRes = makeRes();
    await getCourtScoreRevision({ method: "GET", path: `/revision/${courtId}` }, changedRes);
    expect(changedRes.payload.revision).not.toBe(revisionRes.payload.revision);
  });

  test("ignores a stale matchComplete flag for non-fixed-end scores", async () => {
    const courtId = "aaaax";
    const matchId = "aaaaag";
    const staleScore = {
      ...toLiveScorePayload(
        replayEvents(
          [{ id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 }],
          DEFAULT_SCORING_OPTIONS,
        ),
      ),
      matchComplete: true,
    };

    mockDb = new FakeFirestore({
      ...seedMatchDocs({ courtId, matchId, score: staleScore }),
    });

    let getCourtScore;
    jest.isolateModules(() => {
      ({ getCourtScore } = require("./index"));
    });

    const res = makeRes();
    await getCourtScore({ method: "GET", path: `/score/${courtId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.matchComplete).toBe(false);
  });

  test("still reports matchComplete for tiebreakTen scores", async () => {
    const courtId = "aaabb";
    const matchId = "aaaaag";
    const tiebreakOptions = {
      scoringMode: "tiebreakTen",
      deuceMode: "standard",
      tiebreakMode: "sixAllSeven",
    };
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push({
        id: `e${i}`,
        eventType: "POINT_TEAM_A",
        createdAt: timestamp(i + 1),
        scoreVersion: 0,
      });
    }
    const completedScore = toLiveScorePayload(replayEvents(events, tiebreakOptions));

    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        scoringOptions: tiebreakOptions,
        score: completedScore,
      }),
    });

    let getCourtScore;
    jest.isolateModules(() => {
      ({ getCourtScore } = require("./index"));
    });

    const res = makeRes();
    await getCourtScore({ method: "GET", path: `/score/${courtId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.matchComplete).toBe(true);
  });

  test("revision endpoint reports 404 for an unknown match", async () => {
    mockDb = new FakeFirestore({});

    let getCourtScoreRevision;
    jest.isolateModules(() => {
      ({ getCourtScoreRevision } = require("./index"));
    });

    const res = makeRes();
    await getCourtScoreRevision({ method: "GET", path: "/revision/match/zzzzzz" }, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload).toEqual({ success: false, error: "Match not found." });
  });
});

describe("getCourtStats", () => {
  function makeRes() {
    return {
      statusCode: null,
      payload: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.payload = body;
        return this;
      },
      set(name, value) {
        this.headers[name] = value;
        return this;
      },
      send(body) {
        this.payload = body;
        return this;
      },
    };
  }

  test("replays the match event stream into aggregate stats without point-by-point streams", async () => {
    const courtId = "aaaay";
    const matchId = "aaaaag";
    const events = [
      { id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 },
      { id: "e2", eventType: "POINT_TEAM_A", createdAt: timestamp(2), scoreVersion: 0 },
      { id: "e3", eventType: "POINT_TEAM_B", createdAt: timestamp(3), scoreVersion: 0 },
      { id: "e4", eventType: "POINT_TEAM_A", createdAt: timestamp(4), scoreVersion: 0 },
      { id: "e5", eventType: "POINT_TEAM_A", createdAt: timestamp(5), scoreVersion: 0 },
    ];

    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        events,
        match: {
          teamNames: { A: "Smashers", B: "Lobbers" },
          playerNames: { A1: "Ann", A2: "Al", B1: "Bo", B2: "Bea" },
        },
      }),
    });

    let getCourtStats;
    jest.isolateModules(() => {
      ({ getCourtStats } = require("./index"));
    });

    const res = makeRes();
    await getCourtStats({ method: "GET", path: `/stats/${courtId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.courtId).toBe(courtId);
    expect(res.payload.matchId).toBe(matchId);
    expect(res.payload.totalPoints).toBe(5);
    expect(res.payload.advancedStats.teamStats.A.pointsWon).toBe(4);
    expect(res.payload.advancedStats.teamStats.B.pointsWon).toBe(1);
    expect(res.payload.advancedStats.matchStats.totalPoints).toBe(5);
    expect(res.payload.playerNames.A1).toBe("Ann");

    expect(res.payload.pointHistory).toBeUndefined();
    expect(res.payload.momentumTimeline).toBeUndefined();
    expect(res.payload.setPointMarkers).toBeUndefined();
    expect(res.payload.advancedStats.gameMarkers).toBeUndefined();

    expect(res.headers["Cache-Control"]).toBe("public, max-age=10, s-maxage=10");
  });

  test("serves repeat requests from the in-memory cache instead of replaying events", async () => {
    const courtId = "aaaaz";
    const matchId = "aaaaag";
    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        events: [{ id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 }],
      }),
    });

    let getCourtStats;
    jest.isolateModules(() => {
      ({ getCourtStats } = require("./index"));
    });

    const first = makeRes();
    await getCourtStats({ method: "GET", path: `/stats/${courtId}` }, first);
    expect(first.statusCode).toBe(200);
    expect(first.payload.totalPoints).toBe(1);

    mockDb.docs.set(`matches/${matchId}/events/e2`, {
      eventType: "POINT_TEAM_B",
      createdAt: timestamp(2),
      scoreVersion: 0,
    });

    const second = makeRes();
    await getCourtStats({ method: "GET", path: `/stats/${courtId}` }, second);
    expect(second.statusCode).toBe(200);
    expect(second.payload.totalPoints).toBe(1);
  });

  test("/stats/match/{matchId} returns match-addressed stats", async () => {
    const courtId = "aaaba";
    const matchId = "aaaaam";
    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        events: [{ id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 }],
      }),
    });

    let getCourtStats;
    jest.isolateModules(() => {
      ({ getCourtStats } = require("./index"));
    });

    const res = makeRes();
    await getCourtStats({ method: "GET", path: `/stats/match/${matchId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ courtId, matchId, totalPoints: 1 });
  });

  test("returns 404 for an unknown court", async () => {
    mockDb = new FakeFirestore({});

    let getCourtStats;
    jest.isolateModules(() => {
      ({ getCourtStats } = require("./index"));
    });

    const res = makeRes();
    await getCourtStats({ method: "GET", path: "/stats/aaabk" }, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload).toEqual({ success: false, error: "Court not found." });
  });
});

describe("getCourtMomentum", () => {
  function makeRes() {
    return {
      statusCode: null,
      payload: null,
      headers: {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.payload = body;
        return this;
      },
      set(name, value) {
        this.headers[name] = value;
        return this;
      },
      send(body) {
        this.payload = body;
        return this;
      },
    };
  }

  test("returns the point-by-point momentum streams for the match", async () => {
    const courtId = "aaaap";
    const matchId = "aaaaag";
    const events = [
      { id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 },
      { id: "e2", eventType: "POINT_TEAM_A", createdAt: timestamp(2), scoreVersion: 0 },
      { id: "e3", eventType: "POINT_TEAM_B", createdAt: timestamp(3), scoreVersion: 0 },
      { id: "e4", eventType: "POINT_TEAM_A", createdAt: timestamp(4), scoreVersion: 0 },
      { id: "e5", eventType: "POINT_TEAM_A", createdAt: timestamp(5), scoreVersion: 0 },
    ];

    mockDb = new FakeFirestore({
      ...seedMatchDocs({ courtId, matchId, events }),
    });

    let getCourtMomentum;
    jest.isolateModules(() => {
      ({ getCourtMomentum } = require("./index"));
    });

    const res = makeRes();
    await getCourtMomentum({ method: "GET", path: `/momentum/${courtId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload.success).toBe(true);
    expect(res.payload.courtId).toBe(courtId);
    expect(res.payload.matchId).toBe(matchId);
    expect(res.payload.pointHistory).toEqual(["A", "A", "B", "A", "A"]);
    expect(res.payload.totalPoints).toBe(5);

    expect(res.payload.momentumTimeline).toHaveLength(5);
    res.payload.momentumTimeline.forEach((value) => {
      expect(typeof value).toBe("number");
      expect(value).toBeGreaterThanOrEqual(-100);
      expect(value).toBeLessThanOrEqual(100);
    });

    expect(res.payload.gameMarkers).toEqual([5]);
    expect(res.payload.setPointMarkers).toEqual([]);

    expect(res.headers["Cache-Control"]).toBe("public, max-age=5, s-maxage=5");
  });

  test("serves repeat requests from the in-memory cache instead of replaying events", async () => {
    const courtId = "aaaaq";
    const matchId = "aaaaag";
    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        events: [{ id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 }],
      }),
    });

    let getCourtMomentum;
    jest.isolateModules(() => {
      ({ getCourtMomentum } = require("./index"));
    });

    const first = makeRes();
    await getCourtMomentum({ method: "GET", path: `/momentum/${courtId}` }, first);
    expect(first.statusCode).toBe(200);
    expect(first.payload.totalPoints).toBe(1);

    mockDb.docs.set(`matches/${matchId}/events/e2`, {
      eventType: "POINT_TEAM_B",
      createdAt: timestamp(2),
      scoreVersion: 0,
    });

    const second = makeRes();
    await getCourtMomentum({ method: "GET", path: `/momentum/${courtId}` }, second);
    expect(second.statusCode).toBe(200);
    expect(second.payload.totalPoints).toBe(1);
  });

  test("/momentum/match/{matchId} returns match-addressed momentum", async () => {
    const courtId = "aaaar";
    const matchId = "aaaaaj";
    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        events: [{ id: "e1", eventType: "POINT_TEAM_A", createdAt: timestamp(1), scoreVersion: 0 }],
      }),
    });

    let getCourtMomentum;
    jest.isolateModules(() => {
      ({ getCourtMomentum } = require("./index"));
    });

    const res = makeRes();
    await getCourtMomentum({ method: "GET", path: `/momentum/match/${matchId}` }, res);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ courtId, matchId, totalPoints: 1 });
  });

  test("returns 404 for an unknown court", async () => {
    mockDb = new FakeFirestore({});

    let getCourtMomentum;
    jest.isolateModules(() => {
      ({ getCourtMomentum } = require("./index"));
    });

    const res = makeRes();
    await getCourtMomentum({ method: "GET", path: "/momentum/aaabk" }, res);

    expect(res.statusCode).toBe(404);
    expect(res.payload).toEqual({ success: false, error: "Court not found." });
  });
});

describe("resetCourt - password handling", () => {
  const courtId = "aaabh";
  const matchId = "aaaaag";
  const credentials = { courtPassword: "oldpw" };

  function seedCourtDb(overrides = {}) {
    const { court: courtOverrides = {}, match: matchOverrides = {}, scoreVersion = 2 } = overrides;
    mockDb = new FakeFirestore({
      ...seedMatchDocs({
        courtId,
        matchId,
        scoreVersion,
        court: {
          password: "oldpw",
          beaconSidesSwapped: false,
          ...courtOverrides,
        },
        match: matchOverrides,
      }),
    });

    let resetCourt;
    jest.isolateModules(() => {
      ({ resetCourt } = require("./index"));
    });
    return resetCourt;
  }

  function resetData(data = {}, authCredentials = credentials) {
    return { data: { courtId, ...data, credentials: authCredentials } };
  }

  test("reset always restores default Beacon side handling", async () => {
    const resetCourt = seedCourtDb({ court: { beaconSidesSwapped: true } });

    await resetCourt(resetData({ deepReset: false }));

    expect(mockDb.docs.get(`courts/${courtId}`).beaconSidesSwapped).toBe(false);
  });

  test("a blank password leaves the existing court password untouched", async () => {
    const resetCourt = seedCourtDb();

    const result = await resetCourt(resetData({ deepReset: false }));

    expect(result.success).toBe(true);
    expect(result.matchId).toBe(matchId);
    expect(mockDb.docs.get(`courts/${courtId}`).password).toBe("oldpw");
    expect(result.scoreVersion).toBe(3);
    expect(mockDb.docs.get(`matches/${matchId}`).scoreVersion).toBe(3);
  });

  test("rejects missing or incorrect credentials", async () => {
    const resetCourt = seedCourtDb();

    await expect(resetCourt({ data: { courtId } })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    await expect(
      resetCourt(resetData({}, { courtPassword: "wrong-password" })),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(mockDb.docs.get(`matches/${matchId}`).scoreVersion).toBe(2);
  });

  test("rejects an empty court before creating a match", async () => {
    mockDb = new FakeFirestore({
      [`courts/${courtId}`]: {
        name: "Empty Court",
        password: "oldpw",
        status: "open",
        scoringMode: DEFAULT_SCORING_OPTIONS.scoringMode,
        scoringOptions: DEFAULT_SCORING_OPTIONS,
      },
    });

    let resetCourt;
    jest.isolateModules(() => {
      ({ resetCourt } = require("./index"));
    });

    await expect(resetCourt({ data: { courtId } })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });

    expect(mockDb.docs.get(`courts/${courtId}`).activeMatchId).toBeUndefined();
    expect(
      [...mockDb.docs.keys()].some(
        (path) => path === `matches/${courtId}` || path.startsWith("matches/"),
      ),
    ).toBe(false);
  });

  test("a whitespace-only password is treated as blank, not as a change", async () => {
    const resetCourt = seedCourtDb();

    await resetCourt(resetData({ newPassword: "   " }));

    expect(mockDb.docs.get(`courts/${courtId}`).password).toBe("oldpw");
  });

  test("a new password replaces the old one", async () => {
    const resetCourt = seedCourtDb();

    await resetCourt(resetData({ newPassword: "brandnew" }));

    expect(mockDb.docs.get(`courts/${courtId}`).password).toBe("brandnew");
  });

  function captureCourtWrites() {
    const writes = [];
    // Guarded single-document writes commit through a transaction.
    const originalWrite = mockDb.write.bind(mockDb);
    mockDb.write = (path, data, options) => {
      if (path === `courts/${courtId}`) writes.push(data);
      return originalWrite(path, data, options);
    };
    const originalDoc = mockDb.doc.bind(mockDb);
    mockDb.doc = (path) => {
      const ref = originalDoc(path);
      if (path !== `courts/${courtId}`) return ref;

      const originalSet = ref.set;
      ref.set = async (data, options) => {
        writes.push(data);
        return originalSet(data, options);
      };
      return ref;
    };
    return writes;
  }

  test("re-submitting the current password is not written back", async () => {
    const resetCourt = seedCourtDb();
    const courtWrites = captureCourtWrites();

    await resetCourt(resetData({ newPassword: "oldpw" }));

    expect(mockDb.docs.get(`courts/${courtId}`).password).toBe("oldpw");
    courtWrites.forEach((write) => expect(write).not.toHaveProperty("password"));
  });

  test("a blank password writes no password field at all", async () => {
    const resetCourt = seedCourtDb();
    const courtWrites = captureCourtWrites();

    await resetCourt(resetData({ newPassword: "" }));

    courtWrites.forEach((write) => expect(write).not.toHaveProperty("password"));
  });

  test("an actual password change is written to the court document", async () => {
    const resetCourt = seedCourtDb();
    const courtWrites = captureCourtWrites();

    await resetCourt(resetData({ newPassword: "brandnew" }));

    expect(courtWrites.some((write) => write.password === "brandnew")).toBe(true);
  });

  test("a supplied password shorter than 4 characters is rejected", async () => {
    const resetCourt = seedCourtDb();

    await expect(resetCourt(resetData({ newPassword: "abc" }))).rejects.toThrow(
      "Password must be at least 4 characters.",
    );
    expect(mockDb.docs.get(`courts/${courtId}`).password).toBe("oldpw");
  });

  test("a supplied password equal to the court id is rejected", async () => {
    const resetCourt = seedCourtDb();

    await expect(resetCourt(resetData({ newPassword: courtId }))).rejects.toThrow(
      "Password must be different from court name.",
    );
  });

  test("requirePassword still makes a password mandatory", async () => {
    const resetCourt = seedCourtDb();

    await expect(resetCourt(resetData({ requirePassword: true }))).rejects.toThrow(
      "Password must be at least 4 characters.",
    );
  });

  test("a deep reset with a blank password still restores match names and keeps the password", async () => {
    const resetCourt = seedCourtDb({
      match: {
        teamNames: { A: "Reds", B: "Blues" },
        playerNames: { A1: "Ann", A2: "Bob", B1: "Cy", B2: "Dee" },
      },
    });

    await resetCourt(resetData({ deepReset: true }));

    const court = mockDb.docs.get(`courts/${courtId}`);
    const match = mockDb.docs.get(`matches/${matchId}`);
    expect(court.password).toBe("oldpw");
    expect(match.teamNames).toEqual({ A: "Team A", B: "Team B" });
    expect(match.playerNames).toEqual({ A1: "", A2: "", B1: "", B2: "" });
  });
});
