// Frontend integration tests: court lifecycle flows that affect scoring —
// reset (scoreVersion bump), set-win detection, admin closure, spectating.
import assert from "node:assert/strict";
import test from "node:test";

import {
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
  callableHandlers,
  writeDoc,
} from "./frontendHarness/harness.mjs";
import { session } from "../app/js/state/sessionState.js";

let document;
let window;
let enterCourt;
let changeoverEventCounter = 0;
const swapAnimations = [];

test.before(async () => {
  seedBaseData();
  seedCourt("abcda");
  seedCourt("xyzza", { teamNames: { A: "Reds", B: "Blues" } });

  callableHandlers.set("changeoverCourt", async ({ courtId }) => {
    const courtPath = `courts/${courtId}`;
    const court = firestoreState.docs.get(courtPath) || {};
    const beaconSidesSwapped = court.beaconSidesSwapped !== true;
    const changeoverEventId = `changeover-${++changeoverEventCounter}`;

    writeDoc(courtPath, {
      ...court,
      beaconSidesSwapped,
      changeoverEvent: {
        id: changeoverEventId,
      },
    });

    return { data: { courtId, beaconSidesSwapped, changeoverEventId } };
  });

  // Mimic the resetCourt Cloud Function: zero the score, clear the event log,
  // bump the match's scoreVersion so pre-reset events become stale.
  callableHandlers.set("resetCourt", async ({ courtId, newPassword }) => {
    const courtPath = `courts/${courtId}`;
    const court = firestoreState.docs.get(courtPath) || {};
    const matchId = court.activeMatchId || `${courtId}aaaa`;
    const matchPath = `matches/${matchId}`;
    const match = firestoreState.docs.get(matchPath) || {};
    const scoreVersion = (Number(match.scoreVersion) || 0) + 1;

    for (const path of [...firestoreState.docs.keys()]) {
      if (path.startsWith(`matches/${matchId}/events/`)) {
        firestoreState.docs.delete(path);
      }
    }
    firestoreState.backendScores.delete(matchId);

    writeDoc(courtPath, {
      ...court,
      password: newPassword || court.password,
      beaconSidesSwapped: false,
    });
    writeDoc(matchPath, { ...match, scoreVersion });
    pushScoreSnapshot(courtId, makeScore());

    return { data: { scoreVersion } };
  });

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
  ({ enterCourt } = await import("../app/js/court/session.js"));
  window.HTMLElement.prototype.animate = function (keyframes, options) {
    const animation = { id: "", cancel() {} };
    swapAnimations.push({ keyframes, options, animation });
    return animation;
  };
});

test("set win: winning a set fills a set dot and shows the celebration overlay", async () => {
  await joinCourtAsPlayer(document, "abcda");

  // Take team A to 5-0 games, 40-0, entirely through real point events.
  for (let i = 0; i < 23; i++) {
    document.getElementById("addPointA").click();
    await settle(0);
  }

  await waitFor(() => getRenderedScore(document).gamesA === 5, { label: "A at 5 games" });
  await waitFor(() => getRenderedScore(document).pointsA === "40", { label: "A at 40" });

  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).setsA === 1, { label: "A wins the set" });

  const rendered = getRenderedScore(document);
  assert.equal(rendered.gamesA, 0);
  assert.equal(rendered.pointsA, "0");

  const overlay = document.getElementById("setWinOverlay");
  assert.equal(overlay.classList.contains("hidden"), false);
  assert.equal(overlay.dataset.winner, "A");
  overlay.click(); // dismiss
});

