// Tournament orchestration (spec sections 4, 22, 35-39, 42, 54, 55, 58, 60).
// Formats decide pairings and progression through the pure domain layer; this
// service persists the result atomically and every fixture is played as a
// normal Padel Push match.
const { db, FieldValue } = require("../infrastructure/firebase");
const { paths } = require("./firestorePaths");
const { newTournamentId, newSecret, hashSecret, randomId, secretsMatch } = require("./ids");
const { writeAudit } = require("./auditService");
const { invalid, notFound, precondition, conflict, denied } = require("./errors");
const matchService = require("./matchService");
const {
  getFormat,
  listFormats,
  validateTournamentSetup,
  assignCourts,
} = require("../domain/tournaments");
const {
  normalizeTournamentInput,
  normalizeParticipantInput,
  normalizeTeamInput,
  parseParticipantLines,
  assertStatusTransition,
  assertEditable,
  orderCourtCandidates,
  MAX_PARTICIPANTS,
} = require("../domain/tournaments/setup");
const {
  buildFixtureMatchSpec,
  fixtureSidesComplete,
  matchNamesDiffer,
} = require("../domain/tournaments/fixtureMatch");
const {
  buildTournamentView,
  buildRulesSummary,
  buildFormatState,
} = require("../domain/tournaments/view");
const {
  supportsFullSchedule,
  forecastRoundCount,
  generateSchedule,
} = require("../domain/tournaments/forecast");

const now = () => FieldValue.serverTimestamp();
const BRACKET_KINDS = new Set(["bracket", "groupBracket"]);

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function reader(tx) {
  return (target) => (tx ? tx.get(target) : target.get());
}

function docsOf(snapshot, idKey) {
  return snapshot.docs.map((docSnap) => ({ [idKey]: docSnap.id, ...docSnap.data() }));
}

async function loadTournamentState(tx, tournamentId) {
  if (!tournamentId || typeof tournamentId !== "string")
    throw invalid("A tournament id is required.");
  const get = reader(tx);
  const tournamentSnap = await get(db.doc(paths.tournament(tournamentId)));
  if (!tournamentSnap.exists) throw notFound("That tournament could not be found.");

  const [participantsSnap, teamsSnap, roundsSnap, fixturesSnap] = await Promise.all([
    get(db.collection(paths.tournamentParticipants(tournamentId))),
    get(db.collection(paths.tournamentTeams(tournamentId))),
    get(db.collection(paths.tournamentRounds(tournamentId))),
    get(db.collection(paths.tournamentFixtures(tournamentId))),
  ]);

  return {
    tournament: { tournamentId, ...tournamentSnap.data() },
    participants: docsOf(participantsSnap, "participantId"),
    teams: docsOf(teamsSnap, "teamId"),
    rounds: docsOf(roundsSnap, "roundId").sort((a, b) => a.roundNumber - b.roundNumber),
    fixtures: docsOf(fixturesSnap, "fixtureId"),
  };
}

async function loadCourts(tx, courtIds) {
  const get = reader(tx);
  const snaps = await Promise.all(courtIds.map((courtId) => get(db.doc(paths.court(courtId)))));
  return snaps
    .map((snap, index) => (snap.exists ? { courtId: courtIds[index], ...snap.data() } : null))
    .filter(Boolean);
}

async function loadClub(tx, clubId) {
  if (!clubId) return null;
  const snap = await reader(tx)(db.doc(paths.club(clubId)));
  return snap.exists ? { clubId, ...snap.data() } : null;
}

async function loadTournamentMatches(tx, tournamentId) {
  const snap = await reader(tx)(db.collection("matches").where("tournamentId", "==", tournamentId));
  return docsOf(snap, "matchId");
}

function indexBy(items, key) {
  return Object.fromEntries(items.map((item) => [item[key], item]));
}

function tournamentRef(tournamentId) {
  return db.doc(paths.tournament(tournamentId));
}

function fixtureRef(tournamentId, fixtureId) {
  return db.doc(`${paths.tournamentFixtures(tournamentId)}/${fixtureId}`);
}

function roundRef(tournamentId, roundId) {
  return db.doc(`${paths.tournamentRounds(tournamentId)}/${roundId}`);
}

function participantRef(tournamentId, participantId) {
  return db.doc(`${paths.tournamentParticipants(tournamentId)}/${participantId}`);
}

function teamRef(tournamentId, teamId) {
  return db.doc(`${paths.tournamentTeams(tournamentId)}/${teamId}`);
}

function assertNotFinished(tournament) {
  if (tournament.status === "completed" || tournament.status === "cancelled") {
    throw precondition(`This tournament is ${tournament.status} and is read-only.`);
  }
}

function assertRevision(tournament, expectedRevision) {
  if (expectedRevision == null) return;
  if (Number(expectedRevision) !== Number(tournament.revision || 0)) {
    throw conflict("Another host session changed the tournament. Refresh and retry.");
  }
}

function writeTournamentPatch(tx, tournament, patch) {
  tx.set(
    tournamentRef(tournament.tournamentId),
    { ...patch, revision: Number(tournament.revision || 0) + 1, updatedAt: now() },
    { merge: true },
  );
}

function formatDomainError(error) {
  if (error?.name === "TournamentDomainError") {
    return precondition(error.message, { rule: error.code });
  }
  return error;
}

function firstValidationError(validation) {
  return validation.errors?.length ? validation.errors[0].message : null;
}

async function assertClubAndCourts(tx, { clubId, courtPool }) {
  if (clubId) {
    const club = await loadClub(tx, clubId);
    if (!club) throw invalid("The selected club could not be found.");
  }
  if (courtPool.length) {
    const courts = await loadCourts(tx, courtPool);
    if (courts.length !== courtPool.length) {
      const found = new Set(courts.map((court) => court.courtId));
      const missing = courtPool.filter((courtId) => !found.has(courtId));
      throw invalid(`These courts could not be found: ${missing.join(", ")}.`);
    }
  }
}

function participantUsage(fixtures) {
  const used = new Set();
  fixtures.forEach((fixture) => {
    (fixture.participantIds || []).forEach((id) => used.add(id));
    (fixture.teamIds || []).forEach((id) => used.add(id));
  });
  return used;
}

function entryHasPlayed(fixtures, entryId) {
  return fixtures.some(
    (fixture) =>
      ["live", "completed"].includes(fixture.status) &&
      ((fixture.participantIds || []).includes(entryId) ||
        (fixture.teamIds || []).includes(entryId)),
  );
}

// ---------------------------------------------------------------------------
// Creation and configuration
// ---------------------------------------------------------------------------

function buildParticipantDoc(input, now_) {
  const participant = normalizeParticipantInput(input);
  return {
    participantId: `p-${randomId(6)}`,
    ...participant,
    status: "active",
    createdAt: now_,
    updatedAt: now_,
  };
}

