// Frontend integration tests: how a court password change interacts with playing
// rights. A password change demotes players to spectate mode, but must not do so
// for admins, nor when the "new" password is really the existing one.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_SKELETON_KEY,
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

// Every newPassword the UI handed to the resetCourt callable, in call order.
const resetCalls = [];

function isSpectating() {
  return document.body.classList.contains("spectating-mode");
}

function courtDoc(courtId) {
  return firestoreState.docs.get(`courts/${courtId}`);
}

// Simulates another device changing the court password out from under us.
function changePasswordRemotely(courtId, password) {
  writeDoc(`courts/${courtId}`, { ...courtDoc(courtId), password });
}

// Non-admins are ejected from a private court, which is the cleanest way to get
// back to the menu so the next test can join a different court.
async function returnToMenu(courtId) {
  writeDoc(`courts/${courtId}`, { ...courtDoc(courtId), status: "private" });
  await waitFor(() => document.getElementById("menuPage").style.display !== "none", {
    label: `menu page after ${courtId} went private`,
  });
}

async function openResetModal() {
  document.getElementById("settingsBtn").click();
  await settle(10);
  document.getElementById("resetSettingsBtn").click();
  await waitFor(() => !document.getElementById("resetModal").classList.contains("hidden"), {
    label: "reset modal",
  });
}

test.before(async () => {
  seedBaseData();
  seedCourt("pqrsa");
  seedCourt("abcda");
  // A realistic court password: at least 4 characters, as the reset dialog requires.
  seedCourt("efgha", { password: "curpw123" });

  callableHandlers.set("resetCourt", async ({ courtId, newPassword }) => {
    resetCalls.push(newPassword);

    const court = courtDoc(courtId) || {};
    const matchId = court.activeMatchId || `${courtId}aaaa`;
    const matchPath = `matches/${matchId}`;
    const match = firestoreState.docs.get(matchPath) || {};
    const scoreVersion = (Number(match.scoreVersion) || 0) + 1;
    const trimmed = typeof newPassword === "string" ? newPassword.trim() : "";

    // Mirror the Cloud Function: only write the password when it actually changed.
    writeDoc(`courts/${courtId}`, {
      ...court,
      password: trimmed && trimmed !== court.password ? trimmed : court.password,
    });
    writeDoc(matchPath, { ...match, scoreVersion });

    return { data: { scoreVersion } };
  });

  const dom = await bootFrontend();
  document = dom.window.document;
});

test("a player is switched to spectate when the court password changes", async () => {
  await joinCourtAsPlayer(document, "pqrsa");
  assert.equal(isSpectating(), false, "joins as a player");

  changePasswordRemotely("pqrsa", "rotated1");

  await waitFor(() => isSpectating(), { label: "player demoted to spectate" });
  assert.equal(document.getElementById("undoBtn").style.display, "none");

  await returnToMenu("pqrsa");
});

test("a player is NOT switched to spectate when the court doc changes but the password does not", async () => {
  await joinCourtAsPlayer(document, "abcda");
  assert.equal(isSpectating(), false);

  // A rename of the teams must not be mistaken for a password change.
  writeDoc("matches/abcdaa", {
    ...firestoreState.docs.get("matches/abcdaa"),
    teamNames: { A: "Reds", B: "Blues" },
  });

  await waitFor(() => document.querySelector("#teamA .name-text").textContent === "Reds", {
    label: "team name update applied",
  });
  assert.equal(isSpectating(), false, "unrelated court update must not demote the player");

  await returnToMenu("abcda");
});

test("an admin who entered with the skeleton key keeps playing through a password change", async () => {
  seedCourt("jkmna");
  await joinCourtAsPlayer(document, "jkmna", ADMIN_SKELETON_KEY);
  assert.equal(isSpectating(), false, "admin joins as a player");

  changePasswordRemotely("jkmna", "rotated2");

  // Give the listener the same budget the demotion test needed, then assert the
  // admin is still a player.
  await settle(50);
  assert.equal(isSpectating(), false, "admin must not be demoted by a password change");
  assert.notEqual(document.getElementById("undoBtn").style.display, "none");

  await returnToMenu("jkmna");
});

test("a blank reset password keeps the existing court password", async () => {
  await joinCourtAsPlayer(document, "efgha", "curpw123");
  resetCalls.length = 0;

  await openResetModal();
  document.getElementById("resetCourtPassword").value = "";
  document.getElementById("confirmReset").click();

  await waitFor(() => document.getElementById("resetModal").classList.contains("hidden"), {
    label: "reset modal closed",
  });

  assert.equal(resetCalls.length, 1);
  assert.equal(resetCalls[0], null, "a blank field sends no new password");
  assert.equal(courtDoc("efgha").password, "curpw123", "court password is unchanged");
  assert.equal(isSpectating(), false, "the resetting player keeps playing");
});

test("re-entering the current password is not treated as a change", async () => {
  resetCalls.length = 0;

  await openResetModal();
  document.getElementById("resetCourtPassword").value = "curpw123";
  document.getElementById("shallowReset").click();

  await waitFor(() => document.getElementById("resetModal").classList.contains("hidden"), {
    label: "reset modal closed",
  });

  assert.equal(resetCalls.length, 1);
  assert.equal(resetCalls[0], null, "the unchanged password is not sent as a new one");
  assert.equal(courtDoc("efgha").password, "curpw123");
  assert.equal(isSpectating(), false);
});

test("a too-short reset password is rejected without resetting", async () => {
  resetCalls.length = 0;

  await openResetModal();
  document.getElementById("resetCourtPassword").value = "abc";
  document.getElementById("confirmReset").click();
  await settle(30);

  assert.equal(resetCalls.length, 0, "no reset is issued");
  assert.equal(
    document.getElementById("resetModal").classList.contains("hidden"),
    false,
    "the modal stays open",
  );
  assert.match(document.getElementById("resetPasswordError").textContent, /at least 4 characters/);
});

test("a genuinely new reset password is sent and applied", async () => {
  resetCalls.length = 0;

  document.getElementById("resetCourtPassword").value = "freshpw";
  document.getElementById("shallowReset").click();

  await waitFor(() => document.getElementById("resetModal").classList.contains("hidden"), {
    label: "reset modal closed",
  });

  assert.deepEqual(resetCalls, ["freshpw"]);
  assert.equal(courtDoc("efgha").password, "freshpw");
  // The device that performed the change must not demote itself.
  await settle(50);
  assert.equal(isSpectating(), false, "the resetting player keeps playing");
});
