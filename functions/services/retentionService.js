// ID retention worker: resumable, exactly-once culling of the oldest IDs.
//
// A cull job is created atomically by the allocation that pushes a type's
// ledger to its trigger (services/ids.js). That same commit activates the
// global maintenance gate, so no live write, allocation or manual-delete
// accounting can interleave. The worker then:
//   select   pick the oldest occupied assignments by ledger sequence,
//            regardless of live/released state, up to the planned cull count;
//   archive  copy the root, every nested descendant (missing ancestors
//            included) and the tournament sidecars into CULLED_* under the
//            immutable {id}_{allocationId} key;
//   unlink   clear every stored reference to the victim (previous values are
//            kept in the archive's unlinks subcollection);
//   delete   remove the originals and all descendants;
//   release  delete the ledger record and decrement the ledger atomically;
// and finally clears the gate. Every step is a bounded transaction fenced by
// the job lease (owner + attempt), and all progress (cursors, traversal
// stacks, phases) is durable, so any worker can resume after a crash.
const crypto = require("crypto");
const {
  planArchive,
  writeArchive,
  snapshotBytes,
  writeBytes,
  decodeSnapshot,
} = require("./retentionArchive");
const { createDocumentListing, createCollectionListing } = require("./retentionListing");
const {
  ID_TYPES,
  ROOT_COLLECTIONS,
  TOURNAMENT_SIDECARS,
  GATE_PATH,
  retentionPaths,
  archiveKeyFor,
} = require("./retentionConfig");

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const MAX_STEP_BYTES = 4 * 1024 * 1024;
const MAX_UNIT_BYTES = 9 * 1024 * 1024;

class LeaseLostError extends Error {
  constructor(message = "The retention job lease was lost.") {
    super(message);
    this.name = "LeaseLostError";
  }
}

const SCRUB_KEYS = {
  court: {
    scalar: ["courtId", "currentCourtId", "lastCourtId", "sourceCourtId", "targetCourtId"],
    list: ["courtIds", "courtPool", "assignedCourtIds", "unavailableCourtIds"],
    // Display copies next to a cleared reference (view.js may store the id).
    companions: { courtId: ["courtName"] },
  },
  match: {
    scalar: ["matchId", "activeMatchId", "lastMatchId", "occupiedByMatchId"],
    list: ["matchIds"],
  },
  club: { scalar: ["clubId"], list: ["clubIds"], companions: { clubId: ["clubName"] } },
  tournament: { scalar: ["tournamentId"], list: ["tournamentIds"] },
};

const TOURNAMENT_VIEW_COLLECTIONS = [
  "tournamentViews",
  "tournamentPrivateViews",
  "tournamentDirectory",
];
const VIEW_SCAN_SPECS = TOURNAMENT_VIEW_COLLECTIONS.map((collection) => ({
  collection,
  scan: true,
}));

// Indexed references are cleared first. Read models are also scanned because
// their copied references can outlive the authoritative root/fixture links.
const UNLINK_SPECS = {
  court: [
    { collection: "matches", field: "currentCourtId" },
    { collection: "matches", field: "lastCourtId" },
    { collection: "devices", field: "courtId" },
    { collection: "clubs", field: "courtIds", array: true },
    { collection: "tournaments", field: "courtPool", array: true, views: true },
    { group: "fixtures", field: "courtId", views: true },
    { group: "participants", field: "assignedCourtIds", array: true, views: true },
    { group: "events", field: "courtId" },
    { group: "deviceEvents", field: "sourceCourtId" },
    { group: "deviceEvents", field: "targetCourtId" },
    { group: "audits", field: "courtId" },
    { group: "audits", field: "beforeSummary.courtId" },
    { group: "audits", field: "afterSummary.courtId" },
    ...VIEW_SCAN_SPECS,
  ],
  match: [
    { collection: "courts", field: "activeMatchId" },
    { collection: "courts", field: "lastMatchId" },
    { group: "fixtures", field: "matchId", views: true },
    { group: "audits", field: "matchId" },
    ...VIEW_SCAN_SPECS,
  ],
  tournament: [
    { collection: "matches", field: "tournamentId", alsoNull: ["roundId", "fixtureId"] },
    { collection: "tournamentCreations", field: "tournamentId", archiveDelete: true },
    { group: "audits", field: "tournamentId" },
    ...VIEW_SCAN_SPECS,
  ],
  club: [
    { collection: "courts", field: "clubId" },
    { collection: "devices", field: "clubId" },
    { collection: "tournaments", field: "clubId", views: true },
    { collection: "tournamentDirectory", field: "clubId", alsoNull: ["clubName"] },
    { group: "audits", field: "afterSummary.clubId" },
    ...VIEW_SCAN_SPECS,
  ],
};

