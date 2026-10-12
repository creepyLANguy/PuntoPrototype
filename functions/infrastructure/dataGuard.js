// Central write fence for every backend mutation.
//
// The Firestore singleton is wrapped so that every write — transaction,
// batch or single document write — commits inside a transaction that also:
//   1. reads the managed root (clubs|courts|matches|tournaments/{id}) of every
//      written path and refuses to recreate a vanished root through set/update
//      or to write descendants/sidecars of a missing root;
//   2. compares the root's immutable allocationId with the generation the
//      current operation observed earlier (AsyncLocalStorage scope), so a
//      delayed trigger or a slow request can never mutate a replaced root, nor
//      write a reference to one;
//   3. only lets a root be created through the server ID allocator.
//
// Writes inside transactions are deferred until the callback returns, so the
// guard's reads still precede every write as Firestore requires.
const { AsyncLocalStorage } = require("node:async_hooks");
const { staleGeneration, precondition } = require("../services/errors");
const { COLLECTIONS, consumeAllocatedRoot, validateId } = require("../services/ids");

const RAW = Symbol.for("padelpush.firestore.raw");
const GUARDED = Symbol.for("padelpush.firestore.guarded");
const scopes = new AsyncLocalStorage();

const ROOT_COLLECTION_NAMES = new Set(Object.values(COLLECTIONS));
const SIDECAR_NAMES = new Set([
  "tournamentViews",
  "tournamentPrivateViews",
  "tournamentDirectory",
  "tournamentSecrets",
]);

// Top-level reference fields: a write naming a root the operation observed
// must still see that root's generation.
const REFERENCE_FIELDS = {
  courtId: "courts",
  currentCourtId: "courts",
  lastCourtId: "courts",
  sourceCourtId: "courts",
  targetCourtId: "courts",
  activeMatchId: "matches",
  lastMatchId: "matches",
  matchId: "matches",
  occupiedByMatchId: "matches",
  clubId: "clubs",
  tournamentId: "tournaments",
};
const REFERENCE_LIST_FIELDS = { courtIds: "courts", courtPool: "courts" };

function rootOf(path) {
  const segments = String(path).split("/");
  if (segments.length < 2 || !segments[1]) return null;
  if (ROOT_COLLECTION_NAMES.has(segments[0])) {
    return { rootPath: `${segments[0]}/${segments[1]}`, isRoot: segments.length === 2 };
  }
  if (SIDECAR_NAMES.has(segments[0])) {
    return { rootPath: `tournaments/${segments[1]}`, isRoot: false };
  }
  return null;
}

function unwrap(value) {
  return (value && value[RAW]) || value;
}

function newScope() {
  return {
    observed: new Map(),
    pinned: new Set(),
    assignments: new Map(),
  };
}

function currentScope() {
  return scopes.getStore() || null;
}

// Runs fn in an operation scope (one per request/trigger delivery). Nested
// calls share the outer scope so generation observations span the operation.
function runInOperationScope(fn) {
  if (currentScope()) return fn();
  return scopes.run(newScope(), fn);
}

function withOperationScope(handler) {
  return (...args) =>
    runInOperationScope(() => {
      const expected = args[0]?.data?.expectedAllocations;
      currentScope().requested = Object.entries(COLLECTIONS)
        .filter(([type]) => args[0]?.data?.[`${type}Id`] != null)
        .map(([type, collection]) => `${collection}/${args[0].data[`${type}Id`]}`);
      currentScope().expected = new Set();
      if (expected) {
        for (const [type, entries] of Object.entries(expected)) {
          if (!Object.hasOwn(COLLECTIONS, type) || !entries || typeof entries !== "object") {
            throw precondition("Invalid expected allocations.");
          }
          for (const [id, allocationId] of Object.entries(entries)) {
            validateId(type, id);
            if (typeof allocationId !== "string" || !allocationId) {
              throw precondition("An allocation token is required.");
            }
            currentScope().observed.set(`${COLLECTIONS[type]}/${id}`, {
              exists: true,
              allocationId,
            });
            currentScope().expected.add(`${COLLECTIONS[type]}/${id}`);
          }
        }
      }
      return handler(...args);
    });
}

function stateOf(snapshot) {
  if (!snapshot || !snapshot.exists) return { exists: false, allocationId: null };
  const data = (typeof snapshot.data === "function" ? snapshot.data() : null) || {};
  return { exists: true, allocationId: data.allocationId ?? null };
}

function sameState(left, right) {
  return left.exists === right.exists && left.allocationId === right.allocationId;
}

