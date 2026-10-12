const crypto = require("crypto");
const { Firestore, Timestamp, GeoPoint, VectorValue } = require("@google-cloud/firestore");
const { FakeFirestore } = require("./testSupport/fakeFirestore");
const { runRetentionWorker } = require("./services/retentionService");
const {
  retentionPaths: paths,
  GATE_PATH,
  ROOT_COLLECTIONS,
} = require("./services/retentionConfig");
const {
  MAX_DOCUMENT_BYTES,
  valueBytes,
  writeBytes: protobufBytes,
  planArchive,
  readArchive,
} = require("./services/retentionArchive");
const { createDocumentListing, createCollectionListing } = require("./services/retentionListing");

const hash = (path) => crypto.createHash("sha256").update(path).digest("hex");
const nameBytes = (path) =>
  path.split("/").reduce((sum, segment) => sum + Buffer.byteLength(segment) + 1, 16);
const documentBytes = (path, data) => nameBytes(path) + valueBytes(data);
const mapDepth = (value) => {
  if (
    !value ||
    typeof value !== "object" ||
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array
  ) {
    return 0;
  }
  return 1 + Object.values(value).reduce((depth, child) => Math.max(depth, mapDepth(child)), 0);
};

class BoundedFirestore extends FakeFirestore {
  constructor(docs) {
    super(docs);
    this.transactions = [];
    this.pages = [];
    this.collectionPages = [];
  }

  materialize(value) {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Buffer.from(value);
    return super.materialize(value);
  }

  snapshot(path) {
    if (this.transactionReads) this.transactionReads.add(path);
    const snapshot = super.snapshot(path);
    return {
      ...snapshot,
      data: () => {
        const data = snapshot.data();
        return data === undefined ? undefined : this.materialize(data);
      },
    };
  }

  async runTransaction(callback, options) {
    this.transactionReads = new Set();
    try {
      return await super.runTransaction(callback, options);
    } finally {
      this.transactionReads = null;
    }
  }

  commitOperations(ops) {
    const readBytes = [...(this.transactionReads || [])].reduce(
      (sum, path) => sum + (this.docs.has(path) ? protobufBytes(this.docs.get(path), this) : 0),
      0,
    );
    const writeBytes = ops.reduce(
      (sum, op) => sum + (op.data ? protobufBytes(op.data, this) : nameBytes(op.path)),
      0,
    );
    expect(ops.length).toBeLessThanOrEqual(500);
    expect(ops.filter((op) => op.type === "delete").length).toBeLessThanOrEqual(1);
    expect(readBytes + writeBytes).toBeLessThan(10 * 1024 * 1024);
    ops.forEach((op) => {
      if (!op.data) return;
      expect(documentBytes(op.path, op.data)).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
      expect(mapDepth(op.data) - 1).toBeLessThanOrEqual(20);
    });
    this.transactions.push({ readBytes, writeBytes, writes: ops.length });
    super.commitOperations(ops);
  }

  async retentionListDocuments({ collectionPath, pageSize, pageToken = "" }) {
    this.pages.push({ collectionPath, pageSize, pageToken });
    const candidates = this.childDocuments(collectionPath)
      .map((ref) => ref.path)
      .filter((path) => !pageToken || path > pageToken);
    const page = candidates.slice(0, pageSize);
    return {
      paths: page,
      nextPageToken: candidates.length > page.length ? page[page.length - 1] : "",
    };
  }

  async retentionListCollectionIds(options) {
    this.collectionPages.push(options);
    return super.retentionListCollectionIds(options);
  }
}

function seed(type = "court", phase = "archive") {
  const id = "victim";
  const allocationId = "generation";
  const victim = {
    index: 0,
    type,
    id,
    allocationId,
    sequence: 1,
    priorState: "live",
    archiveKey: `${id}_${allocationId}`,
    phase,
    unlinkSpec: 0,
    stack: null,
  };
  return new BoundedFirestore({
    [GATE_PATH]: { active: true, jobId: "bounds", types: [type] },
    [paths.job("bounds")]: { status: "processing", types: [type], nextVictim: 0, victimCount: 1 },
    [paths.victim("bounds", 0)]: victim,
    [paths.ledger(type)]: { live: 1, released: 0, culled: 0, cullJobId: "bounds" },
    [paths.allocation(type, id)]: { state: "culling", allocationId },
    [`${ROOT_COLLECTIONS[type]}/${id}`]: { allocationId },
  });
}

