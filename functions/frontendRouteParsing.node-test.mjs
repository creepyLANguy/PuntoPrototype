// Unit tests: URL parsing, URL building and view-state normalisation
// (app/js/routing/routeParsers.js, app/js/routing/viewState.js). Pure
// functions; no DOM is required.
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

import {
  buildUrlForViewState,
  getCourtIdFromPathname,
  getCourtRouteIdFromPathname,
  getMatchIdFromPathname,
  getPlayCourtIdFromPathname,
  getPlayTargetIdFromPathname,
  getTournamentIdFromPathname,
  getViewStateFromLocation,
  isAdminRootPathname,
  isPlayRootPathname,
  isSpectateRootPathname,
} from "../app/js/routing/routeParsers.js";
import {
  createViewState,
  isAdminProtectedPage,
  normalizeViewState,
  viewStatesEqual,
} from "../app/js/routing/viewState.js";

const VIEW = {
  page: "menu",
  courtId: null,
  selectedCourtId: null,
  spectate: false,
  modal: null,
  returnToScoreboard: false,
  entityId: null,
  playTargetId: null,
  playTargetType: null,
};

test("resource repositories reject invalid IDs before contacting Firestore", async () => {
  register("./frontendHarness/loaderHooks.mjs", import.meta.url);
  const matches = await import("../app/js/firebase/matchRepository.js");
  const tournaments = await import("../app/js/firebase/tournamentRepository.js");
  const clubs = await import("../app/js/firebase/clubRepository.js");
  const courts = await import("../app/js/firebase/courtRepository.js");
  const { seedDoc, firestoreState } = await import("./frontendHarness/mockFirestoreState.mjs");
  const noOp = () => {};
  const operations = {
    court: [
      (id) => courts.getCourt(id),
      (id) => courts.updateCourt(id, {}),
      (id) => courts.listenToCourt(id, noOp),
    ],
    match: [
      (id) => matches.getMatch(id),
      (id) => matches.listenToMatch(id, noOp),
      (id) => matches.getMatchScore(id),
      (id) => matches.listenToMatchScore(id, noOp),
      (id) => matches.updateMatch(id, {}),
      (id) => matches.addMatchEvent(id, { eventType: "UNDO", createdBy: "test" }),
    ],
    tournament: [
      (id) => matches.listenToTournamentLiveMatches(id, noOp),
      (id) => tournaments.listenToTournamentView(id, noOp),
      (id) => tournaments.getTournamentDirectoryEntry(id),
    ],
    club: [(id) => clubs.getClub(id)],
  };
  const lengths = { court: 5, match: 6, tournament: 7, club: 4 };
  for (const [type, boundaryCalls] of Object.entries(operations)) {
    const length = lengths[type];
    for (const invalid of [
      "a".repeat(length - 1),
      "a".repeat(length + 1),
      "A".repeat(length),
      "i".repeat(length),
      "1".repeat(length),
      ` ${"a".repeat(length)} `,
      null,
      123,
    ]) {
      for (const call of boundaryCalls) assert.throws(() => call(invalid), TypeError);
    }
  }
  seedDoc("matches/abcdef", { name: "Match" });
  seedDoc("tournamentDirectory/abcdefg", { name: "Tournament" });
  seedDoc("clubs/abch", { name: "Club" });
  seedDoc("courts/abcda", { name: "Court" });
  assert.equal((await matches.getMatch("abcdef")).data().name, "Match");
  assert.equal(
    (await tournaments.getTournamentDirectoryEntry("abcdefg")).data().name,
    "Tournament",
  );
  assert.equal((await clubs.getClub("abch")).data().name, "Club");
  await courts.getCourt("abcda");
  assert.throws(
    () => matches.addMatchEvent("abcdef", { eventType: "UNDO", courtId: "bad" }),
    TypeError,
  );
  const eventRef = await matches.addMatchEvent("abcdef", {
    eventType: "JOIN",
    matchId: "invalid",
    courtId: "abcda",
  });
  assert.equal(firestoreState.docs.get(eventRef.path).matchId, "abcdef");
});

test("every supported route maps to the same view state as before", () => {
  const cases = [
    ["/", { ...VIEW }],
    ["/c", { ...VIEW, page: "spectate" }],
    ["/c/", { ...VIEW, page: "spectate" }],
    ["/court", { ...VIEW, page: "spectate" }],
    ["/c/AbCda", { ...VIEW, page: "scoreboard", courtId: "abcda", spectate: true }],
    ["/court/abcda/", { ...VIEW, page: "scoreboard", courtId: "abcda", spectate: true }],
    ["/app/c/abcda", { ...VIEW, page: "scoreboard", courtId: "abcda", spectate: true }],
    ["/p", { ...VIEW, page: "play" }],
    ["/play/", { ...VIEW, page: "play" }],
    [
      "/p/abcda",
      {
        ...VIEW,
        page: "play",
        spectate: true,
        returnToScoreboard: true,
        playTargetId: "abcda",
        playTargetType: "unknown",
      },
    ],
    [
      "/app/play/ABCDA",
      {
        ...VIEW,
        page: "play",
        spectate: true,
        returnToScoreboard: true,
        playTargetId: "abcda",
        playTargetType: "unknown",
      },
    ],
    ["/admin", { ...VIEW, page: "adminDashboard" }],
    ["/admin/", { ...VIEW, page: "adminDashboard" }],
    ["/app/admin", { ...VIEW, page: "adminDashboard" }],
    ["/app/", { ...VIEW }],
    ["/unknown/path", { ...VIEW }],
  ];

  for (const [pathname, expected] of cases) {
    assert.deepEqual(getViewStateFromLocation(pathname), expected, pathname);
  }
});

