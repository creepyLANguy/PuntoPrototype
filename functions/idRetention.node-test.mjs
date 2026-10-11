import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

const { FakeFirestore } = require("./testSupport/fakeFirestore.js");
const { createGuardedFirestore, runInOperationScope } = require("./infrastructure/dataGuard.js");
const { allocateId, ID_ALPHABET, runIdTransaction } = require("./services/ids.js");
const { accountRootDeletion, runRetentionWorker } = require("./services/retentionService.js");
const {
  ARCHIVE_COLLECTIONS,
  GATE_PATH,
  ROOT_COLLECTIONS,
  retentionPaths,
  resetRetentionPolicies,
  setRetentionPolicies,
} = require("./services/retentionConfig.js");

test.afterEach(() => resetRetentionPolicies());

function freshFirestore() {
  const raw = new FakeFirestore();
  return { raw, db: createGuardedFirestore(raw) };
}

function rootPath(type, id) {
  return `${ROOT_COLLECTIONS[type]}/${id}`;
}

function repeatedIds(type, count, offset = 0) {
  const length = { club: 4, court: 5, match: 6, tournament: 7 }[type];
  return Array.from({ length: count }, (_, index) => ID_ALPHABET[offset + index].repeat(length));
}

function randomSourceFor(...ids) {
  const queue = [...ids.join("")].map((letter) => {
    const index = ID_ALPHABET.indexOf(letter);
    assert.notEqual(index, -1, `Unknown ID letter ${letter}.`);
    return index;
  });
  return () => {
    assert.notEqual(queue.length, 0, "Random source exhausted.");
    return queue.shift();
  };
}

async function createAllocatedRoot(db, raw, type, id, data = {}) {
  const createdId = await runIdTransaction(db, async (tx) => {
    const candidate = await allocateId(tx, type, { db, randomInt: randomSourceFor(id) });
    assert.equal(candidate, id);
    tx.create(db.doc(rootPath(type, id)), data);
    return candidate;
  });
  assert.equal(createdId, id);
  const created = raw.get(rootPath(type, id));
  assert.equal(typeof created?.allocationId, "string");
  assert.ok(created.allocationId);
  return created;
}

async function finishWorker(raw, options = {}) {
  const result = await runRetentionWorker({
    db: raw,
    workerId: "worker",
    maxSteps: 1000,
    ...options,
  });
  assert.equal(result.status, "completed");
  return result;
}

function topLevelDocPaths(raw, collection) {
  const prefix = `${collection}/`;
  return [...raw.docs.keys()]
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
    .sort();
}