async function finish(db, options = {}) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const result = await runRetentionWorker({
      db,
      workerId: `restart-${attempt}`,
      maxSteps: 1,
      ...options,
    });
    if (result.status === "completed") return;
  }
  throw new Error("Bounded retention did not finish.");
}

const archiveBase = (type = "court") => paths.archive(type, "victim_generation");

test("large affected views are archived and rewritten in durable, byte-bounded steps", async () => {
  const db = seed();
  const padding = "é".repeat(200 * 1024);
  for (let index = 0; index < 40; index++) {
    const tournament = `t-${String(index).padStart(3, "0")}`;
    db.write(`tournaments/${tournament}/fixtures/f`, {
      courtId: "victim",
      courtAllocationId: "generation",
    });
    ["tournamentViews", "tournamentPrivateViews", "tournamentDirectory"].forEach((collection) => {
      db.write(`${collection}/${tournament}`, {
        padding,
        fixture: { courtId: "victim", courtAllocationId: "generation", courtName: "victim" },
      });
    });
  }
  await runRetentionWorker({ db, workerId: "first", maxSteps: 1 });
  await runRetentionWorker({ db, workerId: "second", maxSteps: 6 });
  expect(db.get(paths.victim("bounds", 0)).unlinkViews.paths.length).toBeGreaterThan(0);
  await finish(db);
  expect(db.get(GATE_PATH).active).toBe(false);
  for (let index = 0; index < 40; index++) {
    const tournament = `t-${String(index).padStart(3, "0")}`;
    for (const collection of ["tournamentViews", "tournamentPrivateViews", "tournamentDirectory"]) {
      const path = `${collection}/${tournament}`;
      expect(db.get(path).fixture).toEqual({
        courtId: null,
        courtAllocationId: null,
        courtName: null,
      });
      const record = db.list(`${archiveBase()}/unlinks`).find((entry) => entry.path === path);
      expect(record.before.fixture.courtId).toBe("victim");
    }
  }
  expect(Math.max(...db.transactions.map((tx) => tx.readBytes + tx.writeBytes))).toBeLessThan(
    10 * 1024 * 1024,
  );
});

test("a maximum-sized source and unlink preimage use reconstructable bounded payloads", async () => {
  const db = seed();
  const padding = crypto.randomBytes(MAX_DOCUMENT_BYTES - 192);
  db.write("courts/victim", { allocationId: "generation", padding });
  db.write("matches/linked", { currentCourtId: "victim", padding });
  expect(documentBytes("courts/victim", db.get("courts/victim"))).toBeLessThanOrEqual(
    MAX_DOCUMENT_BYTES,
  );
  await finish(db);
  const source = await readArchive(
    db,
    db.doc(`${archiveBase()}/documents/${hash("courts/victim")}`),
  );
  const unlink = db
    .list(`${archiveBase()}/unlinks`)
    .find((entry) => entry.path === "matches/linked");
  const before = await readArchive(db, db.doc(`${archiveBase()}/unlinks/${unlink.id}`));
  expect(Buffer.from(source.data.padding).equals(padding)).toBe(true);
  expect(Buffer.from(before.data.padding).equals(padding)).toBe(true);
  expect(before.data.currentCourtId).toBe("victim");
  expect(db.get("matches/linked").currentCourtId).toBeNull();
  expect(source.metadata.chunkCount).toBeGreaterThan(1);
  expect(before.metadata.chunkCount).toBeGreaterThan(1);
  for (const [path, data] of db.docs) {
    expect(documentBytes(path, data)).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
  }
});

test("maximum nesting is encoded without adding a Firestore map level", async () => {
  const db = seed();
  let deep = "original";
  for (let index = 0; index < 20; index++) deep = { nested: deep };
  db.write("courts/victim", { allocationId: "generation", deep });
  expect(mapDepth(db.get("courts/victim")) - 1).toBe(20);
  await finish(db);
  const recovered = await readArchive(
    db,
    db.doc(`${archiveBase()}/documents/${hash("courts/victim")}`),
  );
  expect(recovered.data.deep).toEqual(deep);
  expect(recovered.metadata.format).toBe("firestore-document-protobuf-v1");
});

