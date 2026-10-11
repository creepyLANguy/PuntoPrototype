// In-memory Firestore for service-level tests. Supports the Admin SDK surface
// the services use: doc get/set(merge)/create/update/delete/listCollections,
// collection and collection-group queries with where (dot paths)/orderBy/
// startAt/startAfter/limit, listDocuments (missing ancestors included),
// getAll, batches and transactions (reads must precede writes, as in
// production). Unsupported calls throw instead of being silently ignored.
const SERVER_TIMESTAMP = { __serverTimestamp: true };

function isServerTimestamp(value) {
  return Boolean(value && value.__serverTimestamp === true);
}

function fieldValue(data, field) {
  return String(field)
    .split(".")
    .reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), data);
}

function setFieldPath(target, field, value) {
  const keys = String(field).split(".");
  let node = target;
  keys.slice(0, -1).forEach((key) => {
    if (!node[key] || typeof node[key] !== "object" || Array.isArray(node[key])) node[key] = {};
    node = node[key];
  });
  node[keys[keys.length - 1]] = value;
}

function compareValues(left, right) {
  if (left === right) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (
    typeof left === "object" &&
    typeof right === "object" &&
    "seconds" in left &&
    "seconds" in right
  ) {
    return left.seconds - right.seconds || (left.nanoseconds || 0) - (right.nanoseconds || 0);
  }
  return left < right ? -1 : 1;
}

class FakeFirestore {
  constructor(initialDocs = {}) {
    this.docs = new Map();
    this.clock = 1000;
    this.autoId = 0;
    this.transactionAttempts = 0;
    Object.entries(initialDocs).forEach(([path, data]) =>
      this.docs.set(path, structuredClone(data)),
    );
  }

  tick() {
    this.clock += 1;
    return { seconds: this.clock, nanoseconds: 0 };
  }

  materialize(value) {
    if (isServerTimestamp(value)) return this.tick();
    if (Array.isArray(value)) return value.map((entry) => this.materialize(entry));
    if (value && typeof value === "object") {
      const out = {};
      Object.entries(value).forEach(([key, entry]) => {
        out[key] = this.materialize(entry);
      });
      return out;
    }
    return value;
  }

  write(path, data, options = {}) {
    if (data === undefined) throw new Error(`Cannot write undefined to ${path}`);
    JSON.stringify(data, (key, value) => {
      if (value === undefined) throw new Error(`Undefined field "${key}" written to ${path}`);
      return value;
    });
    const existing = this.docs.get(path);
    const next = {};
    Object.entries(data).forEach(([key, value]) => {
      next[key] = value?.__arrayRemove
        ? (existing?.[key] || []).filter((entry) => !value.__arrayRemove.includes(entry))
        : this.materialize(structuredClone(value));
    });
    this.docs.set(path, options?.merge && existing ? { ...existing, ...next } : next);
  }

  update(path, data) {
    const existing = this.docs.get(path);
    if (existing === undefined) {
      const error = new Error(`No document to update: ${path}`);
      error.code = 5;
      throw error;
    }
    const next = structuredClone(existing);
    Object.entries(data).forEach(([field, value]) => {
      const current = fieldValue(existing, field);
      setFieldPath(
        next,
        field,
        value?.__arrayRemove
          ? (current || []).filter((entry) => !value.__arrayRemove.includes(entry))
          : this.materialize(structuredClone(value)),
      );
    });
    this.docs.set(path, next);
  }

  commitOperations(ops) {
    const before = this.docs;
    const clock = this.clock;
    const writeCount = this.writes?.length;
    this.docs = new Map(before);
    try {
      for (const { type, path, data, options } of ops) {
        if (type === "create" && this.docs.has(path)) {
          const error = new Error(`Document already exists: ${path}`);
          error.code = 6;
          throw error;
        }
        if (type === "delete") this.docs.delete(path);
        else if (type === "update") this.update(path, data);
        else this.write(path, data, options);
      }
    } catch (error) {
      this.docs = before;
      this.clock = clock;
      if (writeCount !== undefined) this.writes.length = writeCount;
      throw error;
    }
  }

  doc(path) {
    const store = this;
    return {
      kind: "doc",
      path,
      id: path.split("/").pop(),
      get: async () => store.snapshot(path),
      set: async (data, options) => store.write(path, data, options),
      create: async (data) => store.commitOperations([{ type: "create", path, data }]),
      update: async (data) => store.commitOperations([{ type: "update", path, data }]),
      delete: async () => store.docs.delete(path),
      collection: (name) => store.collection(`${path}/${name}`),
      listCollections: async () => store.childCollections(path),
    };
  }

