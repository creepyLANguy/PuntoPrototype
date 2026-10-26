// Frontend integration tests: the /play (and /p) deep link that drops a viewer
// straight into the join prompt for a specific court.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  waitFor,
  settle,
} from "./frontendHarness/harness.mjs";

let document;
let window;

test.before(async () => {
  seedBaseData();
  seedCourt("rutea", { name: "Route Court" });

  const dom = await bootFrontend({ url: "https://padel.test/p/rutea" });
  document = dom.window.document;
  window = dom.window;

  await waitFor(
    () =>
      !document.getElementById("joinCourtModal").classList.contains("hidden") &&
      document.getElementById("scoreboardPage").style.display !== "none",
    { label: "join modal over the spectator scoreboard from the /p route" },
  );
  await settle(30);
});

test("/p/<court> opens the join-as-player modal with the password ready", () => {
  assert.equal(document.getElementById("playPage").style.display, "none");
  assert.equal(document.getElementById("joinCourtModal").classList.contains("hidden"), false);
  assert.equal(document.getElementById("joinCourtModalCourtName").textContent, "Route Court");
  assert.equal(document.getElementById("joinCourtModalPassword").value, "");
  assert.equal(document.activeElement?.id, "joinCourtModalPassword");
});

test("the spectator scoreboard is visible behind the join modal", () => {
  assert.notEqual(document.getElementById("scoreboardPage").style.display, "none");
  assert.equal(document.body.classList.contains("spectating-mode"), true);
  assert.equal(window.location.pathname, "/p/rutea");
});

test("dismissing the prompt leaves the viewer on the court's spectator view", async () => {
  document.getElementById("joinCourtModal").click();

  await waitFor(
    () =>
      document.getElementById("joinCourtModal").classList.contains("hidden") &&
      document.getElementById("scoreboardPage").style.display !== "none",
    { label: "join modal to be dismissed" },
  );
  await settle(30);

  assert.notEqual(document.getElementById("scoreboardPage").style.display, "none");
  assert.equal(document.getElementById("menuPage").style.display, "none");
  assert.equal(window.location.pathname, "/c/rutea");
});
