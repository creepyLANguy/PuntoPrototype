const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  DEFAULT_SCORING_OPTIONS,
  replayEvents,
  toLiveScorePayload,
} = require("./domain/scoring/engine");
const {
  scoreApiCache,
  statsApiCache,
  momentumApiCache,
} = require("./services/publicApiService");

let mockDb = null;

jest.mock("./infrastructure/firebase", () => ({
  get db() {
    return mockDb;
  },
  FieldPath: {
    documentId: () => "__name__",
  },
}));

const { getCourtScore } = require("./http/getCourtScore");
const { getCourtScoreRevision } = require("./http/getCourtScoreRevision");
const { getCourtStats } = require("./http/getCourtStats");
const { getCourtMomentum } = require("./http/getCourtMomentum");

class FakeFirestore {
  constructor(initialDocs = {}) {
    this.docs = new Map(
      Object.entries(initialDocs).map(([documentPath, data]) => [
        documentPath,
        structuredClone(data),
      ]),
    );
  }

  doc(documentPath) {
    return {
      kind: "doc",
      path: documentPath,
      id: documentPath.split("/").pop(),
      get: async () => this.getDocSnapshot(documentPath),
    };
  }

  collection(collectionPath) {
    return new FakeQuery(this, collectionPath);
  }

  getDocSnapshot(documentPath) {
    const data = this.docs.get(documentPath);

    return {
      exists: data !== undefined,
      id: documentPath.split("/").pop(),
      ref: this.doc(documentPath),
      data: () => (data === undefined ? undefined : structuredClone(data)),
    };
  }

  getQuerySnapshot(query) {
    const prefix = `${query.path}/`;
    let docs = [...this.docs.entries()]
      .filter(
        ([documentPath]) =>
          documentPath.startsWith(prefix) &&
          !documentPath.slice(prefix.length).includes("/"),
      )
      .map(([documentPath, data]) => ({
        id: documentPath.slice(prefix.length),
        data: structuredClone(data),
      }));

    for (let index = query.orders.length - 1; index >= 0; index -= 1) {
      const order = query.orders[index];
      docs.sort((left, right) => {
        const leftValue =
          order.field === "__name__" ? left.id : left.data[order.field];
        const rightValue =
          order.field === "__name__" ? right.id : right.data[order.field];

        const comparison = compareValues(leftValue, rightValue);
        return order.direction === "desc" ? -comparison : comparison;
      });
    }

    return {
      docs: docs.map((entry) => ({
        id: entry.id,
        ref: this.doc(`${query.path}/${entry.id}`),
        data: () => structuredClone(entry.data),
      })),
      forEach: (callback) => {
        docs.forEach((entry) => {
          callback({
            id: entry.id,
            ref: this.doc(`${query.path}/${entry.id}`),
            data: () => structuredClone(entry.data),
          });
        });
      },
    };
  }
}

class FakeQuery {
  constructor(db, path, orders = []) {
    this.db = db;
    this.path = path;
    this.orders = orders;
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(this.db, this.path, [
      ...this.orders,
      { field, direction },
    ]);
  }

  get() {
    return Promise.resolve(this.db.getQuerySnapshot(this));
  }
}

function compareValues(left, right) {
  if (
    left &&
    right &&
    typeof left.seconds === "number" &&
    typeof right.seconds === "number"
  ) {
    return (
      left.seconds - right.seconds ||
      (left.nanoseconds || 0) - (right.nanoseconds || 0)
    );
  }

  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function timestamp(seconds) {
  return { seconds, nanoseconds: 0 };
}

function makeEvents(sequence) {
  return sequence.map((team, index) => ({
    id: `e${index + 1}`,
    eventType: `POINT_TEAM_${team}`,
    createdAt: timestamp(index + 1),
    scoreVersion: 0,
  }));
}

function makeSeed(
  courtId,
  scoringOptions = DEFAULT_SCORING_OPTIONS,
  events = [],
  courtOverrides = {},
) {
  const score = replayEvents(events, scoringOptions);
  const seed = {
    [`courts/${courtId}`]: {
      scoringMode: scoringOptions.scoringMode,
      scoringOptions,
      scoreVersion: 0,
      ...courtOverrides,
    },
    [`courts/${courtId}/score/current`]: toLiveScorePayload(score),
  };

  events.forEach((event) => {
    seed[`courts/${courtId}/events/${event.id}`] = event;
  });

  return seed;
}

function resetEnvironment(seed) {
  mockDb = new FakeFirestore(seed);
  scoreApiCache.clear("bnrm");
  statsApiCache.clear("bnrm");
  momentumApiCache.clear("bnrm");
}

function makeResponse() {
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
    send(body) {
      this.payload = body;
      return this;
    },
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
  };
}

