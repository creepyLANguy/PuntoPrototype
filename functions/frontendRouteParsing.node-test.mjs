// Unit tests: URL parsing, URL building and view-state normalisation
// (app/js/routing/routeParsers.js, app/js/routing/viewState.js). Pure
// functions; no DOM is required.
import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

import {
  buildUrlForViewState,
  getCourtIdFromPathname,
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
  const { seedDoc, firestoreState } = await import("./frontendHarness/mockFirestoreState.mjs");
  const noOp = () => {};
  const operations = {
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
  const lengths = { match: 8, tournament: 6, club: 10 };
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
  seedDoc("matches/abcdefgh", { name: "Match" });
  seedDoc("tournamentDirectory/abcdef", { name: "Tournament" });
  seedDoc("clubs/abcdefghjk", { name: "Club" });
  assert.equal((await matches.getMatch("abcdefgh")).data().name, "Match");
  assert.equal((await tournaments.getTournamentDirectoryEntry("abcdef")).data().name, "Tournament");
  assert.equal((await clubs.getClub("abcdefghjk")).data().name, "Club");
  assert.throws(
    () => matches.addMatchEvent("abcdefgh", { eventType: "UNDO", courtId: "bad" }),
    TypeError,
  );
  const eventRef = await matches.addMatchEvent("abcdefgh", {
    eventType: "JOIN",
    matchId: "invalid",
    courtId: "abcd",
  });
  assert.equal(firestoreState.docs.get(eventRef.path).matchId, "abcdefgh");
});

