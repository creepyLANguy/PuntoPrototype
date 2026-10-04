// Match lifecycle and court relationship (spec sections 6 and 42). Every
// multi-document transition runs in one Firestore transaction so a court has
// at most one active match and a live match at most one court.
const { db, FieldValue } = require("../infrastructure/firebase");
const { buildScoringOptions } = require("../domain/scoring/modes");
const { defaultScore, toLiveScorePayload, getMatchResult } = require("../domain/scoring/engine");
const {
  assertTransition,
  buildMatchDocument,
  buildScoreSummary,
  normalizeMatchName,
  normalizePlayerNames,
  normalizeTeamNames,
  resolveMatchTitle,
} = require("../domain/matches/lifecycle");
const { normalizeScoreVersion } = require("../domain/events/validation");
const { paths } = require("./firestorePaths");
const { newMatchId } = require("./ids");
const { writeAudit } = require("./auditService");
const { invalid, notFound, precondition } = require("./errors");

const now = () => FieldValue.serverTimestamp();

function courtLabel(court, courtId) {
  return court?.name ? court.name : `Court ${courtId}`;
}

function hasPoints(summary) {
  return (Number(summary?.A?.totalPoints) || 0) + (Number(summary?.B?.totalPoints) || 0) > 0;
}

function matchRef(matchId) {
  return db.doc(paths.match(matchId));
}

function courtRef(courtId) {
  return db.doc(paths.court(courtId));
}

async function readMatch(tx, matchId) {
  if (!matchId || typeof matchId !== "string") throw invalid("A match id is required.");
  const snap = await tx.get(matchRef(matchId));
  if (!snap.exists) throw notFound("That match could not be found.");
  return { matchId, ...snap.data() };
}

async function readCourt(tx, courtId) {
  if (!courtId || typeof courtId !== "string") throw invalid("A court id is required.");
  const snap = await tx.get(courtRef(courtId));
  if (!snap.exists) throw notFound(`Court ${courtId} could not be found.`);
  return { courtId, ...snap.data() };
}

// Builds the documents of a new match. Callers write them in their own
// transaction (tournament round generation creates many matches atomically).
function prepareMatch({
  matchId = newMatchId(),
  name = null,
  teamNames = {},
  playerNames = {},
  scoringOptions = {},
  kind = "casual",
  visibility = "public",
  tournamentId = null,
  roundId = null,
  fixtureId = null,
  status = "scheduled",
}) {
  const options = buildScoringOptions(scoringOptions);
  const timestamp = now();
  const match = buildMatchDocument({
    matchId,
    name,
    teamNames,
    playerNames,
    scoringOptions: options,
    kind,
    visibility,
    tournamentId,
    roundId,
    fixtureId,
    status,
    now: timestamp,
  });
  match.scoreSummary = buildScoreSummary(defaultScore(options));
  const score = {
    ...toLiveScorePayload(defaultScore(options)),
    lastProcessedEventId: null,
    lastProcessedCreatedAt: null,
  };
  return { matchId, match, score };
}

function writePreparedMatch(tx, prepared) {
  tx.set(matchRef(prepared.matchId), prepared.match);
  tx.set(db.doc(paths.matchScore(prepared.matchId)), prepared.score);
}

// Reads the court and anything occupying it. Must run in the read phase of
// the transaction. A placeholder casual match with no points is displaced
// silently; any other live occupant blocks the court unless the caller asks
// to displace a casual match.
async function planCourtAttachment(tx, { matchId, courtId, displace = false }) {
  const court = await readCourt(tx, courtId);
  if (court.status === "closed") {
    throw precondition(`${courtLabel(court, courtId)} is closed.`);
  }

  let displaced = null;
  if (court.activeMatchId && court.activeMatchId !== matchId) {
    const occupantSnap = await tx.get(matchRef(court.activeMatchId));
    const occupant = occupantSnap.exists
      ? { matchId: court.activeMatchId, ...occupantSnap.data() }
      : null;

    if (occupant && occupant.status === "live" && occupant.currentCourtId === courtId) {
      const scored = hasPoints(occupant.scoreSummary);
      if (occupant.tournamentId || (scored && !displace)) {
        throw precondition(
          `${courtLabel(court, courtId)} is already occupied by ${resolveMatchTitle(occupant)}.`,
          { occupiedByMatchId: occupant.matchId, courtId },
        );
      }
      displaced = { match: occupant, status: scored ? "completed" : "cancelled" };
    }
  }

  return { court, displaced };
}

