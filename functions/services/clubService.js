// Club persistence: creating, updating and deleting clubs/{clubId} and keeping
// the clubId of their courts and devices in step, all inside one transaction.
//
// Data model:
//   clubs/{clubId}      { name, courtIds[], deviceIds[], createdAt, updatedAt }
//   courts/{courtId}    { ..., clubId: string | null }
//   devices/{deviceId}  { ..., clubId: string | null }
//
// Every transaction reads the member documents it changes, so two concurrent
// saves that claim the same court or device are serialised by Firestore and
// the second one sees (and undoes) the first one's claim.
const { db, FieldValue } = require("../infrastructure/firebase");
const {
  ClubError,
  CLUB_STATES,
  MEMBER_KINDS,
  normalizeClubId,
  normalizeClubName,
  normalizeClubState,
  normalizeMemberIds,
  planMembershipChange,
} = require("../domain/clubs/membership");
const { allocateId, runIdTransaction } = require("./ids");
const { paths } = require("./firestorePaths");

const CLUBS_COLLECTION = "clubs";
// array-contains-any accepts at most 30 values per query.
const ARRAY_CONTAINS_ANY_LIMIT = 30;

function chunk(values, size) {
  const chunks = [];
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
  return chunks;
}

function clubRef(clubId) {
  return db.doc(paths.club(clubId));
}

function memberRef(kind, id) {
  return db.doc(kind === "courts" ? paths.court(id) : `devices/${id}`);
}

function listOf(data, field) {
  return Array.isArray(data?.[field]) ? data[field].filter((id) => typeof id === "string") : [];
}

// Reads everything one kind of membership change depends on and plans it.
// `knownClubs` (Map clubId -> data) collects every other club document read.
async function readAndPlanKind(tx, { kind, clubId, previousIds, nextIds, knownClubs }) {
  const { listField } = MEMBER_KINDS[kind];
  const ids = [...new Set([...previousIds, ...nextIds])];

  const snapshots = await Promise.all(ids.map((id) => tx.get(memberRef(kind, id))));
  const members = new Map(
    ids.map((id, i) => [id, snapshots[i].exists ? snapshots[i].data() : undefined]),
  );

  const holders = new Map();
  for (const batch of chunk(nextIds, ARRAY_CONTAINS_ANY_LIMIT)) {
    const query = db.collection(CLUBS_COLLECTION).where(listField, "array-contains-any", batch);
    const result = await tx.get(query);
    result.forEach((clubDoc) => {
      if (clubDoc.id === clubId) return;
      knownClubs.set(clubDoc.id, clubDoc.data());
      for (const id of listOf(clubDoc.data(), listField)) {
        if (!batch.includes(id)) continue;
        if (!holders.has(id)) holders.set(id, new Set());
        holders.get(id).add(clubDoc.id);
      }
    });
  }

  const plan = planMembershipChange({ clubId, previousIds, nextIds, members, holders });
  if (plan.missingIds.length > 0) {
    const label = MEMBER_KINDS[kind].label;
    throw new ClubError("not-found", `Unknown ${label} id(s): ${plan.missingIds.join(", ")}.`);
  }
  return plan;
}