function requireMethod(target, name, label) {
  if (!target || typeof target[name] !== "function") {
    throw new Error(`ID retention requires Firestore ${label}.${name}(); refusing to continue.`);
  }
}

function assertRetentionDb(db) {
  ["runTransaction", "doc", "collection", "collectionGroup", "getAll"].forEach((name) =>
    requireMethod(db, name, "db"),
  );
  requireMethod(db.doc(GATE_PATH), "listCollections", "DocumentReference");
  const collection = db.collection(retentionPaths.allocations("court"));
  ["listDocuments", "where", "orderBy", "startAfter", "limit"].forEach((name) =>
    requireMethod(collection, name, "CollectionReference"),
  );
}

const hashPath = (value) => crypto.createHash("sha256").update(value).digest("hex");

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  // Realm-independent: Timestamps, GeoPoints and references have longer
  // prototype chains and are kept verbatim.
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

function withoutUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function scrubValue(value, keys, id) {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const result = scrubValue(entry, keys, id);
      changed = changed || result.changed;
      return result.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (!isPlainObject(value)) return { value, changed: false };
  let changed = false;
  const next = {};
  const cleared = new Set();
  Object.entries(value).forEach(([key, entry]) => {
    if (keys.scalar.includes(key) && entry === id) {
      next[key] = null;
      changed = true;
      cleared.add(key.replace(/Id$/, "AllocationId"));
      (keys.companions?.[key] || []).forEach((companion) => cleared.add(companion));
    } else if (keys.list.includes(key) && Array.isArray(entry) && entry.includes(id)) {
      next[key] = entry.filter((item) => item !== id);
      changed = true;
    } else {
      const result = scrubValue(entry, keys, id);
      next[key] = result.value;
      changed = changed || result.changed;
    }
  });
  cleared.forEach((companion) => {
    if (companion in next) next[companion] = null;
  });
  return { value: changed ? next : value, changed };
}

function clearFieldPath(data, fieldPath, id, array) {
  const segments = fieldPath.split(".");
  let changed = false;
  const walk = (node, index) => {
    if (!isPlainObject(node)) return node;
    const key = segments[index];
    if (!(key in node)) return node;
    if (index < segments.length - 1) {
      const child = walk(node[key], index + 1);
      return child === node[key] ? node : { ...node, [key]: child };
    }
    if (array && Array.isArray(node[key]) && node[key].includes(id)) {
      changed = true;
      return { ...node, [key]: node[key].filter((entry) => entry !== id) };
    }
    if (!array && node[key] === id) {
      changed = true;
      return { ...node, [key]: null };
    }
    return node;
  };
  return { value: walk(data, 0), changed };
}

function unlinkData(data, type, id, spec) {
  let { value, changed } = scrubValue(data, SCRUB_KEYS[type], id);
  const explicit = clearFieldPath(value, spec.field, id, spec.array);
  value = explicit.value;
  changed = changed || explicit.changed;
  if (changed && spec.alsoNull) {
    value = { ...value };
    spec.alsoNull.forEach((field) => {
      if (field in value) value[field] = null;
    });
  }
  return { value, changed };
}

function rootPathOf(victim) {
  return `${ROOT_COLLECTIONS[victim.type]}/${victim.id}`;
}

function traversalSeeds(victim) {
  const seeds = [rootPathOf(victim)];
  if (victim.type === "tournament") {
    TOURNAMENT_SIDECARS.forEach((collection) => seeds.push(`${collection}/${victim.id}`));
  }
  // Processed last-in first-out: keep the root first.
  return seeds.reverse().map((path) => ({ k: "d", p: path }));
}

function tournamentOfPath(path) {
  const segments = path.split("/");
  if (segments[0] === "tournaments" && segments[1]) return segments[1];
  return null;
}