test("match and tournament paths enforce distinct ID types without losing uppercase URLs", () => {
  assert.equal(getMatchIdFromPathname("/m/AbCdEf"), "abcdef");
  assert.equal(getMatchIdFromPathname("/app/m/%20ABCDEF%20/"), "abcdef");
  assert.equal(getTournamentIdFromPathname("/t/ABCDEFG"), "abcdefg");
  assert.equal(getTournamentIdFromPathname("/app/t/%20ABCDEFG%20/"), "abcdefg");
  for (const id of [
    "abcda",
    "abcdefg",
    "abch",
    "abc12345",
    "abcdei",
    "abcdel",
    "abcdeo",
    "abcdev",
    "abcdew",
    "abcdefgh",
    "%E0%A4%A",
    "abcdef%2F",
    "abcd-efg",
  ]) {
    assert.equal(getMatchIdFromPathname(`/m/${id}`), null, id);
  }
  for (const id of [
    "abcda",
    "abcdef",
    "abch",
    "abc123",
    "abcdefi",
    "abcdefl",
    "abcdefo",
    "abcdefv",
    "abcdefw",
    "abcdefgh",
    "%E0%A4%A",
    "abcdefg%2F",
    "abc-def",
  ]) {
    assert.equal(getTournamentIdFromPathname(`/t/${id}`), null, id);
  }
  assert.equal(getMatchIdFromPathname("/m/abcdef/extra"), null);
  assert.equal(getTournamentIdFromPathname("/t/abcdefg/extra"), null);
});

test("direct court route IDs remain available for malformed-URL feedback", () => {
  assert.equal(getCourtRouteIdFromPathname("/c/bad"), "bad");
  assert.equal(getCourtRouteIdFromPathname("/court/%E0%A4%A"), "%E0%A4%A");
  assert.equal(getCourtRouteIdFromPathname("/app/c/AbCda/"), "abcda");
  assert.equal(getCourtRouteIdFromPathname("/c"), null);
});

test("route ids normalize case and reject malformed or wrong-type ids", () => {
  assert.equal(getCourtIdFromPathname("/c/%20AbCda%20"), "abcda");
  assert.equal(getCourtIdFromPathname("/c/Ab%20Cd"), null);
  assert.equal(getCourtIdFromPathname("/c/%E0%A4%A"), null);
  assert.equal(getCourtIdFromPathname("/c/a/b"), null);
  assert.equal(getPlayCourtIdFromPathname("/p/XyZ/"), null);
  assert.equal(getPlayTargetIdFromPathname("/p/Match-123/"), null);
  assert.equal(getPlayTargetIdFromPathname("/p/AbCdEf/"), "abcdef");
  assert.equal(getPlayCourtIdFromPathname("/p/abcdef"), null);
  assert.equal(getPlayCourtIdFromPathname("/c/xyz"), null);
  for (const id of [
    "abc",
    "abcd",
    "abcd0",
    "abcdi",
    "abcdl",
    "abcdo",
    "abcdv",
    "abcdw",
    "abcdef",
    "abch",
  ]) {
    assert.equal(getCourtIdFromPathname(`/c/${id}`), null, id);
  }
  for (const id of ["abcdefg", "abch", "abc12345", "abcdefgi", "abcdef%2F", "%E0%A4%A"]) {
    assert.equal(getPlayTargetIdFromPathname(`/p/${id}`), null, id);
    assert.equal(getViewStateFromLocation(`/p/${id}`).page, "menu", id);
  }
});

test("all routes reject legacy lengths and other resource types", () => {
  const parsers = {
    court: (id) => getCourtIdFromPathname(`/c/${id}`),
    match: (id) => getMatchIdFromPathname(`/m/${id}`),
    tournament: (id) => getTournamentIdFromPathname(`/t/${id}`),
  };
  const lengths = { club: 4, court: 5, match: 6, tournament: 7 };
  for (const [type, parse] of Object.entries(parsers)) {
    for (const length of [3, 4, 5, 6, 7, 8, 10]) {
      assert.equal(parse("a".repeat(length)), length === lengths[type] ? "a".repeat(length) : null);
    }
  }
  for (const length of [3, 4, 5, 6, 7, 8, 10]) {
    const id = "a".repeat(length);
    assert.equal(getPlayTargetIdFromPathname(`/p/${id}`), [5, 6].includes(length) ? id : null);
  }
});

