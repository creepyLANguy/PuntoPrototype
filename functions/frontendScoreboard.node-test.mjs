// Frontend integration tests: court scoreboard live-score rendering.
// Boots the real app (app/index.html + app/js/script.js) in jsdom with the
// Firebase SDK mocked and the real scoringEngine simulating the backend.
import assert from "node:assert/strict";
import test from "node:test";

import
{
  bootFrontend,
  seedBaseData,
  seedCourt,
  joinCourtAsPlayer,
  getRenderedScore,
  pushScoreSnapshot,
  makeScore,
  waitFor,
  settle,
  firestoreState,
  getBackendScore
} from "./frontendHarness/harness.mjs";

let document;
let window;

test.before(async () =>
{
  seedBaseData();
  seedCourt("courtone", { teamNames: { A: "Smashers", B: "Lobbers" } });
  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
});

test("app boots to the main menu with the scoreboard hidden", () =>
{
  assert.notEqual(document.getElementById("menuPage").style.display, "none");
  assert.equal(document.getElementById("scoreboardPage").style.display, "none");
});

test("player can join a court through the play flow", async () =>
{
  await joinCourtAsPlayer(document, "courtone");
  assert.equal(document.getElementById("scoreboardPage").style.display, "flex");
});

test("team names from the court document are shown on the scoreboard", async () =>
{
  await waitFor(
    () => document.querySelector("#teamA .name-text").textContent === "Smashers",
    { label: "team A name" }
  );
  assert.equal(document.querySelector("#teamB .name-text").textContent, "Lobbers");
});

test("scoreboard starts at love-love", () =>
{
  const rendered = getRenderedScore(document);
  assert.equal(rendered.pointsA, "0");
  assert.equal(rendered.pointsB, "0");
});

test("CORE: user-triggered point event updates the scoreboard score", async () =>
{
  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "15", { label: "A at 15" });
  assert.equal(getRenderedScore(document).pointsB, "0");
});

test("CORE: every consecutive user-triggered point renders (15 -> 30 -> 40)", async () =>
{
  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "30", { label: "A at 30" });

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "40", { label: "A at 40" });
});

test("CORE: winning a game resets points and fills a game dot", async () =>
{
  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).gamesA === 1, { label: "A wins a game" });
  assert.equal(getRenderedScore(document).pointsA, "0");
  assert.equal(getRenderedScore(document).pointsB, "0");
});

test("CORE: scores for the other team update too", async () =>
{
  document.getElementById("addPointB").click();
  await waitFor(() => getRenderedScore(document).pointsB === "15", { label: "B at 15" });
});

test("CORE: undo through the UI reverts the last point", async () =>
{
  document.getElementById("undoBtn").click();
  await waitFor(
    () => !document.getElementById("confirmModal").classList.contains("hidden"),
    { label: "undo confirm modal" }
  );
  document.getElementById("confirmOkBtn").click();

  await waitFor(() => getRenderedScore(document).pointsB === "0", { label: "B back to 0" });
  assert.equal(getRenderedScore(document).gamesA, 1);
});

test("keyboard hotkeys A/B award points", async () =>
{
  document.activeElement?.blur?.();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "a", bubbles: true }));
  await waitFor(() => getRenderedScore(document).pointsA === "15", { label: "A at 15 via hotkey" });

  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "b", bubbles: true }));
  await waitFor(() => getRenderedScore(document).pointsB === "15", { label: "B at 15 via hotkey" });
});

test("deuce then advantage renders 40-40 then Ad", async () =>
{
  // A:15 B:15 -> take both to 40-40, then A advantage.
  document.getElementById("addPointA").click(); // A 30
  document.getElementById("addPointA").click(); // A 40
  document.getElementById("addPointB").click(); // B 30
  document.getElementById("addPointB").click(); // B 40
  await waitFor(
    () => getRenderedScore(document).pointsA === "40" && getRenderedScore(document).pointsB === "40",
    { label: "deuce 40-40" }
  );

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "Ad", { label: "advantage A" });
});

