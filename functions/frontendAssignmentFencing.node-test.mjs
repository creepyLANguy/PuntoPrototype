import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

import {
  callableHandlers,
  firestoreState,
  makeSnapshot,
  resetFirestoreState,
  seedDoc,
  writeDoc,
} from "./frontendHarness/mockFirestoreState.mjs";

register("./frontendHarness/loaderHooks.mjs", import.meta.url);

const context = await import("../app/js/firebase/assignmentContext.js");
const courts = await import("../app/js/firebase/courtRepository.js");
const matches = await import("../app/js/firebase/matchRepository.js");
const clubs = await import("../app/js/firebase/clubRepository.js");
const tournaments = await import("../app/js/firebase/tournamentRepository.js");
const devices = await import("../app/js/firebase/deviceRepository.js");
const api = await import("../app/js/firebase/callables.js");
const { getCourtCredentials } = await import("../app/js/state/credentialsState.js");
const { session, clearMatchContext } = await import("../app/js/state/sessionState.js");

const ids = { court: "abcda", match: "abcdef", club: "abch", tournament: "abcdefg" };
const collections = { court: "courts", match: "matches", club: "clubs", tournament: "tournaments" };
const reads = { court: courts.getCourt, match: matches.getMatch, club: clubs.getClub };

test.beforeEach(() => {
  resetFirestoreState();
  callableHandlers.clear();
  context.clearAssignment();
  clearMatchContext();
  session.currentCourtId = null;
  session.currentCourtAllocationId = null;
  for (const [type, id] of Object.entries(ids)) {
    seedDoc(`${collections[type]}/${id}`, {
      allocationId: `${type}-old`,
      status: "live",
      visibility: "public",
    });
  }
});

test("observed assignments remain pinned across deletion and short-id reuse", () => {
  for (const [type, id] of Object.entries(ids)) {
    const old = { allocationId: `${type}-old` };
    assert.equal(context.rememberAssignment(type, id, old), old.allocationId);
    context.rememberAssignment(type, id, { allocationId: `${type}-new` });
    assert.equal(context.getAllocationId(type, id), old.allocationId);
    assert.throws(() => context.assertCurrentAssignment(type, id), { code: "assignment-changed" });
    context.clearAssignment(type, id);
    context.rememberAssignment(type, id, { allocationId: `${type}-new` });
    assert.equal(context.assertCurrentAssignment(type, id), `${type}-new`);
  }
  context.rememberAssignment("match", ids.match, null);
  assert.throws(() => context.assertCurrentAssignment("match", ids.match));
});

test("partial mutation acknowledgements do not invalidate observed match assignments", async () => {
  await matches.getMatch(ids.match);
  callableHandlers.set("manageMatch", async () => ({
    data: { success: true, matchId: ids.match },
  }));
  await api.manageMatch("completeMatch", { matchId: ids.match });
  assert.equal(context.assertCurrentAssignment("match", ids.match), "match-old");
  await api.manageMatch("resetMatch", { matchId: ids.match });
  assert.equal(context.assertCurrentAssignment("match", ids.match), "match-old");

  callableHandlers.set("manageMatch", async () => ({
    data: { matchId: ids.match, allocationId: "match-new" },
  }));
  await api.manageMatch("completeMatch", { matchId: ids.match });
  assert.throws(() => context.assertCurrentAssignment("match", ids.match), {
    code: "assignment-changed",
  });
});

test("partial tournament live-match projections do not invalidate captured assignments", async () => {
  await matches.getMatch(ids.match);
  callableHandlers.set("manageTournament", async () => ({
    data: { liveMatches: [{ matchId: ids.match, scoreSummary: null }] },
  }));
  await api.manageTournament("getTournamentView", { tournamentId: ids.tournament });
  assert.equal(context.assertCurrentAssignment("match", ids.match), "match-old");

  callableHandlers.set("manageTournament", async () => ({
    data: { liveMatches: [{ matchId: ids.match, allocationId: "match-new" }] },
  }));
  await api.manageTournament("getTournamentView", { tournamentId: ids.tournament });
  assert.throws(() => context.assertCurrentAssignment("match", ids.match), {
    code: "assignment-changed",
  });
});