test("Changeover toggles its own state and independently toggles the local view", async () => {
  const courtBefore = firestoreState.docs.get("courts/abcda");
  assert.equal(courtBefore.beaconSidesSwapped, false);

  document.getElementById("settingsBtn").click();
  await settle(10);

  const changeoverTile = document.getElementById("changeoverTile");
  assert.notEqual(changeoverTile.style.display, "none");
  assert.equal(changeoverTile.querySelector("span").textContent, "Changeover");

  const swapViewsButton = document.getElementById("swapBtn");
  const swapViewsLabel = () =>
    swapViewsButton.closest(".setting-item").querySelector("span").textContent;
  assert.equal(swapViewsLabel(), "Swap views");

  // Establish a local view preference that is intentionally different from
  // the backend Beacon mapping. Changeover must not derive its backend value
  // from this view state.
  swapViewsButton.click();
  assert.equal(document.querySelector(".scoreboard").classList.contains("swapped"), true);
  assert.equal(document.querySelector(".scoreboard").classList.contains("swap-animating"), true);
  assert.equal(swapAnimations.at(-1).options.duration, 650);
  assert.equal(swapViewsLabel(), "Unswap views", "the swapped view offers to unswap");
  assert.equal(
    firestoreState.docs.get("courts/abcda").beaconSidesSwapped,
    false,
    "Swap views remains visual-only",
  );

  document.getElementById("changeoverBtn").click();

  await waitFor(() => firestoreState.docs.get("courts/abcda").beaconSidesSwapped === true, {
    label: "local changeover toggles backend Beacon state",
  });
  await waitFor(
    () => document.querySelector(".scoreboard").classList.contains("swapped") === false,
    {
      label: "local changeover blindly toggles local view",
    },
  );
  assert.equal(
    document.querySelector(".scoreboard").classList.contains("changeover-animating"),
    true,
  );
  assert.equal(swapAnimations.at(-1).options.duration, 900);
  await waitFor(
    () =>
      document.getElementById("changeoverTile").querySelector("span").textContent ===
      "Changeover *",
    {
      label: "local changeover toggles its own button state",
    },
  );

  assert.equal(
    swapViewsLabel(),
    "Swap views",
    "Swap views preference is independent of active changeover state",
  );
  assert.equal(window.__clashAudioTestState.starts, 1);

  // The user can change view order without touching the Beacon changeover state.
  swapViewsButton.click();
  assert.equal(document.querySelector(".scoreboard").classList.contains("swapped"), true);
  assert.equal(swapViewsLabel(), "Unswap views");
  assert.equal(firestoreState.docs.get("courts/abcda").beaconSidesSwapped, true);
  assert.equal(
    document.getElementById("changeoverTile").querySelector("span").textContent,
    "Changeover *",
  );

  // A second local view toggle is deliberately used to make view state differ
  // from the current Beacon state again. The next changeover must still
  // toggle Beacon state and local view state independently.
  swapViewsButton.click();
  assert.equal(document.querySelector(".scoreboard").classList.contains("swapped"), false);
  assert.equal(swapViewsLabel(), "Swap views");
  assert.equal(firestoreState.docs.get("courts/abcda").beaconSidesSwapped, true);

  document.getElementById("changeoverBtn").click();

  await waitFor(() => firestoreState.docs.get("courts/abcda").beaconSidesSwapped === false, {
    label: "second local changeover toggles backend independently of view",
  });
  await waitFor(
    () => document.querySelector(".scoreboard").classList.contains("swapped") === true,
    {
      label: "second local changeover toggles local view independently",
    },
  );
  await waitFor(
    () =>
      document.getElementById("changeoverTile").querySelector("span").textContent === "Changeover",
    {
      label: "second local changeover clears its button state",
    },
  );
  assert.equal(window.__clashAudioTestState.starts, 2);

  // Remote changeover broadcasts use the same blind local toggles and do not
  // play the local-only clash sound.
  const remoteCourt = firestoreState.docs.get("courts/abcda");
  writeDoc("courts/abcda", {
    ...remoteCourt,
    beaconSidesSwapped: true,
    changeoverEvent: { id: "remote-changeover-1" },
  });

  await waitFor(
    () => document.querySelector(".scoreboard").classList.contains("swapped") === false,
    {
      label: "remote changeover toggles local view",
    },
  );
  await waitFor(
    () =>
      document.getElementById("changeoverTile").querySelector("span").textContent ===
      "Changeover *",
    {
      label: "remote changeover toggles changeover button state",
    },
  );
  assert.equal(
    window.__clashAudioTestState.starts,
    2,
    "remote changeover broadcast must not play the clash sound",
  );

  // Swap views remains independently controllable after the remote changeover.
  swapViewsButton.click();
  assert.equal(document.querySelector(".scoreboard").classList.contains("swapped"), true);
  assert.equal(
    document.getElementById("changeoverTile").querySelector("span").textContent,
    "Changeover *",
  );

  // A successful local changeover while muted must not play the sound.
  document.getElementById("muteBtn").click();
  assert.equal(document.getElementById("muteBtn").getAttribute("aria-pressed"), "true");
  document.getElementById("changeoverBtn").click();
  await waitFor(() => firestoreState.docs.get("courts/abcda").beaconSidesSwapped === false, {
    label: "muted changeover toggles backend",
  });
  await waitFor(() => document.getElementById("changeoverBtn").disabled === false, {
    label: "muted changeover completed",
  });
  assert.equal(
    window.__clashAudioTestState.starts,
    2,
    "muted local changeover must not play the clash sound",
  );
  document.getElementById("muteBtn").click();
  assert.equal(document.getElementById("muteBtn").getAttribute("aria-pressed"), "false");

  document.getElementById("closeSettingsBtn").click();
  await settle(10);
});

