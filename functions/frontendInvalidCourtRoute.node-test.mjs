// Frontend integration test: malformed direct court URLs should explain why the
// requested court could not be opened rather than silently returning to the menu.
import assert from "node:assert/strict";
import test from "node:test";

import { bootFrontend, waitFor, settle } from "./frontendHarness/harness.mjs";

test("malformed direct court URL shows an error toast and returns to the menu", async () => {
  const dom = await bootFrontend({ url: "https://padel.test/c/not-a-valid-id" });
  const document = dom.window.document;

  const toast = await waitFor(
    () => document.querySelector("#toastContainer .toast.error"),
    { label: "error toast for malformed direct court URL" },
  );
  await settle(30);

  assert.equal(toast.textContent, 'Court "not-a-valid-id" not found.');
  assert.equal(document.getElementById("scoreboardPage").style.display, "none");
  assert.equal(dom.window.location.pathname, "/c/not-a-valid-id");

  dom.window.close();
});