test("fixture creation pins its match without replacing the tournament assignment", async () => {
  context.rememberAssignment("tournament", ids.tournament, { allocationId: "tournament-old" });
  callableHandlers.set("manageTournament", async () => ({
    data: {
      tournamentId: ids.tournament,
      matchId: ids.match,
      allocationId: "fixture-match-assignment",
    },
  }));
  await api.manageTournament("createFixtureMatch", {
    tournamentId: ids.tournament,
    fixtureId: "fixture-1",
  });
  assert.equal(context.assertCurrentAssignment("tournament", ids.tournament), "tournament-old");
  assert.equal(context.assertCurrentAssignment("match", ids.match), "fixture-match-assignment");
});

test("root/list reads preserve SDK snapshots and capture each resource generation", async () => {
  for (const [type, read] of Object.entries(reads)) {
    const snap = await read(ids[type]);
    assert.equal(snap.exists(), true);
    assert.equal(snap.id, ids[type]);
    assert.equal(context.getAllocationId(type, snap.id), `${type}-old`);
  }
  await Promise.all([
    courts.getAllCourts(),
    clubs.getAllClubs(),
    matches.getLiveMatches(),
    matches.getMatchesByStatus("live"),
    tournaments.getAllTournaments(),
  ]);
  assert.equal(context.getAllocationId("tournament", ids.tournament), "tournament-old");
  const snapshot = makeSnapshot(`courts/${ids.court}`, { allocationId: "court-old" });
  assert.equal(context.rememberSnapshot("court", ids.court, snapshot), snapshot);
});

test("direct updates and scoring events send the observed generation, never a fresh read", async () => {
  await courts.getCourt(ids.court);
  await matches.getMatch(ids.match);
  seedDoc(`matches/${ids.match}`, { allocationId: "match-new" });
  await matches.updateMatch(ids.match, { teamNames: { A: "Old draft" } });
  assert.equal(firestoreState.docs.get(`matches/${ids.match}`).allocationId, "match-old");
  await courts.updateCourt(ids.court, { name: "Court draft" });
  assert.equal(firestoreState.docs.get(`courts/${ids.court}`).allocationId, "court-old");
  const eventRef = await matches.addMatchEvent(ids.match, {
    eventType: "WARMUP",
    createdBy: "test-device",
    courtId: ids.court,
  });
  const event = firestoreState.docs.get(eventRef.path);
  assert.equal(event.allocationId, "match-old");
  assert.equal(event.courtAllocationId, "court-old");
  assert.throws(() => matches.updateMatch(ids.match, { allocationId: "match-new" }));
});

test("listener reuse invalidates later mutations instead of adopting the replacement", async () => {
  const snapshots = [];
  const unsubscribe = matches.listenToMatch(ids.match, (snap) => snapshots.push(snap));
  await Promise.resolve();
  writeDoc(`matches/${ids.match}`, { allocationId: "match-new" });
  await Promise.resolve();
  assert.equal(snapshots.at(-1).data().allocationId, "match-new");
  assert.equal(context.getAllocationId("match", ids.match), "match-old");
  assert.throws(() =>
    matches.addMatchEvent(ids.match, {
      eventType: "WARMUP",
      createdBy: "test-device",
    }),
  );
  assert.throws(() => matches.updateMatch(ids.match, { teamNames: {} }));
  unsubscribe();
});