test("changeover shows backend processing feedback and recovers from failure", async () => {
  document.getElementById("settingsBtn").click();
  await settle(10);

  const button = document.getElementById("changeoverBtn");
  const label = document.getElementById("changeoverTile").querySelector("span");
  const originalHandler = callableHandlers.get("changeoverCourt");
  const initialBeaconSidesSwapped =
    firestoreState.docs.get("courts/abcda").beaconSidesSwapped === true;

  try {
    let backendReadyToComplete = null;
    const backendGate = new Promise((resolve) => {
      backendReadyToComplete = resolve;
    });

    let backendStarted = false;
    callableHandlers.set("changeoverCourt", async ({ courtId }) => {
      backendStarted = true;
      await backendGate;
      return originalHandler({ courtId });
    });

    button.click();
    await settle(0);

    assert.equal(backendStarted, true);
    assert.equal(
      firestoreState.docs.get("courts/abcda").beaconSidesSwapped,
      initialBeaconSidesSwapped,
      "backend changeover must not complete while its response is held",
    );
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.getAttribute("aria-label"), "Changing court over");
    assert.equal(button.classList.contains("processing"), true);
    assert.equal(label.textContent, "Changing over…");
    assert.ok(button.querySelector(".changeover-spinner"));

    backendReadyToComplete();

    await waitFor(
      () =>
        button.disabled === false &&
        button.getAttribute("aria-busy") === null &&
        button.classList.contains("processing") === false &&
        label.textContent === "Changeover *",
      { label: "changeover UI should complete after the backend resolves" },
    );

    assert.equal(
      firestoreState.docs.get("courts/abcda").beaconSidesSwapped,
      !initialBeaconSidesSwapped,
      "backend changeover should complete after the held callable resolves",
    );
    assert.equal(button.getAttribute("aria-label"), "Changeover");
    assert.equal(button.title, "Changeover");
    assert.equal(button.textContent, "↔");

    const expectedLabelAfterFailedChangeover = initialBeaconSidesSwapped
      ? "Changeover"
      : "Changeover *";

    callableHandlers.set("changeoverCourt", async () => {
      throw new Error("Simulated changeover failure");
    });

    button.click();

    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(label.textContent, "Changing over…");

    await settle(0);

    await waitFor(
      () =>
        button.disabled === false &&
        button.getAttribute("aria-busy") === null &&
        button.classList.contains("processing") === false &&
        label.textContent === expectedLabelAfterFailedChangeover,
      { label: "changeover UI should recover after backend failure" },
    );

    assert.equal(button.getAttribute("aria-label"), "Changeover");
    assert.equal(button.textContent, "↔");
  } finally {
    callableHandlers.set("changeoverCourt", originalHandler);
  }

  const postTestCourt = firestoreState.docs.get("courts/abcda");
  writeDoc("courts/abcda", {
    ...postTestCourt,
    beaconSidesSwapped: initialBeaconSidesSwapped,
  });

  const scoreboard = document.querySelector(".scoreboard");
  if (scoreboard.classList.contains("swapped")) {
    document.getElementById("swapBtn").click();
  }

  document.getElementById("closeSettingsBtn").click();
  await settle(10);
});