test("winning advantage point takes the game", async () =>
{
  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).gamesA === 2, { label: "A wins game 2" });
  assert.equal(getRenderedScore(document).pointsA, "0");
});

test("CORE: an externally pushed score snapshot re-renders the scoreboard", async () =>
{
  // Simulates another device / the backend writing courts/{id}/score/current.
  pushScoreSnapshot("courtone", makeScore({
    A: { points: 2, games: 5, sets: 1, totalPoints: 40 },
    B: { points: 1, games: 4, sets: 0, totalPoints: 33 },
    lastPointTeam: "A",
    completedSets: [{ A: 6, B: 4, tiebreakPoints: null }]
  }));

  await waitFor(() => getRenderedScore(document).pointsA === "30", { label: "external snapshot rendered" });
  const rendered = getRenderedScore(document);
  assert.equal(rendered.pointsB, "15");
  assert.equal(rendered.gamesA, 5);
  assert.equal(rendered.gamesB, 4);
  assert.equal(rendered.setsA, 1);
  assert.equal(rendered.setsB, 0);
});

test("CORE: consecutive external snapshots each render (no dedupe/stall)", async () =>
{
  pushScoreSnapshot("courtone", makeScore({ A: { points: 1, games: 0, sets: 0, totalPoints: 1 } }));
  await waitFor(() => getRenderedScore(document).pointsA === "15", { label: "first snapshot" });

  pushScoreSnapshot("courtone", makeScore({ A: { points: 2, games: 0, sets: 0, totalPoints: 2 } }));
  await waitFor(() => getRenderedScore(document).pointsA === "30", { label: "second snapshot" });

  pushScoreSnapshot("courtone", makeScore({ A: { points: 3, games: 0, sets: 0, totalPoints: 3 } }));
  await waitFor(() => getRenderedScore(document).pointsA === "40", { label: "third snapshot" });
});

test("CORE: scoreboard still updates after the tab is backgrounded and resumed", async () =>
{
  // Simulate the listener refresh triggered by visibilitychange.
  document.dispatchEvent(new window.Event("visibilitychange"));
  await settle(50);

  document.getElementById("addPointB").click();
  await waitFor(() => getRenderedScore(document).pointsB === "15", { label: "B scores after resume" });
});

test("last-point indicator follows the scoring team", async () =>
{
  const indicatorB = document.querySelector("#teamB .indicator");
  assert.equal(indicatorB.style.opacity, "1");
  const indicatorA = document.querySelector("#teamA .indicator");
  assert.equal(indicatorA.style.opacity, "0");
});

test("frontend score state matches the authoritative backend score", async () =>
{
  await settle(25);
  const backend = getBackendScore("courtone");
  const rendered = getRenderedScore(document);
  assert.equal(rendered.gamesA, backend.A.games);
  assert.equal(rendered.gamesB, backend.B.games);
  assert.equal(rendered.setsA, backend.A.sets);
  assert.equal(rendered.setsB, backend.B.sets);
});

test("stale events posted with an outdated scoreVersion are ignored by the backend", async () =>
{
  // Bump the court's scoreVersion server-side without telling this client yet:
  // events sent with the old version must not corrupt the score.
  const courtBefore = firestoreState.docs.get("courts/courtone");
  const scoreBefore = getRenderedScore(document);

  firestoreState.docs.set("courts/courtone", { ...courtBefore, scoreVersion: 99 });

  document.getElementById("addPointA").click();
  await settle(60);
  assert.deepEqual(getRenderedScore(document), scoreBefore);

  // Restore the version; scoring works again.
  firestoreState.docs.set("courts/courtone", { ...courtBefore });
  document.getElementById("addPointA").click();
  await waitFor(
    () => getRenderedScore(document).pointsA !== scoreBefore.pointsA,
    { label: "scoring resumes after version restore" }
  );
});