function writeDisplacement(tx, displaced) {
  if (!displaced) return;
  const timestamp = now();
  tx.set(
    matchRef(displaced.match.matchId),
    {
      status: displaced.status,
      currentCourtId: null,
      updatedAt: timestamp,
      ...(displaced.status === "completed"
        ? {
            completedAt: timestamp,
            result: getMatchResult({
              ...(displaced.match.scoreSummary || {}),
              scoringOptions: displaced.match.scoringOptions,
            }),
          }
        : { cancelledAt: timestamp }),
    },
    { merge: true },
  );
}

function writeAttachment(tx, { match, court, resetOrientation }) {
  const timestamp = now();
  tx.set(
    courtRef(court.courtId),
    {
      activeMatchId: match.matchId,
      lastMatchId: match.matchId,
      ...(resetOrientation ? { beaconSidesSwapped: false } : {}),
    },
    { merge: true },
  );
  tx.set(
    matchRef(match.matchId),
    {
      status: "live",
      currentCourtId: court.courtId,
      lastCourtId: court.courtId,
      lastCourtName: court.name || court.courtId,
      startedAt: match.startedAt || timestamp,
      updatedAt: timestamp,
    },
    { merge: true },
  );
}

function writeCourtRelease(tx, courtId, matchId, courtData) {
  if (!courtId || !courtData || courtData.activeMatchId !== matchId) return;
  tx.set(courtRef(courtId), { activeMatchId: null }, { merge: true });
}

// Optional tournament side effects that must commit with the match change.
// Reads happen here (read phase); the returned writer runs in the write phase.
async function planTournamentEffects(tx, match) {
  if (!match.tournamentId || !match.fixtureId) return { write: () => {} };
  const tournamentRef = db.doc(paths.tournament(match.tournamentId));
  const tournamentSnap = await tx.get(tournamentRef);
  const tournament = tournamentSnap.exists ? tournamentSnap.data() : null;
  const fixtureRef = db.doc(`${paths.tournamentFixtures(match.tournamentId)}/${match.fixtureId}`);

  return {
    tournament,
    write: (fixturePatch) => {
      tx.set(fixtureRef, fixturePatch, { merge: true });
      if (fixturePatch.status === "live" && tournament && tournament.status === "published") {
        tx.set(
          tournamentRef,
          { status: "live", startedAt: now(), updatedAt: now() },
          { merge: true },
        );
      }
    },
  };
}

async function ensureCourtMatch({ courtId, actor = null }) {
  return db.runTransaction(async (tx) => {
    const court = await readCourt(tx, courtId);

    if (court.activeMatchId) {
      const activeSnap = await tx.get(matchRef(court.activeMatchId));
      const active = activeSnap.exists ? activeSnap.data() : null;
      if (active && active.status === "live" && active.currentCourtId === courtId) {
        return { matchId: court.activeMatchId, created: false };
      }
    }

    const prepared = prepareMatch({
      scoringOptions: { ...(court.scoringOptions || {}), scoringMode: court.scoringMode },
      kind: "casual",
      visibility: court.status === "private" ? "private" : "public",
      status: "live",
    });
    writePreparedMatch(tx, prepared);
    writeAttachment(tx, { match: prepared.match, court, resetOrientation: true });
    writeAudit(tx, {
      operation: "match.create",
      matchId: prepared.matchId,
      courtId,
      actor,
      afterSummary: { status: "live", kind: "casual" },
    });
    return { matchId: prepared.matchId, created: true };
  });
}

async function resolveCourtMatchId(courtId, { ensure = false } = {}) {
  const snap = await courtRef(courtId).get();
  if (!snap.exists) throw notFound(`Court ${courtId} could not be found.`);
  const court = snap.data() || {};
  if (court.activeMatchId) return court.activeMatchId;
  if (!ensure) return court.lastMatchId || null;
  const { matchId } = await ensureCourtMatch({ courtId });
  return matchId;
}