test("active changeover state is applied on join without changing the local view preference", async () => {
  document.getElementById("backBtn").click();
  await waitFor(() => !document.getElementById("confirmModal").classList.contains("hidden"), {
    label: "exit confirm modal before rejoining",
  });
  document.getElementById("confirmOkBtn").click();
  await waitFor(() => document.getElementById("menuPage").style.display !== "none", {
    label: "menu after leaving court",
  });

  const court = firestoreState.docs.get("courts/abcda");
  writeDoc("courts/abcda", {
    ...court,
    beaconSidesSwapped: true,
  });

  await joinCourtAsPlayer(document, "abcda");

  // An active backend changeover controls Beacon semantics, not this client's
  // preferred view order.
  await waitFor(
    () => document.querySelector(".scoreboard").classList.contains("swapped") === false,
    { label: "active changeover does not force player scoreboard view on join" },
  );

  document.getElementById("settingsBtn").click();
  await settle(10);

  assert.equal(
    document.getElementById("changeoverTile").querySelector("span").textContent,
    "Changeover *",
  );
  assert.equal(
    document.getElementById("swapBtn").closest(".setting-item").querySelector("span").textContent,
    "Swap views",
  );
  assert.equal(document.getElementById("swapBtn").getAttribute("aria-pressed"), "false");

  document.getElementById("changeoverBtn").click();

  await waitFor(() => firestoreState.docs.get("courts/abcda").beaconSidesSwapped === false, {
    label: "player toggles active changeover off",
  });
  await waitFor(
    () => document.querySelector(".scoreboard").classList.contains("swapped") === true,
    { label: "player view toggles independently when changeover ends" },
  );
  await waitFor(
    () =>
      document.getElementById("changeoverTile").querySelector("span").textContent === "Changeover",
    { label: "changeover tile returns to inactive state" },
  );

  document.getElementById("closeSettingsBtn").click();
  await settle(10);
});

test("shallow reset through the UI zeroes the scoreboard", async () => {
  document.getElementById("settingsBtn").click();
  await settle(10);
  document.getElementById("resetSettingsBtn").click();
  await waitFor(() => !document.getElementById("resetModal").classList.contains("hidden"), {
    label: "reset modal",
  });

  document.getElementById("resetCourtPassword").value = "newpw1";
  document.getElementById("shallowReset").click();

  await waitFor(
    () => getRenderedScore(document).setsA === 0 && getRenderedScore(document).pointsA === "0",
    { label: "scoreboard zeroed after reset" },
  );
  assert.equal(firestoreState.docs.get("courts/abcda").beaconSidesSwapped, false);
});

test("CORE: scoring still works after a reset bumps the scoreVersion", async () => {
  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "15", {
    label: "A at 15 after reset",
  });

  document.getElementById("addPointB").click();
  await waitFor(() => getRenderedScore(document).pointsB === "15", {
    label: "B at 15 after reset",
  });
});