function writeRosterInput(tx, tournamentId, { participants = [], text = null, teams = [] }) {
  const timestamp = now();
  const created = { participants: [], teams: [] };
  const participantInputs = [...participants, ...parseParticipantLines(text)];

  participantInputs.forEach((input) => {
    const doc = buildParticipantDoc(input, timestamp);
    tx.set(participantRef(tournamentId, doc.participantId), doc);
    created.participants.push(doc);
  });

  teams.forEach((teamInput) => {
    const players = (teamInput.players || []).map((player) =>
      buildParticipantDoc(typeof player === "string" ? { displayName: player } : player, timestamp),
    );
    if (players.length !== 2) throw invalid("Every team needs exactly two players.");
    if (players[0].displayName.toLowerCase() === players[1].displayName.toLowerCase()) {
      throw invalid("A team cannot contain the same player twice.");
    }
    players.forEach((doc) => {
      tx.set(participantRef(tournamentId, doc.participantId), doc);
      created.participants.push(doc);
    });
    const team = normalizeTeamInput(teamInput);
    const teamDoc = {
      teamId: `t-${randomId(6)}`,
      name: team.name || `${players[0].shortName} & ${players[1].shortName}`,
      participantIds: players.map((player) => player.participantId),
      seed: team.seed,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    tx.set(teamRef(tournamentId, teamDoc.teamId), teamDoc);
    created.teams.push(teamDoc);
  });

  return created;
}

async function createTournament(data, { actor }) {
  const input = normalizeTournamentInput(data);
  const requestId = typeof data.requestId === "string" ? data.requestId.slice(0, 64) : null;
  const tournamentId = newTournamentId();
  const hostKey = newSecret();
  const accessCode = input.visibility === "private" ? randomId(8) : null;

  const outcome = await db.runTransaction(async (tx) => {
    if (requestId) {
      const creationSnap = await tx.get(db.doc(paths.tournamentCreation(requestId)));
      if (creationSnap.exists)
        return { duplicate: true, tournamentId: creationSnap.data().tournamentId };
    }
    await assertClubAndCourts(tx, input);
    const existing = await tx.get(tournamentRef(tournamentId));
    if (existing.exists) throw conflict("Please retry creating the tournament.");

    const timestamp = now();
    const roster = writeRosterInput(tx, tournamentId, {
      participants: data.participants || [],
      text: data.participantText || null,
      teams: data.teams || [],
    });
    if (roster.participants.length > MAX_PARTICIPANTS) {
      throw invalid(`A tournament can have at most ${MAX_PARTICIPANTS} players.`);
    }

    tx.set(tournamentRef(tournamentId), {
      tournamentId,
      ...input,
      status: "draft",
      participantIds: roster.participants.map((p) => p.participantId),
      teamIds: roster.teams.map((t) => t.teamId),
      standingsConfig: {},
      currentRoundNumber: 0,
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      publishedAt: null,
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    });
    tx.set(db.doc(paths.tournamentSecret(tournamentId)), {
      hostKeyHash: hashSecret(hostKey),
      accessCodeHash: accessCode ? hashSecret(accessCode) : null,
      createdAt: timestamp,
    });
    if (requestId) {
      tx.set(db.doc(paths.tournamentCreation(requestId)), { tournamentId, createdAt: timestamp });
    }
    writeAudit(tx, {
      operation: "tournament.create",
      tournamentId,
      actor,
      afterSummary: {
        name: input.name,
        format: input.format.id,
        clubId: input.clubId,
        courtCount: input.courtPool.length,
        participants: roster.participants.length,
        teams: roster.teams.length,
      },
    });
    return { duplicate: false, tournamentId };
  });

  if (outcome.duplicate) return { tournamentId: outcome.tournamentId, duplicate: true };
  await recalculateTournament({ tournamentId });
  return { tournamentId, hostKey, accessCode, duplicate: false };
}

const UPDATABLE_FIELDS = [
  "name",
  "description",
  "clubId",
  "visibility",
  "courtPool",
  "scheduling",
  "format",
];

async function updateTournament(data, { actor }) {
  const result = await db.runTransaction(async (tx) => {
    const state = await loadTournamentState(tx, data.tournamentId);
    const { tournament } = state;
    assertNotFinished(tournament);
    assertRevision(tournament, data.expectedRevision);

    const patchInput = data.patch || {};
    const next = normalizeTournamentInput(patchInput, tournament);
    const changed = UPDATABLE_FIELDS.filter(
      (field) =>
        patchInput[field] !== undefined &&
        JSON.stringify(next[field]) !== JSON.stringify(tournament[field] ?? null),
    );
    if (changed.length === 0) return { changed: [] };
    assertEditable(tournament.status, changed, { hasRounds: state.rounds.length > 0 });
    if (changed.includes("format") && next.format.id !== tournament.format.id) {
      const format = getFormat(next.format.id);
      if (format.entryMode !== "either" && format.entryMode !== tournament.participantMode) {
        if (state.participants.length || state.teams.length) {
          throw precondition(
            `${format.label} needs ${format.entryMode} entries; clear the roster first.`,
          );
        }
      }
    }
    await assertClubAndCourts(tx, {
      clubId: changed.includes("clubId") ? next.clubId : null,
      courtPool: changed.includes("courtPool") ? next.courtPool : [],
    });

    const patch = {};
    changed.forEach((field) => {
      patch[field] = next[field];
    });
    if (changed.includes("format")) patch.participantMode = next.participantMode;
    writeTournamentPatch(tx, tournament, patch);
    writeAudit(tx, {
      operation: changed.includes("clubId") ? "tournament.club" : "tournament.update",
      tournamentId: tournament.tournamentId,
      actor,
      beforeSummary: Object.fromEntries(changed.map((field) => [field, tournament[field] ?? null])),
      afterSummary: patch,
      reason: data.reason,
    });
    return { changed };
  });
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, ...result };
}

const TRANSITION_OPERATIONS = {
  draft: "tournament.unpublish",
  published: "tournament.publish",
  live: "tournament.start",
  completed: "tournament.complete",
  cancelled: "tournament.cancel",
};

async function transitionTournament(data, { actor }, to, extra = {}) {
  const result = await db.runTransaction(async (tx) => {
    const state = await loadTournamentState(tx, data.tournamentId);
    const { tournament } = state;
    if (tournament.status === to) return { changed: false };
    assertStatusTransition(tournament.status, to);
    assertRevision(tournament, data.expectedRevision);

    if (to === "published" || to === "live") {
      const validation = validateTournamentSetup({
        format: tournament.format,
        participantMode: tournament.participantMode,
        participants: state.participants.filter((p) => p.status !== "removed"),
        teams: state.teams.filter((t) => t.status !== "removed"),
        courtPool: tournament.courtPool || [],
      });
      const error = firstValidationError(validation);
      if (error) throw precondition(error);
    }

    const timestampField = {
      published: "publishedAt",
      live: "startedAt",
      completed: "completedAt",
      cancelled: "cancelledAt",
    }[to];
    const patch = { status: to, ...(timestampField ? { [timestampField]: now() } : {}), ...extra };
    writeTournamentPatch(tx, tournament, patch);
    writeAudit(tx, {
      operation: TRANSITION_OPERATIONS[to],
      tournamentId: tournament.tournamentId,
      actor,
      beforeSummary: { status: tournament.status },
      afterSummary: { status: to },
      reason: data.reason,
    });
    return { changed: true, state };
  });
  return result;
}

async function publishTournament(data, ctx) {
  await transitionTournament(data, ctx, "published");
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, status: "published" };
}

async function unpublishTournament(data, ctx) {
  const snap = await db.doc(paths.tournament(data.tournamentId)).get();
  if (snap.exists && snap.data().startedAt) {
    throw precondition("A tournament that has started cannot be unpublished.");
  }
  await transitionTournament(data, ctx, "draft");
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, status: "draft" };
}

async function startTournament(data, ctx) {
  const snap = await db.doc(paths.tournament(data.tournamentId)).get();
  if (!snap.exists) throw notFound("That tournament could not be found.");
  if (snap.data().status === "draft") await transitionTournament(data, ctx, "published");
  await transitionTournament(data, ctx, "live");
  const roundsSnap = await db.collection(paths.tournamentRounds(data.tournamentId)).get();
  if (roundsSnap.docs.length === 0) {
    await generateRound({ tournamentId: data.tournamentId, expectedRoundNumber: 1 }, ctx);
  } else {
    await recalculateTournament({ tournamentId: data.tournamentId });
  }
  return { tournamentId: data.tournamentId, status: "live" };
}

// Finishing (normally or early) never fabricates results: unplayed fixtures
// are cancelled, live matches are cancelled and leave their courts.
async function completeTournament(data, ctx) {
  const state = await loadTournamentState(null, data.tournamentId);
  const open = state.fixtures.filter((fixture) => ["scheduled", "live"].includes(fixture.status));
  if (open.length && !data.early) {
    throw precondition(
      `${open.length} match${open.length === 1 ? " is" : "es are"} not finished. Finish early to end the tournament anyway.`,
      { openFixtures: open.length },
    );
  }
  if (data.early && (!data.reason || !String(data.reason).trim())) {
    throw invalid("Give a reason for finishing early.");
  }

  for (const fixture of open) {
    if (fixture.matchId) {
      const matchSnap = await db.doc(paths.match(fixture.matchId)).get();
      const match = matchSnap.exists ? matchSnap.data() : null;
      if (match && ["scheduled", "live"].includes(match.status)) {
        await matchService.cancelMatch({
          matchId: fixture.matchId,
          actor: ctx.actor,
          reason: "Tournament finished before this match was played",
        });
        continue;
      }
    }
    await fixtureRef(data.tournamentId, fixture.fixtureId).set(
      { status: "cancelled" },
      { merge: true },
    );
  }

  await transitionTournament(data, ctx, "completed", {
    completionReason: data.early ? String(data.reason).trim().slice(0, 500) : null,
    finishedEarly: Boolean(data.early),
  });
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, status: "completed", cancelledFixtures: open.length };
}

async function cancelTournament(data, ctx) {
  if (!data.reason || !String(data.reason).trim()) throw invalid("Give a reason for cancelling.");
  const state = await loadTournamentState(null, data.tournamentId);
  for (const fixture of state.fixtures) {
    if (!fixture.matchId || !["scheduled", "live"].includes(fixture.status)) continue;
    const matchSnap = await db.doc(paths.match(fixture.matchId)).get();
    if (matchSnap.exists && ["scheduled", "live"].includes(matchSnap.data().status)) {
      await matchService.cancelMatch({
        matchId: fixture.matchId,
        actor: ctx.actor,
        reason: "Tournament cancelled",
      });
    }
  }
  await transitionTournament(data, ctx, "cancelled", {
    cancellationReason: String(data.reason).trim().slice(0, 500),
  });
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, status: "cancelled" };
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

async function rosterTransaction(data, ctx, operation, mutate) {
  const result = await db.runTransaction(async (tx) => {
    const state = await loadTournamentState(tx, data.tournamentId);
    assertNotFinished(state.tournament);
    assertRevision(state.tournament, data.expectedRevision);
    const outcome = await mutate(tx, state);
    writeTournamentPatch(tx, state.tournament, outcome.tournamentPatch || {});
    writeAudit(tx, {
      operation,
      tournamentId: data.tournamentId,
      actor: ctx.actor,
      beforeSummary: outcome.before || null,
      afterSummary: outcome.after || null,
      reason: data.reason,
    });
    return outcome.result || {};
  });
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, ...result };
}

