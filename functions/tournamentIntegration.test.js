// End-to-end service tests for the match foundation and the tournament suite
// (spec section 66.2), against an in-memory Firestore.
const { FakeFirestore } = require("./testSupport/fakeFirestore");

let mockDb = null;

jest.mock("firebase-functions/v2/firestore", () => ({
  onDocumentCreated: (_config, handler) => handler,
  onDocumentDeleted: (_config, handler) => handler,
}));

jest.mock("firebase-functions/v2/https", () => ({
  onCall: (_config, handler) => handler,
  onRequest: (_config, handler) => handler,
}));

jest.mock("firebase-admin", () => ({
  initializeApp: jest.fn(),
  firestore: () => mockDb,
}));

jest.mock("firebase-admin/firestore", () => ({
  FieldPath: { documentId: () => "__name__" },
  FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
}));

const ADMIN_KEY = "skeleton-key";

function seed() {
  return new FakeFirestore({
    "admin/goodies": { skeletonKey: ADMIN_KEY },
    "clubs/club1": { name: "Example Padel Club", courtIds: ["c1", "c2"], deviceIds: [] },
    "courts/c1": { name: "Court 1", password: "pass1", status: "open", clubId: "club1" },
    "courts/c2": { name: "Court 2", password: "pass2", status: "open", clubId: "club1" },
    "courts/c3": { name: "Court 3", password: "pass3", status: "open", clubId: null },
    "courts/c4": { name: "Court 4", password: "pass4", status: "closed", clubId: "club1" },
  });
}

let api;

function load() {
  jest.isolateModules(() => {
    api = require("./index");
  });
}