test("court listeners and tournament read models preserve allocation identity", async () => {
  const courtSnapshots = [];
  const unsubscribeCourt = courts.listenToCourtDocument(ids.court, (snap) =>
    courtSnapshots.push(snap),
  );
  seedDoc(`tournamentViews/${ids.tournament}`, {
    tournamentId: ids.tournament,
    allocationId: "tournament-old",
  });
  const unsubscribeTournament = tournaments.listenToTournamentView(ids.tournament, () => {});
  await Promise.resolve();
  assert.equal(context.getAllocationId("tournament", ids.tournament), "tournament-old");
  writeDoc(`courts/${ids.court}`, { allocationId: "court-new" });
  await Promise.resolve();
  assert.equal(courtSnapshots.at(-1).data().allocationId, "court-new");
  assert.throws(() => courts.updateCourt(ids.court, { name: "Stale name" }));
  assert.equal(context.getAllocationId("court", ids.court), "court-old");
  unsubscribeCourt();
  unsubscribeTournament();
});

test("callables synchronously capture primary and referenced resource generations", async () => {
  await Promise.all([
    courts.getCourt(ids.court),
    matches.getMatch(ids.match),
    clubs.getClub(ids.club),
    tournaments.getAllTournaments(),
  ]);
  let request;
  callableHandlers.set("manageMatch", async (payload) => {
    request = payload;
    return { data: { success: true } };
  });
  await api.manageMatch(
    "moveMatch",
    {
      matchId: ids.match,
      courtId: ids.court,
      clubId: ids.club,
      tournamentId: ids.tournament,
    },
    { adminKey: "test-admin" },
  );
  assert.deepEqual(request.expectedAllocations, {
    court: { [ids.court]: "court-old" },
    match: { [ids.match]: "match-old" },
    club: { [ids.club]: "club-old" },
    tournament: { [ids.tournament]: "tournament-old" },
  });
  assert.equal(request.credentials.adminKey, "test-admin");
  await assert.rejects(
    api.manageMatch("moveMatch", {
      matchId: ids.match,
      allocationId: "match-new",
    }),
  );
  await assert.rejects(
    api.manageMatch(
      "moveMatch",
      {
        matchId: ids.match,
      },
      { matchAllocationId: null },
    ),
  );
});

test("creation responses remember returned allocations and club picks carry maps", async () => {
  await courts.getAllCourts();
  let request;
  callableHandlers.set("createClub", async (payload) => {
    request = payload;
    return { data: { clubId: ids.club, allocationId: "created-club" } };
  });
  const created = await api.createClub({
    name: "Club",
    courtIds: [ids.court],
    credentials: { adminKey: "test-admin" },
  });
  assert.equal(created.data.clubId, ids.club);
  assert.equal(context.getAllocationId("club", ids.club), "created-club");
  assert.deepEqual(request.expectedAllocations.court, { [ids.court]: "court-old" });
  callableHandlers.set("createCourt", async () => ({
    data: { courtId: ids.court },
  }));
  await assert.rejects(api.createWithUniqueId("court"), TypeError);
});

test("nested metadata references and aliases preserve captured resource allocations", async () => {
  await courts.getCourt(ids.court);
  await matches.getMatch(ids.match);
  await clubs.getClub(ids.club);
  await tournaments.getAllTournaments();
  const payload = {
    tournamentId: ids.tournament,
    patch: {
      clubId: ids.club,
      courtPool: [ids.court],
      metadata: {
        targetClubId: ids.club,
        sourceCourtId: ids.court,
        currentMatchId: ids.match,
        fixtureId: "round-1-fixture-1",
        resourceId: ids.match,
        resourceType: "match",
      },
    },
  };
  assert.deepEqual(context.captureExpectedAllocations(payload), {
    court: { [ids.court]: "court-old" },
    match: { [ids.match]: "match-old" },
    club: { [ids.club]: "club-old" },
    tournament: { [ids.tournament]: "tournament-old" },
  });
  assert.throws(() =>
    context.captureExpectedAllocations({
      ...payload,
      patch: { clubId: ids.club, clubAllocationId: "club-new" },
    }),
  );
  const staleResponseId = "abck";
  context.rememberAssignment("club", staleResponseId, { allocationId: "former-club" });
  callableHandlers.set("createClub", async () => ({
    data: { clubId: staleResponseId, allocationId: "created-club" },
  }));
  await api.createClub({ name: "Created club" });
  assert.equal(context.getAllocationId("club", staleResponseId), "former-club");
  assert.throws(() => context.assertCurrentAssignment("club", staleResponseId));
});