// Expands the durable depth-first traversal by at most `limit` units,
// returning the existing documents reached and the next stack. Missing
// ancestor documents are visited too (listDocuments reports them), so no
// nested subcollection is skipped.
async function expandTraversal(ctx, stack, limit, archive = false, documentLimit = limit) {
  const { db } = ctx;
  const next = stack.map((item) => ({ ...item }));
  const docs = [];
  let units = 0;
  let bytes = 0;
  while (next.length && units < limit && docs.length < documentLimit && bytes < MAX_STEP_BYTES) {
    const item = next.pop();
    units += 1;
    if (item.k === "d") {
      const ref = db.doc(item.p);
      const snapshot = await ref.get();
      const plan = snapshot.exists && archive ? archivePlan(snapshot, ctx) : null;
      const cost = snapshot.exists
        ? (plan?.sourceBytes ?? snapshotBytes(snapshot, db)) + (plan?.bytes || 0) + 16384
        : 0;
      if (docs.length && bytes + cost > MAX_STEP_BYTES) {
        next.push(item);
        break;
      }
      next.push({ k: "l", p: item.p, pageToken: "" });
      if (snapshot.exists) {
        docs.push(snapshot);
        bytes += cost;
      }
      continue;
    }
    if (item.k === "l") {
      const page = await ctx.listCollectionIdsPage({
        documentPath: item.p,
        pageSize: Math.max(
          1,
          Math.min(limit - units, Math.floor((128 * 1024) / (Buffer.byteLength(item.p) + 1501))),
        ),
        pageToken: item.pageToken || "",
      });
      if (page.nextPageToken) next.push({ ...item, pageToken: page.nextPageToken });
      page.ids
        .slice()
        .reverse()
        .forEach((id) => next.push({ k: "c", p: `${item.p}/${id}`, pageToken: "" }));
      continue;
    }
    const page = await ctx.listDocumentsPage({
      collectionPath: item.p,
      pageSize: Math.max(
        1,
        Math.min(limit - units, Math.floor((128 * 1024) / (Buffer.byteLength(item.p) + 1501))),
      ),
      pageToken: item.pageToken || "",
    });
    if (page.nextPageToken) next.push({ ...item, pageToken: page.nextPageToken });
    page.paths
      .slice()
      .reverse()
      .forEach((path) => next.push({ k: "d", p: path }));
  }
  return { docs, stack: next };
}

function createWorkerContext({
  db,
  workerId,
  batchSize = DEFAULT_BATCH_SIZE,
  leaseMs = DEFAULT_LEASE_MS,
  now = Date.now,
  listDocumentsPage,
  listCollectionIdsPage,
  listingClientOptions,
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 200) {
    throw new Error("Retention batchSize must be an integer from 1 to 200.");
  }
  return {
    db,
    workerId: workerId || `worker-${crypto.randomBytes(8).toString("hex")}`,
    batchSize,
    leaseMs,
    now,
    listDocumentsPage: createDocumentListing(db, { listDocumentsPage, listingClientOptions }),
    listCollectionIdsPage: createCollectionListing(db, {
      listCollectionIdsPage,
      listingClientOptions,
    }),
    jobId: null,
    attempt: null,
  };
}

const jobRef = (ctx) => ctx.db.doc(retentionPaths.job(ctx.jobId));

// Fenced step: re-reads the job inside the transaction and refuses to write
// unless this worker still holds the lease for this attempt.
async function fencedStep(ctx, body) {
  return ctx.db.runTransaction(async (tx) => {
    const jobSnap = await tx.get(jobRef(ctx));
    const job = jobSnap.exists ? jobSnap.data() : null;
    if (!job || job.attempt !== ctx.attempt || job.lease?.owner !== ctx.workerId) {
      throw new LeaseLostError();
    }
    const jobPatch = {};
    const result = await body(tx, job, jobPatch);
    tx.set(jobRef(ctx), {
      ...job,
      ...jobPatch,
      lease: { owner: ctx.workerId, expiresAtMs: ctx.now() + ctx.leaseMs },
      updatedAtMs: ctx.now(),
    });
    return result;
  });
}

async function acquireLease(ctx) {
  return ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(jobRef(ctx));
    if (!snapshot.exists) throw new Error(`Retention job ${ctx.jobId} is missing.`);
    const job = snapshot.data();
    if (job.status === "completed") return { acquired: false, job };
    const lease = job.lease;
    if (lease && lease.owner !== ctx.workerId && lease.expiresAtMs > ctx.now()) {
      return { acquired: false, job };
    }
    const attempt = (job.attempt || 0) + 1;
    tx.set(jobRef(ctx), {
      ...job,
      status: job.status === "pending" ? "selecting" : job.status,
      attempt,
      lease: { owner: ctx.workerId, expiresAtMs: ctx.now() + ctx.leaseMs },
      updatedAtMs: ctx.now(),
    });
    return { acquired: true, attempt };
  });
}

async function releaseLease(ctx) {
  await ctx.db.runTransaction(async (tx) => {
    const snapshot = await tx.get(jobRef(ctx));
    const job = snapshot.exists ? snapshot.data() : null;
    if (!job || job.attempt !== ctx.attempt || job.lease?.owner !== ctx.workerId) return;
    tx.set(jobRef(ctx), { ...job, lease: null, updatedAtMs: ctx.now() });
  });
}

function selectionState(job, type) {
  return {
    selected: 0,
    cursor: null,
    done: false,
    shortfall: 0,
    ...(job.selection?.[type] || {}),
  };
}

