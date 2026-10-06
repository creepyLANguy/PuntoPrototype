// Frontend integration tests: alternative scoring modes on the scoreboard.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  joinCourtAsPlayer,
  getRenderedScore,
  waitFor,
  settle,
  callableHandlers,
  getBackendScore,
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
  for (const courtId of ["fixedwinner", "fixeddraw", "fixedgolden"]) {
    seedCourt(courtId, {
      scoringMode: "fixedTotalPoints",
      scoringOptions: {
        scoringMode: "fixedTotalPoints",
        pointsTarget: 12,
        completion: {
          tieResolution: courtId === "fixedgolden" ? "golden_point" : "allow_draw",
        },
      },
    });
  }
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
  assert.equal(document.getElementById("straightPointsTotal").classList.contains("fixed-total"), false);

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
  document.getElementById("closeSettingsBtn").click();
  await waitFor(() => document.getElementById("settingsModal").classList.contains("hidden"), {
    label: "settings modal closed",
  });
});

async function awardFixedPoint(team) {
  const points = document.getElementById(`points${team}`);
  const next = String(Number(points.textContent) + 1);
  document.getElementById(`addPoint${team}`).click();
  await waitFor(() => points.textContent === next, { label: `${team} at ${next}` });
}

function assertFixedGlow(a, b) {
  for (const [team, expected] of [["A", a], ["B", b]]) {
    assert.equal(document.getElementById(`points${team}`).classList.contains("is-critical"), expected);
    assert.equal(document.getElementById(`criticalGlow${team}`).classList.contains("is-critical"), expected);
  }
}

test("fixed scoring sliders use a white accent", () => {
  const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
  assert.match(styles, /\.scoring-field input\[type="range"\]\s*\{[^}]*accent-color:\s*#fff;/);
});

test("fixed scoring totals reset circular sizing and border rules", () => {
  const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
  const rule = styles.match(/\.straight-total\.fixed-total\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /width:\s*unset;/);
  assert.match(rule, /padding:\s*unset\s*!important;/);
  assert.match(rule, /border-radius:\s*unset\s*!important;/);
  assert.match(rule, /aspect-ratio:\s*auto;/);
  assert.match(rule, /height:\s*auto;/);
  assert.match(rule, /max-width:\s*none;/);
});

test("fixed points celebrate the winner only after the last point is scored", async () => {
  await leaveCourtViaBackButton();
  await joinCourtAsPlayer(document, "fixedwinner");
  const overlay = document.getElementById("setWinOverlay");
  overlay.click();
  await awardFixedPoint("A");
  assert.equal(document.getElementById("straightTotalValue").textContent, "1 / 12");
  assert.equal(document.getElementById("straightPointsTotal").classList.contains("fixed-total"), true);
  for (let i = 1; i < 6; i++) await awardFixedPoint("A");
  await awardFixedPoint("B");
  await awardFixedPoint("B");
  assert.equal(document.getElementById("straightTotalValue").textContent, "8 / 12");
  assertFixedGlow(true, false);
  assert.equal(overlay.classList.contains("hidden"), true);

  await awardFixedPoint("A");
  assertFixedGlow(false, false);
  assert.equal(overlay.classList.contains("hidden"), true, "no early majority win screen");
  assert.equal(getBackendScore("fixedwinner").matchComplete, false);
  overlay.click();

  document.getElementById("undoBtn").click();
  await waitFor(() => !document.getElementById("confirmModal").classList.contains("hidden"));
  document.getElementById("confirmOkBtn").click();
  await waitFor(() => document.getElementById("pointsA").textContent === "6");
  assertFixedGlow(true, false);
  await awardFixedPoint("A");
  assert.equal(overlay.classList.contains("hidden"), true, "re-scoring a majority does not celebrate");
  overlay.click();

  for (let i = 0; i < 3; i++) {
    await awardFixedPoint("B");
    assert.equal(overlay.classList.contains("hidden"), i < 2, "celebrate only on the final point");
  }
  assert.equal(getBackendScore("fixedwinner").matchComplete, true);
  assert.equal(document.getElementById("straightTotalValue").textContent, "12 / 12");
  assert.equal(overlay.dataset.winner, "A");
  assert.equal(overlay.querySelector(".set-win-label").textContent, "WINS THE MATCH!");
  assert.equal(overlay.querySelector(".sw-score-a").textContent, "7");
  assert.equal(overlay.querySelector(".sw-score-b").textContent, "5");
  overlay.click();
  document.getElementById("undoBtn").click();
  await waitFor(() => !document.getElementById("confirmModal").classList.contains("hidden"));
  document.getElementById("confirmOkBtn").click();
  await waitFor(() => document.getElementById("pointsB").textContent === "4");
  assert.equal(overlay.classList.contains("hidden"), true);
  await awardFixedPoint("B");
  assert.equal(overlay.classList.contains("hidden"), false, "undo re-arms the final celebration");
  overlay.click();
  assert.equal(getRenderedScore(document).pointsB, "5");
  document.getElementById("addPointB").click();
  await settle();
  assert.equal(getRenderedScore(document).pointsB, "5");
  assert.equal(overlay.classList.contains("hidden"), true, "completed scores do not repeat the celebration");
});

test("fixed points show a draw screen when the target is reached tied", async () => {
  await leaveCourtViaBackButton();
  await joinCourtAsPlayer(document, "fixeddraw");
  for (let i = 0; i < 6; i++) {
    await awardFixedPoint("A");
    await awardFixedPoint("B");
  }
  assertFixedGlow(false, false);
  const overlay = document.getElementById("setWinOverlay");
  assert.equal(overlay.classList.contains("hidden"), false);
  assert.equal(overlay.dataset.winner, "draw");
  assert.equal(overlay.querySelector(".set-win-label").textContent, "MATCH DRAW!");
  assert.equal(overlay.querySelector(".set-win-team-name").textContent, "Team A & Team B");
  assert.equal(overlay.querySelector(".sw-score-a").textContent, "6");
  assert.equal(overlay.querySelector(".sw-score-b").textContent, "6");
  assert.equal(getBackendScore("fixeddraw").result, "draw");
  overlay.click();
});

test("fixed golden points glow for both teams and celebrate the deciding winner", async () => {
  await leaveCourtViaBackButton();
  await joinCourtAsPlayer(document, "fixedgolden");
  for (let i = 0; i < 6; i++) {
    await awardFixedPoint("A");
    await awardFixedPoint("B");
  }
  const overlay = document.getElementById("setWinOverlay");
  assertFixedGlow(true, true);
  assert.equal(overlay.classList.contains("hidden"), true);
  assert.equal(getBackendScore("fixedgolden").matchComplete, false);
  await awardFixedPoint("B");
  assertFixedGlow(false, false);
  assert.equal(overlay.classList.contains("hidden"), false);
  assert.equal(overlay.dataset.winner, "B");
  assert.equal(overlay.querySelector(".set-win-label").textContent, "WINS THE MATCH!");
  assert.equal(getBackendScore("fixedgolden").matchComplete, true);
  assert.equal(document.getElementById("straightTotalValue").textContent, "13 / 12");
  overlay.click();

  await leaveCourtViaBackButton();
  await joinCourtAsPlayer(document, "fixedgolden");
  assert.equal(overlay.classList.contains("hidden"), true, "joining a decided match does not replay its celebration");
});
