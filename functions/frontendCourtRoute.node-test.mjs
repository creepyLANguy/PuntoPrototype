// Frontend integration test for the /c root spectator selection route.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  waitFor,
  settle,
} from "./frontendHarness/harness.mjs";

test("/c opens the spectator selection screen without a court id", async () => {
  seedBaseData();
  seedCourt("rootcourt", { name: "Root Court" });

  const dom = await bootFrontend({ url: "https://padel.test/c" });
  const document = dom.window.document;

  await waitFor(
    () =>
      document.getElementById("spectatePage").style.display !== "none" &&
      document.querySelector("#spectateCourtList .court-item"),
    { label: "spectate page and court list from /c" },
  );
  await settle(30);

  assert.equal(document.getElementById("spectatePage").style.display, "flex");
  assert.equal(document.getElementById("menuPage").style.display, "none");
  assert.ok(document.querySelector("#spectateCourtList .court-item"));
  assert.equal(dom.window.location.pathname, "/c");

  dom.window.close();
});