test("overflow payloads round-trip native Firestore values and exact reference databases", async () => {
  const firestore = new Firestore({ projectId: "demo-retention", databaseId: "named" });
  const other = new Firestore({ projectId: "demo-other", databaseId: "different" });
  let deep = "force-chunk-format";
  for (let index = 0; index < 20; index++) deep = { nested: deep };
  const data = {
    deep,
    timestamp: new Timestamp(1700000000, 123456789),
    reference: firestore.doc("things/local"),
    foreignReference: other.doc("things/remote"),
    point: new GeoPoint(-33.125, 151.875),
    bytes: Buffer.from([0, 1, 127, 255]),
    vector: new VectorValue([1.25, -2.5]),
    integer: 9223372036854775807n,
    special: [NaN, Infinity, -Infinity, -0, null, true],
  };
  const plan = planArchive({ data: () => data }, firestore, { path: "things/original" });
  const records = new Map(
    plan.writes.map((write) => [`archives/source${write.suffix}`, write.data]),
  );
  const storage = {
    projectId: firestore.projectId,
    databaseId: firestore.databaseId,
    doc: (path) =>
      path.startsWith("archives/")
        ? { path, get: async () => ({ exists: records.has(path), data: () => records.get(path) }) }
        : firestore.doc(path),
    getAll: async (...refs) => Promise.all(refs.map((ref) => ref.get())),
  };
  const recovered = await readArchive(storage, storage.doc("archives/source"));
  expect(recovered.path).toBe("things/original");
  expect(recovered.data.timestamp.isEqual(data.timestamp)).toBe(true);
  expect(recovered.data.reference.isEqual(data.reference)).toBe(true);
  expect(recovered.data.foreignReference).toBeInstanceOf(data.foreignReference.constructor);
  expect(recovered.data.foreignReference.path).toBe(data.foreignReference.path);
  expect(recovered.data.foreignReference.firestore.projectId).toBe(other.projectId);
  expect(recovered.data.foreignReference.firestore.databaseId).toBe(other.databaseId);
  expect(recovered.data.point.isEqual(data.point)).toBe(true);
  expect(recovered.data.bytes.equals(data.bytes)).toBe(true);
  expect(recovered.data.vector.isEqual(data.vector)).toBe(true);
  expect(recovered.data.integer).toBe(data.integer);
  expect(recovered.data.special).toEqual(data.special);
});