test("court closed by admin kicks the player back to the menu", async () => {
  const court = firestoreState.docs.get("courts/abcda");
  writeDoc("courts/abcda", { ...court, status: "closed" });

  await waitFor(() => document.getElementById("menuPage").style.display !== "none", {
    label: "menu page after closure",
  });
  assert.equal(document.getElementById("scoreboardPage").style.display, "none");
});

test("spectator joins with the court's active changeover visual state", async () => {
  const court = firestoreState.docs.get("courts/xyzza");
  writeDoc("courts/xyzza", {
    ...court,
    beaconSidesSwapped: true,
  });

  const spectateButton = [...document.querySelectorAll(".menu-btn")].find(
    (btn) => btn.textContent.trim() === "Spectate",
  );
  assert.ok(spectateButton, "Spectate menu button exists");
  spectateButton.click();

  await waitFor(() => document.querySelector(`#spectateCourtList [data-court-name="xyzza"]`), {
    label: "xyzza in spectate list",
  });
  document.querySelector(`#spectateCourtList [data-court-name="xyzza"]`).click();

  await waitFor(() => document.getElementById("scoreboardPage").style.display !== "none", {
    label: "scoreboard shown for spectator",
  });
  await waitFor(() => document.querySelector(".scoreboard").classList.contains("swapped"), {
    label: "active changeover applied to spectator scoreboard on join",
  });

  assert.equal(document.getElementById("changeoverBtn").style.display, "none");
  assert.equal(document.getElementById("changeoverTile").style.display, "none");
  assert.equal(document.getElementById("swapBtn").getAttribute("aria-pressed"), "true");
});

test("spectator sees live score updates pushed by other devices", async () => {
  const spectateButton = [...document.querySelectorAll(".menu-btn")].find(
    (btn) => btn.textContent.trim() === "Spectate",
  );
  assert.ok(spectateButton, "Spectate menu button exists");
  spectateButton.click();

  await waitFor(() => document.querySelector(`#spectateCourtList [data-court-name="xyzza"]`), {
    label: "xyzza in spectate list",
  });
  document.querySelector(`#spectateCourtList [data-court-name="xyzza"]`).click();

  await waitFor(() => document.getElementById("scoreboardPage").style.display !== "none", {
    label: "scoreboard shown for spectator",
  });

  await waitFor(() => document.querySelector("#teamA .name-text").textContent === "Reds", {
    label: "spectated team names",
  });

  pushScoreSnapshot(
    "xyzza",
    makeScore({
      A: { points: 3, games: 2, sets: 0, totalPoints: 11 },
      B: { points: 1, games: 3, sets: 1, totalPoints: 17 },
      lastPointTeam: "A",
    }),
  );

  await waitFor(() => getRenderedScore(document).pointsA === "40", {
    label: "spectated score renders",
  });
  const rendered = getRenderedScore(document);
  assert.equal(rendered.pointsB, "15");
  assert.equal(rendered.gamesA, 2);
  assert.equal(rendered.gamesB, 3);
  assert.equal(rendered.setsB, 1);

  // Spectators must not be able to score: undo hidden, tap-to-score disabled.
  assert.equal(document.body.classList.contains("spectating-mode"), true);
  assert.equal(document.getElementById("undoBtn").style.display, "none");
  assert.equal(document.getElementById("addPointA").style.pointerEvents, "none");
  assert.equal(document.getElementById("addPointB").style.pointerEvents, "none");
  assert.equal(document.getElementById("changeoverBtn").style.display, "none");
  assert.equal(document.getElementById("changeoverFloatingBtn"), null);
  assert.equal(document.getElementById("changeoverTile").style.display, "none");
});

test("New Match is unavailable to spectators, including programmatic clicks", async () => {
  document.getElementById("settingsBtn").click();
  assert.equal(document.getElementById("newMatchTile").style.display, "none");
  assert.equal(document.getElementById("newMatchBtn").disabled, true);
  document.getElementById("newMatchBtn").dispatchEvent(new window.Event("click"));
  await settle(0);
  assert.equal(document.getElementById("confirmModal").classList.contains("hidden"), true);
});

