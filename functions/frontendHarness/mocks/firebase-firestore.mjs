// Mock of https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js
// Backed by the shared in-memory store in ../mockFirestoreState.mjs.
import {
  firestoreState,
  SERVER_TIMESTAMP_SENTINEL,
  makeSnapshot,
  writeDoc,
  mergeDoc,
  deleteDocAt,
  nextAutoId,
  queryDocs,
} from "../mockFirestoreState.mjs";

export function getFirestore(app) {
  return { app, type: "mock-firestore" };
}

function buildPath(segments) {
  return segments
    .filter((segment) => segment !== undefined && segment !== null && segment !== "")
    .join("/");
}

export function doc(dbOrRef, ...segments) {
  const base = dbOrRef && dbOrRef.__path ? [dbOrRef.__path] : [];
  const path = buildPath([...base, ...segments]);
  return { __type: "doc", __path: path, id: path.split("/").pop(), path };
}

export function collection(dbOrRef, ...segments) {
  const base = dbOrRef && dbOrRef.__path ? [dbOrRef.__path] : [];
  const path = buildPath([...base, ...segments]);
  return { __type: "collection", __path: path, id: path.split("/").pop(), path };
}

export async function getDoc(docRef) {
  return makeSnapshot(docRef.__path, firestoreState.docs.get(docRef.__path));
}

// Equality filters only, which is all the app queries use. limit() is a no-op.
export function where(field, op, value) {
  if (op !== "==") throw new Error(`Unsupported mock where operator: ${op}`);
  return { __type: "where", field, value };
}

export function limit(count) {
  return { __type: "limit", count };
}

export function query(collectionRef, ...constraints) {
  return {
    __type: "query",
    __path: collectionRef.__path,
    filters: constraints.filter((constraint) => constraint.__type === "where"),
  };
}

export async function getDocs(collectionRef) {
  if (collectionRef.__type === "query") {
    if (firestoreState.failingCollections.has(collectionRef.__path)) {
      throw new Error(`Simulated read failure: ${collectionRef.__path}`);
    }
    return queryDocs(collectionRef.__path, collectionRef.filters);
  }
  const gate = firestoreState.readGates.get(collectionRef.__path);
  if (gate) await gate;
  if (firestoreState.failingCollections.has(collectionRef.__path)) {
    throw new Error(`Simulated read failure: ${collectionRef.__path}`);
  }
  const prefix = `${collectionRef.__path}/`;
  const docs = [];
  for (const [path, data] of firestoreState.docs.entries()) {
    if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
      docs.push(makeSnapshot(path, data));
    }
  }
  return {
    empty: docs.length === 0,
    size: docs.length,
    docs,
    forEach: (fn) => docs.forEach(fn),
  };
}

export async function setDoc(docRef, data, options = {}) {
  if (options.merge) {
    mergeDoc(docRef.__path, data);
  } else {
    writeDoc(docRef.__path, data);
  }
}

export async function updateDoc(docRef, data) {
  if (!firestoreState.docs.has(docRef.__path)) {
    throw new Error(`No document to update: ${docRef.__path}`);
  }
  mergeDoc(docRef.__path, data);
}

export async function deleteDoc(docRef) {
  deleteDocAt(docRef.__path);
}

export async function addDoc(collectionRef, data) {
  const id = nextAutoId();
  const path = `${collectionRef.__path}/${id}`;
  writeDoc(path, data);
  return { __type: "doc", __path: path, id, path };
}

export function onSnapshot(docRef, onNext, onError) {
  if (docRef.__type === "query") {
    const listener = { collectionPath: docRef.__path, filters: docRef.filters, onNext, onError };
    firestoreState.queryListeners.add(listener);
    queueMicrotask(() => {
      if (firestoreState.queryListeners.has(listener)) {
        onNext(queryDocs(docRef.__path, docRef.filters));
      }
    });
    return () => firestoreState.queryListeners.delete(listener);
  }
  const path = docRef.__path;
  let listeners = firestoreState.listeners.get(path);
  if (!listeners) {
    listeners = new Set();
    firestoreState.listeners.set(path, listeners);
  }

  const listener = { onNext, onError };
  listeners.add(listener);

  // The real SDK delivers the initial snapshot asynchronously.
  queueMicrotask(() => {
    if (listeners.has(listener)) {
      onNext(makeSnapshot(path, firestoreState.docs.get(path)));
    }
  });

  return () => {
    listeners.delete(listener);
  };
}

export function serverTimestamp() {
  return SERVER_TIMESTAMP_SENTINEL;
}

export function connectFirestoreEmulator(db, host, port) {
  return db;
}
