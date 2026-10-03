// Runs the real club Cloud Functions (functions/callables/*Club.js and the
// member deletion triggers) against the harness's in-memory Firestore, so the
// frontend club tests exercise the real backend contract: request payloads,
// responses, validation errors and membership rules.
//
// The functions reach Firestore only through infrastructure/firebase.js; this
// module puts an Admin-SDK-shaped adapter over firestoreState in its place
// before loading them.
import Module, { createRequire } from "node:module";

import {
  callableHandlers,
  deleteDocAt,
  firestoreState,
  mergeDoc,
  SERVER_TIMESTAMP_SENTINEL,
  writeDoc,
} from "./mockFirestoreState.mjs";

const require = createRequire(import.meta.url);

const ARRAY_REMOVE = Symbol("arrayRemove");

const FieldValue = {
  serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  arrayRemove: (...values) => ({ [ARRAY_REMOVE]: values }),
};

function snapshot(path) {
  const data = firestoreState.docs.get(path);
  return {
    id: path.split("/").pop(),
    exists: data !== undefined,
    ref: docRef(path),
    data: () => (data === undefined ? undefined : structuredClone(data)),
  };
}

// Resolves arrayRemove sentinels against the stored document.
function resolveWrite(path, data) {
  const existing = firestoreState.docs.get(path) || {};
  const resolved = {};
  for (const [key, value] of Object.entries(data)) {
    resolved[key] =
      value && value[ARRAY_REMOVE]
        ? (Array.isArray(existing[key]) ? existing[key] : []).filter(
            (item) => !value[ARRAY_REMOVE].includes(item),
          )
        : value;
  }
  return resolved;
}

function applySet(path, data, options = {}) {
  const resolved = resolveWrite(path, data);
  if (options.merge) mergeDoc(path, resolved);
  else writeDoc(path, resolved);
}

function docRef(path) {
  return {
    kind: "doc",
    path,
    id: path.split("/").pop(),
    get: async () => snapshot(path),
    set: async (data, options) => applySet(path, data, options),
  };
}

function runQuery(collectionPath, filters) {
  const prefix = `${collectionPath}/`;
  const docs = [...firestoreState.docs.keys()]
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .filter((path) =>
      filters.every(({ field, op, value }) => {
        const list = firestoreState.docs.get(path)[field];
        if (!Array.isArray(list)) return false;
        if (op === "array-contains") return list.includes(value);
        if (op === "array-contains-any") {
          if (value.length > 30) throw new Error("array-contains-any supports at most 30 values");
          return value.some((item) => list.includes(item));
        }
        throw new Error(`unsupported query operator ${op}`);
      }),
    )
    .map(snapshot);
  return { docs, size: docs.length, forEach: (callback) => docs.forEach(callback) };
}

function collectionRef(path, filters = []) {
  return {
    kind: "query",
    where: (field, op, value) => collectionRef(path, [...filters, { field, op, value }]),
    get: async () => runQuery(path, filters),
  };
}

const adminDb = {
  doc: docRef,
  collection: (path) => collectionRef(path),
  // Reads see committed data; writes are applied together on commit, and a
  // read after the first write fails as it does in Firestore.
  async runTransaction(callback) {
    const writes = [];
    const tx = {
      get: async (target) => {
        if (writes.length > 0) throw new Error("Transactions require all reads before writes");
        return target.kind === "doc" ? snapshot(target.path) : target.get();
      },
      set: (ref, data, options) => writes.push(() => applySet(ref.path, data, options)),
      delete: (ref) => writes.push(() => deleteDocAt(ref.path)),
    };
    const result = await callback(tx);
    writes.forEach((write) => write());
    return result;
  },
};

function installFirebaseInfrastructure() {
  const path = require.resolve("../infrastructure/firebase.js");
  const stub = new Module(path);
  stub.filename = path;
  stub.loaded = true;
  stub.exports = { admin: {}, db: adminDb, FieldPath: {}, FieldValue };
  require.cache[path] = stub;
}

// Registers createClub / updateClub / deleteClub as callable handlers and the
// court / device deletion triggers as delete hooks. Returns a log of the
// callable requests made.
export function installClubBackend() {
  installFirebaseInfrastructure();
  const { createClub } = require("../callables/createClub.js");
  const { updateClub } = require("../callables/updateClub.js");
  const { deleteClub } = require("../callables/deleteClub.js");
  const { removeDeletedMember } = require("../services/clubService.js");

  const requests = [];
  const register = (name, handler) =>
    callableHandlers.set(name, async (data) => {
      requests.push([name, structuredClone(data)]);
      return { data: await handler({ data }) };
    });
  register("createClub", createClub);
  register("updateClub", updateClub);
  register("deleteClub", deleteClub);

  firestoreState.deleteHooks.add((path) => {
    const match = path.match(/^(courts|devices)\/([^/]+)$/);
    if (match) void removeDeletedMember(match[1], match[2]);
  });

  return requests;
}