async function selectStep(ctx, job) {
  const type = job.types.find((candidate) => !selectionState(job, candidate).done);
  if (!type) {
    await fencedStep(ctx, async (_tx, _job, patch) => {
      patch.status = "processing";
    });
    return "progress";
  }
  const state = selectionState(job, type);
  const remaining = job.plan[type].cullCount - state.selected;
  const allocations = ctx.db.collection(retentionPaths.allocations(type));
  let candidates = [];
  let exhausted = false;
  const limit = Math.min(ctx.batchSize, Math.max(remaining, 0));
  if (limit > 0) {
    let query = allocations.orderBy("sequence");
    if (state.cursor !== null) query = query.startAfter(state.cursor);
    const snap = await query.limit(limit).get();
    candidates = snap.docs.map((doc) => doc.data());
    if (candidates.length < limit) exhausted = true;
    if (candidates.length) state.cursor = candidates[candidates.length - 1].sequence;
  }

  await fencedStep(ctx, async (tx, freshJob, patch) => {
    const recordRefs = candidates.map((record) =>
      ctx.db.doc(retentionPaths.allocation(type, record.id)),
    );
    const fresh = await Promise.all(recordRefs.map((ref) => tx.get(ref)));
    let victimCount = freshJob.victimCount || 0;
    let selected = state.selected;
    fresh.forEach((snapshot, index) => {
      const record = snapshot.exists ? snapshot.data() : null;
      if (!record || (record.state !== "live" && record.state !== "released")) return;
      if (selected >= freshJob.plan[type].cullCount) return;
      tx.set(recordRefs[index], {
        ...record,
        state: "culling",
        priorState: record.state,
        jobId: ctx.jobId,
      });
      tx.set(ctx.db.doc(retentionPaths.victim(ctx.jobId, victimCount)), {
        index: victimCount,
        type,
        id: record.id,
        allocationId: record.allocationId,
        sequence: record.sequence,
        priorState: record.state,
        archiveKey: archiveKeyFor(record.id, record.allocationId),
        phase: "archive",
        stack: null,
        unlinkSpec: 0,
        unlinkAfter: null,
        documentCount: 0,
        unlinkCount: 0,
        deletedCount: 0,
      });
      victimCount += 1;
      selected += 1;
    });
    const nextState = { ...state, selected };
    if (selected >= freshJob.plan[type].cullCount) nextState.done = true;
    else if (exhausted) {
      // The ledger holds fewer records than planned; never loop forever.
      nextState.done = true;
      nextState.shortfall = freshJob.plan[type].cullCount - selected;
    }
    patch.selection = { ...(freshJob.selection || {}), [type]: nextState };
    patch.victimCount = victimCount;
  });
  return "progress";
}

function archiveMeta(victim, ctx, extra = {}) {
  return {
    type: victim.type,
    id: victim.id,
    allocationId: victim.allocationId,
    sequence: victim.sequence,
    priorState: victim.priorState,
    jobId: ctx.jobId,
    rootPath: rootPathOf(victim),
    archiveKey: victim.archiveKey,
    ...extra,
  };
}

function archivedDocument(snapshot, ctx) {
  return withoutUndefined({
    path: snapshot.ref.path,
    createTime: snapshot.createTime,
    updateTime: snapshot.updateTime,
    archivedAtMs: ctx.now(),
  });
}

function archivePlan(snapshot, ctx, metadata = archivedDocument(snapshot, ctx), field = "data") {
  return planArchive(snapshot, ctx.db, metadata, field);
}

async function archiveStep(ctx, victim, victimRef) {
  const stack = victim.stack || traversalSeeds(victim);
  const { docs, stack: nextStack } = await expandTraversal(ctx, stack, ctx.batchSize, true);
  await fencedStep(ctx, async (tx) => {
    const fresh = await tx.get(victimRef);
    if (fresh.data()?.phase !== "archive") return;
    const archiveRef = ctx.db.doc(retentionPaths.archive(victim.type, victim.archiveKey));
    const documents = retentionPaths.archiveDocuments(victim.type, victim.archiveKey);
    docs.forEach((snapshot) => {
      writeArchive(
        tx,
        ctx.db,
        `${documents}/${hashPath(snapshot.ref.path)}`,
        archivePlan(snapshot, ctx),
      );
      if (snapshot.ref.path === rootPathOf(victim)) {
        const rootAllocation = snapshot.data()?.allocationId ?? null;
        if (rootAllocation !== victim.allocationId) {
          throw new Error(`Root ${snapshot.ref.path} changed generation during its cull.`);
        }
      }
    });
    const documentCount = (victim.documentCount || 0) + docs.length;
    const rootSeen = docs.some((snapshot) => snapshot.ref.path === rootPathOf(victim));
    const done = nextStack.length === 0;
    tx.set(
      archiveRef,
      archiveMeta(victim, ctx, {
        status: done ? "archived" : "archiving",
        rootExists: Boolean(victim.rootExists || rootSeen),
        documentCount,
        unlinkCount: 0,
        startedAtMs: victim.archiveStartedAtMs || ctx.now(),
        archivedAtMs: done ? ctx.now() : null,
        completedAtMs: null,
      }),
    );
    tx.set(victimRef, {
      ...victim,
      archiveStartedAtMs: victim.archiveStartedAtMs || ctx.now(),
      rootExists: Boolean(victim.rootExists || rootSeen),
      documentCount,
      stack: done ? null : nextStack,
      phase: done ? "unlink" : "archive",
    });
  });
}