// Stored assignments must fence even writes that do not name the assigned root,
// such as a device SKU update. Pin before reading the root or making any writes.
function pinRootGeneration(path, allocationId) {
  const scope = currentScope();
  if (!scope || !rootOf(path)?.isRoot) {
    throw precondition("A managed root and operation scope are required.");
  }
  if (typeof allocationId !== "string" || !allocationId) throw staleGeneration(path);
  const expected = { exists: true, allocationId };
  const observed = scope.observed.get(path);
  if (observed && !sameState(observed, expected)) throw staleGeneration(path);
  scope.observed.set(path, expected);
  scope.pinned.add(path);
}

function assignmentOf(data, exists = true) {
  return {
    exists,
    courtId: data?.courtId || null,
    courtAllocationId: data?.courtAllocationId ?? null,
  };
}

function sameAssignment(left, right) {
  return (
    left.exists === right.exists &&
    left.courtId === right.courtId &&
    left.courtAllocationId === right.courtAllocationId
  );
}

// A relocation may leave a missing source behind, but it must never overwrite
// a concurrent device reassignment based on an earlier device snapshot.
function pinDeviceAssignment(path, data) {
  const scope = currentScope();
  if (!scope || !/^devices\/[^/]+$/.test(path)) {
    throw precondition("A device and operation scope are required.");
  }
  const expected = assignmentOf(data);
  const observed = scope.assignments.get(path);
  if (observed && !sameAssignment(observed, expected)) throw staleGeneration(path);
  scope.assignments.set(path, expected);
}

// First observation wins: a later different generation is a reuse.
// Transaction reads stay attempt-local until that attempt commits, so a
// retried attempt never pins state that the retry has since moved past.
function observe(path, state, attempt) {
  const info = rootOf(path);
  if (!info || (!info.isRoot && !SIDECAR_NAMES.has(path.split("/")[0]))) return;
  path = info.rootPath;
  const target = attempt ? attempt.observed : currentScope()?.observed;
  if (target && !target.has(path)) target.set(path, state);
}

function referencedRoots(data) {
  const roots = new Set();
  if (!data || typeof data !== "object") return roots;
  for (const [field, collection] of Object.entries(REFERENCE_FIELDS)) {
    if (typeof data[field] === "string" && data[field]) roots.add(`${collection}/${data[field]}`);
  }
  for (const [field, collection] of Object.entries(REFERENCE_LIST_FIELDS)) {
    if (!Array.isArray(data[field])) continue;
    data[field].forEach((id) => {
      if (typeof id === "string" && id) roots.add(`${collection}/${id}`);
    });
  }
  return roots;
}

