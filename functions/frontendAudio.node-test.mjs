import assert from "node:assert/strict";
import test from "node:test";
import { bootFrontend, seedBaseData, seedCourt, waitFor, settle } from "./frontendHarness/harness.mjs";
let window;
test.before(async () => { seedBaseData(); seedCourt("audiocourt"); const dom = await bootFrontend({ url: "https://padel.test/c/audiocourt" }); window = dom.window; });
test("a failed direct-link join sound is ignored and never replayed on a later gesture", async () => {
  await waitFor(() => window.__audioTestState.contexts > 0, { label: "audio context created" });
  await settle(25);
  assert.equal(window.__audioTestState.starts, 0);
  assert.equal(window.__audioTestState.resumeCalls, 0);
  window.document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true, cancelable: true }));
  window.document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true, cancelable: true }));
  await settle(100);
  assert.equal(window.__audioTestState.starts, 0);
});
