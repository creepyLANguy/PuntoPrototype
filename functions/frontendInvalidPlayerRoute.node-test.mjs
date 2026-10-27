import assert from "node:assert/strict";
import test from "node:test";

import { bootFrontend, seedBaseData, waitFor, settle } from "./frontendHarness/harness.mjs";

test("malformed direct player URL shows an error toast instead of silently falling back", async () => {
  seedBaseData();
  const dom = await bootFrontend({
    url: "https://padel.test/app/play/not-a-valid-id",
  });

  try {
    const { document, location, history, PopStateEvent } = dom.window;
    const expectedPlayerMessage = 'Court or match "not-a-valid-id" not found.';
    const playerToast = await waitFor(
      () =>
        [...document.querySelectorAll("#toastContainer .toast.error")].find(
          (element) => element.textContent === expectedPlayerMessage,
        ),
      { label: "error toast for malformed direct player URL" },
    );

    await settle(30);
    assert.equal(playerToast.textContent, expectedPlayerMessage);
    assert.equal(document.getElementById("scoreboardPage").style.display, "none");
    assert.notEqual(document.getElementById("menuPage").style.display, "none");

    // Extra segments are also malformed direct-link attempts, even when the
    // first segment itself looks like a valid court ID.
    document.querySelectorAll("#toastContainer .toast").forEach((toast) => toast.remove());
    history.pushState({}, "", "/c/abcda/extra");
    dom.window.dispatchEvent(new PopStateEvent("popstate"));

    const malformedPathToast = await waitFor(
      () =>
        [...document.querySelectorAll("#toastContainer .toast.error")].find(
          (element) => element.textContent === 'Court "abcda" not found.',
        ),
      { label: "error toast for direct court URL with extra segments" },
    );
    assert.equal(malformedPathToast.textContent, 'Court "abcda" not found.');
    assert.equal(location.pathname, "/c/abcda/extra");
    assert.notEqual(document.getElementById("menuPage").style.display, "none");
  } finally {
    dom.window.close();
  }
});
