// Integration test: desktop NFC API absence should not produce misleading toasts.
import assert from "node:assert/strict";
import test from "node:test";

import { appState } from "../app/js/state/appState.js";
import { bootFrontend, settle } from "./frontendHarness/harness.mjs";

test("desktop and touchscreen laptop stay quiet without Web NFC; errors remain specific", async () => {
  const dom = await bootFrontend({
    beforeBoot(window) {
      Object.defineProperty(window.navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      });
      Object.defineProperty(window.navigator, "platform", { configurable: true, value: "Win32" });
      Object.defineProperty(window.navigator, "maxTouchPoints", { configurable: true, value: 10 });
      Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    },
  });
  const { document, navigator } = dom.window;
  const button = document.getElementById("activateNfcBtn");
  const nfcToasts = () =>
    [...document.querySelectorAll(".toast")].map((toast) => toast.textContent).filter((text) => /nfc/i.test(text));

  assert.deepEqual(nfcToasts(), [], "API absence on a desktop is silent at startup");
  assert.equal(appState.nfcDenied, false);

  button.click();
  await settle();
  assert.deepEqual(nfcToasts(), [], "API absence on a desktop remains silent on explicit activation");
  assert.equal(appState.nfcDenied, false);

  dom.window.NDEFReader = class {
    async scan() {
      const error = new Error("adapter unavailable");
      error.name = "NotSupportedError";
      throw error;
    }
  };
  button.click();
  await settle();
  assert.equal(nfcToasts().some((text) => /compatible nfc adapter/i.test(text)), false,
    "adapter diagnostics are suppressed for a conventional desktop");

  Object.defineProperty(dom.window, "isSecureContext", { configurable: true, value: false });
  button.click();
  await settle();
  assert.equal(nfcToasts().some((text) => text === "NFC requires a secure HTTPS connection."), true);
  assert.equal(navigator.platform, "Win32");
});