// Integration test: mobile users receive a browser-support hint only after activation.
import assert from "node:assert/strict";
import test from "node:test";

import { appState } from "../app/js/state/appState.js";
import { bootFrontend, settle } from "./frontendHarness/harness.mjs";

test("mobile without Web NFC is quiet on startup but gets actionable feedback on activation", async () => {
  const dom = await bootFrontend({
    beforeBoot(window) {
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
      });
    },
  });
  const { document } = dom.window;
  const button = document.getElementById("activateNfcBtn");
  const nfcToasts = () =>
    [...document.querySelectorAll(".toast")].map((toast) => toast.textContent).filter((text) => /nfc/i.test(text));

  assert.deepEqual(nfcToasts(), []);
  button.click();
  await settle();

  assert.equal(
    nfcToasts().includes("NFC scanning is unavailable in this browser. Try a supported browser on an NFC-capable device over HTTPS."),
    true,
  );
  assert.equal(appState.nfcDenied, false);
});