test("New Match requires confirmation and recovers safely from a backend failure", async () => {
  seedCourt("nxmca");
  await enterCourt("nxmca", false);
  document.getElementById("settingsBtn").click();
  const button = document.getElementById("newMatchBtn");
  assert.notEqual(document.getElementById("newMatchTile").style.display, "none");
  assert.equal(document.getElementById("resetSettingsTile").nextElementSibling.id, "newMatchTile");

  const originalHandler = callableHandlers.get("manageMatch");
  let calls = 0;
  callableHandlers.set("manageMatch", async (payload) => {
    if (payload.operation !== "newCourtMatch") return originalHandler(payload);
    calls += 1;
    throw new Error("Simulated new match failure");
  });
  try {
    button.click();
    assert.equal(button.disabled, true);
    document.getElementById("confirmCancelBtn").click();
    await waitFor(() => !button.disabled, { label: "cancelled new match" });
    assert.equal(calls, 0);
    assert.equal(firestoreState.docs.get("courts/nxmca").activeMatchId, "nxmcaa");

    button.click();
    document.getElementById("confirmOkBtn").click();
    await waitFor(() => !button.disabled, { label: "failed new match recovers" });
    assert.equal(calls, 1);
    assert.equal(button.hasAttribute("aria-busy"), false);
    assert.equal(session.currentMatchId, "nxmcaa");
    assert.equal(firestoreState.docs.get("courts/nxmca").activeMatchId, "nxmcaa");
    assert.equal(document.getElementById("settingsModal").classList.contains("hidden"), false);
    assert.match(document.body.textContent, /Simulated new match failure/);
  } finally {
    callableHandlers.set("manageMatch", originalHandler);
  }
});

test("New Match hides the settings modal while its confirmation is visible, and restores it on cancel", async () => {
  // Both modals share `.reset-modal` (position: fixed; z-index: 9999) and the
  // settings modal comes later in the DOM, so if it stayed open it would paint
  // over the confirmation and the button would appear to do nothing.
  const settingsModal = document.getElementById("settingsModal");
  const confirmModal = document.getElementById("confirmModal");
  const button = document.getElementById("newMatchBtn");

  if (settingsModal.classList.contains("hidden")) {
    document.getElementById("settingsBtn").click();
    await settle(10);
  }
  assert.equal(settingsModal.classList.contains("hidden"), false, "settings starts open");
  assert.equal(confirmModal.classList.contains("hidden"), true, "confirm starts closed");

  const originalHandler = callableHandlers.get("manageMatch");
  let calls = 0;
  callableHandlers.set("manageMatch", async (payload) => {
    if (payload.operation !== "newCourtMatch") return originalHandler(payload);
    calls += 1;
    throw new Error("Cancelled confirmation must not call the backend");
  });
  try {
    button.click();
    await waitFor(() => !confirmModal.classList.contains("hidden"), {
      label: "new match confirmation shown",
    });
    assert.equal(
      settingsModal.classList.contains("hidden"),
      true,
      "settings modal must be hidden while the confirmation is visible",
    );
    assert.match(document.getElementById("confirmMessage").textContent, /Start a new match\?/);

    document.getElementById("confirmCancelBtn").click();
    await waitFor(() => !button.disabled, { label: "cancelled new match settles" });
    assert.equal(confirmModal.classList.contains("hidden"), true, "confirmation closed on cancel");
    assert.equal(
      settingsModal.classList.contains("hidden"),
      false,
      "settings modal is restored after cancelling",
    );
    assert.equal(calls, 0);

    // Dismissing by clicking the overlay behaves the same as Cancel.
    button.click();
    await waitFor(() => !confirmModal.classList.contains("hidden"), {
      label: "new match confirmation shown again",
    });
    assert.equal(settingsModal.classList.contains("hidden"), true);
    confirmModal.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await waitFor(() => !button.disabled, { label: "overlay dismiss settles" });
    assert.equal(confirmModal.classList.contains("hidden"), true);
    assert.equal(settingsModal.classList.contains("hidden"), false);
    assert.equal(calls, 0);
  } finally {
    callableHandlers.set("manageMatch", originalHandler);
  }
});