test("live unlink rewrites and immutable preimages preserve real SDK snapshot values", async () => {
  const db = seed();
  const sdk = new Firestore({ projectId: "demo-retention", databaseId: "named" });
  const other = new Firestore({ projectId: "demo-other", databaseId: "different" });
  const native = {
    integer: 9223372036854775807n,
    safeInteger: 42,
    negativeInteger: -9223372036854775808n,
    timestamp: new Timestamp(1700000000, 123456789),
    reference: sdk.doc("things/local"),
    foreignReference: other.doc("things/remote"),
    point: new GeoPoint(-33.125, 151.875),
    bytes: Buffer.from([0, 1, 127, 255]),
    vector: new VectorValue([1.25, -2.5]),
    special: [NaN, Infinity, -Infinity, -0, null, true],
  };
  const data = {
    currentCourtId: "victim",
    nested: [{ courtId: "victim", courtAllocationId: "generation", native }],
    native,
  };
  const originalFields = sdk._serializer.encodeFields(data);
  const sources = [
    "matches/linked",
    "tournamentViews/owner",
    "tournamentPrivateViews/owner",
    "tournamentDirectory/owner",
  ];
  const fields = new Map(sources.map((path) => [path, originalFields]));
  sources.forEach((path) => db.write(path, { currentCourtId: "victim" }));
  db.write("tournaments/owner/fixtures/f", { courtId: "victim" });
  const snapshot = (path) =>
    sdk.snapshot_({
      name: `projects/${sdk.projectId}/databases/${sdk.databaseId}/documents/${path}`,
      fields: fields.get(path),
      createTime: { seconds: 1, nanos: 2 },
      updateTime: { seconds: 3, nanos: 4 },
    });
  expect(snapshot(sources[0]).data().native.integer).toBe(Number(native.integer));
  expect(snapshot(sources[0]).data().native.foreignReference.firestore.databaseId).toBe("named");

  // Use actual SDK snapshots for transaction reads and the SDK write batch's
  // validation/serialization for live writes, without an emulator or network.
  const runTransaction = db.runTransaction.bind(db);
  jest.spyOn(db, "runTransaction").mockImplementation(async (callback, options) => {
    let staged;
    const result = await runTransaction(async (tx) => {
      staged = new Map();
      return callback({
        ...tx,
        get: async (ref) => {
          const current = await tx.get(ref);
          return fields.has(ref.path) ? snapshot(ref.path) : current;
        },
        set: (ref, value, writeOptions) => {
          if (!fields.has(ref.path)) return tx.set(ref, value, writeOptions);
          const batch = sdk.batch().set(sdk.doc(ref.path), value);
          staged.set(ref.path, batch._ops[0].op().update.fields);
          return tx.set(ref, { currentCourtId: value.currentCourtId });
        },
      });
    }, options);
    staged.forEach((value, path) => fields.set(path, value));
    return result;
  });
  await finish(db);
  for (const path of sources) {
    const live = snapshot(path).data();
    expect(live.currentCourtId).toBeNull();
    expect(live.nested[0].courtId).toBeNull();
    expect(live.nested[0].courtAllocationId).toBeNull();
    expect(fields.get(path).native).toEqual(originalFields.native);
    expect(fields.get(path).nested.arrayValue.values[0].mapValue.fields.native).toEqual(
      originalFields.native,
    );
    const record = db.list(`${archiveBase()}/unlinks`).find((entry) => entry.path === path);
    const archived = await readArchive(db, db.doc(`${archiveBase()}/unlinks/${record.id}`));
    expect(archived.data.currentCourtId).toBe("victim");
    expect(archived.data.nested[0].courtId).toBe("victim");
    expect(archived.data.native.integer).toBe(native.integer);
    expect(archived.data.native.negativeInteger).toBe(native.negativeInteger);
    expect(archived.data.native.timestamp.isEqual(native.timestamp)).toBe(true);
    expect(archived.data.native.foreignReference.firestore.projectId).toBe(other.projectId);
    expect(archived.data.native.foreignReference.firestore.databaseId).toBe(other.databaseId);
    expect(archived.data.native.bytes.equals(native.bytes)).toBe(true);
    expect(archived.data.native.vector.isEqual(native.vector)).toBe(true);
  }
});

