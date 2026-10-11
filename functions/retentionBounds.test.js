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

test("delete-idempotency markers use the same overflow-safe archive before removal", async () => {
  const db = seed("tournament");
  const padding = crypto.randomBytes(MAX_DOCUMENT_BYTES - 192);
  db.write("tournamentCreations/request", { tournamentId: "victim", padding });
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

test("dense arrays account for protobuf expansion while preserving a resumable unlink", async () => {
  const db = seed();
  const data = { currentCourtId: "victim", flags: Array(600000).fill(true) };
  db.write("matches/dense", data);
  expect(protobufBytes(data, db)).toBeGreaterThan(valueBytes(data) * 3);
  await finish(db);
  expect(db.get("matches/dense").currentCourtId).toBeNull();
  const record = db
    .list(`${archiveBase()}/unlinks`)
    .find((entry) => entry.path === "matches/dense");
  const recovered = await readArchive(db, db.doc(`${archiveBase()}/unlinks/${record.id}`));
  expect(recovered.data.flags).toHaveLength(data.flags.length);
  expect(recovered.data.flags.every((flag) => flag === true)).toBe(true);
});

test("small source int64 values are archived from the SDK proto without numeric rounding", async () => {
  const db = new Firestore({ projectId: "demo-retention" });
  const integer = "9223372036854775807";
  const plan = planArchive(
    {
      data: () => ({ integer: Number(integer) }),
      toDocumentProto: () => ({ fields: { integer: { integerValue: integer } } }),
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
  const recovered = await readArchive(storage, storage.doc("archives/source"));
  expect(recovered.data.integer).toBe(BigInt(integer));
});

test("traversal persists bounded server pages and visits descendants of missing parents", async () => {
  const db = seed();
  for (let index = 0; index < 240; index++) {
    db.write(`courts/victim/children/${String(index).padStart(5, "0")}`, { index });
  }
  db.write("courts/victim/children/missing/deep/leaf", { preserved: true });
  await finish(db, { batchSize: 25 });
  expect(db.pages.length).toBeLessThan(30);
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