test("New Match saves the old match, follows the new match from an explicit match link, and prevents duplicate requests", async () => {
  await enterCourt("nxmca", false, { matchId: "nxmcaa", followRequestedMatch: true });
  document.getElementById("addPointA").click();
  await waitFor(() => getRenderedScore(document).pointsA === "15", { label: "old match score" });
  const oldScore = structuredClone(firestoreState.docs.get("matches/nxmcaa/score/current"));
  const oldEvents = [...firestoreState.docs.entries()].filter(([path]) =>
    path.startsWith("matches/nxmcaa/events/"),
  );
  const originalHandler = callableHandlers.get("manageMatch");
  let calls = 0;
  let release;
  const heldResponse = new Promise((resolve) => {
    release = resolve;
  });
  callableHandlers.set("manageMatch", async (payload) => {
    if (payload.operation !== "newCourtMatch") return originalHandler(payload);
    calls += 1;
    assert.equal(payload.courtId, "nxmca");
    assert.equal(payload.matchId, "nxmcaa");
    assert.equal(payload.credentials.courtPassword, "pw");
    assert.equal(payload.expectedAllocations.match.nxmcaa, session.currentMatchAllocationId);
    await heldResponse;
    const oldMatch = firestoreState.docs.get("matches/nxmcaa");
    writeDoc("matches/nxmcaa", { ...oldMatch, status: "completed", currentCourtId: null });
    writeDoc("matches/nxmcba", {
      ...oldMatch,
      matchId: "nxmcba",
      allocationId: "allocation-matches-nxmcba",
      scoreVersion: 0,
      teamNames: { A: "Team A", B: "Team B" },
    });
    writeDoc("matches/nxmcba/score/current", makeScore());
    const court = firestoreState.docs.get("courts/nxmca");
    writeDoc("courts/nxmca", {
      ...court,
      activeMatchId: "nxmcba",
      lastMatchId: "nxmcba",
      beaconSidesSwapped: false,
    });
    return {
      data: { success: true, matchId: "nxmcba", allocationId: "allocation-matches-nxmcba" },
    };
  });

  const animationsBefore = swapAnimations.length;
  try {
    document.getElementById("settingsBtn").click();
    const button = document.getElementById("newMatchBtn");
    button.click();
    button.dispatchEvent(new window.Event("click"));
    document.getElementById("confirmOkBtn").click();
    await waitFor(() => calls === 1, { label: "new match callable" });
    button.dispatchEvent(new window.Event("click"));
    await settle(0);
    assert.equal(calls, 1);
    assert.equal(button.disabled, true);
    release();
    await waitFor(() => session.currentMatchId === "nxmcba" && !button.disabled, {
      label: "new match followed",
    });
    assert.equal(session.requestedMatchId, "nxmcba");
    // The old match animates out and the new one animates in.
    const fades = swapAnimations
      .slice(animationsBefore)
      .filter(({ options }) => options.duration === 280);
    assert.equal(fades.length, 2);
    assert.equal(fades[0].keyframes.at(-1).opacity, 0);
    assert.equal(fades[1].keyframes.at(-1).opacity, 1);
    assert.equal(window.location.pathname, "/c/nxmca");
    assert.equal(document.getElementById("settingsModal").classList.contains("hidden"), true);
    assert.equal(getRenderedScore(document).pointsA, "0");
    assert.deepEqual(firestoreState.docs.get("matches/nxmcaa/score/current"), oldScore);
    for (const [path, data] of oldEvents) assert.deepEqual(firestoreState.docs.get(path), data);

    document.getElementById("addPointB").click();
    await waitFor(() => getRenderedScore(document).pointsB === "15", {
      label: "new match accepts points",
    });
    assert.deepEqual(firestoreState.docs.get("matches/nxmcaa/score/current"), oldScore);
  } finally {
    release();
    callableHandlers.set("manageMatch", originalHandler);
  }
});

