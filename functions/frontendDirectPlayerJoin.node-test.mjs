import assert from "node:assert/strict";
import test from "node:test";

import
{
  bootFrontend,
  seedBaseData,
  seedCourt,
  waitFor,
  settle
} from "./frontendHarness/harness.mjs";

let document;
let window;

test.before(async () =>
{
  seedBaseData();
  seedCourt("directplayer", { name: "Direct Player Court" });

  const dom = await bootFrontend({ url: "https://padel.test/p/directplayer" });
  document = dom.window.document;
  window = dom.window;

  await waitFor(
    () => document.getElementById("playPage").style.display !== "none"
      && document.querySelector("#playCourtList .court-item.active"),
    { label: "direct player join prompt" }
  );
  await settle(30);
});

test("/p/<court> autofocuses the player password field", () =>
{
  assert.equal(document.activeElement?.id, "playCourtPassword");
});

test("/p/<court> player submit primes and plays the join sound", async () =>
{
  const passwordInput = document.getElementById("playCourtPassword");
  passwordInput.value = "pw";

  document.getElementById("enterCourtBtn").click();

  await waitFor(
    () => document.getElementById("scoreboardPage").style.display !== "none",
    { label: "player scoreboard to be shown" }
  );
  await waitFor(
    () => window.__audioTestState.starts === 1,
    { label: "direct player join sound" }
  );

  assert.ok(window.__audioTestState.resumeCalls > 0, "the AudioContext should be resumed from the submit gesture");
  assert.equal(window.__audioTestState.starts, 1);
});