function assertRosterOpen(state, kind) {
  const format = getFormat(state.tournament.format.id);
  if (state.rounds.length > 0 && format.kind !== "rotating" && format.kind !== "courtRotation") {
    throw precondition(`${kind} cannot be added after the ${format.label} schedule is generated.`);
  }
}

async function addParticipants(data, ctx) {
  return rosterTransaction(data, ctx, "participant.add", async (tx, state) => {
    assertRosterOpen(state, "Players");
    const created = writeRosterInput(tx, data.tournamentId, {
      participants: data.participants || [],
      text: data.text || null,
      teams: data.teams || [],
    });
    if (!created.participants.length) throw invalid("Add at least one player.");
    const participantIds = [
      ...(state.tournament.participantIds || []),
      ...created.participants.map((p) => p.participantId),
    ];
    if (participantIds.length > MAX_PARTICIPANTS) {
      throw invalid(`A tournament can have at most ${MAX_PARTICIPANTS} players.`);
    }
    return {
      tournamentPatch: {
        participantIds,
        teamIds: [...(state.tournament.teamIds || []), ...created.teams.map((t) => t.teamId)],
      },
      after: { added: created.participants.length, teams: created.teams.length },
      result: {
        participantIds: created.participants.map((p) => p.participantId),
        teamIds: created.teams.map((t) => t.teamId),
      },
    };
  });
}

function findParticipant(state, participantId) {
  const participant = state.participants.find((p) => p.participantId === participantId);
  if (!participant) throw notFound("That player could not be found.");
  return participant;
}

function findTeam(state, teamId) {
  const team = state.teams.find((t) => t.teamId === teamId);
  if (!team) throw notFound("That team could not be found.");
  return team;
}

async function updateParticipant(data, ctx) {
  return rosterTransaction(data, ctx, "participant.update", async (tx, state) => {
    const participant = findParticipant(state, data.participantId);
    const next = normalizeParticipantInput({ ...participant, ...(data.patch || {}) });
    if (
      state.rounds.length > 0 &&
      next.seed !== participant.seed &&
      getFormat(state.tournament.format.id).kind !== "rotating"
    ) {
      throw precondition("Seeds cannot change after the draw is generated.");
    }
    tx.set(
      participantRef(data.tournamentId, participant.participantId),
      { ...next, updatedAt: now() },
      { merge: true },
    );
    return {
      before: { displayName: participant.displayName, seed: participant.seed ?? null },
      after: { displayName: next.displayName, seed: next.seed },
    };
  });
}

async function removeParticipant(data, ctx) {
  return rosterTransaction(data, ctx, "participant.remove", async (tx, state) => {
    const participant = findParticipant(state, data.participantId);
    if (participantUsage(state.fixtures).has(participant.participantId)) {
      throw precondition("This player is already in the schedule; withdraw them instead.");
    }
    if (
      state.teams.some(
        (team) =>
          team.status !== "removed" && team.participantIds.includes(participant.participantId),
      )
    ) {
      throw precondition("Remove or edit the player's team first.");
    }
    tx.set(
      participantRef(data.tournamentId, participant.participantId),
      { status: "removed", updatedAt: now() },
      { merge: true },
    );
    return {
      tournamentPatch: {
        participantIds: (state.tournament.participantIds || []).filter(
          (id) => id !== participant.participantId,
        ),
      },
      before: { participantId: participant.participantId, status: participant.status },
      after: { status: "removed" },
    };
  });
}

// Withdrawals only affect future scheduling (spec sections 21.4 and 37):
// bracket opponents receive a walkover, other unplayed fixtures are cancelled.
async function applyWithdrawalToFixtures(tx, state, entryId, actor) {
  const format = getFormat(state.tournament.format.id);
  const affected = state.fixtures.filter(
    (fixture) =>
      fixture.status === "scheduled" &&
      ((fixture.participantIds || []).includes(entryId) ||
        (fixture.teamIds || []).includes(entryId)),
  );
  const matchRefs = affected
    .filter((fixture) => fixture.matchId)
    .map((fixture) => db.doc(paths.match(fixture.matchId)));
  const matchSnaps = await Promise.all(matchRefs.map((ref) => tx.get(ref)));
  const matchesById = Object.fromEntries(
    matchSnaps.filter((snap) => snap.exists).map((snap) => [snap.id, snap.data()]),
  );
  const writes = [];

  for (const fixture of affected) {
    const match = fixture.matchId ? matchesById[fixture.matchId] : null;
    if (match && match.status !== "scheduled") continue;
    const withdrawnSide = ["A", "B"].find((key) => {
      const side = fixture.sides?.[key];
      return side && (side.teamId === entryId || (side.participantIds || []).includes(entryId));
    });
    const otherSide = withdrawnSide === "A" ? "B" : "A";
    const walkover =
      BRACKET_KINDS.has(format.kind) && fixture.stage !== "group" && fixture.sides?.[otherSide];

    writes.push(() => {
      if (fixture.matchId) {
        tx.set(
          db.doc(paths.match(fixture.matchId)),
          { status: "cancelled", cancelledAt: now(), updatedAt: now() },
          { merge: true },
        );
      }
      tx.set(
        fixtureRef(state.tournament.tournamentId, fixture.fixtureId),
        walkover
          ? {
              status: "completed",
              resultSnapshot: {
                winner: otherSide,
                points: { A: 0, B: 0 },
                games: { A: 0, B: 0 },
                sets: { A: 0, B: 0 },
                walkover: true,
                matchId: null,
                corrected: false,
              },
            }
          : { status: "cancelled" },
        { merge: true },
      );
      writeAudit(tx, {
        operation: walkover ? "fixture.walkover" : "fixture.cancel",
        tournamentId: state.tournament.tournamentId,
        roundId: fixture.roundId,
        fixtureId: fixture.fixtureId,
        matchId: fixture.matchId || null,
        actor,
        reason: "Entry withdrawn",
      });
    });
  }
  return writes;
}

async function setEntryStatus(data, ctx, kind, status) {
  const isTeam = kind === "team";
  return rosterTransaction(
    data,
    ctx,
    `${kind}.${status === "withdrawn" ? "withdraw" : "restore"}`,
    async (tx, state) => {
      const entry = isTeam
        ? findTeam(state, data.teamId)
        : findParticipant(state, data.participantId);
      const entryId = isTeam ? entry.teamId : entry.participantId;
      if (status === "withdrawn" && entry.status !== "active")
        throw precondition("Only an active entry can withdraw.");
      if (status === "active" && entry.status !== "withdrawn")
        throw precondition("Only a withdrawn entry can be restored.");
      const fixtureWrites =
        status === "withdrawn"
          ? await applyWithdrawalToFixtures(tx, state, entryId, ctx.actor)
          : [];
      fixtureWrites.forEach((write) => write());
      tx.set(
        isTeam ? teamRef(data.tournamentId, entryId) : participantRef(data.tournamentId, entryId),
        { status, updatedAt: now() },
        { merge: true },
      );
      return {
        before: { entryId, status: entry.status },
        after: { entryId, status, affectedFixtures: fixtureWrites.length },
      };
    },
  );
}

const withdrawParticipant = (data, ctx) => setEntryStatus(data, ctx, "participant", "withdrawn");
const restoreParticipant = (data, ctx) => setEntryStatus(data, ctx, "participant", "active");
const withdrawTeam = (data, ctx) => setEntryStatus(data, ctx, "team", "withdrawn");
const restoreTeam = (data, ctx) => setEntryStatus(data, ctx, "team", "active");

async function createTeam(data, ctx) {
  return rosterTransaction(data, ctx, "team.create", async (tx, state) => {
    assertRosterOpen(state, "Teams");
    let participantIds = Array.isArray(data.participantIds) ? data.participantIds : null;
    if (!participantIds) {
      const created = writeRosterInput(tx, data.tournamentId, {
        teams: [{ name: data.name, seed: data.seed, players: data.players || [] }],
      });
      return {
        tournamentPatch: {
          participantIds: [
            ...(state.tournament.participantIds || []),
            ...created.participants.map((p) => p.participantId),
          ],
          teamIds: [...(state.tournament.teamIds || []), ...created.teams.map((t) => t.teamId)],
        },
        after: { teamId: created.teams[0].teamId },
        result: { teamId: created.teams[0].teamId },
      };
    }
    if (participantIds.length !== 2 || participantIds[0] === participantIds[1]) {
      throw invalid("A team needs two different players.");
    }
    participantIds.forEach((id) => findParticipant(state, id));
    const inTeam = new Set(
      state.teams.filter((t) => t.status !== "removed").flatMap((t) => t.participantIds),
    );
    if (participantIds.some((id) => inTeam.has(id)))
      throw precondition("A player can only be in one team.");
    const team = normalizeTeamInput(data);
    const players = participantIds.map((id) => findParticipant(state, id));
    const teamDoc = {
      teamId: `t-${randomId(6)}`,
      name: team.name || players.map((p) => p.shortName || p.displayName).join(" & "),
      participantIds,
      seed: team.seed,
      status: "active",
      createdAt: now(),
      updatedAt: now(),
    };
    tx.set(teamRef(data.tournamentId, teamDoc.teamId), teamDoc);
    return {
      tournamentPatch: { teamIds: [...(state.tournament.teamIds || []), teamDoc.teamId] },
      after: { teamId: teamDoc.teamId },
      result: { teamId: teamDoc.teamId },
    };
  });
}