test("New Match disappears when the current match becomes a tournament match", async () => {
  const match = firestoreState.docs.get("matches/nxmcba");
  writeDoc("matches/nxmcba", { ...match, tournamentId: "abcdefg", kind: "tournament" });
  await waitFor(() => session.currentTournamentId === "abcdefg", {
    label: "tournament match metadata",
  });
  document.getElementById("settingsBtn").click();
  assert.equal(document.getElementById("newMatchTile").style.display, "none");
  assert.equal(document.getElementById("newMatchBtn").disabled, true);
  document.getElementById("newMatchBtn").dispatchEvent(new window.Event("click"));
  await settle(0);
  assert.equal(document.getElementById("confirmModal").classList.contains("hidden"), true);
  writeDoc("matches/nxmcba", match);
  await waitFor(() => !document.getElementById("newMatchBtn").disabled, {
    label: "casual match option restored",
  });
});

test("New Match rechecks the match and spectator mode after confirmation", async () => {
  const originalHandler = callableHandlers.get("manageMatch");
  let calls = 0;
  callableHandlers.set("manageMatch", async (payload) => {
    if (payload.operation !== "newCourtMatch") return originalHandler(payload);
    calls += 1;
    throw new Error("A stale confirmation must not call the backend");
  });
  try {
    document.getElementById("newMatchBtn").click();
    const match = firestoreState.docs.get("matches/nxmcba");
    writeDoc("matches/nxmcba", { ...match, tournamentId: "abcdefg" });
    await waitFor(() => session.currentTournamentId === "abcdefg", {
      label: "tournament assigned during confirmation",
    });
    document.getElementById("confirmOkBtn").click();
    await settle(0);
    assert.equal(calls, 0);
    writeDoc("matches/nxmcba", match);
    await waitFor(() => !document.getElementById("newMatchBtn").disabled, {
      label: "option restored",
    });

    document.getElementById("newMatchBtn").click();
    const { enableSpectateMode } = await import("../app/js/court/session.js");
    enableSpectateMode();
    document.getElementById("confirmOkBtn").click();
    await settle(0);
    assert.equal(calls, 0);
    assert.equal(document.getElementById("newMatchTile").style.display, "none");
  } finally {
    callableHandlers.set("manageMatch", originalHandler);
  }
});

test("a delayed New Match response does not return a viewer to a court they left", async () => {
  await enterCourt("nxmca", false, { matchId: "nxmcba" });
  document.getElementById("settingsBtn").click();
  const originalHandler = callableHandlers.get("manageMatch");
  let release;
  let called = false;
  const heldResponse = new Promise((resolve) => {
    release = resolve;
  });
  callableHandlers.set("manageMatch", async (payload) => {
    if (payload.operation !== "newCourtMatch") return originalHandler(payload);
    called = true;
    await heldResponse;
    return {
      data: { success: true, matchId: "nxmcca", allocationId: "allocation-matches-nxmcca" },
    };
  });
  try {
    document.getElementById("newMatchBtn").click();
    document.getElementById("confirmOkBtn").click();
    await waitFor(() => called, { label: "new match request in flight" });
    await enterCourt("xyzza", true);
    release();
    await waitFor(() => !document.getElementById("newMatchBtn").hasAttribute("aria-busy"), {
      label: "request completes after navigating away",
    });
    assert.equal(session.currentCourtId, "xyzza");
    assert.equal(session.isSpectating, true);
    assert.equal(document.getElementById("newMatchTile").style.display, "none");
  } finally {
    release();
    callableHandlers.set("manageMatch", originalHandler);
  }
});