async function invoke(handler, route) {
  const response = makeResponse();
  await handler({ method: "GET", path: route }, response);
  return response;
}

let contractPromise;

async function loadContract() {
  if (!contractPromise) {
    contractPromise = (async () => {
      const openapiSource = fs.readFileSync(
        path.join(__dirname, "..", "docs", "api", "openapi.yaml"),
        "utf8",
      );

      const [{ validate: validateOpenApi, dereference }, { validate }] =
        await Promise.all([
          import("@scalar/openapi-parser"),
          import("@scalar/json-schema-validator"),
        ]);

      const openapiResult = await validateOpenApi(openapiSource);
      assert.equal(
        openapiResult.valid,
        true,
        `OpenAPI document failed validation:\\n${formatErrors(openapiResult.errors)}`,
      );

      const dereferenceResult = await dereference(openapiSource);
      assert.equal(
        (dereferenceResult.errors || []).length,
        0,
        `OpenAPI references failed to resolve:\\n${formatErrors(dereferenceResult.errors)}`,
      );

      return {
        document: dereferenceResult.schema,
        validateResponse: validate,
      };
    })();
  }

  return contractPromise;
}

function getResponseSchema(document, route) {
  return document.paths[route].get.responses["200"].content[
    "application/json"
  ].schema;
}

function formatErrors(errors) {
  return JSON.stringify(errors || [], null, 2);
}

async function assertSuccessfulResponseMatchesContract(
  contract,
  route,
  response,
) {
  assert.equal(response.statusCode, 200);

  const result = contract.validateResponse(
    response.payload,
    getResponseSchema(contract.document, route),
  );

  assert.equal(
    result.valid,
    true,
    `Response for ${route} did not match OpenAPI schema:\\n${formatErrors(result.errors)}\\nPayload:\\n${JSON.stringify(response.payload, null, 2)}`,
  );
}

function buildSixAllTiebreakEvents(tiebreakWinner, target) {
  const events = [];

  for (let game = 0; game < 6; game += 1) {
    events.push(...makeEvents(["A", "A", "A", "A", "B", "B", "B", "B"]));
  }

  const tiebreakPoints = Array.from({ length: target }, () => tiebreakWinner);
  const sequence = events.map((event) => (event.eventType.endsWith("_A") ? "A" : "B"));
  return makeEvents([...sequence, ...tiebreakPoints]);
}