function unlinkQuery(ctx, spec, victim, limit) {
  const source = spec.group
    ? ctx.db.collectionGroup(spec.group)
    : ctx.db.collection(spec.collection);
  return source.where(spec.field, spec.array ? "array-contains" : "==", victim.id).limit(limit);
}

async function unlinkStep(ctx, victim, victimRef) {
  // Marker copies commit before their separately fenced deletion, whose
  // index-entry cost can dwarf the document's serialized payload.
  if (victim.unlinkDelete) {
    await fencedStep(ctx, async (tx) => {
      const fresh = await tx.get(victimRef);
      if (fresh.data()?.phase !== "unlink") return;
      tx.delete(ctx.db.doc(victim.unlinkDelete));
      tx.set(victimRef, { ...victim, unlinkDelete: null });
    });
    return;
  }
  if (victim.unlinkViews?.paths?.length) {
    await unlinkViewsStep(ctx, victim, victimRef);
    return;
  }
  const specs = UNLINK_SPECS[victim.type];
  const specIndex = victim.unlinkSpec || 0;
  if (specIndex >= specs.length) {
    await fencedStep(ctx, async (tx) => {
      const fresh = await tx.get(victimRef);
      if (fresh.data()?.phase !== "unlink") return;
      tx.set(victimRef, { ...victim, phase: "delete", stack: null });
    });
    return;
  }
  const spec = specs[specIndex];
  if (spec.scan) {
    await unlinkScanStep(ctx, victim, victimRef, spec, specIndex);
    return;
  }
  const pageSize = spec.archiveDelete
    ? 1
    : Math.max(1, Math.floor(ctx.batchSize / (spec.views ? 5 : 2)));
  const snap = await unlinkQuery(ctx, spec, victim, pageSize).get();
  const pagePaths = snap.docs.map((doc) => doc.ref.path);
  const paths = [];
  let plannedBytes = 0;
  for (const snapshot of snap.docs) {
    const plan = archivePlan(snapshot, ctx);
    const cost = plan.sourceBytes * (spec.archiveDelete ? 1 : 2) + plan.bytes + 16384;
    if (paths.length && plannedBytes + cost > MAX_STEP_BYTES) break;
    plannedBytes += cost;
    paths.push(snapshot.ref.path);
  }

  await fencedStep(ctx, async (tx) => {
    const fresh = await tx.get(victimRef);
    if (fresh.data()?.phase !== "unlink" || (fresh.data().unlinkSpec || 0) !== specIndex) return;
    const refs = paths.map((path) => ctx.db.doc(path));
    const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
    const archiveBase = retentionPaths.archive(victim.type, victim.archiveKey);
    let unlinked = 0;
    let deferred = pagePaths.length - paths.length;
    let bytes = 0;
    let writes = 2;
    const pendingViews = new Set();
    let pendingDelete = null;
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const before = decodeSnapshot(snapshot, ctx.db);
      const recordId = hashPath(`${specIndex}|${snapshot.ref.path}`);
      const { value, changed } = unlinkData(before, victim.type, victim.id, spec);
      if (!changed && !spec.archiveDelete) return;
      const plan = spec.archiveDelete
        ? archivePlan(snapshot, ctx)
        : archivePlan(
            snapshot,
            ctx,
            { path: snapshot.ref.path, field: spec.field, unlinkedAtMs: ctx.now() },
            "before",
          );
      const cost =
        plan.sourceBytes + plan.bytes + (spec.archiveDelete ? 0 : writeBytes(value, ctx.db));
      const budget = unlinked ? MAX_STEP_BYTES : MAX_UNIT_BYTES;
      if (bytes + cost > budget || writes + plan.writes.length + 1 > 450) {
        deferred += 1;
        return;
      }
      bytes += cost;
      writes += plan.writes.length + 1;
      if (spec.archiveDelete) {
        writeArchive(tx, ctx.db, `${archiveBase}/documents/${hashPath(snapshot.ref.path)}`, plan);
        pendingDelete = snapshot.ref.path;
        unlinked += 1;
        return;
      }
      writeArchive(tx, ctx.db, `${archiveBase}/unlinks/${recordId}`, plan);
      tx.set(refs[index], value);
      unlinked += 1;
      const tournamentId =
        spec.collection === "tournaments" ? snapshot.id : tournamentOfPath(snapshot.ref.path);
      if (spec.views && tournamentId) {
        TOURNAMENT_VIEW_COLLECTIONS.forEach((collection) =>
          pendingViews.add(`${collection}/${tournamentId}`),
        );
      }
    });
    // A short, fully processed page means the reference set is exhausted;
    // a page without any change (should not happen) also advances so a
    // malformed document can never hot-loop the worker.
    const advance = deferred === 0 && (pagePaths.length < pageSize || unlinked === 0);
    if (!unlinked && deferred)
      throw new Error("Retention unlink unit exceeds its transaction budget.");
    tx.set(victimRef, {
      ...victim,
      unlinkCount: (victim.unlinkCount || 0) + unlinked,
      unlinkSpec: advance ? specIndex + 1 : specIndex,
      unlinkViews: pendingViews.size ? { specIndex, paths: [...pendingViews] } : null,
      unlinkDelete: pendingDelete,
    });
  });
}

