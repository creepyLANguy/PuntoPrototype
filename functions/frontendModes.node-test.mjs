// Frontend integration tests: alternative scoring modes on the scoreboard.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  joinCourtAsPlayer,
  getRenderedScore,
  waitFor,
  settle,
  callableHandlers,
} from "./frontendHarness/harness.mjs";

let document;
let window;
let scoringUpdateRequests = [];

async function leaveCourtViaBackButton() {
  document.getElementById("backBtn").click();
  await waitFor(() => !document.getElementById("confirmModal").classList.contains("hidden"), {
    label: "exit confirm modal",
  });
  document.getElementById("confirmOkBtn").click();
  await waitFor(() => document.getElementById("menuPage").style.display !== "none", {
    label: "menu page after leaving court",
  });
  await settle(30);
}

test.before(async () => {
  seedBaseData();
  seedCourt("straightcourt", {
    scoringMode: "straight",
    scoringOptions: { scoringMode: "straight", deuceMode: "standard", tiebreakMode: "sixAllSeven" },
  });
  seedCourt("tiebreakcourt", {
    scoringMode: "tiebreakTen",
    scoringOptions: {
      scoringMode: "tiebreakTen",
      deuceMode: "standard",
      tiebreakMode: "sixAllSeven",
    },
  });
  seedCourt("settingscourt", {
    scoringMode: "standard",
    scoringOptions: {
      scoringMode: "standard",
      deuceMode: "standard",
      tiebreakMode: "sixAllSeven",
    },
  });
  scoringUpdateRequests = [];
  callableHandlers.set("updateScoringOptions", async (payload) => {
    scoringUpdateRequests.push(structuredClone(payload));
    return {
      data: {
        scoringOptions: structuredClone(payload.scoringOptions),
        scoringMode: payload.scoringMode,
      },
    };
  });
  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
});

test("straight mode: points render as running numbers", async () => {
  await joinCourtAsPlayer(document, "straightcourt");

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "1", { label: "A at 1" });

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "2", { label: "A at 2" });

  document.getElementById("addPointB").click();
  await waitFor(() => getRenderedScore(document).pointsB === "1", { label: "B at 1" });
});

test("straight mode: sets/games rows are hidden and total is shown", async () => {
  const setsRowHidden = [...document.querySelectorAll(".sets-row")].every((el) =>
    el.classList.contains("hidden"),
  );
  const gamesRowHidden = [...document.querySelectorAll(".games-row")].every((el) =>
    el.classList.contains("hidden"),
  );
  assert.equal(setsRowHidden, true);
  assert.equal(gamesRowHidden, true);

  const totalEl = document.getElementById("straightPointsTotal");
  assert.equal(totalEl.classList.contains("hidden"), false);
  assert.equal(document.getElementById("straightTotalValue").textContent, "3");

  const badge = document.getElementById("scoreFormatBadge");
  assert.equal(badge.classList.contains("hidden"), false);
  assert.match(badge.textContent, /Straight points/);
});

test("tiebreakTen mode: numeric points and match completion at 10", async () => {
  await leaveCourtViaBackButton();
  await joinCourtAsPlayer(document, "tiebreakcourt");

  for (let i = 0; i < 9; i++) {
    document.getElementById("addPointA").click();
    await waitFor(() => getRenderedScore(document).pointsA === String(i + 1), {
      label: `A at ${i + 1}`,
    });
  }

  document.getElementById("addPointB").click();
  await waitFor(() => getRenderedScore(document).pointsB === "1", { label: "B at 1" });

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "10", {
    label: "A wins the tiebreak",
  });

  // Match complete: further points must not change the score.
  document.getElementById("addPointA").click();
  await settle(60);
  assert.equal(getRenderedScore(document).pointsA, "10");
  assert.equal(getRenderedScore(document).pointsB, "1");
});


test("fixed scoring controls commit on release and retain their profile across mode switches", async () => {
  await leaveCourtViaBackButton();
  await joinCourtAsPlayer(document, "settingscourt");

  scoringUpdateRequests = [];
  document.getElementById("settingsBtn").click();
  await waitFor(
    () => !document.getElementById("settingsModal").classList.contains("hidden"),
    { label: "settings modal" },
  );

  const mode = document.getElementById("scoringModeSelect");
  mode.value = "fixedTotalPoints";
  mode.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => scoringUpdateRequests.length === 1 && !mode.disabled, {
    label: "fixed mode save",
  });

  const total = document.getElementById("fixedPointsTargetInput");
  const totalValue = document.getElementById("fixedPointsTargetValue");
  assert.equal(total.type, "range");
  assert.equal(total.min, "12");
  assert.equal(total.max, "100");
  assert.equal(total.step, "4");

  total.value = "52";
  total.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(totalValue.textContent, "52");
  assert.equal(scoringUpdateRequests.length, 1);

  total.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => scoringUpdateRequests.length === 2 && !total.disabled, {
    label: "total points save",
  });
  assert.equal(scoringUpdateRequests.at(-1).scoringOptions.pointsTarget, 52);

  const block = document.getElementById("fixedServeBlockLengthInput");
  const blockValue = document.getElementById("fixedServeBlockLengthValue");
  assert.equal(block.type, "range");
  assert.equal(block.min, "1");
  assert.equal(block.max, "4");
  assert.equal(block.step, "1");

  block.value = "3";
  block.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(blockValue.textContent, "3");
  assert.equal(scoringUpdateRequests.length, 2);

  block.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => scoringUpdateRequests.length === 3 && !block.disabled, {
    label: "block length save",
  });
  assert.equal(
    scoringUpdateRequests.at(-1).scoringOptions.serving.serveBlockLength,
    3,
  );

  const serveOrder = document.getElementById("fixedServeOrderInput");
  serveOrder.value = "B1, A1, B2, A2";
  serveOrder.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(scoringUpdateRequests.length, 3);
  serveOrder.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => scoringUpdateRequests.length === 4 && !serveOrder.disabled, {
    label: "serve order save",
  });
  assert.deepEqual(
    scoringUpdateRequests.at(-1).scoringOptions.serving.order,
    ["B1", "A1", "B2", "A2"],
  );

  mode.value = "standard";
  mode.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => scoringUpdateRequests.length === 5, {
    label: "standard mode save",
  });
  await waitFor(
    () => !mode.disabled && mode.value === "standard",
    { label: "standard mode applied" },
  );
  await settle(50);

  mode.value = "fixedTotalPoints";
  mode.dispatchEvent(new window.Event("change", { bubbles: true }));
  await waitFor(() => scoringUpdateRequests.length === 6 && !mode.disabled, {
    label: "fixed mode restore save",
  });

  assert.equal(total.value, "52");
  assert.equal(block.value, "3");
  assert.deepEqual(serveOrder.value, "B1, A1, B2, A2");
  assert.equal(
    scoringUpdateRequests.at(-1).scoringOptions.pointsTarget,
    52,
  );
  assert.equal(
    scoringUpdateRequests.at(-1).scoringOptions.serving.serveBlockLength,
    3,
  );
  assert.equal(
    scoringUpdateRequests.at(-1).scoringOptions.serving.servesPerPlayer,
    undefined,
  );
});