test.each(["match", "club"])(
  "%s read-model scans are durable and bounded even when current court pools no longer match",
  async (type) => {
    const db = seed(type);
    const courtField = type === "match" ? "activeMatchId" : "clubId";
    for (const court of ["court-a", "court-b"]) {
      db.write(`courts/${court}`, { [courtField]: court === "court-a" ? "victim" : "new" });
    }
    const padding = "é".repeat(200 * 1024);
    const collections = ["tournamentViews", "tournamentPrivateViews", "tournamentDirectory"];
    for (let index = 0; index < 30; index++) {
      const id = `owner-${String(index).padStart(3, "0")}`;
      db.write(`tournaments/${id}`, { courtPool: [], clubId: "other" });
      collections.forEach((collection) => {
        db.write(`${collection}/${id}`, {
          padding,
          courts: ["court-a", "court-b"].map((courtId) => ({ courtId, [courtField]: "victim" })),
        });
      });
    }
    const scanPages = [];
    let crashDiscovery = false;
    const runTransaction = db.runTransaction.bind(db);
    jest.spyOn(db, "runTransaction").mockImplementation((callback, options) =>
      runTransaction(
        (tx) =>
          callback({
            ...tx,
            get: async (target) => {
              const discovery = collections.includes(target.path) && !target.filters?.length;
              if (discovery && crashDiscovery) throw new Error("crash at scan cursor");
              const page = await tx.get(target);
              if (discovery) {
                scanPages.push({
                  count: page.size,
                  limit: target.limitCount,
                  after: target.startAfterValues,
                });
              }
              return page;
            },
          }),
        options,
      ),
    );
    const victimPath = paths.victim("bounds", 0);
    const firstWorker = {
      db,
      workerId: "before-crash",
      maxSteps: 1,
      batchSize: 1,
      leaseMs: 100,
      now: () => 1000,
    };
    for (let attempt = 0; attempt < 20; attempt++) {
      await runRetentionWorker(firstWorker);
      if (db.get("courts/court-a")[courtField] === null) break;
    }
    expect(db.get(victimPath).unlinkAfter ?? null).toBeNull();
    expect(db.get("courts/court-a")[courtField]).toBeNull();
    expect(db.get("courts/court-b")[courtField]).toBe("new");
    expect(scanPages).toHaveLength(0);
    expect(db.get("tournamentViews/owner-000").courts[0][courtField]).toBe("victim");
    for (let step = 0; step < 20; step++) {
      await runRetentionWorker({ ...firstWorker, workerId: "after-court-rewrite" });
      if (db.get(victimPath).unlinkAfter) break;
    }
    expect(db.get(victimPath).unlinkAfter).toBe("owner-000");
    expect(db.get(victimPath).unlinkViews).toEqual({
      specIndex: type === "match" ? 4 : 5,
      paths: ["tournamentViews/owner-000"],
    });
    expect(db.get(paths.allocation(type, "victim"))).toBeDefined();
    expect(db.get(GATE_PATH).active).toBe(true);
    await runRetentionWorker({ ...firstWorker, workerId: "after-scan-discovery" });
    expect(db.get(victimPath).unlinkViews).toBeNull();
    expect(db.get(victimPath).unlinkAfter).toBe("owner-000");
    expect(db.get("tournamentViews/owner-000").courts[0][courtField]).toBeNull();
    expect(db.get("tournamentPrivateViews/owner-000").courts[0][courtField]).toBe("victim");
    expect(db.get(paths.allocation(type, "victim"))).toBeDefined();
    const checkpoint = db.get(victimPath);
    expect(checkpoint.unlinkViews).toBeNull();
    crashDiscovery = true;
    await expect(runRetentionWorker({ ...firstWorker, workerId: "crashed" })).rejects.toThrow(
      "crash at scan cursor",
    );
    expect(db.get(victimPath)).toEqual(checkpoint);
    expect(
      await runRetentionWorker({ ...firstWorker, workerId: "too-early", now: () => 1050 }),
    ).toMatchObject({ status: "busy", steps: 0 });
    crashDiscovery = false;
    await finish(db, { batchSize: 1, now: () => 1101 });
    expect(scanPages.every((page) => page.count <= 1 && page.limit === 1)).toBe(true);
    expect(scanPages.some((page) => page.after)).toBe(true);
    expect(scanPages.length).toBe(93);
    for (let index = 0; index < 30; index++) {
      const id = `owner-${String(index).padStart(3, "0")}`;
      for (const collection of collections) {
        const path = `${collection}/${id}`;
        expect(db.get(path).courts.every((court) => court[courtField] === null)).toBe(true);
        const record = db.list(`${archiveBase(type)}/unlinks`).find((entry) => entry.path === path);
        expect(record.before.courts.every((court) => court[courtField] === "victim")).toBe(true);
      }
    }
    expect(db.get(paths.allocation(type, "victim"))).toBeUndefined();
    expect(db.get(GATE_PATH).active).toBe(false);
  },
);

test("delete-idempotency markers use the same overflow-safe archive before removal", async () => {
  const db = seed("tournament");
  const padding = crypto.randomBytes(MAX_DOCUMENT_BYTES - 192);
  db.write("tournamentCreations/request", { tournamentId: "victim", padding });
  for (let step = 0; step < 20; step++) {
    await runRetentionWorker({ db, workerId: "archive-marker", maxSteps: 1 });
    if (db.get(paths.victim("bounds", 0)).unlinkDelete) break;
  }
  expect(db.get(paths.victim("bounds", 0)).unlinkDelete).toBe("tournamentCreations/request");
  expect(db.get("tournamentCreations/request")).toBeDefined();
  expect(db.get(GATE_PATH).active).toBe(true);
  expect(
    db.get(`${archiveBase("tournament")}/documents/${hash("tournamentCreations/request")}`)
      .chunkCount,
  ).toBeGreaterThan(1);
  await finish(db);
  expect(db.get("tournamentCreations/request")).toBeUndefined();
  const recovered = await readArchive(
    db,
    db.doc(`${archiveBase("tournament")}/documents/${hash("tournamentCreations/request")}`),
  );
  expect(recovered.path).toBe("tournamentCreations/request");
  expect(recovered.data.tournamentId).toBe("victim");
  expect(recovered.data.padding.equals(padding)).toBe(true);
});