async function unlinkScanStep(ctx, victim, victimRef, spec, specIndex) {
  await fencedStep(ctx, async (tx) => {
    const fresh = await tx.get(victimRef);
    if (fresh.data()?.phase !== "unlink" || (fresh.data().unlinkSpec || 0) !== specIndex) return;
    let query = ctx.db.collection(spec.collection).orderBy("__name__").limit(1);
    if (victim.unlinkAfter) query = query.startAfter(victim.unlinkAfter);
    const page = await tx.get(query);
    const snapshot = page.docs[0];
    // Advancing the cursor and enqueuing its rewrite are one commit. The queue
    // drains before discovering another page or releasing the victim.
    tx.set(victimRef, {
      ...victim,
      unlinkSpec: snapshot ? specIndex : specIndex + 1,
      unlinkAfter: snapshot ? snapshot.id : null,
      unlinkViews: snapshot ? { specIndex, paths: [snapshot.ref.path] } : null,
    });
  });
}

async function unlinkViewsStep(ctx, victim, victimRef) {
  const pending = victim.unlinkViews;
  const paths = pending.paths.slice(0, 1);
  await fencedStep(ctx, async (tx) => {
    const fresh = await tx.get(victimRef);
    if (fresh.data()?.phase !== "unlink") return;
    const snapshots = await Promise.all(paths.map((path) => tx.get(ctx.db.doc(path))));
    const archiveBase = retentionPaths.archive(victim.type, victim.archiveKey);
    const archives = await Promise.all(
      paths.map((path) =>
        tx.get(ctx.db.doc(`${archiveBase}/unlinks/${hashPath(`${pending.specIndex}|${path}`)}`)),
      ),
    );
    let consumed = 0;
    let bytes = 0;
    let writes = 2;
    for (const [index, snapshot] of snapshots.entries()) {
      if (snapshot.exists) {
        const before = decodeSnapshot(snapshot, ctx.db);
        const { value, changed } = scrubValue(before, SCRUB_KEYS[victim.type], victim.id);
        if (changed) {
          const plan = archivePlan(
            snapshot,
            ctx,
            { path: snapshot.ref.path, field: "*", unlinkedAtMs: ctx.now() },
            "before",
          );
          const archive = archives[index];
          const archiveBytes = archive.exists ? snapshotBytes(archive, ctx.db) : plan.bytes;
          const archiveWrites = archive.exists ? 0 : plan.writes.length;
          const cost = plan.sourceBytes + archiveBytes + writeBytes(value, ctx.db);
          if (bytes + cost > MAX_UNIT_BYTES || writes + archiveWrites + 1 > 450) break;
          bytes += cost;
          writes += archiveWrites + 1;
          if (!archive.exists) {
            writeArchive(tx, ctx.db, archive.ref.path, plan);
          }
          tx.set(snapshot.ref, value);
        }
      }
      consumed += 1;
    }
    if (!consumed) throw new Error("Retention view unit exceeds its transaction budget.");
    const remaining = pending.paths.slice(consumed);
    tx.set(victimRef, {
      ...victim,
      unlinkViews: remaining.length ? { ...pending, paths: remaining } : null,
    });
  });
}