test("root route predicates", () => {
  assert.equal(isPlayRootPathname("/p"), true);
  assert.equal(isPlayRootPathname("/app/play/"), true);
  assert.equal(isPlayRootPathname("/p/abcda"), false);
  assert.equal(isSpectateRootPathname("/court/"), true);
  assert.equal(isSpectateRootPathname("/c/abcda"), false);
  assert.equal(isAdminRootPathname("/admin///"), true);
  assert.equal(isAdminRootPathname("/app/admin"), true);
  assert.equal(isAdminRootPathname("/administrator"), false);
});

test("view states build the canonical URLs, honouring the /app prefix", () => {
  const scoreboard = createViewState({ page: "scoreboard", courtId: "ABCDA", spectate: true });
  assert.equal(buildUrlForViewState(scoreboard, "/"), "/c/abcda");
  assert.equal(buildUrlForViewState(scoreboard, "/app/c/x"), "/app/c/abcda");

  const joinCourtModal = createViewState({
    page: "scoreboard",
    courtId: "abcda",
    spectate: true,
    modal: "joinCourt",
    playTargetId: "abcda",
    playTargetType: "court",
  });
  assert.equal(buildUrlForViewState(joinCourtModal, "/"), "/p/abcda");
  assert.equal(buildUrlForViewState(joinCourtModal, "/app/c/x"), "/app/p/abcda");

  const matchJoinModal = createViewState({
    page: "scoreboard",
    courtId: "abcda",
    spectate: true,
    modal: "joinCourt",
    playTargetId: "abcdef",
    playTargetType: "match",
  });
  assert.equal(buildUrlForViewState(matchJoinModal, "/"), "/p/abcdef");
  assert.equal(buildUrlForViewState({ page: "scoreboard", courtId: "ab cd" }, "/"), "/");

  const joinPrompt = createViewState({ page: "play", courtId: "abcda", returnToScoreboard: true });
  assert.equal(buildUrlForViewState(joinPrompt, "/"), "/p/abcda");
  const matchJoinPrompt = createViewState({
    page: "play",
    courtId: "abcda",
    playTargetId: "abcdef",
    playTargetType: "match",
    returnToScoreboard: true,
  });
  assert.equal(buildUrlForViewState(matchJoinPrompt, "/"), "/p/abcdef");
  assert.equal(buildUrlForViewState(createViewState({ page: "play" }), "/"), "/p");
  assert.equal(buildUrlForViewState(createViewState({ page: "spectate" }), "/app"), "/app/c");
  assert.equal(buildUrlForViewState(createViewState({ page: "menu" }), "/"), "/");
  assert.equal(buildUrlForViewState(createViewState({ page: "menu" }), "/app/x"), "/app/");

  for (const page of [
    "adminDashboard",
    "createCourt",
    "editCourt",
    "addDevice",
    "editDevice",
    "createClub",
    "editClub",
  ]) {
    assert.equal(isAdminProtectedPage(page), true, page);
    assert.equal(buildUrlForViewState(createViewState({ page }), "/app/"), "/admin", page);
  }
  assert.equal(isAdminProtectedPage("adminAuth"), false);
});

test("view-state normalisation drops fields that do not apply to the page", () => {
  assert.deepEqual(
    normalizeViewState({ page: "spectate", courtId: "X", spectate: true, modal: "details" }),
    { ...VIEW, page: "spectate" },
  );
  assert.deepEqual(
    normalizeViewState({ page: "scoreboard", courtId: " AbCda ", modal: "settings", spectate: 1 }),
    { ...VIEW, page: "scoreboard", courtId: "abcda", spectate: true, modal: "settings" },
  );
  assert.deepEqual(normalizeViewState({ page: 7, entityId: 3 }), { ...VIEW });
  assert.equal(normalizeViewState({ page: "play", courtId: "a" }).courtId, null);
  assert.equal(
    normalizeViewState({ page: "play", courtId: "a", returnToScoreboard: true }).courtId,
    null,
  );
});

test("club editor view states keep the club id and compare by it", () => {
  const editClub = createViewState({ page: "editClub", entityId: "abch" });
  assert.deepEqual(editClub, { ...VIEW, page: "editClub", entityId: "abch" });
  assert.deepEqual(createViewState({ page: "createClub" }), { ...VIEW, page: "createClub" });
  assert.equal(viewStatesEqual(editClub, { page: "editClub", entityId: "abch" }), true);
  assert.equal(viewStatesEqual(editClub, { page: "editClub", entityId: "jknp" }), false);
  assert.equal(viewStatesEqual(editClub, { page: "createClub" }), false);
});

test("view states compare by their normalised form", () => {
  assert.equal(
    viewStatesEqual(
      { page: "scoreboard", courtId: "ABCDA" },
      { page: "scoreboard", courtId: "abcda" },
    ),
    true,
  );
  assert.equal(viewStatesEqual({ page: "menu", courtId: "x" }, { page: "menu" }), true);
  assert.equal(
    viewStatesEqual(
      { page: "scoreboard", courtId: "abcda" },
      { page: "scoreboard", courtId: "efgha" },
    ),
    false,
  );
});
