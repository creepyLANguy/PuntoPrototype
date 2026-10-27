import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  firestoreState,
  waitFor,
  settle,
} from "./frontendHarness/harness.mjs";

test("direct court and player routes toast when Firestore document lookups reject", async () => {
  seedBaseData();
  seedCourt("abcda");
  firestoreState.failingDocuments.add("courts/abcda");

  const dom = await bootFrontend({ url: "https://padel.test/c/abcda" });

  try {
    const { document, history, PopStateEvent } = dom.window;
    const courtMessage = 'Could not open court "abcda". Please try again.';
    const courtToast = await waitFor(
      () =>
        [...document.querySelectorAll("#toastContainer .toast.error")].find(
          (element) => element.textContent === courtMessage,
        ),
      { label: "court lookup failure toast" },
    );
    assert.equal(courtToast.textContent, courtMessage);
    assert.equal(document.getElementById("scoreboardPage").style.display, "none");
    assert.notEqual(document.getElementById("menuPage").style.display, "none");

    document.querySelectorAll("#toastContainer .toast").forEach((toast) => toast.remove());
    history.pushState({}, "", "/p/abcda");
    dom.window.dispatchEvent(new PopStateEvent("popstate"));

    const playerMessage = 'Could not open court or match "abcda". Please try again.';
    const playerToast = await waitFor(
      () =>
        [...document.querySelectorAll("#toastContainer .toast.error")].find(
          (element) => element.textContent === playerMessage,
        ),
      { label: "player target lookup failure toast" },
    );
    await settle(20);
    assert.equal(playerToast.textContent, playerMessage);
  } finally {
    dom.window.close();
  }
});