function createGuardedFirestore(raw) {
  if (!raw) return raw;
  if (raw[GUARDED]) return raw;

  function wrapDocSnapshot(snapshot, attempt) {
    if (!snapshot) return snapshot;
    const path = snapshot.ref?.path;
    if (path) observe(path, stateOf(snapshot), attempt);
    return new Proxy(snapshot, {
      get(target, prop) {
        if (prop === RAW) return target;
        if (prop === "ref") return target.ref ? wrapRef(target.ref) : target.ref;
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  function wrapQuerySnapshot(snapshot, attempt) {
    const docs = (snapshot.docs || []).map((doc) => wrapDocSnapshot(doc, attempt));
    return new Proxy(snapshot, {
      get(target, prop) {
        if (prop === RAW) return target;
        if (prop === "docs") return docs;
        if (prop === "forEach") return (callback, thisArg) => docs.forEach(callback, thisArg);
        if (prop === "size") return docs.length;
        if (prop === "empty") return docs.length === 0;
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  const QUERY_BUILDERS = new Set([
    "where",
    "orderBy",
    "limit",
    "limitToLast",
    "startAt",
    "startAfter",
    "endAt",
    "endBefore",
    "offset",
    "select",
  ]);

  function wrapQuery(query) {
    if (!query || query[RAW]) return query;
    return new Proxy(query, {
      get(target, prop) {
        if (prop === RAW) return target;
        if (QUERY_BUILDERS.has(prop)) {
          return (...args) => wrapQuery(target[prop](...args.map(unwrap)));
        }
        if (prop === "doc") return (...args) => wrapRef(target.doc(...args));
        if (prop === "get") return async () => wrapQuerySnapshot(await target.get());
        const value = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  function wrapRef(ref) {
    if (!ref || ref[RAW]) return ref;
    return new Proxy(ref, {
      get(target, prop) {
        if (prop === RAW) return target;
        switch (prop) {
          case "get":
            return async () => wrapDocSnapshot(await target.get());
          case "set":
            return (data, options) => writeOne("set", target, data, options);
          case "create":
            return (data) => writeOne("create", target, data);
          case "update":
            return (data) => writeOne("update", target, data);
          case "delete":
            return () => writeOne("delete", target);
          case "collection":
            return (name) => wrapQuery(target.collection(name));
          default: {
            const value = Reflect.get(target, prop, target);
            return typeof value === "function" ? value.bind(target) : value;
          }
        }
      },
    });
  }

  async function preflight(rawTx, attempt, scope) {
    const queue = attempt.queue;
    if (!queue.length) return;
    for (const path of scope?.requested || []) {
      if (!scope.expected.has(path))
        throw precondition("An expected allocation token is required.");
    }

    const rootPaths = new Set();
    queue.forEach((op) => {
      const info = rootOf(op.ref.path);
      if (info) rootPaths.add(info.rootPath);
    });
    const observedOf = (path) => scope?.observed.get(path) || attempt.observed.get(path);
    const referenced = new Set();
    queue.forEach((op) => {
      if (op.type === "delete") return;
      referencedRoots(op.data).forEach((path) => {
        referenced.add(path);
      });
    });
    const toRead = [
      ...new Set([
        ...rootPaths,
        ...referenced,
        ...(scope?.pinned || []),
        ...(scope?.assignments.keys() || []),
      ]),
    ];
    const snapshots = await Promise.all(toRead.map((path) => rawTx.get(raw.doc(path))));
    const current = new Map(toRead.map((path, index) => [path, stateOf(snapshots[index])]));
    const snapshotsByPath = new Map(toRead.map((path, index) => [path, snapshots[index]]));
    scope?.assignments.forEach((expected, path) => {
      const snapshot = snapshotsByPath.get(path);
      const assignment = assignmentOf(snapshot?.data(), snapshot?.exists === true);
      if (!sameAssignment(expected, assignment)) throw staleGeneration(path);
    });

    const createdRoots = new Map();
    queue.forEach((op) => {
      if (op.type !== "create") return;
      const info = rootOf(op.ref.path);
      if (info?.isRoot) createdRoots.set(op.ref.path, op.data?.allocationId);
    });

    const assertGeneration = (path) => {
      const observed = observedOf(path);
      if (observed && !createdRoots.has(path) && !sameState(observed, current.get(path))) {
        throw staleGeneration(path);
      }
    };

    queue.forEach((op) => {
      const info = rootOf(op.ref.path);
      if (!info) return;
      const { rootPath } = info;
      assertGeneration(rootPath);
      const state = current.get(rootPath);
      const createdHere = createdRoots.has(rootPath);

      if (info.isRoot) {
        if (op.type === "create") {
          if (!consumeAllocatedRoot(op.data, rootPath)) {
            throw precondition("Records must be created through server ID allocation.");
          }
          return;
        }
        if (op.type === "delete") return;
        if (!state.exists && !createdHere) {
          throw precondition("That record no longer exists.", { code: "ROOT_MISSING" });
        }
        const generation = createdHere ? createdRoots.get(rootPath) : state.allocationId;
        if (op.data && "allocationId" in op.data && op.data.allocationId !== generation) {
          throw precondition("A record's allocation id is immutable.");
        }
        // A full overwrite keeps the root's generation token.
        if (op.type === "set" && !op.options?.merge && generation && op.data) {
          op.data = { ...op.data, allocationId: generation };
        }
        return;
      }
      if (op.type !== "delete" && !state.exists && !createdHere) {
        throw precondition("That record no longer exists.", { code: "ROOT_MISSING" });
      }
    });
    referenced.forEach(assertGeneration);
    scope?.pinned.forEach(assertGeneration);
    queue.forEach((op) => {
      if (!op.data || op.type === "delete") return;
      const payload = { ...op.data };
      for (const [field, collection] of Object.entries(REFERENCE_FIELDS)) {
        if (!Object.hasOwn(payload, field)) continue;
        const id = payload[field];
        const tokenField = field.replace(/Id$/, "AllocationId");
        const path = `${collection}/${id}`;
        const allocationId =
          id == null ? null : createdRoots.get(path) || current.get(path)?.allocationId || null;
        if (
          id != null &&
          Object.hasOwn(payload, tokenField) &&
          payload[tokenField] !== allocationId
        ) {
          throw staleGeneration(path);
        }
        payload[tokenField] = allocationId;
      }
      const info = rootOf(op.ref.path);
      if (info && !info.isRoot && SIDECAR_NAMES.has(op.ref.path.split("/")[0])) {
        payload.allocationId =
          createdRoots.get(info.rootPath) || current.get(info.rootPath)?.allocationId;
      }
      op.data = payload;
    });
  }

  function flush(rawTx, queue) {
    queue.forEach((op) => {
      if (op.type === "set") {
        if (op.options === undefined) rawTx.set(op.ref, op.data);
        else rawTx.set(op.ref, op.data, op.options);
      } else if (op.type === "create") rawTx.create(op.ref, op.data);
      else if (op.type === "update") rawTx.update(op.ref, op.data);
      else rawTx.delete(op.ref);
    });
  }

  function afterCommit(attempt, scope) {
    if (!scope || !attempt) return;
    attempt.observed.forEach((state, path) => {
      if (!scope.observed.has(path)) scope.observed.set(path, state);
    });
    attempt.queue.forEach((op) => {
      if (scope.assignments.has(op.ref.path)) {
        const previous =
          op.type === "set" && !op.options?.merge ? {} : scope.assignments.get(op.ref.path);
        scope.assignments.set(
          op.ref.path,
          op.type === "delete"
            ? assignmentOf(null, false)
            : assignmentOf({ ...previous, ...op.data }),
        );
      }
      const info = rootOf(op.ref.path);
      if (!info?.isRoot) return;
      if (op.type === "create") {
        scope.observed.set(op.ref.path, {
          exists: true,
          allocationId: op.data?.allocationId ?? null,
        });
      } else if (op.type === "delete") {
        scope.observed.set(op.ref.path, { exists: false, allocationId: null });
      }
    });
  }

  function runTransaction(callback, options) {
    const scope = currentScope();
    const facades = new WeakMap();
    let committedAttempt = null;
    const run = raw.runTransaction(async (rawTx) => {
      const attempt = { queue: [], observed: new Map() };
      let facade = facades.get(rawTx);
      if (!facade) {
        const holder = {};
        facade = {
          get: async (target) => {
            if (holder.attempt.queue.length) {
              throw new Error("Transaction reads must happen before writes.");
            }
            const rawTarget = unwrap(target);
            const snapshot = await rawTx.get(rawTarget);
            return typeof rawTarget.where === "function"
              ? wrapQuerySnapshot(snapshot, holder.attempt)
              : wrapDocSnapshot(snapshot, holder.attempt);
          },
          set: (ref, data, setOptions) => {
            holder.attempt.queue.push({ type: "set", ref: unwrap(ref), data, options: setOptions });
            return facade;
          },
          create: (ref, data) => {
            holder.attempt.queue.push({ type: "create", ref: unwrap(ref), data });
            return facade;
          },
          update: (ref, data) => {
            holder.attempt.queue.push({ type: "update", ref: unwrap(ref), data });
            return facade;
          },
          delete: (ref) => {
            holder.attempt.queue.push({ type: "delete", ref: unwrap(ref) });
            return facade;
          },
          [GUARDED]: holder,
        };
        facades.set(rawTx, facade);
      }
      facade[GUARDED].attempt = attempt;
      const result = await callback(facade);
      await preflight(rawTx, attempt, scope);
      flush(rawTx, attempt.queue);
      committedAttempt = attempt;
      return result;
    }, options);
    return run.then((result) => {
      afterCommit(committedAttempt, scope);
      return result;
    });
  }

  function writeOne(type, ref, data, options) {
    return runTransaction(async (tx) => {
      if (type === "set") tx.set(ref, data, options);
      else if (type === "create") tx.create(ref, data);
      else if (type === "update") tx.update(ref, data);
      else tx.delete(ref);
    });
  }

  function batch() {
    const ops = [];
    const guardedBatch = {
      set: (ref, data, options) => {
        ops.push({ type: "set", ref, data, options });
        return guardedBatch;
      },
      create: (ref, data) => {
        ops.push({ type: "create", ref, data });
        return guardedBatch;
      },
      update: (ref, data) => {
        ops.push({ type: "update", ref, data });
        return guardedBatch;
      },
      delete: (ref) => {
        ops.push({ type: "delete", ref });
        return guardedBatch;
      },
      commit: () => {
        if (!ops.length) return Promise.resolve([]);
        return runTransaction(async (tx) => {
          ops.forEach((op) => {
            if (op.type === "set") tx.set(op.ref, op.data, op.options);
            else if (op.type === "create") tx.create(op.ref, op.data);
            else if (op.type === "update") tx.update(op.ref, op.data);
            else tx.delete(op.ref);
          });
        });
      },
    };
    return guardedBatch;
  }

  const guarded = new Proxy(raw, {
    get(target, prop) {
      switch (prop) {
        case RAW:
          return target;
        case GUARDED:
          return true;
        case "doc":
          return (path) => wrapRef(target.doc(path));
        case "collection":
          return (path) => wrapQuery(target.collection(path));
        case "collectionGroup":
          return (id) => wrapQuery(target.collectionGroup(id));
        case "batch":
          return batch;
        case "runTransaction":
          return runTransaction;
        default: {
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  });
  return guarded;
}

function unwrapFirestore(db) {
  return (db && db[RAW]) || db;
}

module.exports = {
  createGuardedFirestore,
  unwrapFirestore,
  unwrap,
  rootOf,
  runInOperationScope,
  withOperationScope,
  currentScope,
  pinRootGeneration,
  pinDeviceAssignment,
};