function archivePaths(raw, type, archiveKey) {
  return [...raw.docs.entries()]
    .filter(([path]) => path.startsWith(`${ARCHIVE_COLLECTIONS[type]}/${archiveKey}/documents/`))
    .map(([, value]) => value.path)
    .sort();
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("each managed type activates retention at its trigger and keeps only the newest target roots", async () => {
  const policies = {
    club: { trigger: 4, target: 2 },
    court: { trigger: 5, target: 2 },
    match: { trigger: 6, target: 2 },
    tournament: { trigger: 7, target: 2 },
  };

  for (const [type, policy] of Object.entries(policies)) {
    const { raw, db } = freshFirestore();
    setRetentionPolicies({ [type]: policy });
    const ids = repeatedIds(type, policy.trigger);
    for (const id of ids.slice(0, -1)) await createAllocatedRoot(db, raw, type, id);
    assert.equal(raw.get(GATE_PATH), undefined, `${type} should stay below its trigger.`);

    await createAllocatedRoot(db, raw, type, ids.at(-1));
    const gate = raw.get(GATE_PATH);
    assert.equal(gate.active, true);
    const job = raw.get(retentionPaths.job(gate.jobId));
    assert.deepEqual(job.plan[type], {
      cullCount: policy.trigger - policy.target,
      occupiedAtStart: policy.trigger,
    });

    await finishWorker(raw);

    assert.equal(raw.get(GATE_PATH).active, false);
    assert.deepEqual(
      raw
        .list(ROOT_COLLECTIONS[type])
        .map(({ id }) => id)
        .sort(),
      ids.slice(-policy.target).sort(),
    );
    assert.deepEqual(
      raw
        .list(retentionPaths.allocations(type))
        .map(({ id }) => id)
        .sort(),
      ids.slice(-policy.target).sort(),
    );
    assert.deepEqual(
      topLevelDocPaths(raw, ARCHIVE_COLLECTIONS[type])
        .map((path) => path.split("/")[1].split("_")[0])
        .sort(),
      ids.slice(0, policy.trigger - policy.target).sort(),
    );
    assert.match(raw.get(retentionPaths.ledger(type)).lastCullJobId, /.+/);
    assert.equal(raw.get(retentionPaths.ledger(type)).live, policy.target);
  }
});

test("a failed triggering allocation rolls back roots, gate and ledger accounting", async () => {
  const { raw, db } = freshFirestore();
  setRetentionPolicies({ match: { trigger: 2, target: 1 } });
  await createAllocatedRoot(db, raw, "match", "aaaaaa");

  await assert.rejects(
    runIdTransaction(db, async (tx) => {
      const id = await allocateId(tx, "match", { db, randomInt: randomSourceFor("bbbbbb") });
      tx.create(db.doc(rootPath("match", id)), { name: "should rollback" });
      tx.create(db.doc("admin/goodies"), { first: true });
      tx.create(db.doc("admin/goodies"), { second: true });
    }),
    /Document already exists: admin\/goodies/,
  );

  assert.equal(raw.get(GATE_PATH), undefined);
  assert.equal(raw.get(rootPath("match", "bbbbbb")), undefined);
  assert.equal(raw.get(retentionPaths.allocation("match", "bbbbbb")), undefined);
  assert.equal(raw.get(retentionPaths.ledger("match")).live, 1);
  assert.equal(raw.get(retentionPaths.ledger("match")).cullJobId, null);
});

test("archiving preserves descendants reachable only through missing ancestors", async () => {
  const { raw, db } = freshFirestore();
  setRetentionPolicies({ match: { trigger: 2, target: 1 } });
  const victim = "aaaaaa";
  const survivor = "bbbbbb";
  const created = await createAllocatedRoot(db, raw, "match", victim, { name: "oldest" });
  await raw.doc(`${rootPath("match", victim)}/events/e1`).set({ kind: "plain-event" });
  await raw.doc(`${rootPath("match", victim)}/events/ghost/audits/a1`).set({ kind: "deep-leaf" });

  await createAllocatedRoot(db, raw, "match", survivor, { name: "newest" });
  await finishWorker(raw);

  const archiveKey = `${victim}_${created.allocationId}`;
  assert.deepEqual(archivePaths(raw, "match", archiveKey), [
    rootPath("match", victim),
    `${rootPath("match", victim)}/events/e1`,
    `${rootPath("match", victim)}/events/ghost/audits/a1`,
  ]);
  assert.equal(
    raw.get(
      `${ARCHIVE_COLLECTIONS.match}/${archiveKey}/documents/${sha(`${rootPath("match", victim)}/events/ghost`)}`,
    ),
    undefined,
  );
  assert.equal(raw.get(rootPath("match", victim)), undefined);
  assert.equal(raw.get(`${rootPath("match", victim)}/events/e1`), undefined);
  assert.equal(raw.get(`${rootPath("match", victim)}/events/ghost/audits/a1`), undefined);
  assert.ok(raw.get(rootPath("match", survivor)));
});

test("reused ids create distinct archive roots across repeated culls", async () => {
  const { raw, db } = freshFirestore();
  setRetentionPolicies({ club: { trigger: 2, target: 1 } });

  const first = await createAllocatedRoot(db, raw, "club", "aaaa", { round: 1 });
  await createAllocatedRoot(db, raw, "club", "bbbb", { round: 1 });
  await finishWorker(raw);

  await createAllocatedRoot(db, raw, "club", "aaaa", { round: 2 });
  const second = raw.get(rootPath("club", "aaaa"));
  await finishWorker(raw);

  await createAllocatedRoot(db, raw, "club", "cccc", { round: 3 });
  await finishWorker(raw);

  const archives = topLevelDocPaths(raw, ARCHIVE_COLLECTIONS.club)
    .map((path) => path.split("/")[1])
    .filter((key) => key.startsWith("aaaa_"))
    .sort();
  assert.deepEqual(archives, [`aaaa_${first.allocationId}`, `aaaa_${second.allocationId}`].sort());
  assert.notEqual(first.allocationId, second.allocationId);
});

test("court culls unlink live references, nested values and tournament read models", async () => {
  const { raw, db } = freshFirestore();
  setRetentionPolicies({ court: { trigger: 2, target: 1 } });

  const victim = "aaaaa";
  const survivor = "eeeee";
  await createAllocatedRoot(db, raw, "court", victim, { name: "Old court" });
  await createAllocatedRoot(db, raw, "club", "bbbb", { courtIds: [victim, survivor] });
  await createAllocatedRoot(db, raw, "match", "cccccc", {
    currentCourtId: victim,
    lastCourtId: victim,
  });
  await createAllocatedRoot(db, raw, "tournament", "ddddddd", { courtPool: [victim, survivor] });
  await raw.doc("devices/device-1").set({ courtId: victim });
  await raw
    .doc("tournaments/ddddddd/fixtures/f1")
    .set({ courtId: victim, nested: { currentCourtId: victim } });
  await raw.doc("tournaments/ddddddd/participants/p1").set({
    assignedCourtIds: [victim, survivor],
    nested: { currentCourtId: victim },
  });
  await raw
    .doc("matches/cccccc/events/e1")
    .set({ courtId: victim, nested: { lastCourtId: victim } });
  await raw
    .doc("courts/eeeee/deviceEvents/de1")
    .set({ sourceCourtId: victim, targetCourtId: victim });
  await raw.doc("matches/cccccc/audits/a1").set({
    courtId: victim,
    beforeSummary: { courtId: victim },
    afterSummary: { courtId: victim },
  });
  await raw.doc("tournamentViews/ddddddd").set({
    nested: { currentCourtId: victim },
    courtPool: [victim, survivor],
  });
  await raw.doc("tournamentPrivateViews/ddddddd").set({
    rows: [{ assignedCourtIds: [victim, survivor] }],
  });
  await raw.doc("tournamentDirectory/ddddddd").set({
    currentCourtId: victim,
    courtIds: [victim, survivor],
  });

  await createAllocatedRoot(db, raw, "court", survivor, { name: "New court" });
  await finishWorker(raw);

  assert.deepEqual(raw.get("clubs/bbbb").courtIds, [survivor]);
  assert.deepEqual(raw.get("matches/cccccc"), {
    currentCourtId: null,
    lastCourtId: null,
    currentCourtAllocationId: null,
    lastCourtAllocationId: null,
    allocationId: raw.get("matches/cccccc").allocationId,
  });
  assert.deepEqual(raw.get("tournaments/ddddddd").courtPool, [survivor]);
  assert.equal(raw.get("devices/device-1").courtId, null);
  assert.equal(raw.get("tournaments/ddddddd/fixtures/f1").courtId, null);
  assert.equal(raw.get("tournaments/ddddddd/fixtures/f1").nested.currentCourtId, null);
  assert.deepEqual(raw.get("tournaments/ddddddd/participants/p1").assignedCourtIds, [survivor]);
  assert.equal(raw.get("tournaments/ddddddd/participants/p1").nested.currentCourtId, null);
  assert.equal(raw.get("matches/cccccc/events/e1").courtId, null);
  assert.equal(raw.get("matches/cccccc/events/e1").nested.lastCourtId, null);
  assert.equal(raw.get("courts/eeeee/deviceEvents/de1").sourceCourtId, null);
  assert.equal(raw.get("courts/eeeee/deviceEvents/de1").targetCourtId, null);
  assert.equal(raw.get("matches/cccccc/audits/a1").courtId, null);
  assert.equal(raw.get("matches/cccccc/audits/a1").beforeSummary.courtId, null);
  assert.equal(raw.get("matches/cccccc/audits/a1").afterSummary.courtId, null);
  assert.deepEqual(raw.get("tournamentViews/ddddddd"), {
    nested: { currentCourtId: null },
    courtPool: [survivor],
  });
  assert.deepEqual(raw.get("tournamentPrivateViews/ddddddd"), {
    rows: [{ assignedCourtIds: [survivor] }],
  });
  assert.deepEqual(raw.get("tournamentDirectory/ddddddd"), {
    currentCourtId: null,
    courtIds: [survivor],
  });
});

test("one-step workers recover expired leases and finish the same job", async () => {
  const { raw, db } = freshFirestore();
  setRetentionPolicies({ match: { trigger: 2, target: 1 } });
  await createAllocatedRoot(db, raw, "match", "aaaaaa");
  await createAllocatedRoot(db, raw, "match", "bbbbbb");

  const jobId = raw.get(GATE_PATH).jobId;
  raw.write(retentionPaths.job(jobId), {
    ...raw.get(retentionPaths.job(jobId)),
    status: "selecting",
    attempt: 1,
    lease: { owner: "stuck-worker", expiresAtMs: 200 },
  });

  let nowMs = 150;
  const blocked = await runRetentionWorker({
    db: raw,
    workerId: "worker-b",
    leaseMs: 50,
    maxSteps: 1,
    now: () => nowMs,
  });
  assert.deepEqual(blocked, { status: "busy", jobId, steps: 0 });

  nowMs = 250;
  let result = await runRetentionWorker({
    db: raw,
    workerId: "worker-c",
    leaseMs: 50,
    maxSteps: 1,
    now: () => nowMs,
  });
  assert.equal(result.status, "progress");

  for (let step = 0; step < 30 && result.status === "progress"; step++) {
    nowMs += 10;
    result = await runRetentionWorker({
      db: raw,
      workerId: step % 2 === 0 ? "worker-b" : "worker-c",
      leaseMs: 50,
      maxSteps: 1,
      now: () => nowMs,
    });
  }

  assert.equal(result.status, "completed");
  assert.equal(raw.get(GATE_PATH).active, false);
  assert.equal(raw.get(retentionPaths.job(jobId)).attempt > 1, true);
});

test("guarded writes reject stale generations after a culled id is reused", async () => {
  const { raw, db } = freshFirestore();
  setRetentionPolicies({ match: { trigger: 3, target: 1 } });
  const victim = "aaaaaa";
  await createAllocatedRoot(db, raw, "match", victim, { name: "original" });
  await createAllocatedRoot(db, raw, "match", "bbbbbb", { name: "middle" });

  let observed;
  let releaseWrite;
  const observedPromise = new Promise((resolve) => {
    observed = resolve;
  });
  const releasePromise = new Promise((resolve) => {
    releaseWrite = resolve;
  });
  const staleWrite = runInOperationScope(async () => {
    await db.doc(rootPath("match", victim)).get();
    observed();
    await releasePromise;
    return db.doc(rootPath("match", victim)).set({ name: "stale" }, { merge: true });
  });

  await observedPromise;
  await createAllocatedRoot(db, raw, "match", "cccccc", { name: "trigger" });
  await finishWorker(raw);
  await createAllocatedRoot(db, raw, "match", victim, { name: "replacement" });

  releaseWrite();
  await assert.rejects(
    staleWrite,
    (error) => error?.code === "ABORTED" && error?.details?.code === "STALE_GENERATION",
  );
  assert.equal(raw.get(rootPath("match", victim)).name, "replacement");
});

test("manual deletions retain allocation age and newer released reservations survive older live ones", async () => {
  const { raw, db } = freshFirestore();
  setRetentionPolicies({ court: { trigger: 5, target: 3 } });
  for (const id of ["aaaaa", "bbbbb", "ccccc", "ddddd"]) {
    await createAllocatedRoot(db, raw, "court", id, { name: id });
  }

  for (const id of ["bbbbb", "ccccc"]) {
    const deleted = raw.get(rootPath("court", id));
    await raw.doc(rootPath("court", id)).delete();
    assert.deepEqual(await accountRootDeletion("court", id, deleted, { db }), {
      status: "released",
    });
    assert.equal(raw.get(retentionPaths.allocation("court", id)).sequence, id === "bbbbb" ? 2 : 3);
  }

  await createAllocatedRoot(db, raw, "court", "eeeee", { name: "eeeee" });
  const jobId = raw.get(GATE_PATH).jobId;
  await finishWorker(raw);

  assert.deepEqual(
    raw
      .list("courts")
      .map(({ id }) => id)
      .sort(),
    ["ddddd", "eeeee"],
  );
  assert.deepEqual(
    [0, 1].map((index) => raw.get(retentionPaths.victim(jobId, index)).id),
    ["aaaaa", "bbbbb"],
  );
  assert.deepEqual(
    [0, 1].map((index) => raw.get(retentionPaths.victim(jobId, index)).sequence),
    [1, 2],
  );
  assert.deepEqual(
    raw
      .list(retentionPaths.allocations("court"))
      .map(({ id }) => id)
      .sort(),
    ["ccccc", "ddddd", "eeeee"],
  );
  assert.equal(raw.get(retentionPaths.allocation("court", "ccccc")).sequence, 3);
  assert.equal(raw.get(retentionPaths.allocation("court", "ccccc")).state, "released");
  assert.equal(raw.get(retentionPaths.ledger("court")).released, 1);
  assert.equal(raw.get(retentionPaths.ledger("court")).live, 2);
});

test("all managed types retain the newest reservations and archive/unlink older live and released assignments", async () => {
  const references = {
    club: { collection: "courts", field: "clubId" },
    court: { collection: "devices", field: "courtId" },
    match: { collection: "courts", field: "activeMatchId" },
    tournament: { collection: "matches", field: "tournamentId" },
  };
  for (const type of Object.keys(ROOT_COLLECTIONS)) {
    const { raw, db } = freshFirestore();
    setRetentionPolicies({ [type]: { trigger: 5, target: 3 } });
    const ids = repeatedIds(type, 5).reverse();
    const generations = [];
    for (const id of ids.slice(0, -1)) {
      generations.push(await createAllocatedRoot(db, raw, type, id, { name: id }));
    }
    const releasedVictim = ids[1];
    const releasedSurvivor = ids[3];
    const victimLeaf = `${rootPath(type, releasedVictim)}/events/missing/audits/leaf`;
    const survivorLeaf = `${rootPath(type, releasedSurvivor)}/events/kept`;
    await raw.doc(victimLeaf).set({ note: "archive this orphan" });
    await raw.doc(survivorLeaf).set({ note: "keep this reservation's descendants" });
    for (const index of [3, 1]) {
      await raw.doc(rootPath(type, ids[index])).delete();
      assert.deepEqual(await accountRootDeletion(type, ids[index], generations[index], { db }), {
        status: "released",
      });
      assert.equal(raw.get(retentionPaths.allocation(type, ids[index])).sequence, index + 1);
    }
    const { collection, field } = references[type];
    const generationField = field.replace(/Id$/, "AllocationId");
    await raw
      .doc(`${collection}/oldest-reference`)
      .set({ [field]: ids[0], [generationField]: generations[0].allocationId });
    await raw
      .doc(`${collection}/released-reference`)
      .set({ [field]: releasedVictim, [generationField]: generations[1].allocationId });
    await raw
      .doc(`${collection}/surviving-reference`)
      .set({ [field]: releasedSurvivor, [generationField]: generations[3].allocationId });
    if (type === "tournament") {
      await raw.doc(`tournamentSecrets/${releasedVictim}`).set({ secret: "old-sidecar" });
      await raw.doc(`tournamentSecrets/${releasedSurvivor}`).set({ secret: "keep-sidecar" });
    }

    await createAllocatedRoot(db, raw, type, ids[4]);
    const jobId = raw.get(GATE_PATH).jobId;
    assert.deepEqual(raw.get(retentionPaths.job(jobId)).plan[type], {
      cullCount: 2,
      occupiedAtStart: 5,
    });
    await finishWorker(raw, { batchSize: 1 });

    assert.deepEqual(
      raw
        .list(retentionPaths.allocations(type))
        .map(({ sequence }) => sequence)
        .sort(),
      [3, 4, 5],
    );
    assert.deepEqual(
      [0, 1].map((index) => raw.get(retentionPaths.victim(jobId, index)).id),
      ids.slice(0, 2),
    );
    assert.equal(raw.get(retentionPaths.ledger(type)).live, 2);
    assert.equal(raw.get(retentionPaths.ledger(type)).released, 1);
    assert.equal(raw.get(retentionPaths.ledger(type)).culled, 2);
    assert.equal(raw.get(retentionPaths.ledger(type)).sequence, 5);
    assert.equal(raw.get(rootPath(type, ids[0])), undefined);
    assert.equal(raw.get(victimLeaf), undefined);
    assert.ok(raw.get(rootPath(type, ids[2])));
    assert.ok(raw.get(rootPath(type, ids[4])));
    assert.ok(raw.get(survivorLeaf));
    assert.equal(raw.get(retentionPaths.allocation(type, releasedSurvivor)).state, "released");
    assert.equal(raw.get(`${collection}/oldest-reference`)[field], null);
    assert.equal(raw.get(`${collection}/released-reference`)[field], null);
    assert.equal(raw.get(`${collection}/oldest-reference`)[generationField], null);
    assert.equal(raw.get(`${collection}/released-reference`)[generationField], null);
    assert.equal(raw.get(`${collection}/surviving-reference`)[field], releasedSurvivor);
    assert.equal(
      raw.get(`${collection}/surviving-reference`)[generationField],
      generations[3].allocationId,
    );
    for (const [index, priorState] of ["live", "released"].entries()) {
      const key = `${ids[index]}_${generations[index].allocationId}`;
      const archive = raw.get(retentionPaths.archive(type, key));
      assert.equal(archive.sequence, index + 1);
      assert.equal(archive.priorState, priorState);
      assert.equal(archive.status, "complete");
      assert.equal(archive.rootExists, index === 0);
      assert.ok(raw.list(`${retentionPaths.archive(type, key)}/unlinks`).length);
      if (index === 0) assert.ok(archivePaths(raw, type, key).includes(rootPath(type, ids[0])));
      else assert.ok(archivePaths(raw, type, key).includes(victimLeaf));
    }
    if (type === "tournament") {
      assert.equal(raw.get(`tournamentSecrets/${releasedVictim}`), undefined);
      assert.ok(raw.get(`tournamentSecrets/${releasedSurvivor}`));
    }
    assert.deepEqual(await accountRootDeletion(type, releasedVictim, generations[1], { db }), {
      status: "stale",
    });
    assert.equal(raw.get(retentionPaths.ledger(type)).released, 1);
  }
});