test("dense arrays budget protobuf expansion and use compact bounded preimages", () => {
  const db = new Firestore({ projectId: "demo-retention" });
  const data = { currentCourtId: "victim", flags: Array(600000).fill(true) };
  const wireBytes = protobufBytes(data, db);
  expect(wireBytes).toBeGreaterThan(valueBytes(data) * 3);
  const plan = planArchive({ data: () => data }, db, { path: "matches/dense" }, "before");
  expect(plan.writes[0].data.payloadCompression).toBe("deflate-raw");
  expect(plan.sourceBytes + wireBytes + plan.bytes).toBeGreaterThan(4 * 1024 * 1024);
  expect(plan.sourceBytes + wireBytes + plan.bytes).toBeLessThan(9 * 1024 * 1024);
  plan.writes.forEach((write) =>
    expect(documentBytes(`archives/dense${write.suffix}`, write.data)).toBeLessThanOrEqual(
      MAX_DOCUMENT_BYTES,
    ),
  );
});

test.each(["scalar", "nested"])(
  "small source int64 %s values are archived from the SDK proto without numeric rounding",
  async (shape) => {
    const db = new Firestore({ projectId: "demo-retention" });
    const integer = "9223372036854775807";
    const nested = shape === "nested";
    const data = nested ? { nested: [{ integer: Number(integer) }] } : { integer: Number(integer) };
    const fields = nested
      ? {
          nested: {
            arrayValue: {
              values: [{ mapValue: { fields: { integer: { integerValue: integer } } } }],
            },
          },
        }
      : { integer: { integerValue: integer } };
    const plan = planArchive(
      {
        data: () => data,
        toDocumentProto: () => ({ fields }),
      },
      db,
      { path: "things/original" },
    );
    const manifest = plan.writes[0].data;
    expect(manifest.format).toBe("firestore-document-protobuf-v1");
    const records = new Map(
      plan.writes.map((write) => [`archives/source${write.suffix}`, write.data]),
    );
    const storage = {
      doc: (path) => ({
        path,
        get: async () => ({ exists: records.has(path), data: () => records.get(path) }),
      }),
      getAll: async (...refs) => Promise.all(refs.map((ref) => ref.get())),
    };
    const recovered = await readArchive(storage, storage.doc("archives/source"), {
      useBigInt: true,
    });
    expect(nested ? recovered.data.nested[0].integer : recovered.data.integer).toBe(
      BigInt(integer),
    );
  },
);

test("archive field exemptions keep maximum-indexed sources from adding payload indexes", () => {
  const { fieldOverrides } = require("../firestore.indexes.json");
  const exemptions = (group) =>
    fieldOverrides
      .filter((override) => override.collectionGroup === group && override.indexes.length === 0)
      .map((override) => override.fieldPath);
  expect(exemptions("documents")).toContain("data");
  expect(exemptions("unlinks")).toContain("before");
  expect(exemptions("payload")).toContain("bytes");
  const leaves = (value, prefix = "") =>
    Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return child && Object.getPrototypeOf(child) === Object.prototype
        ? leaves(child, path)
        : [path];
    });
  const indexedEntries = (data, excluded = []) =>
    leaves(data).filter(
      (path) => !excluded.some((field) => path === field || path.startsWith(`${field}.`)),
    ).length * 2;
  const source = Object.fromEntries(
    Array.from({ length: 20000 }, (_, index) => [`f${String(index).padStart(5, "0")}`, true]),
  );
  expect(indexedEntries(source)).toBe(40000);
  const db = new Firestore({ projectId: "demo-retention" });
  for (const [group, field] of [
    ["documents", "data"],
    ["unlinks", "before"],
  ]) {
    const plan = planArchive(
      { data: () => source },
      db,
      { path: "courts/source", archivedAtMs: 1 },
      field,
    );
    const record = plan.writes[0].data;
    expect(record[field]).toBe(source);
    expect(indexedEntries(record)).toBeGreaterThan(40000);
    expect(indexedEntries(record, exemptions(group))).toBe(4);
  }
  expect(indexedEntries({ bytes: Buffer.alloc(256 * 1024) }, exemptions("payload"))).toBe(0);
});