async function updateTeam(data, ctx) {
  return rosterTransaction(data, ctx, "team.update", async (tx, state) => {
    const team = findTeam(state, data.teamId);
    const next = normalizeTeamInput({ ...team, ...(data.patch || {}) });
    if (
      state.rounds.length > 0 &&
      next.seed !== team.seed &&
      getFormat(state.tournament.format.id).kind !== "rotating"
    ) {
      throw precondition("Seeds cannot change after the draw is generated.");
    }
    tx.set(
      teamRef(data.tournamentId, team.teamId),
      { name: next.name || team.name, seed: next.seed, updatedAt: now() },
      { merge: true },
    );
    return {
      before: { name: team.name, seed: team.seed ?? null },
      after: { name: next.name || team.name, seed: next.seed },
    };
  });
}

async function removeTeam(data, ctx) {
  return rosterTransaction(data, ctx, "team.remove", async (tx, state) => {
    const team = findTeam(state, data.teamId);
    if (participantUsage(state.fixtures).has(team.teamId)) {
      throw precondition("This team is already in the schedule; withdraw it instead.");
    }
    tx.set(
      teamRef(data.tournamentId, team.teamId),
      { status: "removed", updatedAt: now() },
      { merge: true },
    );
    team.participantIds.forEach((participantId) =>
      tx.set(
        participantRef(data.tournamentId, participantId),
        { status: "removed", updatedAt: now() },
        { merge: true },
      ),
    );
    return {
      tournamentPatch: {
        teamIds: (state.tournament.teamIds || []).filter((id) => id !== team.teamId),
        participantIds: (state.tournament.participantIds || []).filter(
          (id) => !team.participantIds.includes(id),
        ),
      },
      before: { teamId: team.teamId },
      after: { status: "removed" },
    };
  });
}