async function startMatch({ matchId, courtId, displace = false, actor = null, reason = null }) {
  const result = await db.runTransaction(async (tx) => {
    const match = await readMatch(tx, matchId);

    if (match.status === "live" && match.currentCourtId === courtId) {
      return { match, changed: false };
    }
    if (match.status === "live" && match.currentCourtId) {
      throw precondition(`This match is currently on court ${match.currentCourtId}.`, {
        currentCourtId: match.currentCourtId,
      });
    }
    if (match.status !== "live") assertTransition(match.status, "live");

    const plan = await planCourtAttachment(tx, { matchId, courtId, displace });
    const effects = await planTournamentEffects(tx, match);

    writeDisplacement(tx, plan.displaced);
    writeAttachment(tx, { match, court: plan.court, resetOrientation: match.status !== "live" });
    effects.write({ status: "live", courtId });
    writeAudit(tx, {
      operation: match.status === "live" ? "match.resume" : "match.start",
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      fixtureId: match.fixtureId,
      matchId,
      courtId,
      actor,
      reason,
      beforeSummary: { status: match.status, courtId: match.currentCourtId || null },
      afterSummary: { status: "live", courtId },
    });
    return { match, changed: true, displacedMatchId: plan.displaced?.match.matchId || null };
  });

  return {
    matchId,
    courtId,
    status: "live",
    changed: result.changed,
    displacedMatchId: result.displacedMatchId || null,
    tournamentId: result.match.tournamentId || null,
  };
}

async function moveMatch({ matchId, courtId, displace = false, actor = null, reason = null }) {
  const result = await db.runTransaction(async (tx) => {
    const match = await readMatch(tx, matchId);
    if (match.status !== "live") {
      throw precondition("Only a live match can be moved to another court.");
    }
    if (match.currentCourtId === courtId) return { match, changed: false };

    const fromCourtId = match.currentCourtId || null;
    let fromCourt = null;
    if (fromCourtId) {
      const fromSnap = await tx.get(courtRef(fromCourtId));
      fromCourt = fromSnap.exists ? fromSnap.data() : null;
    }
    const plan = await planCourtAttachment(tx, { matchId, courtId, displace });
    const effects = await planTournamentEffects(tx, match);

    writeCourtRelease(tx, fromCourtId, matchId, fromCourt);
    writeDisplacement(tx, plan.displaced);
    writeAttachment(tx, { match, court: plan.court, resetOrientation: false });
    effects.write({ status: "live", courtId });
    writeAudit(tx, {
      operation: "match.move",
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      fixtureId: match.fixtureId,
      matchId,
      courtId,
      actor,
      reason,
      beforeSummary: { courtId: fromCourtId },
      afterSummary: { courtId },
    });
    return { match, changed: true, fromCourtId };
  });

  return {
    matchId,
    courtId,
    fromCourtId: result.fromCourtId || null,
    changed: result.changed,
    tournamentId: result.match.tournamentId || null,
  };
}

// Detach keeps the match live (paused, no court); requeue returns it to
// scheduled. Neither completes the match.
async function detachMatch({ matchId, requeue = false, actor = null, reason = null }) {
  const result = await db.runTransaction(async (tx) => {
    const match = await readMatch(tx, matchId);
    if (match.status !== "live") throw precondition("Only a live match can be detached.");

    const fromCourtId = match.currentCourtId || null;
    let fromCourt = null;
    if (fromCourtId) {
      const fromSnap = await tx.get(courtRef(fromCourtId));
      fromCourt = fromSnap.exists ? fromSnap.data() : null;
    }
    const effects = await planTournamentEffects(tx, match);
    const nextStatus = requeue ? "scheduled" : "live";
    if (requeue) assertTransition(match.status, "scheduled");

    writeCourtRelease(tx, fromCourtId, matchId, fromCourt);
    tx.set(
      matchRef(matchId),
      { status: nextStatus, currentCourtId: null, updatedAt: now() },
      { merge: true },
    );
    effects.write({ status: nextStatus === "live" ? "live" : "scheduled", courtId: null });
    writeAudit(tx, {
      operation: requeue ? "match.requeue" : "match.detach",
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      fixtureId: match.fixtureId,
      matchId,
      courtId: fromCourtId,
      actor,
      reason,
      beforeSummary: { status: match.status, courtId: fromCourtId },
      afterSummary: { status: nextStatus, courtId: null },
    });
    return { match, fromCourtId };
  });

  return {
    matchId,
    fromCourtId: result.fromCourtId,
    status: requeue ? "scheduled" : "live",
    tournamentId: result.match.tournamentId || null,
  };
}

