// Integration test: an explicit permission-denied state remains retryable and recovers on success.
import assert from "node:assert/strict";
import test from "node:test";

import { appState } from "../app/js/state/appState.js";
import { bootFrontend, settle } from "./frontendHarness/harness.mjs";

test("denied permission is reported and a later successful scan clears the denied flag", async () => {
  const dom = await bootFrontend({
    beforeBoot(window) {
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
      });
      Object.defineProperty(window.navigator, "permissions", {
        configurable: true,
        value: { query: async () => ({ state: "denied" }) },
      });
      window.__nfcScanCalls = 0;
      window.__nfcShouldFail = true;
      window.NDEFReader = class {
        async scan() {
          window.__nfcScanCalls += 1;
          if (window.__nfcShouldFail) {
            const error = new Error("blocked");
            error.name = "NotAllowedError";
            throw error;
          }
        }
      };
    },
  });
  const { document } = dom.window;
  const button = document.getElementById("activateNfcBtn");
  const toastTexts = () => [...document.querySelectorAll(".toast")].map((toast) => toast.textContent);

  assert.equal(dom.window.__nfcScanCalls, 0, "denied permission should not trigger an automatic scan");
  assert.equal(appState.nfcDenied, true);
  assert.equal(
    toastTexts().includes("NFC access is blocked for this site. Allow NFC in your browser's site settings, then try again."),
    true,
  );
  assert.equal(button.classList.contains("hidden"), false);

  dom.window.__nfcShouldFail = false;
  button.click();
  await settle();

  assert.equal(dom.window.__nfcScanCalls, 1);
  assert.equal(appState.nfcDenied, false);
  assert.equal(button.classList.contains("hidden"), true);
  assert.equal(toastTexts().includes("NFC is ready. Tap an NFC tag to scan."), true);
});