// Explicit, audited member replacement. Historical fixtures keep the
// original player; only unplayed fixtures and their matches see the change.
async function replaceTeamMember(data, ctx) {
  return rosterTransaction(data, ctx, "team.replaceMember", async (tx, state) => {
    const team = findTeam(state, data.teamId);
    if (!team.participantIds.includes(data.participantId))
      throw invalid("That player is not in this team.");
    const played = entryHasPlayed(state.fixtures, team.teamId);
    if (played && (!data.reason || !String(data.reason).trim())) {
      throw invalid("Give a reason for replacing a player in a team that has already played.");
    }
    let replacement;
    const newMembers = [];
    if (data.newParticipantId) {
      replacement = findParticipant(state, data.newParticipantId);
    } else {
      replacement = buildParticipantDoc(data.newParticipant || {}, now());
      tx.set(participantRef(data.tournamentId, replacement.participantId), replacement);
      newMembers.push(replacement.participantId);
    }
    const participantIds = team.participantIds.map((id) =>
      id === data.participantId ? replacement.participantId : id,
    );
    tx.set(
      teamRef(data.tournamentId, team.teamId),
      { participantIds, updatedAt: now() },
      { merge: true },
    );

    state.fixtures
      .filter(
        (fixture) =>
          fixture.status === "scheduled" && (fixture.teamIds || []).includes(team.teamId),
      )
      .forEach((fixture) => {
        const sides = { ...fixture.sides };
        ["A", "B"].forEach((key) => {
          if (sides[key]?.teamId === team.teamId) sides[key] = { ...sides[key], participantIds };
        });
        tx.set(
          fixtureRef(data.tournamentId, fixture.fixtureId),
          {
            sides,
            participantIds: [
              ...(sides.A?.participantIds || []),
              ...(sides.B?.participantIds || []),
            ],
          },
          { merge: true },
        );
      });

    return {
      tournamentPatch: newMembers.length
        ? { participantIds: [...(state.tournament.participantIds || []), ...newMembers] }
        : {},
      before: { teamId: team.teamId, participantId: data.participantId },
      after: {
        teamId: team.teamId,
        participantId: replacement.participantId,
        teamHadPlayed: played,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Round generation and scheduling
// ---------------------------------------------------------------------------

function scheduleGeneration(generation, { tournament, courts, nowMs }) {
  const scheduling = tournament.scheduling || {};
  const unavailable = courts
    .filter((court) => court.status === "closed")
    .map((court) => court.courtId);
  const pool = tournament.courtPool || [];
  const duration = Number(scheduling.defaultMatchDurationMinutes) || 0;
  const changeover = Number(scheduling.defaultChangeoverMinutes) || 0;
  let startAt =
    scheduling.startAt &&
    Number(scheduling.startAt) > nowMs &&
    generation.rounds[0]?.roundNumber === 1
      ? Number(scheduling.startAt)
      : nowMs;

  const scheduled = [];
  [...generation.rounds]
    .sort((a, b) => a.roundNumber - b.roundNumber)
    .forEach((round) => {
      const roundFixtures = generation.fixtures.filter(
        (fixture) => fixture.roundId === round.roundId,
      );
      const assigned = assignCourts(roundFixtures, {
        courtPool: pool,
        unavailableCourtIds: unavailable,
        startAt,
        matchDurationMinutes: duration,
        changeoverMinutes: changeover,
      }).map((fixture) => {
        // Court-rotation formats play each level on a fixed court.
        if (fixture.courtLevel && pool[fixture.courtLevel - 1]) {
          return { ...fixture, courtId: pool[fixture.courtLevel - 1] };
        }
        return fixture;
      });
      const waves = Math.max(1, ...assigned.map((fixture) => fixture.wave || 1));
      startAt += waves * (duration + changeover) * 60000;
      scheduled.push(...assigned);
    });
  return scheduled;
}

function prepareFixtureMatch({ tournament, fixture, lookups }) {
  const spec = buildFixtureMatchSpec({
    tournament,
    fixture,
    participantsById: lookups.participantsById,
    teamsById: lookups.teamsById,
  });
  return matchService.prepareMatch({
    ...spec,
    kind: "tournament",
    tournamentId: tournament.tournamentId,
    roundId: fixture.roundId,
    fixtureId: fixture.fixtureId,
    status: "scheduled",
  });
}

// Firestore rejects undefined values; format output is plain data, so a JSON
// round trip drops them (and the scheduling-only wave marker) safely.
function stripFixtureForStorage(fixture) {
  const { wave: _wave, ...rest } = fixture;
  return JSON.parse(JSON.stringify(rest));
}

async function generateRound(data, ctx) {
  const tournamentId = data.tournamentId;
  const outcome = await db.runTransaction(async (tx) => {
    const state = await loadTournamentState(tx, tournamentId);
    const { tournament } = state;
    assertNotFinished(tournament);

    const maxRound = state.rounds.reduce((max, round) => Math.max(max, round.roundNumber), 0);
    if (data.expectedRoundNumber != null && Number(data.expectedRoundNumber) !== maxRound + 1) {
      const existing = state.rounds.find(
        (round) => round.roundNumber === Number(data.expectedRoundNumber),
      );
      if (existing) return { duplicate: true, roundIds: [existing.roundId] };
      throw conflict("The schedule changed in another session. Refresh and retry.");
    }

    const format = getFormat(tournament.format.id);
    const validation = validateTournamentSetup({
      format: tournament.format,
      participantMode: tournament.participantMode,
      participants: state.participants.filter((p) => p.status !== "removed"),
      teams: state.teams.filter((t) => t.status !== "removed"),
      courtPool: tournament.courtPool || [],
    });
    const validationError = firstValidationError(validation);
    if (validationError) throw precondition(validationError);
    if (!(tournament.courtPool || []).length)
      throw precondition("Choose at least one court before generating.");

    const formatState = buildFormatState(state);
    let generation;
    try {
      if (supportsFullSchedule(format)) {
        if (state.rounds.length) {
          throw precondition(
            "The schedule already exists. Recalculate to rebuild remaining rounds.",
          );
        }
        generation = generateSchedule(format, formatState);
      } else if (state.rounds.length === 0) {
        generation = format.generateInitialRound(formatState);
      } else {
        const check = format.supportsNextRound
          ? format.canGenerateNextRound(formatState)
          : { allowed: false, reason: "This format schedules every round automatically." };
        if (!check.allowed) {
          throw precondition(`Round ${maxRound + 1} cannot be generated yet: ${check.reason}`);
        }
        generation = format.generateNextRound(formatState);
      }
    } catch (error) {
      throw formatDomainError(error);
    }
    if (!generation?.rounds?.length) throw precondition("No new round could be generated.");
    assertScheduleSize(generation);
    if (
      generation.rounds.some((round) =>
        state.rounds.some((existing) => existing.roundId === round.roundId),
      )
    ) {
      throw conflict("That round already exists. Refresh and retry.");
    }

    const courts = await loadCourts(tx, tournament.courtPool || []);
    const scheduledFixtures = scheduleGeneration(generation, {
      tournament,
      courts,
      nowMs: Date.now(),
    });
    const lookups = {
      participantsById: indexBy(state.participants, "participantId"),
      teamsById: indexBy(state.teams, "teamId"),
    };

    const timestamp = now();
    let matchCount = 0;
    scheduledFixtures.forEach((fixture) => {
      const stored = stripFixtureForStorage(fixture);
      if (fixture.status === "scheduled" && fixtureSidesComplete(fixture)) {
        const prepared = prepareFixtureMatch({ tournament, fixture, lookups });
        matchService.writePreparedMatch(tx, prepared);
        stored.matchId = prepared.matchId;
        matchCount += 1;
      }
      tx.set(fixtureRef(tournamentId, fixture.fixtureId), { ...stored, createdAt: timestamp });
    });
    generation.rounds.forEach((round) => {
      tx.set(roundRef(tournamentId, round.roundId), {
        ...JSON.parse(JSON.stringify(round)),
        tournamentId,
        fixtureIds: scheduledFixtures
          .filter((f) => f.roundId === round.roundId)
          .map((f) => f.fixtureId),
        generatedAt: timestamp,
        startedAt: null,
        completedAt: null,
        notes: null,
      });
    });

    const lastRoundNumber = Math.max(...generation.rounds.map((round) => round.roundNumber));
    writeTournamentPatch(tx, tournament, {
      currentRoundNumber: Math.max(
        tournament.currentRoundNumber || 0,
        generation.rounds[0].roundNumber,
      ),
      lastGeneratedRoundNumber: lastRoundNumber,
      ...(supportsFullSchedule(format) ? { forecastRoundCount: lastRoundNumber } : {}),
    });
    writeAudit(tx, {
      operation: "round.generate",
      tournamentId,
      roundId: generation.rounds[0].roundId,
      actor: ctx.actor,
      afterSummary: {
        rounds: generation.rounds.map((round) => round.roundNumber),
        fixtures: scheduledFixtures.length,
        matches: matchCount,
        seed: generation.rounds[0].generationSnapshot?.seed || null,
      },
      reason: data.reason,
    });
    return {
      duplicate: false,
      roundIds: generation.rounds.map((round) => round.roundId),
      fixtures: scheduledFixtures.length,
      matches: matchCount,
    };
  });

  await recalculateTournament({ tournamentId });
  return { tournamentId, ...outcome };
}

// ---------------------------------------------------------------------------
// Fixture operations (court assignment uses the match lifecycle)
// ---------------------------------------------------------------------------

async function loadFixture(tournamentId, fixtureId) {
  const snap = await fixtureRef(tournamentId, fixtureId).get();
  if (!snap.exists) throw notFound("That fixture could not be found.");
  return { fixtureId, ...snap.data() };
}

async function assertTournamentOperable(tournamentId) {
  const snap = await tournamentRef(tournamentId).get();
  if (!snap.exists) throw notFound("That tournament could not be found.");
  assertNotFinished(snap.data());
  return { tournamentId, ...snap.data() };
}

async function startFixture(data, ctx) {
  await assertTournamentOperable(data.tournamentId);
  const fixture = await loadFixture(data.tournamentId, data.fixtureId);
  if (!fixtureSidesComplete(fixture))
    throw precondition("Both sides must be known before this match can start.");
  if (!fixture.matchId)
    throw precondition("This fixture has no match yet. Recalculate the tournament.");
  const courtId = data.courtId || fixture.courtId;
  if (!courtId) throw invalid("Choose a court for this match.");
  const result = await matchService.startMatch({
    matchId: fixture.matchId,
    courtId,
    displace: Boolean(data.displace),
    actor: ctx.actor,
    reason: data.reason,
  });
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, ...result };
}

// Starts every ready match of a round on its planned court; courts that are
// busy are reported back rather than taken over.
async function startRound(data, ctx) {
  await assertTournamentOperable(data.tournamentId);
  const state = await loadTournamentState(null, data.tournamentId);
  const roundId =
    data.roundId ||
    state.rounds.find((round) =>
      state.fixtures.some((f) => f.roundId === round.roundId && f.status === "scheduled"),
    )?.roundId;
  if (!roundId) throw precondition("There is no round waiting to start.");

  const usedCourts = new Set();
  const started = [];
  const skipped = [];
  const candidates = state.fixtures
    .filter(
      (fixture) =>
        fixture.roundId === roundId &&
        fixture.status === "scheduled" &&
        fixture.matchId &&
        fixtureSidesComplete(fixture),
    )
    .sort((a, b) => (a.scheduledStartAt || 0) - (b.scheduledStartAt || 0));
  for (const fixture of candidates) {
    if (!fixture.courtId || usedCourts.has(fixture.courtId)) {
      skipped.push({ fixtureId: fixture.fixtureId, reason: "No free court" });
      continue;
    }
    try {
      await matchService.startMatch({
        matchId: fixture.matchId,
        courtId: fixture.courtId,
        actor: ctx.actor,
      });
      usedCourts.add(fixture.courtId);
      started.push(fixture.fixtureId);
    } catch (error) {
      skipped.push({ fixtureId: fixture.fixtureId, reason: error.message });
    }
  }
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, roundId, started, skipped };
}

async function assignFixtureCourt(data, ctx) {
  await assertTournamentOperable(data.tournamentId);
  const fixture = await loadFixture(data.tournamentId, data.fixtureId);
  if (fixture.status === "live" && fixture.matchId) {
    const result = await matchService.moveMatch({
      matchId: fixture.matchId,
      courtId: data.courtId,
      displace: Boolean(data.displace),
      actor: ctx.actor,
      reason: data.reason,
    });
    await recalculateTournament({ tournamentId: data.tournamentId });
    return { tournamentId: data.tournamentId, ...result };
  }
  if (fixture.status !== "scheduled")
    throw precondition("Only an upcoming match can be given a court.");
  if (data.courtId) {
    const courtSnap = await db.doc(paths.court(data.courtId)).get();
    if (!courtSnap.exists) throw notFound(`Court ${data.courtId} could not be found.`);
  }
  await db.runTransaction(async (tx) => {
    tx.set(
      fixtureRef(data.tournamentId, fixture.fixtureId),
      { courtId: data.courtId || null },
      { merge: true },
    );
    writeAudit(tx, {
      operation: "fixture.assignCourt",
      tournamentId: data.tournamentId,
      roundId: fixture.roundId,
      fixtureId: fixture.fixtureId,
      matchId: fixture.matchId || null,
      courtId: data.courtId || null,
      actor: ctx.actor,
      beforeSummary: { courtId: fixture.courtId || null },
      afterSummary: { courtId: data.courtId || null },
    });
  });
  await recalculateTournament({ tournamentId: data.tournamentId });
  return {
    tournamentId: data.tournamentId,
    fixtureId: fixture.fixtureId,
    courtId: data.courtId || null,
  };
}

async function setFixtureSchedule(data, ctx) {
  await assertTournamentOperable(data.tournamentId);
  const fixture = await loadFixture(data.tournamentId, data.fixtureId);
  if (fixture.status !== "scheduled")
    throw precondition("Only an upcoming match can be rescheduled.");
  const ms =
    data.scheduledStartAt == null
      ? null
      : typeof data.scheduledStartAt === "number"
        ? data.scheduledStartAt
        : Date.parse(data.scheduledStartAt);
  if (ms != null && !Number.isFinite(ms)) throw invalid("That start time is not valid.");
  await db.runTransaction(async (tx) => {
    tx.set(
      fixtureRef(data.tournamentId, fixture.fixtureId),
      { scheduledStartAt: ms },
      { merge: true },
    );
    writeAudit(tx, {
      operation: "fixture.schedule",
      tournamentId: data.tournamentId,
      fixtureId: fixture.fixtureId,
      actor: ctx.actor,
      beforeSummary: { scheduledStartAt: fixture.scheduledStartAt ?? null },
      afterSummary: { scheduledStartAt: ms },
    });
  });
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, fixtureId: fixture.fixtureId, scheduledStartAt: ms };
}

async function fixtureMatchOperation(data, ctx, operation) {
  await assertTournamentOperable(data.tournamentId);
  const fixture = await loadFixture(data.tournamentId, data.fixtureId);
  if (!fixture.matchId) throw precondition("This fixture has no match yet.");
  const result = await operation(fixture);
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, fixtureId: fixture.fixtureId, ...result };
}

const moveFixtureCourt = (data, ctx) =>
  fixtureMatchOperation(data, ctx, (fixture) =>
    matchService.moveMatch({
      matchId: fixture.matchId,
      courtId: data.courtId,
      displace: Boolean(data.displace),
      actor: ctx.actor,
      reason: data.reason,
    }),
  );

const detachFixtureMatch = (data, ctx) =>
  fixtureMatchOperation(data, ctx, (fixture) =>
    matchService.detachMatch({
      matchId: fixture.matchId,
      requeue: Boolean(data.requeue),
      actor: ctx.actor,
      reason: data.reason,
    }),
  );

const renameFixture = (data, ctx) =>
  fixtureMatchOperation(data, ctx, (fixture) =>
    matchService.renameMatch({ matchId: fixture.matchId, name: data.name, actor: ctx.actor }),
  );

async function completeFixture(data, ctx) {
  const fixture = await loadFixture(data.tournamentId, data.fixtureId);
  if (!fixture.matchId) throw precondition("This fixture has no match yet.");
  const requireDecisive = await fixtureRequiresWinner({
    tournamentId: data.tournamentId,
    fixtureId: fixture.fixtureId,
  });
  const result = await matchService.completeMatch({
    matchId: fixture.matchId,
    actor: ctx.actor,
    reason: data.reason,
    requireDecisive,
  });
  await recalculateTournament({ tournamentId: data.tournamentId });
  return { tournamentId: data.tournamentId, fixtureId: fixture.fixtureId, ...result };
}

async function createFixtureMatch(data, ctx) {
  const tournamentId = data.tournamentId;
  const result = await db.runTransaction(async (tx) => {
    const state = await loadTournamentState(tx, tournamentId);
    assertNotFinished(state.tournament);
    const fixture = state.fixtures.find((f) => f.fixtureId === data.fixtureId);
    if (!fixture) throw notFound("That fixture could not be found.");
    if (fixture.matchId) return { matchId: fixture.matchId, created: false };
    if (fixture.status !== "scheduled" || !fixtureSidesComplete(fixture)) {
      throw precondition("Both sides must be known before a match can be created.");
    }
    const prepared = prepareFixtureMatch({
      tournament: state.tournament,
      fixture,
      lookups: {
        participantsById: indexBy(state.participants, "participantId"),
        teamsById: indexBy(state.teams, "teamId"),
      },
    });
    matchService.writePreparedMatch(tx, prepared);
    tx.set(
      fixtureRef(tournamentId, fixture.fixtureId),
      { matchId: prepared.matchId },
      { merge: true },
    );
    writeAudit(tx, {
      operation: "fixture.createMatch",
      tournamentId,
      fixtureId: fixture.fixtureId,
      matchId: prepared.matchId,
      actor: ctx.actor,
    });
    return { matchId: prepared.matchId, created: true };
  });
  await recalculateTournament({ tournamentId });
  return { tournamentId, fixtureId: data.fixtureId, ...result };
}

// ---------------------------------------------------------------------------
// Results, corrections and progression
// ---------------------------------------------------------------------------

async function fixtureRequiresWinner({ tournamentId, fixtureId }) {
  if (!tournamentId || !fixtureId) return false;
  const [tournamentSnap, fixtureSnap] = await Promise.all([
    tournamentRef(tournamentId).get(),
    fixtureRef(tournamentId, fixtureId).get(),
  ]);
  if (!tournamentSnap.exists || !fixtureSnap.exists) return false;
  const format = getFormat(tournamentSnap.data().format.id);
  const fixture = fixtureSnap.data();
  if (format.kind === "bracket") return true;
  if (format.kind === "groupBracket") return fixture.stage !== "group";
  if (format.kind === "courtRotation") {
    return (tournamentSnap.data().format.config || {}).tieBehaviour === "replay";
  }
  return false;
}

function downstreamFixtures(fixture, fixturesById) {
  return ["winner", "loser"]
    .map((outcome) => fixture.feeds?.[outcome])
    .filter(Boolean)
    .map((feed) => ({ feed, fixture: fixturesById[feed.fixtureId] }))
    .filter((entry) => entry.fixture);
}

async function assertDownstreamNotStarted(tx, state, fixture) {
  const fixturesById = indexBy(state.fixtures, "fixtureId");
  const downstream = downstreamFixtures(fixture, fixturesById);
  for (const { fixture: dest } of downstream) {
    if (["live", "completed"].includes(dest.status)) {
      throw precondition(
        `${dest.label || dest.fixtureId} already depends on this result and has started. Correct that match first.`,
      );
    }
    if (dest.matchId) {
      const snap = await tx.get(db.doc(paths.match(dest.matchId)));
      if (snap.exists && snap.data().status !== "scheduled") {
        throw precondition(
          `${dest.label || dest.fixtureId} already depends on this result and has started.`,
        );
      }
    }
  }
  return downstream;
}

// Reopening a bracket result clears the slots it fed, so a changed winner
// can never leave an impossible bracket path.
async function assertFixtureReopenable(match) {
  if (!match.tournamentId || !match.fixtureId) return;
  await db.runTransaction(async (tx) => {
    const state = await loadTournamentState(tx, match.tournamentId);
    assertNotFinished(state.tournament);
    const fixture = state.fixtures.find((f) => f.fixtureId === match.fixtureId);
    if (!fixture) return;
    const downstream = await assertDownstreamNotStarted(tx, state, fixture);
    downstream.forEach(({ feed, fixture: dest }) => {
      const sides = { ...dest.sides, [feed.side]: null };
      tx.set(
        fixtureRef(match.tournamentId, dest.fixtureId),
        {
          sides,
          participantIds: [...(sides.A?.participantIds || []), ...(sides.B?.participantIds || [])],
          teamIds: [sides.A?.teamId, sides.B?.teamId].filter(Boolean),
          status: "scheduled",
        },
        { merge: true },
      );
    });
  });
}

function outcomeFromCorrection(input, original) {
  const pick = (value, fallback) => ({
    A: Number(value?.A ?? fallback?.A ?? 0),
    B: Number(value?.B ?? fallback?.B ?? 0),
  });
  const points = pick(input.points, original?.points);
  const games = pick(input.games, original?.games);
  const sets = pick(input.sets, original?.sets);
  [points, games, sets].forEach((pair) => {
    if (![pair.A, pair.B].every((n) => Number.isInteger(n) && n >= 0 && n <= 999)) {
      throw invalid("Scores must be whole numbers.");
    }
  });
  let winner = input.winner;
  if (!["A", "B", "draw"].includes(winner)) {
    const compare = (pair) => (pair.A === pair.B ? null : pair.A > pair.B ? "A" : "B");
    winner = compare(sets) || compare(games) || compare(points) || "draw";
  }
  return { winner, points, games, sets };
}

async function correctTournamentResult(data, ctx) {
  if (!data.reason || !String(data.reason).trim())
    throw invalid("A reason is required to correct a result.");
  const tournamentId = data.tournamentId;
  const result = await db.runTransaction(async (tx) => {
    const state = await loadTournamentState(tx, tournamentId);
    if (state.tournament.status === "cancelled")
      throw precondition("A cancelled tournament is read-only.");
    const fixture = state.fixtures.find((f) => f.fixtureId === data.fixtureId);
    if (!fixture) throw notFound("That fixture could not be found.");
    if (fixture.status !== "completed" || !fixture.resultSnapshot) {
      throw precondition("Only a completed match result can be corrected.");
    }
    const original = fixture.resultSnapshot;
    const corrected = outcomeFromCorrection(data, original);
    const requiresWinner = await fixtureRequiresWinner({
      tournamentId,
      fixtureId: fixture.fixtureId,
    });
    if (requiresWinner && corrected.winner === "draw")
      throw precondition("This match needs a winner.");

    if (corrected.winner !== original.winner) {
      const downstream = await assertDownstreamNotStarted(tx, state, fixture);
      downstream.forEach(({ feed, fixture: dest }) => {
        const sides = { ...dest.sides, [feed.side]: null };
        tx.set(fixtureRef(tournamentId, dest.fixtureId), { sides }, { merge: true });
      });
    }

    const correction = {
      original: {
        winner: original.winner,
        points: original.points,
        games: original.games,
        sets: original.sets,
      },
      reason: String(data.reason).trim().slice(0, 500),
      correctedAt: Date.now(),
      actorType: ctx.actor?.type || null,
    };
    tx.set(
      fixtureRef(tournamentId, fixture.fixtureId),
      { resultSnapshot: { ...original, ...corrected, corrected: true, correction } },
      { merge: true },
    );
    if (fixture.matchId) {
      // The match event history is preserved; the correction is metadata.
      tx.set(
        db.doc(paths.match(fixture.matchId)),
        { resultCorrection: { ...corrected, ...correction }, updatedAt: now() },
        { merge: true },
      );
    }
    writeAudit(tx, {
      operation: "result.correct",
      tournamentId,
      roundId: fixture.roundId,
      fixtureId: fixture.fixtureId,
      matchId: fixture.matchId || null,
      actor: ctx.actor,
      beforeSummary: correction.original,
      afterSummary: corrected,
      reason: data.reason,
    });
    return { corrected };
  });
  await recalculateTournament({ tournamentId });
  return { tournamentId, fixtureId: data.fixtureId, ...result };
}

// Pure progression over the in-memory state: advance every completed (or
// bye) bracket fixture until nothing changes. advanceBracket is idempotent.
function applyBracketProgression(format, state) {
  if (typeof format.advanceBracket !== "function") return new Map();
  const changed = new Map();
  let fixtures = state.fixtures.map((fixture) => ({ ...fixture }));
  for (let pass = 0; pass < 8; pass += 1) {
    let anyChange = false;
    const sources = fixtures.filter(
      (fixture) => fixture.status === "completed" || fixture.status === "bye",
    );
    for (const source of sources) {
      let updates;
      try {
        ({ updates } = format.advanceBracket({ ...state, fixtures }, source.fixtureId));
      } catch (error) {
        if (error?.name === "TournamentDomainError") continue;
        throw error;
      }
      for (const update of updates || []) {
        const index = fixtures.findIndex((fixture) => fixture.fixtureId === update.fixtureId);
        if (index < 0) continue;
        const before = fixtures[index];
        const after = { ...before, ...update.patch };
        // Never overwrite a fixture that is already being played.
        if (["live", "completed"].includes(before.status) && before.status !== after.status)
          continue;
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        fixtures[index] = after;
        changed.set(after.fixtureId, after);
        anyChange = true;
      }
    }
    if (!anyChange) break;
  }
  return changed;
}

function assertScheduleSize(generation, extraWrites = 0) {
  if (generation.fixtures.length * 3 + generation.rounds.length * 2 + extraWrites + 5 > 450) {
    throw precondition(
      "This forecast is too large to save atomically. Choose fewer rounds or courts.",
    );
  }
}

function rebuildRemainingSchedule(tx, state, format, matchesById, courts, actor) {
  const { tournament } = state;
  const protectedRound = state.fixtures.reduce((last, fixture) => {
    const match = matchesById[fixture.matchId];
    const protectedFixture =
      fixture.resultSnapshot ||
      ["live", "completed"].includes(fixture.status) ||
      ["live", "completed"].includes(match?.status) ||
      matchService.hasPoints(match?.scoreSummary);
    return protectedFixture ? Math.max(last, fixture.roundNumber) : last;
  }, 0);
  const retainedRounds = state.rounds.filter((round) => round.roundNumber <= protectedRound);
  const retainedFixtures = state.fixtures.filter(
    (fixture) => fixture.roundNumber <= protectedRound,
  );
  const target = Math.max(protectedRound, forecastRoundCount(format, state));
  let generation;
  try {
    generation = generateSchedule(
      format,
      {
        ...buildFormatState(state),
        rounds: retainedRounds,
        fixtures: retainedFixtures,
      },
      target,
    );
  } catch (error) {
    throw formatDomainError(error);
  }
  const generatedIds = new Set(generation.fixtures.map((fixture) => fixture.fixtureId));
  const removedFixtures = state.fixtures.filter(
    (fixture) => fixture.roundNumber > protectedRound && !generatedIds.has(fixture.fixtureId),
  );
  const removedRounds = state.rounds.filter((round) => round.roundNumber > target);
  const oldFixtures = indexBy(state.fixtures, "fixtureId");
  const newMatches = generation.fixtures.filter(
    (fixture) => matchesById[oldFixtures[fixture.fixtureId]?.matchId]?.status !== "scheduled",
  ).length;
  assertScheduleSize(generation, removedFixtures.length * 2 + removedRounds.length + newMatches);
  const duration =
    (tournament.scheduling.defaultMatchDurationMinutes +
      tournament.scheduling.defaultChangeoverMinutes) *
    60000;
  const startAt = Math.max(
    Date.now(),
    ...retainedFixtures.map((fixture) => Number(fixture.scheduledStartAt || 0) + duration),
  );
  const scheduled = scheduleGeneration(generation, { tournament, courts, nowMs: startAt });
  const previous = indexBy(state.fixtures, "fixtureId");
  const futureIds = new Set(scheduled.map((fixture) => fixture.fixtureId));
  state.fixtures
    .filter((fixture) => fixture.roundNumber > protectedRound)
    .forEach((fixture) => {
      const match = matchesById[fixture.matchId];
      if (match && match.status !== "cancelled" && !futureIds.has(fixture.fixtureId)) {
        tx.set(
          db.doc(paths.match(fixture.matchId)),
          {
            status: "cancelled",
            cancelledAt: now(),
            updatedAt: now(),
          },
          { merge: true },
        );
      }
      if (!futureIds.has(fixture.fixtureId))
        tx.delete(fixtureRef(tournament.tournamentId, fixture.fixtureId));
    });
  const fixtures = scheduled.map((fixture) => {
    const old = previous[fixture.fixtureId];
    const reusableMatch = old?.matchId && matchesById[old.matchId]?.status === "scheduled";
    const stored = {
      ...stripFixtureForStorage(fixture),
      createdAt: old?.createdAt || now(),
      ...(reusableMatch ? { matchId: old.matchId } : {}),
    };
    tx.set(fixtureRef(tournament.tournamentId, fixture.fixtureId), stored);
    return stored;
  });
  const futureRoundIds = new Set(generation.rounds.map((round) => round.roundId));
  state.rounds
    .filter((round) => round.roundNumber > protectedRound && !futureRoundIds.has(round.roundId))
    .forEach((round) => tx.delete(roundRef(tournament.tournamentId, round.roundId)));
  const rounds = generation.rounds.map((round) => ({
    ...JSON.parse(JSON.stringify(round)),
    tournamentId: tournament.tournamentId,
    generatedAt: now(),
    startedAt: null,
    completedAt: null,
    notes: null,
  }));
  rounds.forEach((round) => tx.set(roundRef(tournament.tournamentId, round.roundId), round));
  state.rounds = [...retainedRounds, ...rounds];
  state.fixtures = [...retainedFixtures, ...fixtures];
  tournament.forecastRoundCount = target;
  writeTournamentPatch(tx, tournament, {
    forecastRoundCount: target,
    lastGeneratedRoundNumber: target,
  });
  tournament.revision = Number(tournament.revision || 0) + 1;
  writeAudit(tx, {
    operation: "schedule.recalculate",
    tournamentId: tournament.tournamentId,
    actor,
    afterSummary: {
      protectedThroughRound: protectedRound,
      rounds: rounds.length,
      fixtures: fixtures.length,
    },
  });
}

async function recalculateTournament({ tournamentId, rebuildSchedule = false }, ctx = {}) {
  return db.runTransaction(async (tx) => {
    const state = await loadTournamentState(tx, tournamentId);
    const { tournament } = state;
    const [matches, courts, club] = await Promise.all([
      loadTournamentMatches(tx, tournamentId),
      loadCourts(tx, tournament.courtPool || []),
      loadClub(tx, tournament.clubId),
    ]);
    const format = getFormat(tournament.format.id);
    const matchesById = indexBy(matches, "matchId");
    const lookups = {
      participantsById: indexBy(state.participants, "participantId"),
      teamsById: indexBy(state.teams, "teamId"),
    };

    const fixtureWrites = new Map();
    const finished = ["completed", "cancelled"].includes(tournament.status);
    if (rebuildSchedule && supportsFullSchedule(format) && state.rounds.length) {
      assertNotFinished(tournament);
      rebuildRemainingSchedule(tx, state, format, matchesById, courts, ctx.actor);
    }

    // Fixture status mirrors its match when they ever disagree.
    state.fixtures.forEach((fixture) => {
      const match = fixture.matchId ? matchesById[fixture.matchId] : null;
      if (!match) return;
      if (match.status === "live" && fixture.status === "scheduled") {
        fixtureWrites.set(fixture.fixtureId, {
          ...fixture,
          status: "live",
          courtId: match.currentCourtId || fixture.courtId,
        });
      }
      if (match.status === "cancelled" && ["scheduled", "live"].includes(fixture.status)) {
        fixtureWrites.set(fixture.fixtureId, { ...fixture, status: "cancelled" });
      }
    });
    const mirrored = state.fixtures.map(
      (fixture) => fixtureWrites.get(fixture.fixtureId) || fixture,
    );

    if (!finished) {
      const progressed = applyBracketProgression(format, {
        ...buildFormatState(state),
        fixtures: mirrored,
      });
      progressed.forEach((fixture, fixtureId) => fixtureWrites.set(fixtureId, fixture));
    }
    let fixtures = mirrored.map((fixture) => fixtureWrites.get(fixture.fixtureId) || fixture);

    // Matches are created as soon as both sides of a fixture are known, and
    // a scheduled match follows its fixture's sides.
    const createdMatches = [];
    if (!finished) {
      fixtures = fixtures.map((fixture) => {
        if (fixture.status !== "scheduled" || !fixtureSidesComplete(fixture)) return fixture;
        if (!fixture.matchId) {
          const prepared = prepareFixtureMatch({ tournament, fixture, lookups });
          matchService.writePreparedMatch(tx, prepared);
          createdMatches.push({ matchId: prepared.matchId, ...prepared.match });
          const next = { ...fixture, matchId: prepared.matchId };
          fixtureWrites.set(fixture.fixtureId, next);
          return next;
        }
        const match = matchesById[fixture.matchId];
        if (match && match.status === "scheduled") {
          const spec = buildFixtureMatchSpec({ tournament, fixture, ...lookups });
          if (matchNamesDiffer(match, spec)) {
            tx.set(
              db.doc(paths.match(fixture.matchId)),
              { teamNames: spec.teamNames, playerNames: spec.playerNames, updatedAt: now() },
              { merge: true },
            );
            matchesById[fixture.matchId] = {
              ...match,
              teamNames: spec.teamNames,
              playerNames: spec.playerNames,
            };
          }
        }
        return fixture;
      });
    }

    const fixtureIds = new Set(state.fixtures.map((fixture) => fixture.fixtureId));
    fixtureWrites.forEach((fixture, fixtureId) => {
      if (!fixtureIds.has(fixtureId)) return;
      const { fixtureId: _id, ...data } = fixture;
      tx.set(fixtureRef(tournamentId, fixtureId), data, { merge: true });
    });

    const view = buildTournamentView({
      tournament,
      participants: state.participants.filter((p) => p.status !== "removed"),
      teams: state.teams.filter((t) => t.status !== "removed"),
      rounds: state.rounds,
      fixtures,
      matches: [...Object.values(matchesById), ...createdMatches],
      courts,
      club,
      now: Date.now(),
    });

    view.rounds.forEach((roundView) => {
      const round = state.rounds.find((r) => r.roundId === roundView.roundId);
      if (round && round.status !== roundView.status) {
        tx.set(
          roundRef(tournamentId, round.roundId),
          {
            status: roundView.status,
            ...(roundView.status === "live" && !round.startedAt ? { startedAt: now() } : {}),
            ...(roundView.status === "completed" && !round.completedAt
              ? { completedAt: now() }
              : {}),
          },
          { merge: true },
        );
      }
    });

    const viewDoc = {
      ...JSON.parse(JSON.stringify(view)),
      revision: Number(tournament.revision || 0),
      updatedAt: now(),
    };
    if (tournament.visibility === "private") {
      tx.set(db.doc(paths.tournamentPrivateView(tournamentId)), viewDoc);
      tx.set(db.doc(paths.tournamentView(tournamentId)), {
        tournamentId,
        visibility: "private",
        status: tournament.status,
        updatedAt: now(),
      });
      tx.delete(db.doc(paths.tournamentDirectory(tournamentId)));
    } else {
      tx.set(db.doc(paths.tournamentView(tournamentId)), viewDoc);
      tx.delete(db.doc(paths.tournamentPrivateView(tournamentId)));
      // Small directory entry for search and discovery (spec section 44).
      tx.set(db.doc(paths.tournamentDirectory(tournamentId)), {
        tournamentId,
        name: tournament.name,
        status: tournament.status,
        visibility: "public",
        clubId: tournament.clubId || null,
        clubName: club?.name || null,
        formatId: tournament.format.id,
        formatLabel: format.label,
        startAt: tournament.scheduling?.startAt ?? null,
        updatedAt: now(),
      });
    }
    if (view.currentRound && view.currentRound.roundNumber !== tournament.currentRoundNumber) {
      tx.set(
        tournamentRef(tournamentId),
        { currentRoundNumber: view.currentRound.roundNumber },
        { merge: true },
      );
    }
    return {
      tournamentId,
      fixturesUpdated: fixtureWrites.size,
      matchesCreated: createdMatches.length,
    };
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function getTournamentView(data, credentials) {
  const publicSnap = await db.doc(paths.tournamentView(data.tournamentId)).get();
  if (!publicSnap.exists) throw notFound("That tournament could not be found.");
  const publicView = publicSnap.data();
  if (publicView.visibility !== "private") return { view: publicView };

  const secretSnap = await db.doc(paths.tournamentSecret(data.tournamentId)).get();
  const secret = secretSnap.exists ? secretSnap.data() : {};
  const { isAdmin } = require("./authService");
  const allowed =
    (await isAdmin(credentials)) ||
    secretsMatch(credentials.hostKey, secret.hostKeyHash) ||
    secretsMatch(data.accessCode, secret.accessCodeHash);
  if (!allowed) throw denied("This tournament is private. Enter its access code to view it.");
  const privateSnap = await db.doc(paths.tournamentPrivateView(data.tournamentId)).get();
  return { view: privateSnap.exists ? privateSnap.data() : publicView };
}

async function getCourtOptions(data) {
  const snap = await db.collection("courts").get();
  const courts = snap.docs.map((docSnap) => ({ courtId: docSnap.id, ...docSnap.data() }));
  const club = await loadClub(null, data.clubId || null);
  return {
    club: club ? { clubId: club.clubId, name: club.name } : null,
    courts: orderCourtCandidates(courts, {
      clubId: club?.clubId || null,
      selectedCourtIds: data.selectedCourtIds || [],
    }),
  };
}

// Setup warnings (spec section 36): advisory, never blocking.
function setupWarnings({ format, input, preview }) {
  const warnings = [];
  if (!preview) return warnings;
  const scheduling = input.scheduling;
  if (scheduling.startAt && scheduling.plannedEndAt) {
    const availableMinutes = (scheduling.plannedEndAt - scheduling.startAt) / 60000;
    if (preview.estimatedMinutes > availableMinutes) {
      warnings.push({
        code: "LIKELY_OVERRUN",
        message: `The schedule needs about ${preview.estimatedMinutes} minutes but ${Math.round(availableMinutes)} are planned.`,
      });
    }
  }
  if (preview.courtsNeeded > input.courtPool.length && input.courtPool.length > 0) {
    warnings.push({
      code: "IDLE_PLAYERS",
      message: `Only ${input.courtPool.length} court(s) for ${preview.courtsNeeded} simultaneous matches: players will wait between matches.`,
    });
  }
  if (format.kind === "rotating") {
    if (scheduling.targetRoundCount && scheduling.targetRoundCount < 3) {
      warnings.push({
        code: "FEW_ROUNDS",
        message: "Fewer than 3 rounds gives each player few different partners.",
      });
    }
    if (preview.sittingOut > 0) {
      warnings.push({
        code: "SITTING_OUT",
        message: `${preview.sittingOut} player(s) sit out each round; sitting out is rotated fairly.`,
      });
    }
  }
  if (preview.byes > 0 && ["bracket", "groupBracket", "league", "swiss"].includes(format.kind)) {
    warnings.push({
      code: "BYES",
      message: `${preview.byes} bye(s) in the first schedule; byes are not losses and are rotated where possible.`,
    });
  }
  return warnings;
}

// Setup preview (spec section 35, step 7) without persisting anything.
function previewTournament(data) {
  const input = normalizeTournamentInput({ name: data.name || "Preview", ...data });
  const format = getFormat(input.format.id);
  const participants = (data.participants || []).map((p, index) => ({
    participantId: p.participantId || `preview-p${index + 1}`,
    displayName: p.displayName || `Player ${index + 1}`,
    seed: p.seed ?? null,
    gender: p.gender || null,
    status: "active",
  }));
  const teams = (data.teams || []).map((team, index) => ({
    teamId: team.teamId || `preview-t${index + 1}`,
    name: team.name || `Team ${index + 1}`,
    participantIds: team.participantIds || [`preview-t${index + 1}-a`, `preview-t${index + 1}-b`],
    seed: team.seed ?? null,
    status: "active",
  }));
  const tournament = { tournamentId: "preview", status: "draft", ...input };
  const validation = validateTournamentSetup({
    format: input.format,
    participantMode: input.participantMode,
    participants,
    teams,
    courtPool: input.courtPool,
  });
  const rules = buildRulesSummary(tournament, null);

  let firstRound = null;
  if (!validation.errors.length) {
    try {
      const previewState = buildFormatState({
        tournament,
        participants,
        teams,
        rounds: [],
        fixtures: [],
      });
      const generation = supportsFullSchedule(format)
        ? generateSchedule(format, previewState)
        : format.generateInitialRound(previewState);
      assertScheduleSize(generation);
      const playable = generation.fixtures.filter((f) => f.status === "scheduled");
      const courts = Math.max(1, input.courtPool.length || 1);
      const waves = generation.rounds.reduce((sum, round) => {
        const count = playable.filter((f) => f.roundId === round.roundId).length;
        return sum + Math.max(1, Math.ceil(count / courts));
      }, 0);
      const minutesPerWave =
        input.scheduling.defaultMatchDurationMinutes + input.scheduling.defaultChangeoverMinutes;
      firstRound = {
        rounds: generation.rounds.length,
        matches: playable.length,
        byes: generation.fixtures.filter((f) => f.status === "bye").length,
        sittingOut:
          generation.rounds[0].sittingOutParticipantIds.length +
          generation.rounds[0].sittingOutTeamIds.length,
        courtsNeeded: Math.max(
          ...generation.rounds.map(
            (round) => playable.filter((f) => f.roundId === round.roundId).length,
          ),
          0,
        ),
        estimatedMinutes: waves * minutesPerWave,
      };
    } catch (error) {
      validation.errors.push({ code: error.code || "GENERATION_FAILED", message: error.message });
    }
  }
  validation.warnings.push(...setupWarnings({ format, input, preview: firstRound }));
  return {
    errors: validation.errors,
    warnings: validation.warnings,
    rulesSummary: { title: rules.title, lines: rules.lines },
    scoringOptions: rules.scoringOptions,
    participantMode: input.participantMode,
    preview: firstRound,
  };
}

module.exports = {
  listFormats,
  loadTournamentState,
  createTournament,
  updateTournament,
  publishTournament,
  unpublishTournament,
  startTournament,
  completeTournament,
  cancelTournament,
  addParticipants,
  updateParticipant,
  removeParticipant,
  withdrawParticipant,
  restoreParticipant,
  createTeam,
  updateTeam,
  removeTeam,
  withdrawTeam,
  restoreTeam,
  replaceTeamMember,
  generateRound,
  startFixture,
  startRound,
  assignFixtureCourt,
  setFixtureSchedule,
  moveFixtureCourt,
  detachFixtureMatch,
  renameFixture,
  completeFixture,
  createFixtureMatch,
  correctTournamentResult,
  recalculateTournament,
  fixtureRequiresWinner,
  assertFixtureReopenable,
  applyBracketProgression,
  getTournamentView,
  getCourtOptions,
  previewTournament,
};