test("every supported route maps to the same view state as before", () => {
  const cases = [
    ["/", { ...VIEW }],
    ["/c", { ...VIEW, page: "spectate" }],
    ["/c/", { ...VIEW, page: "spectate" }],
    ["/court", { ...VIEW, page: "spectate" }],
    ["/c/AbCd", { ...VIEW, page: "scoreboard", courtId: "abcd", spectate: true }],
    ["/court/abcd/", { ...VIEW, page: "scoreboard", courtId: "abcd", spectate: true }],
    ["/app/c/abcd", { ...VIEW, page: "scoreboard", courtId: "abcd", spectate: true }],
    ["/p", { ...VIEW, page: "play" }],
    ["/play/", { ...VIEW, page: "play" }],
    [
      "/p/abcd",
      {
        ...VIEW,
        page: "play",
        spectate: true,
        returnToScoreboard: true,
        playTargetId: "abcd",
        playTargetType: "unknown",
      },
    ],
    [
      "/app/play/ABCD",
      {
        ...VIEW,
        page: "play",
        spectate: true,
        returnToScoreboard: true,
        playTargetId: "abcd",
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
  assert.equal(getMatchIdFromPathname("/m/AbCdEfGh"), "abcdefgh");
  assert.equal(getMatchIdFromPathname("/app/m/%20ABCDEFGH%20/"), "abcdefgh");
  assert.equal(getTournamentIdFromPathname("/t/ABCDEF"), "abcdef");
  assert.equal(getTournamentIdFromPathname("/app/t/%20ABCDEF%20/"), "abcdef");
  for (const id of [
    "abcd",
    "abcdef",
    "abcdefghjk",
    "abc12345",
    "abcdefgi",
    "abcdefgl",
    "abcdefgo",
    "abcdefgv",
    "abcdefgw",
    "%E0%A4%A",
    "abcdefgh%2F",
    "abcd-efg",
  ]) {
    assert.equal(getMatchIdFromPathname(`/m/${id}`), null, id);
  }
  for (const id of [
    "abcd",
    "abcdefgh",
    "abcdefghjk",
    "abc123",
    "abcdei",
    "abcdel",
    "abcdeo",
    "abcdev",
    "abcdew",
    "%E0%A4%A",
    "abcdef%2F",
    "abc-def",
  ]) {
    assert.equal(getTournamentIdFromPathname(`/t/${id}`), null, id);
  }
  assert.equal(getMatchIdFromPathname("/m/abcdefgh/extra"), null);
  assert.equal(getTournamentIdFromPathname("/t/abcdef/extra"), null);
});

test("route ids normalize case and reject malformed or wrong-type ids", () => {
  assert.equal(getCourtIdFromPathname("/c/%20AbCd%20"), "abcd");
  assert.equal(getCourtIdFromPathname("/c/Ab%20Cd"), null);
  assert.equal(getCourtIdFromPathname("/c/%E0%A4%A"), null);
  assert.equal(getCourtIdFromPathname("/c/a/b"), null);
  assert.equal(getPlayCourtIdFromPathname("/p/XyZ/"), null);
  assert.equal(getPlayTargetIdFromPathname("/p/Match-123/"), null);
  assert.equal(getPlayTargetIdFromPathname("/p/AbCdEfGh/"), "abcdefgh");
  assert.equal(getPlayCourtIdFromPathname("/p/abcdefgh"), null);
  assert.equal(getPlayCourtIdFromPathname("/c/xyz"), null);
  for (const id of [
    "abc",
    "abcde",
    "abc0",
    "abci",
    "abcl",
    "abco",
    "abcv",
    "abcw",
    "abcdefgh",
    "abcdefghjk",
  ]) {
    assert.equal(getCourtIdFromPathname(`/c/${id}`), null, id);
  }
  for (const id of ["abcdef", "abcdefghjk", "abc12345", "abcdefgi", "abcdefgh%2F", "%E0%A4%A"]) {
    assert.equal(getPlayTargetIdFromPathname(`/p/${id}`), null, id);
    assert.equal(getViewStateFromLocation(`/p/${id}`).page, "menu", id);
  }
});

test("root route predicates", () => {
  assert.equal(isPlayRootPathname("/p"), true);
  assert.equal(isPlayRootPathname("/app/play/"), true);
  assert.equal(isPlayRootPathname("/p/abcd"), false);
  assert.equal(isSpectateRootPathname("/court/"), true);
  assert.equal(isSpectateRootPathname("/c/abcd"), false);
  assert.equal(isAdminRootPathname("/admin///"), true);
  assert.equal(isAdminRootPathname("/app/admin"), true);
  assert.equal(isAdminRootPathname("/administrator"), false);
});

test("view states build the canonical URLs, honouring the /app prefix", () => {
  const scoreboard = createViewState({ page: "scoreboard", courtId: "ABCD", spectate: true });
  assert.equal(buildUrlForViewState(scoreboard, "/"), "/c/abcd");
  assert.equal(buildUrlForViewState(scoreboard, "/app/c/x"), "/app/c/abcd");
  assert.equal(buildUrlForViewState({ page: "scoreboard", courtId: "ab cd" }, "/"), "/");

  const joinPrompt = createViewState({ page: "play", courtId: "abcd", returnToScoreboard: true });
  assert.equal(buildUrlForViewState(joinPrompt, "/"), "/p/abcd");
  const matchJoinPrompt = createViewState({
    page: "play",
    courtId: "abcd",
    playTargetId: "abcdefgh",
    playTargetType: "match",
    returnToScoreboard: true,
  });
  assert.equal(buildUrlForViewState(matchJoinPrompt, "/"), "/p/abcdefgh");
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
    normalizeViewState({ page: "scoreboard", courtId: " AbCd ", modal: "settings", spectate: 1 }),
    { ...VIEW, page: "scoreboard", courtId: "abcd", spectate: true, modal: "settings" },
  );
  assert.deepEqual(normalizeViewState({ page: 7, entityId: 3 }), { ...VIEW });
  assert.equal(normalizeViewState({ page: "play", courtId: "a" }).courtId, null);
  assert.equal(
    normalizeViewState({ page: "play", courtId: "a", returnToScoreboard: true }).courtId,
    null,
  );
});

test("club editor view states keep the club id and compare by it", () => {
  const editClub = createViewState({ page: "editClub", entityId: "abcdefghjk" });
  assert.deepEqual(editClub, { ...VIEW, page: "editClub", entityId: "abcdefghjk" });
  assert.deepEqual(createViewState({ page: "createClub" }), { ...VIEW, page: "createClub" });
  assert.equal(viewStatesEqual(editClub, { page: "editClub", entityId: "abcdefghjk" }), true);
  assert.equal(viewStatesEqual(editClub, { page: "editClub", entityId: "jkmnpqrstu" }), false);
  assert.equal(viewStatesEqual(editClub, { page: "createClub" }), false);
});

test("view states compare by their normalised form", () => {
  assert.equal(
    viewStatesEqual(
      { page: "scoreboard", courtId: "ABCD" },
      { page: "scoreboard", courtId: "abcd" },
    ),
    true,
  );
  assert.equal(viewStatesEqual({ page: "menu", courtId: "x" }, { page: "menu" }), true);
  assert.equal(
    viewStatesEqual(
      { page: "scoreboard", courtId: "abcd" },
      { page: "scoreboard", courtId: "efgh" },
    ),
    false,
  );
});