test("court and club deletions use authenticated fenced callables, not direct SDK deletion", async () => {
  await courts.getCourt(ids.court);
  await clubs.getClub(ids.club);
  for (const [type, remove] of [
    ["court", courts.deleteCourt],
    ["club", api.deleteClub],
  ]) {
    let request;
    callableHandlers.set(`delete${type[0].toUpperCase()}${type.slice(1)}`, async (payload) => {
      request = payload;
      return { data: { success: true } };
    });

    await remove(ids[type], { adminKey: "test-admin" }, `${type}-old`);
    assert.equal(request.credentials.adminKey, "test-admin");
    assert.equal(request.expectedAllocations[type][ids[type]], `${type}-old`);
    assert.ok(firestoreState.docs.has(`${collections[type]}/${ids[type]}`));
  }
});

test("implicit-court mutations include the match pin from captured session credentials", async () => {
  await courts.getCourt(ids.court);
  await matches.getMatch(ids.match);
  session.currentCourtId = ids.court;
  session.currentCourtAllocationId = "court-old";
  session.currentMatchId = ids.match;
  session.currentMatchAllocationId = "match-old";
  let request;
  for (const name of ["resetCourt", "changeoverCourt", "updateScoringOptions"]) {
    callableHandlers.set(name, async (payload) => {
      request = payload;
      return { data: { success: true } };
    });
  }
  const credentials = getCourtCredentials();
  await api.resetCourt(ids.court, false, null, false, credentials);
  assert.equal(request.expectedAllocations.match[ids.match], "match-old");
  await api.changeoverCourt({ courtId: ids.court, credentials });
  assert.equal(request.expectedAllocations.match[ids.match], "match-old");
  await api.updateScoringOptions({
    courtId: ids.court,
    credentials,
    expectedAllocations: { court: { [ids.court]: "court-old" } },
  });
  assert.equal(request.expectedAllocations.match[ids.match], "match-old");
  context.rememberAssignment("match", ids.match, { allocationId: "match-new" });
  await assert.rejects(api.resetCourt(ids.court, false, null, false, credentials));
});

test("device reference writes require observed targets, fence drafts and support null clears", async () => {
  assert.throws(() => devices.setDevice("physical-device", { courtId: ids.court }), {
    code: "assignment-not-found",
    message:
      'The court "abcda" was not found in the loaded courts. Select an existing court, or refresh the list and try again.',
  });
  await courts.getCourt(ids.court);
  await clubs.getClub(ids.club);
  await devices.setDevice("physical-device", { courtId: ids.court, clubId: ids.club });
  assert.deepEqual(firestoreState.docs.get("devices/physical-device"), {
    courtId: ids.court,
    courtAllocationId: "court-old",
    clubId: ids.club,
    clubAllocationId: "club-old",
  });

  assert.throws(
    () =>
      devices.updateDevice("physical-device", {
        courtId: ids.court,
        courtAllocationId: "court-new",
      }),
    { code: "assignment-changed" },
  );
  context.rememberAssignment("court", ids.court, { allocationId: "court-new" });
  assert.throws(() => devices.updateDevice("physical-device", { courtId: ids.court }), {
    code: "assignment-changed",
  });
  await devices.updateDevice("physical-device", { courtId: null, clubId: null });
  assert.deepEqual(firestoreState.docs.get("devices/physical-device"), {
    courtId: null,
    courtAllocationId: null,
    clubId: null,
    clubAllocationId: null,
  });
});

