// Frontend integration tests: match-scoped scoreboard context.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  firestoreState,
  joinCourtAsPlayer,
  makeScore,
  pushScoreSnapshot,
  seedBaseData,
  seedCourt,
  seedDoc,
  settle,
  waitFor,
  writeDoc,
} from "./frontendHarness/harness.mjs";
import { session } from "../app/js/state/sessionState.js";

let document;
let window;

const $ = (id) => document.getElementById(id);

function team(points = 0) {
  return { points, games: 0, sets: 0, totalPoints: points };
}

async function leaveScoreboard() {
  $("backBtn").click();
  await settle(20);
  if (!$("confirmModal").classList.contains("hidden")) {
    $("confirmOkBtn").click();
  }
  await waitFor(() => $("menuPage").style.display !== "none", { label: "menu" });
}

function clickMenuButton(label) {
  const button = [...document.querySelectorAll(".menu-btn")].find(
    (btn) => btn.textContent.trim() === label,
  );
  assert.ok(button, `menu button ${label}`);
  button.click();
}

function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test.before(async () => {
  seedBaseData();
  seedCourt("ctxqa", {
    name: "Court One",
    matchName: "Grand Final",
    teamNames: { A: "Alpha", B: "Beta" },
  });
  seedDoc("matches/tuxyza", {
    matchId: "tuxyza",
    name: null,
    status: "live",
    visibility: "public",
    currentCourtId: "ctxqa",
    lastCourtId: "ctxqa",
    teamNames: { A: "Wolves", B: "Foxes" },
    playerNames: { A1: "", A2: "", B1: "", B2: "" },
    scoringMode: "standard",
    scoringOptions: { scoringMode: "standard", deuceMode: "standard", tiebreakMode: "sixAllSeven" },
    scoreVersion: 0,
    tournamentId: "abcdefg",
  });
  pushScoreSnapshot("tuxyza", makeScore({ A: team(1), B: team(0) }));

  seedCourt("srcha", {
    name: "Search Court",
    playerNames: { A1: "Needle Player", A2: "", B1: "Haystack Rival", B2: "" },
  });
  seedDoc("tournamentDirectory/abcdefg", {
    name: "Autumn Cup",
    visibility: "public",
    status: "live",
  });

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
  await joinCourtAsPlayer(document, "ctxqa");
});

test("points are written to the current match events with court context", async () => {
  $("addPointA").click();

  await waitFor(
    () => [...firestoreState.docs.keys()].find((path) => path.startsWith("matches/ctxqaa/events/")),
    { label: "match event" },
  );
  const [eventPath, event] = [...firestoreState.docs.entries()].find(
    ([path, data]) =>
      path.startsWith("matches/ctxqaa/events/") && data.eventType === "POINT_TEAM_A",
  );
  assert.equal(event.eventType, "POINT_TEAM_A");
  assert.equal(event.courtId, "ctxqa");
  assert.equal(event.matchId, "ctxqaa");
  assert.equal(
    [...firestoreState.docs.keys()].some((path) => path.startsWith("courts/ctxqa/events/")),
    false,
    eventPath,
  );
});

test("a resolved live match supplies its current score version before the listener catches up", async () => {
  const matchPath = "matches/ctxqaa";
  seedDoc(matchPath, { ...firestoreState.docs.get(matchPath), scoreVersion: 7 });
  session.currentMatchStatus = "completed";
  session.currentScoreVersion = 0;

  $("addPointA").click();

  await waitFor(
    () =>
      [...firestoreState.docs.entries()].some(
        ([path, event]) =>
          path.startsWith(`${matchPath}/events/`) &&
          event.eventType === "POINT_TEAM_A" &&
          event.scoreVersion === 7,
      ),
    { label: "point with authoritative score version" },
  );
});

test("scoreboard follows a new active match's names, score and tournament lock", async () => {
  const court = firestoreState.docs.get("courts/ctxqa");
  writeDoc("courts/ctxqa", { ...court, activeMatchId: "tuxyza", lastMatchId: "tuxyza" });

  await waitFor(() => $("courtTitle").textContent === "Wolves vs Foxes", {
    label: "new match title",
  });
  await waitFor(() => $("teamA").querySelector(".name-text").textContent === "Wolves", {
    label: "new team names",
  });
  await waitFor(() => $("pointsA").textContent === "15", { label: "new match score" });

  $("settingsBtn").click();
  await waitFor(() => $("settingsModal").style.display !== "none", { label: "settings modal" });
  assert.equal($("scoringModeSelect").disabled, true);
  assert.equal($("deuceModeSelect").disabled, true);
  assert.equal($("tiebreakModeSelect").disabled, true);
  assert.equal($("scoringStatus").textContent, "Tournament rules");
  $("closeSettingsBtn").click();
  await settle(10);
});

test("scoreboard preserves the complete six-letter match ID title in both orientations", async () => {
  const matchPath = "matches/tuxyza";
  const match = firestoreState.docs.get(matchPath);
  writeDoc(matchPath, { ...match, teamNames: {}, playerNames: {} });
  await waitFor(() => $("courtTitle").textContent === "tuxyza", {
    label: "match ID fallback title",
  });
  const styles = document.querySelector("style").textContent;
  assert.match(styles, /#courtTitle\s*\{[^}]*white-space:\s*nowrap;/);
  assert.match(styles, /\.marquee-content\s*\{[^}]*width:\s*max-content;/);
  assert.match(styles, /#courtTitle\s*\{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;/);
  for (const [width, height] of [
    [360, 780],
    [932, 430],
    [1280, 720],
  ]) {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
    window.dispatchEvent(new window.Event("resize"));
    assert.equal($("courtTitle").textContent, "tuxyza");
  }
  writeDoc(matchPath, match);
  await waitFor(() => $("courtTitle").textContent === "Wolves vs Foxes", {
    label: "restored title",
  });
});

test("spectate search finds live match players and discovery tournament results", async () => {
  await leaveScoreboard();
  clickMenuButton("Spectate");
  await waitFor(() => document.querySelectorAll("#spectateCourtList .court-item").length >= 2, {
    label: "spectate courts",
  });

  typeInto($("spectateCourtSearch"), "Needle Player");
  await waitFor(
    () =>
      [...document.querySelectorAll("#spectateCourtList .court-item")]
        .map((row) => row.dataset.courtId)
        .join(",") === "srcha",
    { label: "player search result" },
  );
  assert.ok(document.querySelector("#spectateDiscoveryResults .discovery-match"));

  typeInto($("spectateCourtSearch"), "Autumn Cup");
  await waitFor(() => document.querySelector("#spectateDiscoveryResults .discovery-tournament"), {
    label: "tournament discovery result",
  });
});