async function deleteStep(ctx, victim, victimRef) {
  const stack = victim.stack || traversalSeeds(victim);
  // A valid document can carry 8 MiB of index entries: delete only one per commit.
  const { docs, stack: nextStack } = await expandTraversal(ctx, stack, ctx.batchSize, false, 1);
  await fencedStep(ctx, async (tx) => {
    const fresh = await tx.get(victimRef);
    if (fresh.data()?.phase !== "delete") return;
    const rootPath = rootPathOf(victim);
    const rootIndex = docs.findIndex((snapshot) => snapshot.ref.path === rootPath);
    if (rootIndex >= 0) {
      const root = await tx.get(ctx.db.doc(rootPath));
      if (root.exists && (root.data()?.allocationId ?? null) !== victim.allocationId) {
        throw new Error(`Root ${rootPath} changed generation during its cull.`);
      }
    }
    docs.forEach((snapshot) => tx.delete(ctx.db.doc(snapshot.ref.path)));
    const done = nextStack.length === 0;
    tx.set(victimRef, {
      ...victim,
      deletedCount: (victim.deletedCount || 0) + docs.length,
      stack: done ? null : nextStack,
      phase: done ? "release" : "delete",
    });
  });
}

async function releaseStep(ctx, victim, victimRef) {
  await fencedStep(ctx, async (tx, job, patch) => {
    const recordRef = ctx.db.doc(retentionPaths.allocation(victim.type, victim.id));
    const ledgerRef = ctx.db.doc(retentionPaths.ledger(victim.type));
    const archiveRef = ctx.db.doc(retentionPaths.archive(victim.type, victim.archiveKey));
    const [fresh, record, ledger, archive] = await Promise.all([
      tx.get(victimRef),
      tx.get(recordRef),
      tx.get(ledgerRef),
      tx.get(archiveRef),
    ]);
    if (fresh.data()?.phase !== "release") return;
    const recordData = record.exists ? record.data() : null;
    const ledgerData = ledger.exists ? ledger.data() : {};
    const nextLedger = { ...ledgerData, updatedAtMs: ctx.now() };
    if (recordData && recordData.allocationId === victim.allocationId) {
      tx.delete(recordRef);
      if (victim.priorState === "released") {
        nextLedger.released = Math.max(0, (ledgerData.released || 0) - 1);
      } else {
        nextLedger.live = Math.max(0, (ledgerData.live || 0) - 1);
      }
      nextLedger.culled = (ledgerData.culled || 0) + 1;
      tx.set(ledgerRef, nextLedger);
    }
    tx.set(archiveRef, {
      ...(archive.exists ? archive.data() : archiveMeta(victim, ctx)),
      status: "complete",
      unlinkCount: victim.unlinkCount || 0,
      deletedCount: victim.deletedCount || 0,
      completedAtMs: ctx.now(),
    });
    tx.set(victimRef, { ...victim, phase: "done", completedAtMs: ctx.now() });
    patch.nextVictim = Math.max(job.nextVictim || 0, victim.index + 1);
  });
}

async function finalizeStep(ctx) {
  await fencedStep(ctx, async (tx, freshJob, patch) => {
    const gateRef = ctx.db.doc(GATE_PATH);
    const ledgerRefs = freshJob.types.map((type) => ctx.db.doc(retentionPaths.ledger(type)));
    const [gate, ...ledgers] = await Promise.all([
      tx.get(gateRef),
      ...ledgerRefs.map((ref) => tx.get(ref)),
    ]);
    ledgers.forEach((ledger, index) => {
      const data = ledger.exists ? ledger.data() : {};
      if (data.cullJobId !== ctx.jobId) return;
      tx.set(ledgerRefs[index], {
        ...data,
        cullJobId: null,
        lastCullJobId: ctx.jobId,
        updatedAtMs: ctx.now(),
      });
    });
    const gateData = gate.exists ? gate.data() : {};
    if (gateData.jobId === ctx.jobId) {
      tx.set(gateRef, {
        ...gateData,
        active: false,
        jobId: null,
        types: [],
        epoch: (gateData.epoch || 0) + 1,
        completedAtMs: ctx.now(),
        lastJobId: ctx.jobId,
      });
    }
    patch.status = "completed";
    patch.completedAtMs = ctx.now();
  });
}