async function completeMatch({
  matchId,
  actor = null,
  reason = null,
  requireDecisive = false,
  allowIncomplete = true,
}) {
  const result = await db.runTransaction(async (tx) => {
    const match = await readMatch(tx, matchId);
    if (match.status === "completed") return { match, changed: false, result: match.result };
    assertTransition(match.status, "completed");

    const scoreSnap = await tx.get(db.doc(paths.matchScore(matchId)));
    const score = scoreSnap.exists ? scoreSnap.data() : defaultScore(match.scoringOptions);
    const matchResult = getMatchResult({ ...score, scoringOptions: match.scoringOptions });

    if (!allowIncomplete && !matchResult.matchComplete) {
      throw precondition("This match has not reached its finishing score yet.");
    }
    if (requireDecisive && matchResult.winner === "draw") {
      throw precondition("This match needs a winner before it can be completed.");
    }

    const fromCourtId = match.currentCourtId || null;
    let fromCourt = null;
    if (fromCourtId) {
      const fromSnap = await tx.get(courtRef(fromCourtId));
      fromCourt = fromSnap.exists ? fromSnap.data() : null;
    }
    const effects = await planTournamentEffects(tx, match);
    const timestamp = now();
    const resultRecord = { ...matchResult, completedAt: timestamp };

    writeCourtRelease(tx, fromCourtId, matchId, fromCourt);
    tx.set(
      matchRef(matchId),
      {
        status: "completed",
        currentCourtId: null,
        result: resultRecord,
        scoreSummary: buildScoreSummary({ ...score, scoringOptions: match.scoringOptions }),
        completedAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true },
    );
    effects.write({
      status: "completed",
      courtId: fromCourtId,
      resultSnapshot: { ...resultRecord, matchId, corrected: false },
    });
    writeAudit(tx, {
      operation: "match.complete",
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      fixtureId: match.fixtureId,
      matchId,
      courtId: fromCourtId,
      actor,
      reason,
      beforeSummary: { status: match.status },
      afterSummary: {
        status: "completed",
        winner: matchResult.winner,
        points: matchResult.points,
        games: matchResult.games,
        sets: matchResult.sets,
      },
    });
    return { match, changed: true, result: matchResult };
  });

  return {
    matchId,
    status: "completed",
    changed: result.changed,
    result: result.result,
    tournamentId: result.match.tournamentId || null,
  };
}

async function cancelMatch({ matchId, actor = null, reason = null }) {
  const result = await db.runTransaction(async (tx) => {
    const match = await readMatch(tx, matchId);
    if (match.status === "cancelled") return { match, changed: false };
    assertTransition(match.status, "cancelled");

    const fromCourtId = match.currentCourtId || null;
    let fromCourt = null;
    if (fromCourtId) {
      const fromSnap = await tx.get(courtRef(fromCourtId));
      fromCourt = fromSnap.exists ? fromSnap.data() : null;
    }
    const effects = await planTournamentEffects(tx, match);
    const timestamp = now();

    writeCourtRelease(tx, fromCourtId, matchId, fromCourt);
    tx.set(
      matchRef(matchId),
      { status: "cancelled", currentCourtId: null, cancelledAt: timestamp, updatedAt: timestamp },
      { merge: true },
    );
    effects.write({ status: "cancelled", courtId: null });
    writeAudit(tx, {
      operation: "match.cancel",
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      fixtureId: match.fixtureId,
      matchId,
      courtId: fromCourtId,
      actor,
      reason,
      beforeSummary: { status: match.status },
      afterSummary: { status: "cancelled" },
    });
    return { match, changed: true };
  });

  return {
    matchId,
    status: "cancelled",
    changed: result.changed,
    tournamentId: result.match.tournamentId || null,
  };
}