beforeEach(() => {
  mockDb = seed();
  jest.spyOn(console, "debug").mockImplementation(() => {});
  load();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const tournament = (operation, data = {}, credentials = {}) =>
  api.manageTournament({ data: { operation, ...data, credentials } });
const match = (operation, data = {}, credentials = {}) =>
  api.manageMatch({ data: { operation, ...data, credentials } });

let eventCounter = 0;
async function score(matchId, sequence) {
  for (const team of sequence) {
    const matchDoc = mockDb.get(`matches/${matchId}`);
    eventCounter += 1;
    const eventId = `ev${String(eventCounter).padStart(6, "0")}`;
    const event = {
      eventType: team === "A" ? "POINT_TEAM_A" : "POINT_TEAM_B",
      createdAt: { seconds: 100000 + eventCounter, nanoseconds: 0 },
      scoreVersion: matchDoc.scoreVersion || 0,
      matchId,
    };
    mockDb.docs.set(`matches/${matchId}/events/${eventId}`, event);
    await api.onEventCreate({ params: { matchId, eventId }, data: { data: () => ({ ...event }) } });
  }
}

const PLAYERS = ["Alice", "Ben", "Chris", "Dan", "Eva", "Finn", "Gina", "Hugo"];

async function createAmericano(extra = {}) {
  const created = await tournament("createTournament", {
    name: "Friday Night Padel Social",
    clubId: "club1",
    format: { id: "americano", config: { scoring: { pointsTarget: 36 } } },
    courtPool: ["c1", "c2"],
    participantText: PLAYERS.join("\n"),
    scheduling: { defaultMatchDurationMinutes: 15, defaultChangeoverMinutes: 2 },
    ...extra,
  });
  return created;
}

const view = (tournamentId) => mockDb.get(`tournamentViews/${tournamentId}`);

describe("match foundation", () => {
  test("a court gets a durable casual match on demand, idempotently", async () => {
    const first = await match("ensureCourtMatch", { courtId: "c1" });
    const second = await match("ensureCourtMatch", { courtId: "c1" });
    expect(first.created).toBe(true);
    expect(second.matchId).toBe(first.matchId);
    expect(mockDb.get("courts/c1").activeMatchId).toBe(first.matchId);
    const matchDoc = mockDb.get(`matches/${first.matchId}`);
    expect(matchDoc).toMatchObject({ status: "live", currentCourtId: "c1", kind: "casual" });
    expect(mockDb.get(`matches/${first.matchId}/score/current`)).toBeDefined();
  });

  test("scoring events are match-scoped and replay never depends on the court", async () => {
    const { matchId } = await match("ensureCourtMatch", { courtId: "c1" });
    await score(matchId, "AAB");
    const current = mockDb.get(`matches/${matchId}/score/current`);
    expect(current.A.points).toBe(2);
    expect(mockDb.get(`matches/${matchId}`).scoreSummary.A.totalPoints).toBe(2);
    expect(mockDb.list("courts/c1/events")).toHaveLength(0);
  });

  test("reset keeps the match id, bumps the score version and archives history", async () => {
    const { matchId } = await match("ensureCourtMatch", { courtId: "c1" });
    await score(matchId, "AA");
    await expect(match("resetMatch", { matchId })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    const result = await match("resetMatch", { matchId }, { courtPassword: "pass1" });
    expect(result.matchId).toBe(matchId);
    expect(result.scoreVersion).toBe(1);
    expect(mockDb.get(`matches/${matchId}/score/current`).A.points).toBe(0);
    expect(mockDb.list(`matches/${matchId}/events`)).toHaveLength(0);
    expect(mockDb.get("courts/c1").activeMatchId).toBe(matchId);
  });

  test("a court has at most one live match and moves are atomic", async () => {
    const casual = await match("ensureCourtMatch", { courtId: "c2" });
    await score(casual.matchId, "A");
    const { matchId } = await match("createMatch", { name: "Exhibition" }, { adminKey: ADMIN_KEY });

    await expect(
      match("startMatch", { matchId, courtId: "c2" }, { adminKey: ADMIN_KEY }),
    ).rejects.toThrow(/already occupied/);
    await expect(
      match("startMatch", { matchId, courtId: "c4" }, { adminKey: ADMIN_KEY }),
    ).rejects.toThrow(/closed/);

    await match("startMatch", { matchId, courtId: "c1" }, { adminKey: ADMIN_KEY });
    await match("moveMatch", { matchId, courtId: "c3" }, { adminKey: ADMIN_KEY });
    expect(mockDb.get("courts/c1").activeMatchId).toBeNull();
    expect(mockDb.get("courts/c3").activeMatchId).toBe(matchId);
    expect(mockDb.get(`matches/${matchId}`)).toMatchObject({
      currentCourtId: "c3",
      name: "Exhibition",
    });

    await match("startMatch", { matchId: casual.matchId, courtId: "c2" }, { adminKey: ADMIN_KEY });
    await match("detachMatch", { matchId }, { adminKey: ADMIN_KEY });
    expect(mockDb.get(`matches/${matchId}`)).toMatchObject({
      status: "live",
      currentCourtId: null,
    });
    expect(mockDb.get("courts/c3").activeMatchId).toBeNull();

    await match("startMatch", { matchId, courtId: "c3" }, { adminKey: ADMIN_KEY });
    await match("completeMatch", { matchId }, { adminKey: ADMIN_KEY });
    expect(mockDb.get(`matches/${matchId}`).status).toBe("completed");
    expect(mockDb.get("courts/c3").activeMatchId).toBeNull();
  });

  test("an empty placeholder match is displaced silently", async () => {
    const casual = await match("ensureCourtMatch", { courtId: "c1" });
    const { matchId } = await match(
      "createMatch",
      { name: "Final", courtId: "c1" },
      { adminKey: ADMIN_KEY },
    );
    expect(mockDb.get(`matches/${casual.matchId}`).status).toBe("cancelled");
    expect(mockDb.get("courts/c1").activeMatchId).toBe(matchId);
  });

  test("public score API resolves courts and matches with match-name identity", async () => {
    const { matchId } = await match(
      "createMatch",
      { name: "Friday Night Final", courtId: "c1" },
      { adminKey: ADMIN_KEY },
    );
    const respond = async (handler, path) => {
      let payload;
      const res = {
        set: () => {},
        status: (code) => ({ json: (body) => (payload = { code, body }), send: () => {} }),
      };
      await handler({ method: "GET", path }, res);
      return payload;
    };
    const byCourt = await respond(api.getCourtScore, "/c1");
    expect(byCourt.body).toMatchObject({ matchId, title: "Friday Night Final", courtId: "c1" });
    await match("moveMatch", { matchId, courtId: "c3" }, { adminKey: ADMIN_KEY });
    const byMatch = await respond(api.getCourtScore, `/match/${matchId}`);
    expect(byMatch.body).toMatchObject({ matchId, title: "Friday Night Final", courtId: "c3" });
    const missing = await respond(api.getCourtScore, "/match/nope");
    expect(missing.code).toBe(404);
  });
});

describe("tournament flow", () => {
  test("Americano end to end: create, generate, play, move, extend, correct, complete", async () => {
    const created = await createAmericano({ requestId: "req-1" });
    const { tournamentId, hostKey } = created;
    const host = { hostKey };
    expect(hostKey).toBeTruthy();

    const again = await createAmericano({ requestId: "req-1" });
    expect(again).toMatchObject({ tournamentId, duplicate: true });

    const stored = mockDb.get(`tournaments/${tournamentId}`);
    expect(stored).toMatchObject({ clubId: "club1", status: "draft", courtPool: ["c1", "c2"] });
    expect(mockDb.get(`tournamentSecrets/${tournamentId}`).hostKeyHash).not.toContain(hostKey);
    expect(view(tournamentId).club).toEqual({ clubId: "club1", name: "Example Padel Club" });
    expect(view(tournamentId).rulesSummary.lines).toEqual(
      expect.arrayContaining(["36 total points", "4 serves per player"]),
    );

    await expect(tournament("generateRound", { tournamentId })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });

    const round1 = await tournament(
      "generateRound",
      { tournamentId, expectedRoundNumber: 1 },
      host,
    );
    expect(round1.roundIds).toEqual(["r1"]);
    const duplicate = await tournament(
      "generateRound",
      { tournamentId, expectedRoundNumber: 1 },
      host,
    );
    expect(duplicate.duplicate).toBe(true);
    expect(mockDb.list(`tournaments/${tournamentId}/rounds`)).toHaveLength(1);

    const fixtures = mockDb.list(`tournaments/${tournamentId}/fixtures`);
    expect(fixtures).toHaveLength(2);
    fixtures.forEach((fixture) => {
      const matchDoc = mockDb.get(`matches/${fixture.matchId}`);
      expect(matchDoc).toMatchObject({
        status: "scheduled",
        tournamentId,
        fixtureId: fixture.id,
        kind: "tournament",
        name: fixture.label,
      });
      expect(matchDoc.scoringOptions).toMatchObject({
        scoringMode: "fixedTotalPoints",
        pointsTarget: 36,
        serving: { servesPerPlayer: 4, serveBlockLength: 1, order: ["A1", "B1", "A2", "B2"] },
      });
    });

    await tournament("publishTournament", { tournamentId }, host);
    const started = await tournament("startRound", { tournamentId }, host);
    expect(started.started).toHaveLength(2);
    expect(mockDb.get(`tournaments/${tournamentId}`).status).toBe("live");

    await expect(
      tournament("updateTournament", { tournamentId, patch: { clubId: null } }, host),
    ).rejects.toThrow(/club cannot be changed/i);

    const [f1, f2] = mockDb
      .list(`tournaments/${tournamentId}/fixtures`)
      .sort((a, b) => a.id.localeCompare(b.id));

    await score(f1.matchId, "A".repeat(19) + "B".repeat(17));
    expect(mockDb.get(`matches/${f1.matchId}`).status).toBe("completed");
    const f1Done = mockDb.get(`tournaments/${tournamentId}/fixtures/${f1.id}`);
    expect(f1Done.resultSnapshot).toMatchObject({ winner: "A", points: { A: 19, B: 17 } });

    // Move a live match: the match id survives and both courts update.
    const moved = await tournament(
      "moveFixtureCourt",
      { tournamentId, fixtureId: f2.id, courtId: "c3" },
      host,
    );
    expect(moved.matchId).toBe(f2.matchId);
    expect(mockDb.get("courts/c3").activeMatchId).toBe(f2.matchId);
    expect(mockDb.get(`courts/${f2.courtId}`).activeMatchId).toBeNull();

    await score(f2.matchId, "AB".repeat(18));
    expect(mockDb.get(`tournaments/${tournamentId}/fixtures/${f2.id}`).resultSnapshot.winner).toBe(
      "draw",
    );

    const afterRound1 = view(tournamentId);
    const pointsById = Object.fromEntries(
      afterRound1.standings.rows.map((row) => [row.entryId, row.totalPoints]),
    );
    f1.sides.A.participantIds.forEach((id) => expect(pointsById[id]).toBe(19));
    f1.sides.B.participantIds.forEach((id) => expect(pointsById[id]).toBe(17));
    f2.participantIds.forEach((id) => expect(pointsById[id]).toBe(18));
    expect(afterRound1.nextRound.allowed).toBe(true);

    // Extend: round 2 is appended and avoids repeating partners.
    await tournament("generateNextRound", { tournamentId, expectedRoundNumber: 2 }, host);
    const round2 = mockDb
      .list(`tournaments/${tournamentId}/fixtures`)
      .filter((fixture) => fixture.roundId === "r2");
    expect(round2).toHaveLength(2);
    const partnerKey = (side) => [...side.participantIds].sort().join("|");
    const round1Partners = new Set(
      [f1, f2].flatMap((f) => [partnerKey(f.sides.A), partnerKey(f.sides.B)]),
    );
    round2.forEach((fixture) => {
      expect(round1Partners.has(partnerKey(fixture.sides.A))).toBe(false);
      expect(round1Partners.has(partnerKey(fixture.sides.B))).toBe(false);
    });
    expect(mockDb.get(`tournaments/${tournamentId}/rounds/r1`).status).toBe("completed");

    // Correction is explicit, audited and recomputes standings.
    await expect(
      tournament(
        "correctTournamentResult",
        { tournamentId, fixtureId: f1.id, points: { A: 20, B: 16 } },
        host,
      ),
    ).rejects.toThrow(/reason/);
    await tournament(
      "correctTournamentResult",
      { tournamentId, fixtureId: f1.id, points: { A: 20, B: 16 }, reason: "Scorer missed a point" },
      host,
    );
    const corrected = view(tournamentId).standings.rows.find(
      (row) => row.entryId === f1.sides.A.participantIds[0],
    );
    expect(corrected.totalPoints).toBe(20);
    const audits = mockDb
      .list(`tournaments/${tournamentId}/audits`)
      .map((audit) => audit.operation);
    expect(audits).toEqual(
      expect.arrayContaining([
        "tournament.create",
        "round.generate",
        "match.move",
        "result.correct",
      ]),
    );
    expect(mockDb.list(`matches/${f1.matchId}/events`).length).toBe(36);

    // Historical match stays reachable through its own id.
    expect(mockDb.get(`matches/${f1.matchId}`)).toMatchObject({
      status: "completed",
      lastCourtId: f1.courtId,
      tournamentId,
    });

    await expect(tournament("completeTournament", { tournamentId }, host)).rejects.toThrow(
      /not finished/,
    );
    const finished = await tournament(
      "completeTournament",
      { tournamentId, early: true, reason: "Out of court time" },
      host,
    );
    expect(finished.cancelledFixtures).toBe(2);
    expect(view(tournamentId).status).toBe("completed");
    round2.forEach((fixture) =>
      expect(mockDb.get(`matches/${fixture.matchId}`).status).toBe("cancelled"),
    );
  });

  test("tournament without a club and club-first court options", async () => {
    const { tournamentId } = await tournament("createTournament", {
      name: "No Club Cup",
      format: { id: "roundRobin", config: { scoring: { scoringMode: "straight" } } },
      courtPool: ["c3"],
      teams: [{ players: ["A1", "A2"] }, { players: ["B1", "B2"] }, { players: ["C1", "C2"] }],
    });
    expect(mockDb.get(`tournaments/${tournamentId}`).clubId).toBeNull();
    expect(view(tournamentId).club).toBeNull();

    const options = await tournament("getCourtOptions", {
      clubId: "club1",
      selectedCourtIds: ["c3"],
    });
    expect(options.courts.map((court) => court.courtId)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(options.courts.map((court) => court.group)).toEqual([
      "club",
      "club",
      "other",
      "unavailable",
    ]);
    expect(options.courts.find((court) => court.courtId === "c3").selected).toBe(true);

    await expect(
      tournament("createTournament", { name: "Bad", clubId: "nope", format: { id: "americano" } }),
    ).rejects.toThrow(/club could not be found/);
    await expect(
      tournament("createTournament", {
        name: "Bad",
        format: { id: "americano" },
        courtPool: ["zz"],
      }),
    ).rejects.toThrow(/could not be found: zz/);
  });

  test("single elimination advances winners into normal matches and needs a winner", async () => {
    const { tournamentId, hostKey } = await tournament("createTournament", {
      name: "Knockout Cup",
      format: { id: "singleElimination", config: { scoring: { scoringMode: "straight" } } },
      courtPool: ["c1", "c2"],
      teams: [1, 2, 3, 4].map((n) => ({
        name: `Team ${n}`,
        seed: n,
        players: [`P${n}a`, `P${n}b`],
      })),
    });
    const host = { hostKey };
    await tournament("startTournament", { tournamentId }, host);
    const fixtures = () => mockDb.list(`tournaments/${tournamentId}/fixtures`);
    const semis = fixtures().filter((fixture) => fixture.roundId === "r1");
    const final = fixtures().find((fixture) => fixture.roundId === "r2");
    expect(semis).toHaveLength(2);
    expect(final.matchId).toBeFalsy();
    expect(final.label).toBe("Final");

    await tournament("startRound", { tournamentId }, host);
    await score(semis[0].matchId, "AB");
    await expect(
      tournament("completeFixture", { tournamentId, fixtureId: semis[0].id }, host),
    ).rejects.toThrow(/needs a winner/);
    await score(semis[0].matchId, "A");
    await tournament("completeFixture", { tournamentId, fixtureId: semis[0].id }, host);
    await score(semis[1].matchId, "BB");
    await tournament("completeFixture", { tournamentId, fixtureId: semis[1].id }, host);

    const finalAfter = fixtures().find((fixture) => fixture.id === final.id);
    expect(finalAfter.matchId).toBeTruthy();
    expect(finalAfter.sides.A.teamId).toBe(semis[0].sides.A.teamId);
    expect(finalAfter.sides.B.teamId).toBe(semis[1].sides.B.teamId);
    const finalMatch = mockDb.get(`matches/${finalAfter.matchId}`);
    expect(finalMatch).toMatchObject({ name: "Final", status: "scheduled" });
    expect(view(tournamentId).bracket.stages.length).toBeGreaterThan(0);
  });

  test("withdrawal cancels unplayed rotating fixtures without fake results", async () => {
    const { tournamentId, hostKey } = await createAmericano();
    await tournament("generateRound", { tournamentId }, { hostKey });
    const fixture = mockDb.list(`tournaments/${tournamentId}/fixtures`)[0];
    const withdrawn = fixture.participantIds[0];
    await tournament(
      "withdrawParticipant",
      { tournamentId, participantId: withdrawn, reason: "Injury" },
      { hostKey },
    );
    expect(mockDb.get(`tournaments/${tournamentId}/fixtures/${fixture.id}`)).toMatchObject({
      status: "cancelled",
      resultSnapshot: null,
    });
    expect(mockDb.get(`matches/${fixture.matchId}`).status).toBe("cancelled");
    const row = view(tournamentId).standings.rows.find((entry) => entry.entryId === withdrawn);
    expect(row.status).toBe("withdrawn");
    expect(row.losses || 0).toBe(0);
  });

  test("private tournaments need the access code or host key to read", async () => {
    const { tournamentId, accessCode, hostKey } = await createAmericano({ visibility: "private" });
    expect(view(tournamentId)).toMatchObject({ visibility: "private" });
    expect(view(tournamentId).participants).toBeUndefined();
    await expect(tournament("getTournamentView", { tournamentId })).rejects.toThrow(/private/);
    const viaCode = await tournament("getTournamentView", { tournamentId, accessCode });
    expect(viaCode.view.participants).toHaveLength(8);
    const viaHost = await tournament("getTournamentView", { tournamentId }, { hostKey });
    expect(viaHost.view.name).toBe("Friday Night Padel Social");
  });

  test("preview shows match count, sitting out and rules before saving", async () => {
    const preview = await tournament("previewTournament", {
      name: "Preview",
      format: { id: "americano" },
      courtPool: ["c1", "c2"],
      participants: Array.from({ length: 9 }, (_, i) => ({ displayName: `P${i}` })),
      scheduling: { defaultMatchDurationMinutes: 15, defaultChangeoverMinutes: 5 },
    });
    expect(preview.errors).toEqual([]);
    expect(preview.preview).toMatchObject({ matches: 2, sittingOut: 1, estimatedMinutes: 20 });
    expect(preview.rulesSummary.title).toBe("AMERICANO");
  });
});