test("court relationship updates send companion allocations and reject missing targets", async () => {
  await courts.getCourt(ids.court);
  assert.throws(() => courts.updateCourt(ids.court, { activeMatchId: ids.match }));
  assert.throws(() => courts.updateCourt(ids.court, { clubId: ids.club }));
  await matches.getMatch(ids.match);
  await clubs.getClub(ids.club);
  await courts.updateCourt(ids.court, {
    activeMatchId: ids.match,
    lastMatchId: ids.match,
    clubId: ids.club,
  });
  const court = firestoreState.docs.get(`courts/${ids.court}`);
  assert.equal(court.allocationId, "court-old");
  assert.equal(court.activeMatchAllocationId, "match-old");
  assert.equal(court.lastMatchAllocationId, "match-old");
  assert.equal(court.clubAllocationId, "club-old");
  await courts.updateCourt(ids.court, { activeMatchId: null, lastMatchId: null, clubId: null });
  const cleared = firestoreState.docs.get(`courts/${ids.court}`);
  assert.equal(cleared.activeMatchAllocationId, null);
  assert.equal(cleared.lastMatchAllocationId, null);
  assert.equal(cleared.clubAllocationId, null);
});

test("clearing match context also clears its allocation pin from session state", () => {
  session.currentMatchId = ids.match;
  session.currentMatchAllocationId = "match-old";
  session.currentCourtId = ids.court;
  session.currentCourtAllocationId = "court-old";
  assert.deepEqual(getCourtCredentials().expectedAllocations, {
    court: { [ids.court]: "court-old" },
    match: { [ids.match]: "match-old" },
  });
  clearMatchContext();
  assert.equal(session.currentMatchId, null);
  assert.equal(session.currentMatchAllocationId, null);
});

test("an open match rejects a reused-id listener and leave clears session generations", async () => {
  const { bootFrontend, seedBaseData, seedCourt, settle } =
    await import("./frontendHarness/harness.mjs");
  seedBaseData();
  seedCourt(ids.court);
  seedDoc(`courts/${ids.court}`, {
    ...firestoreState.docs.get(`courts/${ids.court}`),
    allocationId: "court-old",
  });
  const matchId = `${ids.court}a`;
  seedDoc(`matches/${matchId}`, {
    ...firestoreState.docs.get(`matches/${matchId}`),
    allocationId: "match-old",
  });
  const dom = await bootFrontend();
  const { enterCourt, leaveCourt } = await import("../app/js/court/session.js");
  const { isCurrentMatchScorable } = await import("../app/js/court/matchSync.js");
  await assert.rejects(
    enterCourt(ids.court, false, {
      historyMode: "skip",
      courtAllocationId: "old-url-court",
    }),
    { code: "assignment-changed" },
  );
  context.clearAssignment();
  await enterCourt(ids.court, false, {
    historyMode: "skip",
    courtAllocationId: "court-old",
    matchId,
    matchAllocationId: "match-old",
  });
  await settle();
  assert.equal(session.currentCourtAllocationId, "court-old");
  assert.equal(session.currentMatchAllocationId, "match-old");
  const oldMatch = firestoreState.docs.get(`matches/${matchId}`);
  writeDoc(`matches/${matchId}`, { ...oldMatch, allocationId: "match-new" });
  await settle();
  assert.equal(session.currentMatchAllocationId, "match-old");
  assert.equal(session.currentMatchStatus, null);
  assert.equal(isCurrentMatchScorable(), false);
  assert.throws(() =>
    matches.addMatchEvent(matchId, {
      eventType: "POINT_TEAM_A",
      createdBy: "test-device",
      courtId: ids.court,
      allocationId: "match-old",
    }),
  );
  leaveCourt("skip");
  assert.equal(session.currentCourtAllocationId, null);
  assert.equal(session.currentMatchAllocationId, null);
  dom.window.close();
});