// Explicit, audited reopen of a completed match. The match resumes on the
// given court when it is free, otherwise it is live without a court.
async function reopenMatch({ matchId, courtId = null, actor = null, reason = null }) {
  if (!reason || !String(reason).trim()) {
    throw invalid("A reason is required to reopen a completed match.");
  }

  const result = await db.runTransaction(async (tx) => {
    const match = await readMatch(tx, matchId);
    assertTransition(match.status, "live");

    const plan = courtId ? await planCourtAttachment(tx, { matchId, courtId }) : null;
    const effects = await planTournamentEffects(tx, match);

    tx.set(
      matchRef(matchId),
      { status: "live", result: null, completedAt: null, currentCourtId: null, updatedAt: now() },
      { merge: true },
    );
    if (plan) {
      writeDisplacement(tx, plan.displaced);
      writeAttachment(tx, { match: { ...match, status: "live" }, court: plan.court });
    }
    effects.write({ status: "live", courtId: courtId || null, resultSnapshot: null });
    writeAudit(tx, {
      operation: "match.reopen",
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      fixtureId: match.fixtureId,
      matchId,
      courtId,
      actor,
      reason,
      beforeSummary: { status: "completed", result: match.result || null },
      afterSummary: { status: "live", courtId: courtId || null },
    });
    return { match };
  });

  return { matchId, status: "live", courtId, tournamentId: result.match.tournamentId || null };
}

async function renameMatch({ matchId, name, actor = null }) {
  const nextName = normalizeMatchName(name);
  const result = await db.runTransaction(async (tx) => {
    const match = await readMatch(tx, matchId);
    tx.set(matchRef(matchId), { name: nextName, updatedAt: now() }, { merge: true });
    if (match.tournamentId && match.fixtureId) {
      tx.set(
        db.doc(`${paths.tournamentFixtures(match.tournamentId)}/${match.fixtureId}`),
        { label: nextName || match.name },
        { merge: true },
      );
    }
    writeAudit(tx, {
      operation: "match.rename",
      tournamentId: match.tournamentId,
      fixtureId: match.fixtureId,
      matchId,
      actor,
      beforeSummary: { name: match.name || null },
      afterSummary: { name: nextName },
    });
    return { match };
  });
  return { matchId, name: nextName, tournamentId: result.match.tournamentId || null };
}

async function updateMatchNames({ matchId, teamNames, playerNames, actor = null }) {
  return db.runTransaction(async (tx) => {
    const match = await readMatch(tx, matchId);
    if (match.tournamentId) {
      throw precondition("Tournament match names come from the tournament roster.");
    }
    const patch = { updatedAt: now() };
    if (teamNames) patch.teamNames = normalizeTeamNames(teamNames);
    if (playerNames) patch.playerNames = normalizePlayerNames(playerNames);
    tx.set(matchRef(matchId), patch, { merge: true });
    writeAudit(tx, { operation: "match.names", matchId, actor });
    return { matchId };
  });
}

