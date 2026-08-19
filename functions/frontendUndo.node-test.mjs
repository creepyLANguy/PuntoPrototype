// Frontend integration tests: undo feedback and score/options consistency
// around scoring-mode changes and stale matchComplete flags.
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
  writeDoc
} from "./frontendHarness/harness.mjs";

let document;
let window;

const STRAIGHT_OPTIONS = { scoringMode: "straight", deuceMode: "standard", tiebreakMode: "sixAllSeven" };

async function undoViaButton()
{
  document.getElementById("undoBtn").click();
  await waitFor(
    () => !document.getElementById("confirmModal").classList.contains("hidden"),
    { label: "undo confirm modal" }
  );
  document.getElementById("confirmOkBtn").click();
  await settle(40);
}

test.before(async () =>
{
  seedBaseData();
  seedCourt("undocourt");
  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
  await joinCourtAsPlayer(document, "undocourt");
});

test("undo with nothing to undo gives no undo feedback", async () =>
{
  await undoViaButton();
  await settle(40);

  // The backend treats an UNDO on a fresh score as a no-op, so the UI must
  // not flash an undo animation either.
  assert.equal(document.getElementById("pointsA").classList.contains("undo-flash"), false);
  assert.equal(document.getElementById("pointsB").classList.contains("undo-flash"), false);
  assert.equal(getRenderedScore(document).pointsA, "0");
  assert.equal(getRenderedScore(document).pointsB, "0");
});

test("undo reverts the last point and flashes the scorer's points", async () =>
{
  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "15", { label: "A at 15" });

  await undoViaButton();
  await waitFor(() => getRenderedScore(document).pointsA === "0", { label: "A back to 0" });

  assert.equal(document.getElementById("pointsA").classList.contains("undo-flash"), true);
});

test("score rendering follows the score document's own options during a mode change", async () =>
{
  // Score three points -> 40 in standard scoring.
  for (const target of ["15", "30", "40"])
  {
    document.getElementById("addPointA").click();
    await waitFor(() => getRenderedScore(document).pointsA === target, { label: `A at ${target}` });
  }

  // Simulate a remote scoring-mode change: the court document flips to
  // "straight" while the recalculated score document has not arrived yet.
  writeDoc("courts/undocourt", {
    name: "undocourt",
    password: "pw",
    status: "open",
    scoreVersion: 0,
    scoringMode: "straight",
    scoringOptions: STRAIGHT_OPTIONS,
    teamNames: { A: "Team A", B: "Team B" },
    playerNames: { A1: "", A2: "", B1: "", B2: "" }
  });
  await settle(40);

  // Re-render the still-standard score snapshot: the numbers were produced by
  // standard scoring, so they must keep their tennis labels until a score
  // recalculated under the new mode actually arrives.
  pushScoreSnapshot("undocourt", makeScore({
    A: { points: 3, games: 0, sets: 0, totalPoints: 3 },
    lastPointTeam: "A"
  }));
  await settle(40);

  assert.equal(getRenderedScore(document).pointsA, "40");

  // No straight-points badge/total for a score that is still standard.
  assert.equal(document.getElementById("scoreFormatBadge").classList.contains("hidden"), true);
  assert.equal(document.getElementById("straightPointsTotal").classList.contains("hidden"), true);

  // Sets/games rows describe the standard-format score and must stay visible.
  const setsRowsVisible = [...document.querySelectorAll(".sets-row")]
    .every((el) => !el.classList.contains("hidden"));
  assert.equal(setsRowsVisible, true);
});

test("a stale matchComplete flag outside tiebreakTen does not suppress critical-point indicators", async () =>
{
  // Set point in standard scoring (5-0 games, 40-0), but with a stale
  // matchComplete flag such as one persisted before a mode change.
  pushScoreSnapshot("undocourt", makeScore({
    A: { points: 3, games: 5, sets: 0, totalPoints: 23 },
    B: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    lastPointTeam: "A",
    matchComplete: true
  }));
  await settle(40);

  assert.equal(getRenderedScore(document).pointsA, "40");
  assert.equal(document.getElementById("pointsA").classList.contains("is-critical"), true);
});
