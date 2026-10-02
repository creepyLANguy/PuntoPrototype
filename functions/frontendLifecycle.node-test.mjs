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

let document;
let window;
let changeoverEventCounter = 0;

test.before(async () => {
  seedBaseData();
  seedCourt("lifecourt");
  seedCourt("watchcourt", { teamNames: { A: "Reds", B: "Blues" } });

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
  // bump the court's scoreVersion so pre-reset events become stale.
  callableHandlers.set("resetCourt", async ({ courtId, newPassword }) => {
    const courtPath = `courts/${courtId}`;
    const court = firestoreState.docs.get(courtPath) || {};
    const scoreVersion = (Number(court.scoreVersion) || 0) + 1;

    for (const path of [...firestoreState.docs.keys()]) {
      if (path.startsWith(`courts/${courtId}/events/`)) {
        firestoreState.docs.delete(path);
      }
    }
    firestoreState.backendScores.delete(courtId);

    writeDoc(courtPath, {
      ...court,
      scoreVersion,
      password: newPassword || court.password,
      beaconSidesSwapped: false,
    });
    pushScoreSnapshot(courtId, makeScore());

    return { data: { scoreVersion } };
  });

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
});

test("set win: winning a set fills a set dot and shows the celebration overlay", async () => {
  await joinCourtAsPlayer(document, "lifecourt");

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
  const courtBefore = firestoreState.docs.get("courts/lifecourt");
  assert.equal(courtBefore.beaconSidesSwapped, false);

  document.getElementById("settingsBtn").click();
  await settle(10);

  const changeoverTile = document.getElementById("changeoverTile");
  assert.notEqual(changeoverTile.style.display, "none");
  assert.equal(changeoverTile.querySelector("span").textContent, "Changeover");

  const switchViewsButton = document.getElementById("swapBtn");
  assert.equal(
    switchViewsButton.closest(".setting-item").querySelector("span").textContent,
    "Switch views",
  );

  // Establish a local view preference that is intentionally different from
  // the backend Beacon mapping. Changeover must not derive its backend value
  // from this view state.
  switchViewsButton.click();
  assert.equal(document.querySelector(".scoreboard").classList.contains("swapped"), true);
  assert.equal(
    firestoreState.docs.get("courts/lifecourt").beaconSidesSwapped,
    false,
    "Switch views remains visual-only",
  );

  document.getElementById("changeoverBtn").click();

  await waitFor(() => firestoreState.docs.get("courts/lifecourt").beaconSidesSwapped === true, {
    label: "local changeover toggles backend Beacon state",
  });
  await waitFor(
    () => document.querySelector(".scoreboard").classList.contains("swapped") === false,
    {
      label: "local changeover blindly toggles local view",
    },
  );
  await waitFor(
    () =>
      document.getElementById("changeoverTile").querySelector("span").textContent ===
      "Changeover *",
    {
      label: "local changeover toggles its own button state",
    },
  );

  assert.equal(
    switchViewsButton.closest(".setting-item").querySelector("span").textContent,
    "Switch views",
    "Switch views preference is independent of active changeover state",
  );
  assert.equal(window.__clashAudioTestState.starts, 1);

  // The user can change view order without touching the Beacon changeover state.
  switchViewsButton.click();
  assert.equal(document.querySelector(".scoreboard").classList.contains("swapped"), true);
  assert.equal(firestoreState.docs.get("courts/lifecourt").beaconSidesSwapped, true);
  assert.equal(
    document.getElementById("changeoverTile").querySelector("span").textContent,
    "Changeover *",
  );

  // A second local view toggle is deliberately used to make view state differ
  // from the current Beacon state again. The next changeover must still
  // toggle Beacon state and local view state independently.
  switchViewsButton.click();
  assert.equal(document.querySelector(".scoreboard").classList.contains("swapped"), false);
  assert.equal(firestoreState.docs.get("courts/lifecourt").beaconSidesSwapped, true);

  document.getElementById("changeoverBtn").click();

  await waitFor(() => firestoreState.docs.get("courts/lifecourt").beaconSidesSwapped === false, {
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
  const remoteCourt = firestoreState.docs.get("courts/lifecourt");
  writeDoc("courts/lifecourt", {
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

  // Switch views remains independently controllable after the remote changeover.
  switchViewsButton.click();
  assert.equal(document.querySelector(".scoreboard").classList.contains("swapped"), true);
  assert.equal(
    document.getElementById("changeoverTile").querySelector("span").textContent,
    "Changeover *",
  );

  // A successful local changeover while muted must not play the sound.
  document.getElementById("muteBtn").click();
  assert.equal(document.getElementById("muteBtn").getAttribute("aria-pressed"), "true");
  document.getElementById("changeoverBtn").click();
  await waitFor(() => firestoreState.docs.get("courts/lifecourt").beaconSidesSwapped === false, {
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

  try
  {
    callableHandlers.set(
      "changeoverCourt",
      async ({ courtId }) =>
      {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return originalHandler({ courtId });
      },
    );

    button.click();
    await settle(0);

    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.getAttribute("aria-label"), "Changing court over");
    assert.equal(button.classList.contains("processing"), true);
    assert.equal(label.textContent, "Changing over…");
    assert.ok(button.querySelector(".changeover-spinner"));

    await waitFor(
      () =>
        button.disabled === false &&
        button.getAttribute("aria-busy") === null &&
        label.textContent === "Changeover *",
      { label: "changeover processing state clears after success" },
    );
    assert.equal(button.classList.contains("processing"), false);
    assert.equal(button.getAttribute("aria-label"), "Changeover");
    assert.equal(button.title, "Changeover");
    assert.equal(button.textContent, "↔");

    callableHandlers.set(
      "changeoverCourt",
      async () =>
      {
        throw new Error("Simulated changeover failure");
      },
    );

    button.click();

    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(label.textContent, "Changing over…");

    await waitFor(
      () =>
        button.disabled === false &&
        button.getAttribute("aria-busy") === null &&
        label.textContent === "Changeover",
      { label: "changeover processing state clears after failure" },
    );
    assert.equal(button.classList.contains("processing"), false);
    assert.equal(button.getAttribute("aria-label"), "Changeover");
    assert.equal(button.textContent, "↔");
  }
  finally
  {
    callableHandlers.set("changeoverCourt", originalHandler);
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

  const court = firestoreState.docs.get("courts/lifecourt");
  writeDoc("courts/lifecourt", {
    ...court,
    beaconSidesSwapped: true,
  });

  await joinCourtAsPlayer(document, "lifecourt");

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
    "Switch views",
  );
  assert.equal(document.getElementById("swapBtn").getAttribute("aria-pressed"), "false");

  document.getElementById("changeoverBtn").click();

  await waitFor(() => firestoreState.docs.get("courts/lifecourt").beaconSidesSwapped === false, {
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
  assert.equal(firestoreState.docs.get("courts/lifecourt").beaconSidesSwapped, false);
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
  const court = firestoreState.docs.get("courts/lifecourt");
  writeDoc("courts/lifecourt", { ...court, status: "closed" });

  await waitFor(() => document.getElementById("menuPage").style.display !== "none", {
    label: "menu page after closure",
  });
  assert.equal(document.getElementById("scoreboardPage").style.display, "none");
});

test("spectator joins with the court's active changeover visual state", async () => {
  const court = firestoreState.docs.get("courts/watchcourt");
  writeDoc("courts/watchcourt", {
    ...court,
    beaconSidesSwapped: true,
  });

  const spectateButton = [...document.querySelectorAll(".menu-btn")].find(
    (btn) => btn.textContent.trim() === "Spectate",
  );
  assert.ok(spectateButton, "Spectate menu button exists");
  spectateButton.click();

  await waitFor(() => document.querySelector(`#spectateCourtList [data-court-name="watchcourt"]`), {
    label: "watchcourt in spectate list",
  });
  document.querySelector(`#spectateCourtList [data-court-name="watchcourt"]`).click();

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

  await waitFor(() => document.querySelector(`#spectateCourtList [data-court-name="watchcourt"]`), {
    label: "watchcourt in spectate list",
  });
  document.querySelector(`#spectateCourtList [data-court-name="watchcourt"]`).click();

  await waitFor(() => document.getElementById("scoreboardPage").style.display !== "none", {
    label: "scoreboard shown for spectator",
  });

  await waitFor(() => document.querySelector("#teamA .name-text").textContent === "Reds", {
    label: "spectated team names",
  });

  pushScoreSnapshot(
    "watchcourt",
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