test("traversal persists bounded server pages and visits descendants of missing parents", async () => {
  const db = seed();
  for (let index = 0; index < 240; index++) {
    db.write(`courts/victim/children/${String(index).padStart(5, "0")}`, { index });
  }
  db.write("courts/victim/children/missing/deep/leaf", { preserved: true });
  await finish(db, { batchSize: 25 });
  expect(db.pages.length).toBeLessThan(50);
  expect(db.pages.every((page) => page.pageSize <= 25)).toBe(true);
  expect(db.pages.some((page) => page.pageToken)).toBe(true);
  expect(db.list(`${archiveBase()}/documents`)).toHaveLength(242);
  expect([...db.docs.keys()].some((path) => path.startsWith("courts/victim/"))).toBe(false);
  const recovered = await readArchive(
    db,
    db.doc(`${archiveBase()}/documents/${hash("courts/victim/children/missing/deep/leaf")}`),
  );
  expect(recovered.data).toEqual({ preserved: true });
});

test("traversal also pages broad subcollection fanout without growing the durable stack", async () => {
  const db = seed();
  for (let index = 0; index < 100; index++) {
    db.write(`courts/victim/fanout-${String(index).padStart(3, "0")}/leaf`, { index });
  }
  await finish(db, { batchSize: 25 });
  const pages = db.collectionPages.filter((page) => page.documentPath === "courts/victim");
  expect(pages.length).toBeGreaterThan(2);
  expect(pages.some((page) => page.pageToken)).toBe(true);
  expect(db.collectionPages.every((page) => page.pageSize <= 25)).toBe(true);
  expect(db.list(`${archiveBase()}/documents`)).toHaveLength(101);
  expect([...db.docs.keys()].some((path) => path.startsWith("courts/victim/"))).toBe(false);
});

test("public v1 listing uses one missing-inclusive name-only page and the server cursor", async () => {
  const sdk = require("@google-cloud/firestore");
  const listDocuments = jest
    .fn()
    .mockResolvedValue([
      [{ name: "projects/demo-retention/databases/named/documents/roots/r/children/missing" }],
      null,
      { nextPageToken: "opaque-next" },
    ]);
  const listCollectionIds = jest
    .fn()
    .mockResolvedValue([["children"], null, { nextPageToken: "opaque-collections-next" }]);
  const constructor = jest
    .spyOn(sdk.v1, "FirestoreClient")
    .mockImplementation(() => ({ listDocuments, listCollectionIds }));
  try {
    const db = {
      projectId: "demo-retention",
      databaseId: "named",
    };
    const list = createDocumentListing(db);
    const result = await list({
      collectionPath: "roots/r/children",
      pageSize: 37,
      pageToken: "opaque-before",
    });
    expect(constructor).toHaveBeenCalledWith({ projectId: "demo-retention" });
    expect(listDocuments).toHaveBeenCalledWith(
      {
        parent: "projects/demo-retention/databases/named/documents/roots/r",
        collectionId: "children",
        pageSize: 37,
        pageToken: "opaque-before",
        showMissing: true,
        mask: { fieldPaths: [] },
      },
      { autoPaginate: false },
    );
    expect(result).toEqual({
      paths: ["roots/r/children/missing"],
      nextPageToken: "opaque-next",
    });
    const collections = await createCollectionListing(db)({
      documentPath: "roots/r",
      pageSize: 19,
      pageToken: "opaque-collections-before",
    });
    expect(listCollectionIds).toHaveBeenCalledWith(
      {
        parent: "projects/demo-retention/databases/named/documents/roots/r",
        pageSize: 19,
        pageToken: "opaque-collections-before",
      },
      { autoPaginate: false },
    );
    expect(collections).toEqual({
      ids: ["children"],
      nextPageToken: "opaque-collections-next",
    });
    expect(constructor).toHaveBeenCalledTimes(1);
  } finally {
    constructor.mockRestore();
  }
});
