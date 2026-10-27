// Integration test: unsupported Permissions API descriptors must not disable explicit activation.
import assert from "node:assert/strict";
import test from "node:test";

import { appState } from "../app/js/state/appState.js";
import { bootFrontend, settle } from "./frontendHarness/harness.mjs";

test("permission-query failure defers scanning until the user activates NFC", async () => {
  const dom = await bootFrontend({
    beforeBoot(window) {
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
      });
      Object.defineProperty(window.navigator, "permissions", {
        configurable: true,
        value: { query: async () => { throw new TypeError("Unsupported permission descriptor"); } },
      });
      window.__nfcScanCalls = 0;
      window.NDEFReader = class {
        async scan() {
          window.__nfcScanCalls += 1;
        }
      };
    },
  });

  assert.equal(dom.window.__nfcScanCalls, 0);
  assert.equal(appState.nfcDenied, false);

  dom.window.document.getElementById("activateNfcBtn").click();
  await settle();

  assert.equal(dom.window.__nfcScanCalls, 1);
  assert.equal(
    [...dom.window.document.querySelectorAll(".toast")].some((toast) =>
      toast.textContent === "NFC is ready. Tap an NFC tag to scan.",
    ),
    true,
  );
  assert.equal(appState.nfcDenied, false);
});