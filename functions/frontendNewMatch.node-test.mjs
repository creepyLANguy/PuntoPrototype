// Frontend tests: the "New Match" tile in the court settings menu.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  joinCourtAsPlayer,
  waitFor,
  settle,
  firestoreState,
  callableHandlers,
  writeDoc,
} from "./frontendHarness/harness.mjs";

let document;
const newMatchCalls = [];

const tile = () => document.getElementById("newMatchSettingsTile");
const visible = () => tile().style.display !== "none";

test.before(async () => {
  seedBaseData();
  seedCourt("abcda");
  seedCourt("xyzza");

  const defaultHandler = callableHandlers.get("manageMatch");
  callableHandlers.set("manageMatch", async (payload) => {
    if (payload.operation !== "newCourtMatch") return defaultHandler(payload);
    newMatchCalls.push(payload);
    const court = firestoreState.docs.get(`courts/${payload.courtId}`);
    const oldId = court.activeMatchId;
    const old = firestoreState.docs.get(`matches/${oldId}`);
    writeDoc(`matches/${oldId}`, { ...old, status: "completed", currentCourtId: null });
    const matchId = "fghjkm";
    writeDoc(`matches/${matchId}`, {
      ...old,
      matchId,
      allocationId: `allocation-matches-${matchId}`,
      status: "live",
      scoreVersion: 0,
    });
    writeDoc(`courts/${payload.courtId}`, { ...court, activeMatchId: matchId });
    return {
      data: {
        success: true,
        matchId,
        allocationId: `allocation-matches-${matchId}`,
        created: true,
      },
    };
  });

  const dom = await bootFrontend();
  document = dom.window.document;
});

test("players see New Match next to Reset and it archives then replaces the match", async () => {
  await joinCourtAsPlayer(document, "abcda");
  document.getElementById("settingsBtn").click();
  await settle(10);

  assert.ok(visible(), "tile is shown to players");
  assert.equal(tile().previousElementSibling.id, "resetSettingsTile");

  const previousMatchId = firestoreState.docs.get("courts/abcda").activeMatchId;
  document.getElementById("newMatchSettingsBtn").click();
  await waitFor(() => !document.getElementById("confirmModal").classList.contains("hidden"), {
    label: "confirmation",
  });
  assert.equal(newMatchCalls.length, 0, "nothing happens before confirming");
  document.getElementById("confirmOkBtn").click();

  await waitFor(() => newMatchCalls.length === 1, { label: "newCourtMatch call" });
  assert.equal(newMatchCalls[0].courtId, "abcda");
  await waitFor(() => firestoreState.docs.get("courts/abcda").activeMatchId === "fghjkm", {
    label: "court on new match",
  });
  assert.equal(firestoreState.docs.get(`matches/${previousMatchId}`).status, "completed");
});

test("cancelling the confirmation does not create a match", async () => {
  document.getElementById("settingsBtn").click();
  await settle(10);
  document.getElementById("newMatchSettingsBtn").click();
  await waitFor(() => !document.getElementById("confirmModal").classList.contains("hidden"), {
    label: "confirmation",
  });
  document.getElementById("confirmCancelBtn").click();
  await settle(10);
  assert.equal(newMatchCalls.length, 1);
});

test("New Match is hidden when the match is part of a tournament", async () => {
  const matchId = firestoreState.docs.get("courts/abcda").activeMatchId;
  const match = firestoreState.docs.get(`matches/${matchId}`);
  writeDoc(`matches/${matchId}`, { ...match, tournamentId: "tttttt" });
  await waitFor(() => !visible(), { label: "tile hidden for tournament match" });

  writeDoc(`matches/${matchId}`, { ...match, tournamentId: null });
  await waitFor(() => visible(), { label: "tile back for casual match" });
});

test("New Match is hidden for spectators", async () => {
  document.getElementById("closeSettingsBtn").click();
  await settle(10);
  document.getElementById("backBtn").click();
  await waitFor(() => !document.getElementById("confirmModal").classList.contains("hidden"), {
    label: "exit confirmation",
  });
  document.getElementById("confirmOkBtn").click();
  await waitFor(() => document.getElementById("menuPage").style.display !== "none", {
    label: "menu",
  });

  const spectate = [...document.querySelectorAll(".menu-btn")].find(
    (btn) => btn.textContent.trim() === "Spectate",
  );
  spectate.click();
  await waitFor(() => document.querySelector(`#spectateCourtList [data-court-name="xyzza"]`), {
    label: "spectate list",
  });
  document.querySelector(`#spectateCourtList [data-court-name="xyzza"]`).click();
  await waitFor(() => document.getElementById("scoreboardPage").style.display !== "none", {
    label: "scoreboard",
  });
  assert.equal(visible(), false);
});