// Reset is a match operation (spec section 7): same matchId, next
// scoreVersion, cleared score, archived history.
async function resetMatch({
  matchId,
  deepReset = false,
  scoringOptions: incomingScoringOptions = null,
  actor = null,
  reason = null,
}) {
  const reset = await db.runTransaction(async (tx) => {
    const match = await readMatch(tx, matchId);
    if (match.status === "completed" || match.status === "cancelled") {
      throw precondition(`A ${match.status} match cannot be reset.`);
    }
    if (match.tournamentId && incomingScoringOptions) {
      const requested = buildScoringOptions({ ...match.scoringOptions, ...incomingScoringOptions });
      if (JSON.stringify(requested) !== JSON.stringify(buildScoringOptions(match.scoringOptions))) {
        throw precondition("Tournament match scoring rules cannot be changed.");
      }
    }

    let court = null;
    if (match.currentCourtId) {
      const courtSnap = await tx.get(courtRef(match.currentCourtId));
      court = courtSnap.exists ? courtSnap.data() : null;
    }

    const scoringOptions = match.tournamentId
      ? buildScoringOptions(match.scoringOptions)
      : buildScoringOptions({ ...(match.scoringOptions || {}), ...(incomingScoringOptions || {}) });
    const nextScoreVersion = normalizeScoreVersion(match.scoreVersion) + 1;
    const freshScore = defaultScore(scoringOptions);

    const patch = {
      scoreVersion: nextScoreVersion,
      scoringOptions,
      scoringMode: scoringOptions.scoringMode,
      scoreSummary: buildScoreSummary(freshScore),
      updatedAt: now(),
    };
    if (deepReset && !match.tournamentId) {
      patch.teamNames = normalizeTeamNames({});
      patch.playerNames = normalizePlayerNames({});
    }

    tx.set(matchRef(matchId), patch, { merge: true });
    // Explicit null ordering sentinels stop an in-flight trigger for a
    // pre-reset event from treating the fresh score as already ahead of it.
    tx.set(db.doc(paths.matchScore(matchId)), {
      ...toLiveScorePayload(freshScore),
      lastProcessedEventId: null,
      lastProcessedCreatedAt: null,
    });
    if (court) {
      // A reset starts the match again with the physical Beacon mapping restored.
      tx.set(courtRef(match.currentCourtId), { beaconSidesSwapped: false }, { merge: true });
    }
    writeAudit(tx, {
      operation: "match.reset",
      tournamentId: match.tournamentId,
      roundId: match.roundId,
      fixtureId: match.fixtureId,
      matchId,
      courtId: match.currentCourtId || null,
      actor,
      reason,
      beforeSummary: { scoreVersion: normalizeScoreVersion(match.scoreVersion) },
      afterSummary: { scoreVersion: nextScoreVersion, deepReset: Boolean(deepReset) },
    });
    return { match, scoringOptions, nextScoreVersion };
  });

  const archiveId = await archiveMatchEvents(matchId, reset.nextScoreVersion, actor);
  return {
    success: true,
    matchId,
    archivedId: archiveId,
    scoreVersion: reset.nextScoreVersion,
    scoringMode: reset.scoringOptions.scoringMode,
    scoringOptions: reset.scoringOptions,
    tournamentId: reset.match.tournamentId || null,
  };
}

// Moves the event history of earlier score versions to the archive. The
// version bump already stops those events from replaying, so this runs after
// the reset commits; events already written for the new version stay put.
async function archiveMatchEvents(matchId, activeScoreVersion, actor = null) {
  const [eventsSnap, checkpointsSnap] = await Promise.all([
    db.collection(paths.matchEvents(matchId)).get(),
    db.collection(paths.matchCheckpoints(matchId)).get(),
  ]);
  const archiveId = new Date().toISOString();
  const staleEvents = eventsSnap.docs.filter(
    (docSnap) => normalizeScoreVersion(docSnap.data()?.scoreVersion) < activeScoreVersion,
  );
  const staleCheckpoints = checkpointsSnap.docs.filter(
    (docSnap) => normalizeScoreVersion(docSnap.data()?.scoreVersion) < activeScoreVersion,
  );

  const archiveBatch = db.batch();
  staleEvents.forEach((docSnap) => {
    archiveBatch.set(db.doc(paths.matchArchiveEvent(matchId, archiveId, docSnap.id)), {
      ...docSnap.data(),
      archivedAt: now(),
      resetBy: actor?.uid || actor?.type || "system",
    });
  });
  await archiveBatch.commit();

  const deleteBatch = db.batch();
  staleEvents.forEach((docSnap) => deleteBatch.delete(docSnap.ref));
  staleCheckpoints.forEach((docSnap) => deleteBatch.delete(docSnap.ref));
  await deleteBatch.commit();

  return archiveId;
}

module.exports = {
  courtLabel,
  hasPoints,
  prepareMatch,
  writePreparedMatch,
  planCourtAttachment,
  ensureCourtMatch,
  resolveCourtMatchId,
  startMatch,
  moveMatch,
  detachMatch,
  completeMatch,
  cancelMatch,
  reopenMatch,
  renameMatch,
  updateMatchNames,
  resetMatch,
  archiveMatchEvents,
};
