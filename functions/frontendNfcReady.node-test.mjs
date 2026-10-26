// Integration test: granted permission starts scanning at startup and confirms readiness.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  getRenderedScore,
  joinCourtAsPlayer,
  seedBaseData,
  seedCourt,
  settle,
  waitFor,
} from "./frontendHarness/harness.mjs";

test("granted permission produces exactly one NFC-ready toast after scan resolves", async () => {
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
        value: { query: async ({ name }) => {
          assert.equal(name, "nfc");
          return { state: "granted" };
        } },
      });
      window.__nfcScanCalls = 0;
      window.NDEFReader = class {
        constructor() {
          window.__nfcReader = this;
        }
        async scan() {
          window.__nfcScanCalls += 1;
        }
      };
    },
  });
  const { document } = dom.window;
  const button = document.getElementById("activateNfcBtn");
  const readyToasts = () =>
    [...document.querySelectorAll(".toast")].filter((toast) =>
      toast.textContent === "NFC is ready. Tap an NFC tag to scan.",
    );

  assert.equal(dom.window.__nfcScanCalls, 1);
  assert.equal(readyToasts().length, 1);
  assert.equal(button.classList.contains("hidden"), true);

  const { initNfc } = await import("../app/js/nfc/nfc.js");
  await initNfc();
  button.click();
  await settle();

  assert.equal(dom.window.__nfcScanCalls, 1, "subsequent initialization does not start another scan");
  assert.equal(readyToasts().length, 1, "the ready toast is emitted once per transition");

  await joinCourtAsPlayer(document, "crtna");
  assert.equal(getRenderedScore(document).pointsA, "0");

  const tagEvent = {
    message: {
      records: [{
        recordType: "text",
        data: new TextEncoder().encode("EVENT:POINT_TEAM_A"),
      }],
    },
  };
  dom.window.__nfcReader.onreading(tagEvent);
  dom.window.__nfcReader.onreading(tagEvent);
  await waitFor(() => getRenderedScore(document).pointsA === "15", { label: "NFC point event" });

  assert.equal(getRenderedScore(document).pointsA, "15", "cooldown prevents the immediately repeated tag from adding another point");
  assert.equal(document.getElementById("nfcCooldownBanner").classList.contains("hidden"), false);
  assert.equal(document.getElementById("nfcCountdown").textContent, "3");
});