describe("public API OpenAPI contract", () => {
  let contract;

  beforeAll(async () => {
    contract = await loadContract();
  });

  test("the OpenAPI document is valid and all local references resolve", () => {
    expect(contract.document.openapi).toBe("3.1.0");
    expect(contract.document.paths["/score/{courtId}"]).toBeDefined();
    expect(
      contract.document.paths["/revision/{courtId}"],
    ).toBeDefined();
    expect(contract.document.paths["/stats/{courtId}"]).toBeDefined();
    expect(
      contract.document.paths["/momentum/{courtId}"],
    ).toBeDefined();
  });

  test.each([
    {
      name: "empty/default court",
      options: DEFAULT_SCORING_OPTIONS,
      events: [],
      court: {},
    },
    {
      name: "straight scoring",
      options: {
        scoringMode: "straight",
        deuceMode: "standard",
        tiebreakMode: "off",
      },
      events: makeEvents(["A", "A", "A", "B"]),
      court: {},
    },
    {
      name: "golden deuce",
      options: {
        scoringMode: "standard",
        deuceMode: "golden",
        tiebreakMode: "sixAllSeven",
      },
      events: makeEvents(["A", "A", "A", "B", "B", "B", "A"]),
      court: {},
    },
    {
      name: "silver deuce",
      options: {
        scoringMode: "standard",
        deuceMode: "silver",
        tiebreakMode: "sixAllSeven",
      },
      events: makeEvents(["A", "A", "A", "B", "B", "B", "A", "B", "A"]),
      court: {},
    },
    {
      name: "star deuce",
      options: {
        scoringMode: "standard",
        deuceMode: "star",
        tiebreakMode: "sixAllSeven",
      },
      events: makeEvents([
        "A",
        "A",
        "A",
        "B",
        "B",
        "B",
        "A",
        "B",
        "A",
        "B",
        "A",
      ]),
      court: {},
    },
    {
      name: "seven-point tiebreak",
      options: {
        scoringMode: "standard",
        deuceMode: "standard",
        tiebreakMode: "sixAllSeven",
      },
      events: buildSixAllTiebreakEvents("A", 7),
      court: {},
    },
    {
      name: "ten-point tiebreak",
      options: {
        scoringMode: "standard",
        deuceMode: "standard",
        tiebreakMode: "sixAllTen",
      },
      events: buildSixAllTiebreakEvents("B", 10),
      court: {},
    },
    {
      name: "match tiebreak",
      options: {
        scoringMode: "tiebreakTen",
        deuceMode: "standard",
        tiebreakMode: "sixAllTen",
      },
      events: makeEvents(Array.from({ length: 10 }, () => "A")),
      court: {},
    },
    {
      name: "completed set and server rotation",
      options: DEFAULT_SCORING_OPTIONS,
      events: makeEvents([
        ...Array.from({ length: 8 }, () => "A"),
      ]),
      court: {},
    },
    {
      name: "empty player names",
      options: DEFAULT_SCORING_OPTIONS,
      events: [],
      court: {
        teamNames: { A: "Team A", B: "Team B" },
      },
    },
  ])(
    "validates the /score response for $name",
    async ({ options, events, court }) => {
      resetEnvironment(makeSeed("bnrm", options, events, court));
      const response = await invoke(getCourtScore, "/score/bnrm");

      await assertSuccessfulResponseMatchesContract(
        contract,
        "/score/{courtId}",
        response,
      );
    },
  );

  test("validates /revision and preserves the advertised score revision", async () => {
    const events = makeEvents(["A", "A", "A"]);
    resetEnvironment(
      makeSeed("bnrm", DEFAULT_SCORING_OPTIONS, events, {
        teamNames: { A: "Smashers", B: "Lobbers" },
        playerNames: { A1: "Ann", A2: "Al", B1: "Bo", B2: "Bea" },
      }),
    );

    const revision = await invoke(getCourtScoreRevision, "/revision/bnrm");
    await assertSuccessfulResponseMatchesContract(
      contract,
      "/revision/{courtId}",
      revision,
    );

    const score = await invoke(getCourtScore, "/score/bnrm");
    expect(score.payload.revision).toBe(revision.payload.revision);
  });

  test("validates /stats for zero-denominator statistics and populated match data", async () => {
    resetEnvironment(
      makeSeed("bnrm", DEFAULT_SCORING_OPTIONS, [], {
        playerNames: { A1: "", A2: "", B1: "", B2: "" },
      }),
    );

    const emptyStats = await invoke(getCourtStats, "/stats/bnrm");
    await assertSuccessfulResponseMatchesContract(
      contract,
      "/stats/{courtId}",
      emptyStats,
    );

    const events = makeEvents(["A", "A", "B", "A", "A"]);
    resetEnvironment(
      makeSeed("bnrm", DEFAULT_SCORING_OPTIONS, events, {
        playerNames: { A1: "Ann", A2: "Al", B1: "Bo", B2: "Bea" },
      }),
    );

    const populatedStats = await invoke(getCourtStats, "/stats/bnrm");
    await assertSuccessfulResponseMatchesContract(
      contract,
      "/stats/{courtId}",
      populatedStats,
    );
    expect(populatedStats.payload.totalPoints).toBe(5);
  });

  test("validates /momentum and preserves one-to-one marker alignment", async () => {
    const events = makeEvents(["A", "A", "B", "A", "A"]);
    resetEnvironment(makeSeed("bnrm", DEFAULT_SCORING_OPTIONS, events));

    const momentum = await invoke(getCourtMomentum, "/momentum/bnrm");
    await assertSuccessfulResponseMatchesContract(
      contract,
      "/momentum/{courtId}",
      momentum,
    );

    expect(momentum.payload.pointHistory).toEqual(["A", "A", "B", "A", "A"]);
    expect(momentum.payload.momentumTimeline).toHaveLength(5);
    expect(momentum.payload.gameMarkers).toEqual([5]);
    expect(momentum.payload.setPointMarkers).toEqual([]);
  });

  test("rejects an implementation payload with an incompatible enum", async () => {
    resetEnvironment(makeSeed("bnrm"));
    const response = await invoke(getCourtScore, "/score/bnrm");
    const brokenPayload = {
      ...response.payload,
      scoringMode: "unsupported-mode",
    };

    const result = contract.validateResponse(
      brokenPayload,
      getResponseSchema(contract.document, "/score/{courtId}"),
    );

    expect(result.valid).toBe(false);
  });
});
