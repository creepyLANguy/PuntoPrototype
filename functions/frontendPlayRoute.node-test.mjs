// Frontend integration tests: the /play (and /p) deep link that drops a viewer
// straight into the join prompt for a specific court.
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
  seedCourt("routecourt", { name: "Route Court" });

  const dom = await bootFrontend({ url: "https://padel.test/p/routecourt" });
  document = dom.window.document;
  window = dom.window;

  await waitFor(
    () => document.getElementById("playPage").style.display !== "none"
      && document.querySelector("#playCourtList .court-item.active"),
    { label: "play page from the /p route" }
  );
  await settle(30);
});

test("/p/<court> opens the join prompt with the court preselected", () =>
{
  assert.equal(document.getElementById("playPage").style.display, "flex");
  assert.equal(document.getElementById("playCourtSearch").value, "Route Court");
  assert.equal(document.getElementById("playPasswordSection").style.display, "block");
  assert.equal(
    document.querySelector("#playCourtList .court-item.active")?.dataset.courtId,
    "routecourt"
  );
});

test("the court is already spectated behind the prompt", () =>
{
  assert.notEqual(document.getElementById("scoreboardPage").style.display, "none");
  assert.equal(window.location.pathname, "/p/routecourt");
});

test("dismissing the prompt leaves the viewer on the court's spectator view", async () =>
{
  document.getElementById("playPage").click();

  await waitFor(
    () => document.getElementById("playPage").style.display === "none",
    { label: "play page to be dismissed" }
  );
  await settle(30);

  assert.notEqual(document.getElementById("scoreboardPage").style.display, "none");
  assert.equal(document.getElementById("menuPage").style.display, "none");
  assert.equal(window.location.pathname, "/c/routecourt");
});