async function runStep(ctx) {
  const jobSnap = await jobRef(ctx).get();
  const job = jobSnap.data();
  if (job.status === "completed") return "completed";
  if (job.status === "selecting" || job.status === "pending") return selectStep(ctx, job);
  const index = job.nextVictim || 0;
  if (index >= (job.victimCount || 0)) {
    await finalizeStep(ctx);
    return "completed";
  }
  const victimRef = ctx.db.doc(retentionPaths.victim(ctx.jobId, index));
  const victimSnap = await victimRef.get();
  if (!victimSnap.exists) throw new Error(`Retention victim ${index} is missing.`);
  const victim = victimSnap.data();
  if (victim.phase === "archive") await archiveStep(ctx, victim, victimRef);
  else if (victim.phase === "unlink") await unlinkStep(ctx, victim, victimRef);
  else if (victim.phase === "delete") await deleteStep(ctx, victim, victimRef);
  else if (victim.phase === "release") await releaseStep(ctx, victim, victimRef);
  else {
    await fencedStep(ctx, async (_tx, freshJob, patch) => {
      patch.nextVictim = Math.max(freshJob.nextVictim || 0, index + 1);
    });
  }
  return "progress";
}

// Runs the active cull job (if any) until it completes, the step budget or
// deadline is reached, or the lease is lost. Safe to run concurrently: only
// the lease holder writes, and every step is idempotent and fenced.
async function runRetentionWorker(options = {}) {
  const db = options.db || require("../infrastructure/firebase").rawDb;
  assertRetentionDb(db);
  const ctx = createWorkerContext({ ...options, db });
  const maxSteps = options.maxSteps ?? Number.POSITIVE_INFINITY;
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;

  const gateSnap = await db.doc(GATE_PATH).get();
  const gate = gateSnap.exists ? gateSnap.data() : null;
  if (!gate?.active || !gate.jobId) return { status: "idle", steps: 0 };
  ctx.jobId = gate.jobId;

  const lease = await acquireLease(ctx);
  if (!lease.acquired) {
    return {
      status: lease.job?.status === "completed" ? "completed" : "busy",
      jobId: ctx.jobId,
      steps: 0,
    };
  }
  ctx.attempt = lease.attempt;
  let steps = 0;
  try {
    while (steps < maxSteps && ctx.now() < deadlineMs) {
      const outcome = await runStep(ctx);
      steps += 1;
      if (outcome === "completed") return { status: "completed", jobId: ctx.jobId, steps };
    }
  } catch (error) {
    if (error instanceof LeaseLostError) return { status: "lease-lost", jobId: ctx.jobId, steps };
    throw error;
  }
  await releaseLease(ctx);
  return { status: "progress", jobId: ctx.jobId, steps };
}

// Manual deletes (club delete, client court delete, console): a live record
// becomes "released" — it still occupies its ID until the next cull archives
// leftovers and unlinks references — and the ledger moves the ID from live to
// released exactly once. Stale/duplicate trigger deliveries are no-ops.
async function accountRootDeletion(type, id, deletedData, { db } = {}) {
  if (!ID_TYPES.includes(type)) throw new Error(`Unknown ID type ${type}.`);
  if (!db) db = require("../infrastructure/firebase").db;
  const allocationId = deletedData?.allocationId ?? null;
  if (typeof allocationId !== "string" || !allocationId) return { status: "unmanaged" };
  const recordRef = db.doc(retentionPaths.allocation(type, id));
  const precheck = await recordRef.get();
  const precheckData = precheck.exists ? precheck.data() : null;
  if (!precheckData || precheckData.allocationId !== allocationId) return { status: "stale" };
  if (precheckData.state !== "live") return { status: precheckData.state };

  return db.runTransaction(async (tx) => {
    const ledgerRef = db.doc(retentionPaths.ledger(type));
    const rootRef = db.doc(`${ROOT_COLLECTIONS[type]}/${id}`);
    const [record, ledger, root] = await Promise.all([
      tx.get(recordRef),
      tx.get(ledgerRef),
      tx.get(rootRef),
    ]);
    const data = record.exists ? record.data() : null;
    if (!data || data.allocationId !== allocationId) return { status: "stale" };
    if (data.state !== "live") return { status: data.state };
    if (root.exists) return { status: "stale" };
    const nowMs = Date.now();
    tx.set(recordRef, {
      ...data,
      state: "released",
      releasedAtMs: nowMs,
    });
    const ledgerData = ledger.exists ? ledger.data() : { type, sequence: 0, live: 0, released: 0 };
    tx.set(ledgerRef, {
      ...ledgerData,
      live: Math.max(0, (ledgerData.live || 0) - 1),
      released: (ledgerData.released || 0) + 1,
      updatedAtMs: nowMs,
    });
    return { status: "released" };
  });
}

module.exports = {
  DEFAULT_BATCH_SIZE,
  UNLINK_SPECS,
  SCRUB_KEYS,
  LeaseLostError,
  runRetentionWorker,
  accountRootDeletion,
  scrubValue,
  unlinkData,
};
