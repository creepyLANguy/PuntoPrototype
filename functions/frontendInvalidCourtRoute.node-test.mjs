// Frontend integration test: malformed direct court URLs should explain why the
// requested court could not be opened rather than silently returning to the menu.
import assert from "node:assert/strict";
import test from "node:test";

import { bootFrontend, waitFor, settle } from "./frontendHarness/harness.mjs";

test("malformed direct court URL shows an error toast and returns to the menu", async () => {
  const dom = await bootFrontend({ url: "https://padel.test/c/not-a-valid-id" });
  try {
    const document = dom.window.document;
    const expectedMessage = 'Court "not-a-valid-id" not found.';

    const toast = await waitFor(
      () =>
        [...document.querySelectorAll("#toastContainer .toast.error")].find(
          (element) => element.textContent === expectedMessage,
        ),
      { label: "error toast for malformed direct court URL" },
    );
    await settle(30);

    assert.equal(toast.textContent, expectedMessage);
    assert.equal(document.getElementById("scoreboardPage").style.display, "none");
    assert.notEqual(document.getElementById("menuPage").style.display, "none");
    assert.equal(dom.window.location.pathname, "/");
  } finally {
    dom.window.close();
  }
});