  childCollections(docPath) {
    const prefix = `${docPath}/`;
    const ids = new Set();
    [...this.docs.keys()].forEach((path) => {
      if (path.startsWith(prefix)) ids.add(path.slice(prefix.length).split("/")[0]);
    });
    return [...ids].sort().map((id) => this.collection(`${prefix}${id}`));
  }

  // Like the Admin SDK: includes "missing" documents that only have descendants.
  childDocuments(collectionPath) {
    const prefix = `${collectionPath}/`;
    const ids = new Set();
    [...this.docs.keys()].forEach((path) => {
      if (path.startsWith(prefix)) ids.add(path.slice(prefix.length).split("/")[0]);
    });
    return [...ids].sort().map((id) => this.doc(`${prefix}${id}`));
  }

  async retentionListDocuments({ collectionPath, pageSize, pageToken = "" }) {
    const refs = this.childDocuments(collectionPath).filter(
      (ref) => !pageToken || ref.path > pageToken,
    );
    const page = refs.slice(0, pageSize);
    return {
      paths: page.map((ref) => ref.path),
      nextPageToken: refs.length > page.length ? page[page.length - 1].path : "",
    };
  }

  async retentionListCollectionIds({ documentPath, pageSize, pageToken = "" }) {
    const collections = this.childCollections(documentPath).filter(
      (collection) => !pageToken || collection.id > pageToken,
    );
    const page = collections.slice(0, pageSize);
    return {
      ids: page.map((collection) => collection.id),
      nextPageToken: collections.length > page.length ? page[page.length - 1].id : "",
    };
  }

  collectionGroup(collectionId) {
    return new FakeQuery(this, null, [], [], null, null, collectionId);
  }

  async getAll(...refs) {
    return refs.map((ref) => this.snapshot(ref.path));
  }

  snapshot(path) {
    const data = this.docs.get(path);
    return {
      exists: data !== undefined,
      id: path.split("/").pop(),
      ref: this.doc(path),
      data: () => (data === undefined ? undefined : structuredClone(data)),
    };
  }

  collection(path) {
    return new FakeQuery(this, path);
  }

  batch() {
    const ops = [];
    return {
      set: (ref, data, options) => ops.push({ type: "set", path: ref.path, data, options }),
      create: (ref, data) => ops.push({ type: "create", path: ref.path, data }),
      update: (ref, data) => ops.push({ type: "update", path: ref.path, data }),
      delete: (ref) => ops.push({ type: "delete", path: ref.path }),
      commit: async () => this.commitOperations(ops),
    };
  }

  async runTransaction(callback, { maxAttempts = 5 } = {}) {
    if (this.failNextTransaction) {
      const error = this.failNextTransaction;
      this.failNextTransaction = null;
      throw error;
    }
    let ops = [];
    let reads = [];
    const enqueue = (type, ref, data, options) => {
      ops.push({ type, path: ref.path, data, options });
    };
    // Like the Admin SDK, retries reuse this object and reset only attempt state.
    const tx = {
      get: async (target) => {
        if (ops.length) throw new Error("Transaction reads must happen before writes.");
        if (target.kind === "doc") {
          const snapshot = this.snapshot(target.path);
          const value = JSON.stringify(snapshot.data());
          reads.push(() => JSON.stringify(this.docs.get(target.path)) === value);
          return snapshot;
        }
        const fingerprint = () =>
          JSON.stringify(
            [...this.docs.entries()].filter(([path]) =>
              target.group
                ? target.inGroup(path)
                : path.startsWith(`${target.path}/`) &&
                  !path.slice(target.path.length + 1).includes("/"),
            ),
          );
        const value = fingerprint();
        const result = await target.get();
        reads.push(() => fingerprint() === value);
        return result;
      },
      set: (ref, data, options) => enqueue("set", ref, data, options),
      create: (ref, data) => enqueue("create", ref, data),
      update: (ref, data) => enqueue("update", ref, data),
      delete: (ref) => enqueue("delete", ref),
    };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      this.transactionAttempts += 1;
      ops = [];
      reads = [];
      try {
        const result = await callback(tx);
        if (reads.some((check) => !check())) continue;
        this.commitOperations(ops);
        return result;
      } catch (error) {
        if (error.code !== 10 || attempt + 1 === maxAttempts) throw error;
      }
    }
    const error = new Error("Transaction conflict retry limit exceeded.");
    error.code = 10;
    throw error;
  }

  // Test helpers
  get(path) {
    const data = this.docs.get(path);
    return data === undefined ? undefined : structuredClone(data);
  }

  list(collectionPath) {
    const prefix = `${collectionPath}/`;
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map(([path, data]) => ({ id: path.slice(prefix.length), ...structuredClone(data) }));
  }
}