async function readClosedClubEffects(tx, { clubId, previousState, nextState, courtIds }) {
  if (nextState !== CLUB_STATES.CLOSED || previousState === CLUB_STATES.CLOSED) {
    return { courts: [], tournaments: [], matches: new Map(), fixtures: new Map() };
  }

  const courtSnaps = await Promise.all(
    courtIds.map((courtId) => tx.get(memberRef("courts", courtId))),
  );
  const courts = courtSnaps
    .map((snap, index) => (snap.exists ? { courtId: courtIds[index], ...snap.data() } : null))
    .filter(Boolean);

  const tournamentSnap = await tx.get(db.collection("tournaments").where("clubId", "==", clubId));
  const tournaments = tournamentSnap.docs.map((snap) => ({
    tournamentId: snap.id,
    ...snap.data(),
  }));

  const matches = new Map();
  const fixtures = new Map();

  for (const tournament of tournaments) {
    const [matchSnap, fixtureSnap] = await Promise.all([
      tx.get(db.collection("matches").where("tournamentId", "==", tournament.tournamentId)),
      tx.get(db.collection(paths.tournamentFixtures(tournament.tournamentId))),
    ]);
    matchSnap.docs.forEach((snap) => {
      matches.set(snap.id, { matchId: snap.id, ...snap.data() });
    });
    fixtures.set(
      tournament.tournamentId,
      fixtureSnap.docs.map((snap) => ({ fixtureId: snap.id, ...snap.data() })),
    );
  }

  for (const court of courts) {
    const matchSnap = await tx.get(
      db.collection("matches").where("currentCourtId", "==", court.courtId),
    );
    matchSnap.docs.forEach((snap) => {
      matches.set(snap.id, { matchId: snap.id, ...snap.data() });
    });
  }

  return { courts, tournaments, matches, fixtures };
}

