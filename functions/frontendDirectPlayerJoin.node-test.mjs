import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  seedDoc,
  pushScoreSnapshot,
  makeScore,
  waitFor,
  settle,
} from "./frontendHarness/harness.mjs";

let document;
let window;

test.before(async () => {
  seedBaseData();
  seedCourt("directplayer", { name: "Direct Player Court" });

  const matchRouteCourt = seedCourt("matchroute", {
    name: "Match Route Court",
    activeMatchId: "active-match",
    matchName: "Active Match",
  });
  seedDoc("matches/linked-match", {
    matchId: "linked-match",
    name: "Linked Match",
    kind: "tournament",
    visibility: "public",
    status: "live",
    currentCourtId: "matchroute",
    lastCourtId: "matchroute",
    teamNames: { A: "Linked A", B: "Linked B" },
    playerNames: { A1: "", A2: "", B1: "", B2: "" },
    scoringMode: "straight",
    scoringOptions: {
      scoringMode: "straight",
      deuceMode: "standard",
      tiebreakMode: "sixAllSeven",
    },
    scoreVersion: 0,
    tournamentId: "tournament-1",
  });
  seedDoc("courts/matchroute", {
    ...matchRouteCourt,
    activeMatchId: "active-match",
    lastMatchId: "active-match",
  });
  pushScoreSnapshot(
    "linked-match",
    makeScore({
      A: { points: 7, games: 0, sets: 0, totalPoints: 7 },
      B: { points: 2, games: 0, sets: 0, totalPoints: 2 },
      scoringOptions: {
        scoringMode: "straight",
        deuceMode: "standard",
        tiebreakMode: "sixAllSeven",
      },
    }),
  );

  const dom = await bootFrontend({ url: "https://padel.test/p/directplayer" });
  document = dom.window.document;
  window = dom.window;

  await waitFor(
    () =>
      document.getElementById("playPage").style.display !== "none" &&
      document.querySelector("#playCourtList .court-item.active"),
    { label: "direct player join prompt" },
  );
  await settle(30);
});

test("/p/<court> autofocuses the player password field", () => {
  assert.equal(document.activeElement?.id, "playCourtPassword");
});

test("/p/<court> player submit primes and plays the join sound", async () => {
  const passwordInput = document.getElementById("playCourtPassword");
  passwordInput.value = "pw";

  document.getElementById("enterCourtBtn").click();

  await waitFor(() => document.getElementById("scoreboardPage").style.display !== "none", {
    label: "player scoreboard to be shown",
  });
  await waitFor(() => window.__audioTestState.starts === 1, { label: "direct player join sound" });

  assert.ok(
    window.__audioTestState.resumeCalls > 0,
    "the AudioContext should be resumed from the submit gesture",
  );
  assert.equal(window.__audioTestState.starts, 1);
});


test("/p/<matchId> loads that match on its court as a spectator and then authenticates as a player", async () => {
  window.history.pushState({}, "", "/p/linked-match");
  window.dispatchEvent(new window.PopStateEvent("popstate"));

  await waitFor(
    () =>
      document.getElementById("playPage").style.display !== "none" &&
      document.querySelector('#playCourtList .court-item[data-court-id="matchroute"].active'),
    { label: "match-target join prompt" },
  );
  await waitFor(
    () => getRenderedScoreForDirectJoin(document).pointsA === "7",
    { label: "linked match score" },
  );

  assert.equal(document.getElementById("playCourtSearch").value, "Match Route Court");
  assert.equal(document.getElementById("playPasswordSection").style.display, "block");
  assert.notEqual(document.getElementById("scoreboardPage").style.display, "none");
  assert.equal(window.location.pathname, "/p/linked-match");
  assert.equal(document.body.classList.contains("spectating-mode"), true);

  document.getElementById("playCourtPassword").value = "pw";
  document.getElementById("enterCourtBtn").click();

  await waitFor(
    () => document.getElementById("scoreboardPage").style.display !== "none" &&
      !document.body.classList.contains("spectating-mode"),
    { label: "linked match player join" },
  );
  await settle(30);

  assert.equal(getRenderedScoreForDirectJoin(document).pointsA, "7");
  assert.equal(getRenderedScoreForDirectJoin(document).pointsB, "2");
});

function getRenderedScoreForDirectJoin(document) {
  return {
    pointsA: document.getElementById("pointsA").textContent,
    pointsB: document.getElementById("pointsB").textContent,
  };
}