class FakeQuery {
  constructor(
    db,
    path,
    filters = [],
    orders = [],
    startAtValues = null,
    limitCount = null,
    group = null,
  ) {
    this.kind = "query";
    this.db = db;
    this.path = path;
    this.filters = filters;
    this.orders = orders;
    this.startAtValues = startAtValues;
    this.startAfterValues = null;
    this.limitCount = limitCount;
    this.group = group;
  }

  get id() {
    return this.group || this.path.split("/").pop();
  }

  inGroup(path) {
    const segments = path.split("/");
    return segments.length % 2 === 0 && segments[segments.length - 2] === this.group;
  }

  clone(patch) {
    const next = new FakeQuery(
      this.db,
      this.path,
      this.filters,
      this.orders,
      this.startAtValues,
      this.limitCount,
      this.group,
    );
    next.startAfterValues = this.startAfterValues;
    return Object.assign(next, patch);
  }

  startAfter(...values) {
    return this.clone({ startAfterValues: values });
  }

  async listDocuments() {
    if (this.group) throw new Error("listDocuments is not available on collection groups.");
    return this.db.childDocuments(this.path);
  }

  where(field, op, value) {
    return this.clone({ filters: [...this.filters, { field, op, value }] });
  }

  orderBy(field, direction = "asc") {
    return this.clone({ orders: [...this.orders, { field, direction }] });
  }

  startAt(...values) {
    return this.clone({ startAtValues: values });
  }

  limit(count) {
    return this.clone({ limitCount: count });
  }

  doc(id) {
    if (this.group) throw new Error("Collection groups have no documents.");
    this.db.autoId += 1;
    return this.db.doc(`${this.path}/${id || `auto-${String(this.db.autoId).padStart(6, "0")}`}`);
  }

  async get() {
    const prefix = `${this.path}/`;
    let docs = [...this.db.docs.entries()]
      .filter(([path]) =>
        this.group
          ? this.inGroup(path)
          : path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
      )
      .map(([path, data]) => ({ id: path.split("/").pop(), path, data }));

    this.filters.forEach(({ field, op, value }) => {
      docs = docs.filter((doc) => {
        const actual = fieldValue(doc.data, field);
        if (op === "==") return actual === value;
        if (op === "in") return value.includes(actual);
        if (op === "array-contains") {
          return Array.isArray(actual) && actual.includes(value);
        }
        if (op === "array-contains-any") {
          return Array.isArray(actual) && actual.some((entry) => value.includes(entry));
        }
        throw new Error(`Unsupported operator ${op}`);
      });
    });

    if (this.orders.length) {
      // Firestore omits documents that lack an ordered field.
      docs = docs.filter((doc) =>
        this.orders.every(
          ({ field }) => field === "__name__" || fieldValue(doc.data, field) !== undefined,
        ),
      );
      docs.sort((left, right) => {
        for (const { field, direction } of this.orders) {
          const byId = field === "__name__";
          const comparison = compareValues(
            byId ? left.id : fieldValue(left.data, field),
            byId ? right.id : fieldValue(right.data, field),
          );
          if (comparison !== 0) return direction === "desc" ? -comparison : comparison;
        }
        return 0;
      });
    }

    if (this.startAtValues && this.orders.length) {
      const field = this.orders[0].field;
      docs = docs.filter((doc) => compareValues(doc.data[field], this.startAtValues[0]) >= 0);
    }
    if (this.startAfterValues && this.orders.length) {
      const { field, direction } = this.orders[0];
      docs = docs.filter((doc) => {
        const comparison = compareValues(
          field === "__name__" ? doc.id : fieldValue(doc.data, field),
          this.startAfterValues[0],
        );
        return direction === "desc" ? comparison < 0 : comparison > 0;
      });
    }
    if (typeof this.limitCount === "number") docs = docs.slice(0, this.limitCount);

    const wrapped = docs.map((doc) => ({
      id: doc.id,
      exists: true,
      ref: this.db.doc(doc.path),
      data: () => structuredClone(doc.data),
    }));
    return {
      docs: wrapped,
      size: wrapped.length,
      empty: wrapped.length === 0,
      forEach: (callback) => wrapped.forEach(callback),
    };
  }
}

module.exports = { FakeFirestore, SERVER_TIMESTAMP };
