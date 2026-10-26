// Integration test: prompt permission does not trigger a startup scan; activation does.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  joinCourtAsPlayer,
  seedBaseData,
  seedCourt,
  settle,
} from "./frontendHarness/harness.mjs";

test("prompt state waits for activation and then shows NFC readiness", async () => {
  seedBaseData();
  seedCourt("crtna");

  const dom = await bootFrontend({
    beforeBoot(window) {
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
      });
      Object.defineProperty(window.navigator, "permissions", {
        configurable: true,
        value: { query: async () => ({ state: "prompt" }) },
      });
      window.__nfcScanCalls = 0;
      window.NDEFReader = class {
        async scan() {
          window.__nfcScanCalls += 1;
        }
      };
    },
  });
  const { document } = dom.window;
  const button = document.getElementById("activateNfcBtn");
  const toastTexts = () => [...document.querySelectorAll(".toast")].map((toast) => toast.textContent);

  assert.equal(dom.window.__nfcScanCalls, 0, "startup must not initiate a permission-requiring scan");
  assert.equal(
    toastTexts().includes("NFC permission is required. Tap Activate NFC and allow access when prompted."),
    true,
  );
  assert.equal(button.classList.contains("hidden"), false);

  // Entering the scoreboard must not hide activation while a user gesture is required.
  await joinCourtAsPlayer(document, "crtna");
  assert.equal(button.classList.contains("hidden"), false);

  // Double-clicking during an in-flight scan must still create only one reader scan.
  button.click();
  button.click();
  await settle();

  assert.equal(dom.window.__nfcScanCalls, 1);
  assert.equal(toastTexts().filter((text) => text === "NFC is ready. Tap an NFC tag to scan.").length, 1);
  assert.equal(button.classList.contains("hidden"), true);
});