function applyClosedClubEffects(tx, effects, { clubId, clubName }) {
  if (!effects) return [];

  const closingCourtIds = new Set(effects.courts.map((court) => court.courtId));
  const cancelledTournamentIds = [];
  const tournamentIds = new Set(effects.tournaments.map((tournament) => tournament.tournamentId));

  for (const tournament of effects.tournaments) {
    const wasCancelled = tournament.status === "cancelled";
    const nextStatus = ["completed", "cancelled"].includes(tournament.status)
      ? tournament.status
      : "cancelled";
    const timestamp = FieldValue.serverTimestamp();

    if (!wasCancelled && nextStatus === "cancelled") {
      cancelledTournamentIds.push(tournament.tournamentId);
      tx.set(
        db.doc(paths.tournament(tournament.tournamentId)),
        {
          status: "cancelled",
          cancelledAt: timestamp,
          cancellationReason: `Club "${clubName || clubId}" was closed.`,
          revision: Number(tournament.revision || 0) + 1,
          updatedAt: timestamp,
        },
        { merge: true },
      );
    }

    tx.set(
      db.doc(paths.tournamentDirectory(tournament.tournamentId)),
      { status: nextStatus, clubId, clubName: null, updatedAt: timestamp },
      { merge: true },
    );
    tx.set(
      db.doc(paths.tournamentView(tournament.tournamentId)),
      { status: nextStatus, club: null, updatedAt: timestamp },
      { merge: true },
    );
    tx.set(
      db.doc(paths.tournamentPrivateView(tournament.tournamentId)),
      { status: nextStatus, club: null, updatedAt: timestamp },
      { merge: true },
    );
  }

  for (const court of effects.courts) {
    tx.set(
      memberRef("courts", court.courtId),
      { status: "closed", activeMatchId: null, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }

  const releasedOtherCourtIds = new Set();
  effects.matches.forEach((match) => {
    const tournamentCancelled = Boolean(
      match.tournamentId && tournamentIds.has(match.tournamentId),
    );
    const needsCancellation =
      tournamentCancelled && !["completed", "cancelled"].includes(match.status);
    const needsUnlink = match.currentCourtId && closingCourtIds.has(match.currentCourtId);

    if (!needsCancellation && !needsUnlink) return;

    const patch = { currentCourtId: null, updatedAt: FieldValue.serverTimestamp() };
    if (needsCancellation) {
      patch.status = "cancelled";
      patch.cancelledAt = FieldValue.serverTimestamp();
    }
    tx.set(db.doc(paths.match(match.matchId)), patch, { merge: true });

    if (match.currentCourtId && !closingCourtIds.has(match.currentCourtId)) {
      releasedOtherCourtIds.add(match.currentCourtId);
    }
  });

  for (const courtId of releasedOtherCourtIds) {
    tx.set(memberRef("courts", courtId), { activeMatchId: null }, { merge: true });
  }

  effects.fixtures.forEach((fixtureList, tournamentId) => {
    fixtureList.forEach((fixture) => {
      if (["completed", "cancelled", "bye"].includes(fixture.status)) return;
      tx.set(
        db.doc(`${paths.tournamentFixtures(tournamentId)}/${fixture.fixtureId}`),
        { status: "cancelled", updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
    });
  });

  return cancelledTournamentIds;
}

// Applies a full membership change for `clubId` (creating it when `isNew`).
async function saveClubInTransaction(tx, { clubId, isNew, name, state, courtIds, deviceIds }) {
  const ref = clubRef(clubId);
  const clubSnap = await tx.get(ref);

  if (!isNew && !clubSnap.exists) {
    throw new ClubError("not-found", `Club ${clubId} not found.`);
  }

  const existing = clubSnap.exists ? clubSnap.data() : {};
  const previousState = clubSnap.exists ? normalizeClubState(existing.state) : null;
  const nextState =
    state === undefined && clubSnap.exists
      ? normalizeClubState(existing.state)
      : normalizeClubState(state);
  const effectiveDeviceIds = nextState === CLUB_STATES.CLOSED ? [] : deviceIds;
  const knownClubs = new Map();
  const nextIdsByKind = { courts: courtIds, devices: effectiveDeviceIds };
  const plans = {};

  for (const kind of Object.keys(MEMBER_KINDS)) {
    plans[kind] = await readAndPlanKind(tx, {
      kind,
      clubId,
      previousIds: listOf(existing, MEMBER_KINDS[kind].listField),
      nextIds: nextIdsByKind[kind],
      knownClubs,
    });
  }

  // Other clubs that lose members. Clubs named only by a member's clubId are
  // read too, so every read happens before the first write.
  const otherClubIds = new Set(
    Object.values(plans).flatMap((plan) => [...plan.removeFromClubs.keys()]),
  );
  for (const otherClubId of otherClubIds) {
    if (knownClubs.has(otherClubId)) continue;
    const snap = await tx.get(clubRef(otherClubId));
    knownClubs.set(otherClubId, snap.exists ? snap.data() : undefined);
  }

  // All reads must happen before the first queued write in a Firestore transaction.
  const closureEffects = await readClosedClubEffects(tx, {
    clubId,
    previousState,
    nextState,
    courtIds: listOf(existing, MEMBER_KINDS.courts.listField),
  });
  const cancelledTournamentIds = applyClosedClubEffects(tx, closureEffects, {
    clubId,
    clubName: name,
  });

  const now = FieldValue.serverTimestamp();

  for (const otherClubId of otherClubIds) {
    const otherClub = knownClubs.get(otherClubId);
    if (!otherClub) continue;
    const update = { updatedAt: now };
    for (const kind of Object.keys(MEMBER_KINDS)) {
      const removed = plans[kind].removeFromClubs.get(otherClubId);
      if (!removed) continue;
      const { listField } = MEMBER_KINDS[kind];
      update[listField] = listOf(otherClub, listField).filter((id) => !removed.includes(id));
    }
    tx.set(clubRef(otherClubId), update, { merge: true });
  }

  for (const kind of Object.keys(MEMBER_KINDS)) {
    for (const id of plans[kind].assign) {
      tx.set(memberRef(kind, id), { clubId }, { merge: true });
    }
    for (const id of plans[kind].release) {
      tx.set(memberRef(kind, id), { clubId: null }, { merge: true });
    }
  }

  const savedClub = {
    name,
    courtIds,
    deviceIds: effectiveDeviceIds,
    state: nextState,
    updatedAt: now,
    ...(isNew ? { createdAt: now } : {}),
  };
  if (isNew) tx.create(ref, savedClub);
  else tx.set(ref, savedClub, { merge: true });

  const describeMoves = (plan) =>
    plan.moved.map(({ id, fromClubId }) => ({
      id,
      fromClubId,
      fromClubName: knownClubs.get(fromClubId)?.name || null,
    }));

  return {
    clubId,
    name,
    state: nextState,
    courtIds,
    deviceIds: effectiveDeviceIds,
    moved: {
      courts: describeMoves(plans.courts),
      devices: describeMoves(plans.devices),
    },
    closedTournamentIds: cancelledTournamentIds,
  };
}

function normalizeMembership({ courtIds, deviceIds }) {
  return {
    courtIds: normalizeMemberIds(courtIds, "courts"),
    deviceIds: normalizeMemberIds(deviceIds, "devices"),
  };
}

async function createClub(input = {}, allocationOptions = {}) {
  if (input.clubId !== undefined) {
    throw new ClubError("invalid-argument", "Club ids are allocated by the server.");
  }
  const name = normalizeClubName(input.name);
  const state = normalizeClubState(input.state);
  const membership = normalizeMembership(input);

  try {
    return await runIdTransaction(db, async (tx) => {
      const clubId = await allocateId(tx, "club", { ...allocationOptions, db });
      return saveClubInTransaction(tx, { clubId, isNew: true, name, state, ...membership });
    });
  } catch (error) {
    if (error.code === "ABORTED") throw new ClubError("aborted", error.message);
    throw error;
  }
}

async function updateClub(input = {}) {
  const clubId = normalizeClubId(input.clubId);
  const name = normalizeClubName(input.name);
  const state = input.state === undefined ? undefined : normalizeClubState(input.state);
  const membership = normalizeMembership(input);

  const result = await db.runTransaction((tx) =>
    saveClubInTransaction(tx, { clubId, isNew: false, name, state, ...membership }),
  );

  if (result?.closedTournamentIds?.length) {
    try {
      const { recalculateTournament } = require("./tournamentService");
      await Promise.allSettled(
        result.closedTournamentIds.map((tournamentId) =>
          recalculateTournament({ tournamentId, reason: "club-closed" }),
        ),
      );
    } catch (error) {
      console.error("Could not refresh closed-club tournament views:", error);
    }
  }

  return result;
}

async function deleteClub(input = {}) {
  const clubId = normalizeClubId(input.clubId);

  return db.runTransaction(async (tx) => {
    const ref = clubRef(clubId);
    const clubSnap = await tx.get(ref);
    if (!clubSnap.exists) {
      throw new ClubError("not-found", `Club ${clubId} not found.`);
    }

    const club = clubSnap.data();
    const releases = [];
    for (const kind of Object.keys(MEMBER_KINDS)) {
      const ids = listOf(club, MEMBER_KINDS[kind].listField);
      const snapshots = await Promise.all(ids.map((id) => tx.get(memberRef(kind, id))));
      snapshots.forEach((snap, i) => {
        if (snap.exists && snap.data().clubId === clubId) releases.push(memberRef(kind, ids[i]));
      });
    }

    for (const releaseRef of releases) {
      tx.set(releaseRef, { clubId: null }, { merge: true });
    }
    tx.delete(ref);

    return { clubId, releasedCount: releases.length };
  });
}

// Drops a deleted court or device from every club that lists it. Each club is
// updated in its own transaction that re-checks the member is still gone, so
// a delayed or retried delivery never unlinks a court id that was reused.
async function removeDeletedMember(kind, memberId) {
  normalizeMemberIds([memberId], kind);
  const { listField } = MEMBER_KINDS[kind];
  const clubs = await db
    .collection(CLUBS_COLLECTION)
    .where(listField, "array-contains", memberId)
    .get();

  const updates = [];
  clubs.forEach((clubDoc) => {
    updates.push(
      db.runTransaction(async (tx) => {
        const [member, club] = await Promise.all([
          tx.get(memberRef(kind, memberId)),
          tx.get(clubDoc.ref),
        ]);
        if (member.exists || !club.exists) return false;
        if (!(club.data()[listField] || []).includes(memberId)) return false;
        tx.set(
          clubDoc.ref,
          {
            [listField]: FieldValue.arrayRemove(memberId),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        return true;
      }),
    );
  });
  const results = await Promise.all(updates);
  return results.filter(Boolean).length;
}

module.exports = {
  CLUBS_COLLECTION,
  createClub,
  updateClub,
  deleteClub,
  removeDeletedMember,
};
