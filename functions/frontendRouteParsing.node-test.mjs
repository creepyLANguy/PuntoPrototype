// Unit tests: URL parsing, URL building and view-state normalisation
// (app/js/routing/routeParsers.js, app/js/routing/viewState.js). Pure
// functions; no DOM is required.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildUrlForViewState,
  getCourtIdFromPathname,
  getPlayCourtIdFromPathname,
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
};

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
        courtId: "abcd",
        selectedCourtId: "abcd",
        spectate: true,
        returnToScoreboard: true,
      },
    ],
    [
      "/app/play/ABCD",
      {
        ...VIEW,
        page: "play",
        courtId: "abcd",
        selectedCourtId: "abcd",
        spectate: true,
        returnToScoreboard: true,
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

test("court ids are decoded, trimmed and lower-cased", () => {
  assert.equal(getCourtIdFromPathname("/c/Ab%20Cd"), "ab cd");
  assert.equal(getCourtIdFromPathname("/c/%E0%A4%A"), "%e0%a4%a", "malformed escapes fall back");
  assert.equal(getCourtIdFromPathname("/c/a/b"), null);
  assert.equal(getPlayCourtIdFromPathname("/p/XyZ/"), "xyz");
  assert.equal(getPlayCourtIdFromPathname("/c/xyz"), null);
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
  const scoreboard = createViewState({ page: "scoreboard", courtId: "ab cd", spectate: true });
  assert.equal(buildUrlForViewState(scoreboard, "/"), "/c/ab%20cd");
  assert.equal(buildUrlForViewState(scoreboard, "/app/c/x"), "/app/c/ab%20cd");

  const joinPrompt = createViewState({ page: "play", courtId: "abcd", returnToScoreboard: true });
  assert.equal(buildUrlForViewState(joinPrompt, "/"), "/p/abcd");
  assert.equal(buildUrlForViewState(createViewState({ page: "play" }), "/"), "/p");
  assert.equal(buildUrlForViewState(createViewState({ page: "spectate" }), "/app"), "/app/c");
  assert.equal(buildUrlForViewState(createViewState({ page: "menu" }), "/"), "/");
  assert.equal(buildUrlForViewState(createViewState({ page: "menu" }), "/app/x"), "/app/");

  for (const page of ["adminDashboard", "createCourt", "editCourt", "addDevice", "editDevice"]) {
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
    normalizeViewState({ page: "scoreboard", courtId: " AbC ", modal: "settings", spectate: 1 }),
    { ...VIEW, page: "scoreboard", courtId: "abc", spectate: true, modal: "settings" },
  );
  assert.deepEqual(normalizeViewState({ page: 7, entityId: 3 }), { ...VIEW });
  assert.equal(normalizeViewState({ page: "play", courtId: "a" }).courtId, null);
  assert.equal(
    normalizeViewState({ page: "play", courtId: "a", returnToScoreboard: true }).courtId,
    "a",
  );
});

test("view states compare by their normalised form", () => {
  assert.equal(
    viewStatesEqual({ page: "scoreboard", courtId: "ABC" }, { page: "scoreboard", courtId: "abc" }),
    true,
  );
  assert.equal(viewStatesEqual({ page: "menu", courtId: "x" }, { page: "menu" }), true);
  assert.equal(
    viewStatesEqual({ page: "scoreboard", courtId: "a" }, { page: "scoreboard", courtId: "b" }),
    false,
  );
});
