// Integration test: permission, adapter, disabled-adapter and unexpected errors differ.
import assert from "node:assert/strict";
import test from "node:test";

import { appState } from "../app/js/state/appState.js";
import { bootFrontend, settle } from "./frontendHarness/harness.mjs";

test("scan errors are classified without conflating permission and adapter failures", async () => {
  const dom = await bootFrontend({
    beforeBoot(window) {
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      });
      Object.defineProperty(window.navigator, "permissions", {
        configurable: true,
        value: { query: async () => ({ state: "prompt" }) },
      });
      window.__nfcErrorName = "NotAllowedError";
      window.NDEFReader = class {
        scan() {
          const error = new Error("mock scan failure");
          error.name = window.__nfcErrorName;
          return Promise.reject(error);
        }
      };
    },
  });
  const { document } = dom.window;
  const button = document.getElementById("activateNfcBtn");
  const hasToast = (text) =>
    [...document.querySelectorAll(".toast")].some((toast) => toast.textContent === text);

  button.click();
  await settle();
  assert.equal(hasToast("NFC access is blocked for this site. Allow NFC in your browser's site settings, then try again."), true);
  assert.equal(appState.nfcDenied, true);
  assert.equal(button.classList.contains("hidden"), false);

  appState.nfcDenied = false;
  dom.window.__nfcErrorName = "NotSupportedError";
  button.click();
  await settle();
  assert.equal(hasToast("No compatible NFC adapter was detected. Check that this device supports NFC."), true);
  assert.equal(appState.nfcDenied, false);

  dom.window.__nfcErrorName = "NotReadableError";
  button.click();
  await settle();
  assert.equal(hasToast("NFC is turned off or cannot be accessed. Enable NFC in device settings and try again."), true);
  assert.equal(appState.nfcDenied, false);

  dom.window.__nfcErrorName = "UnknownError";
  button.click();
  await settle();
  assert.equal(hasToast("NFC scanning could not be started. Please try again."), true);
  assert.equal(appState.nfcDenied, false);
});