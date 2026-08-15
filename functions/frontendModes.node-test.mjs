// Frontend integration tests: alternative scoring modes on the scoreboard.
import assert from "node:assert/strict";
import test from "node:test";

import
{
  bootFrontend,
  seedBaseData,
  seedCourt,
  joinCourtAsPlayer,
  getRenderedScore,
  waitFor,
  settle
} from "./frontendHarness/harness.mjs";

let document;
let window;

async function leaveCourtViaBackButton()
{
  document.getElementById("backBtn").click();
  await waitFor(
    () => !document.getElementById("confirmModal").classList.contains("hidden"),
    { label: "exit confirm modal" }
  );
  document.getElementById("confirmOkBtn").click();
  await waitFor(
    () => document.getElementById("menuPage").style.display !== "none",
    { label: "menu page after leaving court" }
  );
  await settle(30);
}

test.before(async () =>
{
  seedBaseData();
  seedCourt("straightcourt", {
    scoringMode: "straight",
    scoringOptions: { scoringMode: "straight", deuceMode: "standard", tiebreakMode: "sixAllSeven" }
  });
  seedCourt("tiebreakcourt", {
    scoringMode: "tiebreakTen",
    scoringOptions: { scoringMode: "tiebreakTen", deuceMode: "standard", tiebreakMode: "sixAllSeven" }
  });
  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
});

test("straight mode: points render as running numbers", async () =>
{
  await joinCourtAsPlayer(document, "straightcourt");

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "1", { label: "A at 1" });

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "2", { label: "A at 2" });

  document.getElementById("addPointB").click();
  await waitFor(() => getRenderedScore(document).pointsB === "1", { label: "B at 1" });
});

test("straight mode: sets/games rows are hidden and total is shown", async () =>
{
  const setsRowHidden = [...document.querySelectorAll(".sets-row")]
    .every((el) => el.classList.contains("hidden"));
  const gamesRowHidden = [...document.querySelectorAll(".games-row")]
    .every((el) => el.classList.contains("hidden"));
  assert.equal(setsRowHidden, true);
  assert.equal(gamesRowHidden, true);

  const totalEl = document.getElementById("straightPointsTotal");
  assert.equal(totalEl.classList.contains("hidden"), false);
  assert.equal(document.getElementById("straightTotalValue").textContent, "3");

  const badge = document.getElementById("scoreFormatBadge");
  assert.equal(badge.classList.contains("hidden"), false);
  assert.match(badge.textContent, /Straight points/);
});

test("tiebreakTen mode: numeric points and match completion at 10", async () =>
{
  await leaveCourtViaBackButton();
  await joinCourtAsPlayer(document, "tiebreakcourt");

  for (let i = 0; i < 9; i++)
  {
    document.getElementById("addPointA").click();
    await waitFor(
      () => getRenderedScore(document).pointsA === String(i + 1),
      { label: `A at ${i + 1}` }
    );
  }

  document.getElementById("addPointB").click();
  await waitFor(() => getRenderedScore(document).pointsB === "1", { label: "B at 1" });

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "10", { label: "A wins the tiebreak" });

  // Match complete: further points must not change the score.
  document.getElementById("addPointA").click();
  await settle(60);
  assert.equal(getRenderedScore(document).pointsA, "10");
  assert.equal(getRenderedScore(document).pointsB, "1");
});
