// Frontend tests: the engagement nudges on Match Details (share button pulse,
// expandable stats arrow, mobile-only scoreboard nudge). Stylesheet rules are
// checked directly; the behaviour that switches them on and off is exercised
// on the real app booted in jsdom.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bootFrontend,
  callableHandlers,
  makeScore,
  pushScoreSnapshot,
  seedBaseData,
  seedCourt,
  settle,
  waitFor,
} from "./frontendHarness/harness.mjs";

const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");

const COURT_ID = "nudgecourt";

let window;
let document;

function makeNoopCanvasContext() {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === Symbol.toPrimitive) return () => 0;
        return () => makeNoopCanvasContext();
      },
      set: () => true,
    },
  );
}

test.before(async () => {
  seedBaseData();
  seedCourt(COURT_ID, { teamNames: { A: "Reds", B: "Blues" } });
  pushScoreSnapshot(
    COURT_ID,
    makeScore({
      A: { points: 1, games: 2, sets: 1, totalPoints: 30 },
      B: { points: 0, games: 1, sets: 0, totalPoints: 20 },
      completedSets: [{ A: 6, B: 3 }],
    }),
  );

  callableHandlers.set("getDetailedScore", async () => ({
    data: {
      sets: [{ A: 6, B: 3 }],
      currentGames: { A: 2, B: 1 },
      points: { A: 1, B: 0 },
      setsA: 1,
      setsB: 0,
      scoringMode: "standard",
      matchComplete: false,
      playerNames: { A1: "", A2: "", B1: "", B2: "" },
      advancedStats: null,
    },
  }));

  const dom = await bootFrontend({ url: `https://padel.test/c/${COURT_ID}` });
  window = dom.window;
  document = window.document;

  window.HTMLCanvasElement.prototype.getContext = () => makeNoopCanvasContext();
  window.Path2D = function Path2D() {
    return makeNoopCanvasContext();
  };
  globalThis.Path2D = window.Path2D;
  window.navigator.share = async () => {};

  await waitFor(() => document.getElementById("scoreboardPage").style.display !== "none", {
    label: "spectator scoreboard",
  });
});

async function openDetails() {
  document.getElementById("detailsBtn").click();
  await waitFor(() => !document.getElementById("shareDetailsBtn").classList.contains("hidden"), {
    label: "share button ready",
  });
}

async function closeDetails() {
  document.getElementById("closeDetailsBtn").click();
  await waitFor(() => document.getElementById("detailsModal").classList.contains("hidden"), {
    label: "details modal closed",
  });
  await settle();
}

test("share button uses the continuous engagement animation", () => {
  assert.match(
    styles,
    /\.dm-share-btn\s*\{[\s\S]*?animation:\s*matchEngagementPulse\s+4\.8s\s+ease-in-out\s+infinite;/,
  );
  assert.match(styles, /@keyframes\s+matchEngagementPulse\s*\{/);
});

test("share button stops animating after it is clicked", async () => {
  await openDetails();
  const shareButton = document.getElementById("shareDetailsBtn");
  assert.equal(shareButton.classList.contains("engagement-animation-disabled"), false);

  shareButton.click();
  assert.equal(shareButton.classList.contains("engagement-animation-disabled"), true);

  assert.match(
    styles,
    /\.dm-share-btn\.engagement-animation-disabled\s*\{[\s\S]*?animation:\s*none;[\s\S]*?opacity:\s*var\(--engagement-rest-opacity\);/,
  );
  await settle();
});

test("share animation is not reset just because already-open details are refreshed", async () => {
  const shareButton = document.getElementById("shareDetailsBtn");
  assert.equal(shareButton.classList.contains("engagement-animation-disabled"), true);

  // A live score update re-renders the open details in place.
  pushScoreSnapshot(
    COURT_ID,
    makeScore({
      A: { points: 2, games: 2, sets: 1, totalPoints: 31 },
      B: { points: 0, games: 1, sets: 0, totalPoints: 20 },
      completedSets: [{ A: 6, B: 3 }],
    }),
  );
  await waitFor(() => document.getElementById("pointsA").textContent === "30", {
    label: "score update rendered",
  });
  await settle(50);

  assert.equal(document.getElementById("detailsModal").classList.contains("hidden"), false);
  assert.equal(shareButton.classList.contains("engagement-animation-disabled"), true);
});

test("share animation is re-enabled when the details modal is actually opened", async () => {
  await closeDetails();
  await openDetails();

  assert.equal(
    document.getElementById("shareDetailsBtn").classList.contains("engagement-animation-disabled"),
    false,
  );
  await closeDetails();
});

test("share engagement rests at a lower opacity and briefly increases opacity", () => {
  assert.match(
    styles,
    /\.dm-share-btn\s*\{[\s\S]*?--engagement-rest-opacity:\s*0\.75;[\s\S]*?opacity:\s*var\(--engagement-rest-opacity\);/,
  );
  assert.match(styles, /82%\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(styles, /90%\s*\{[\s\S]*?opacity:\s*0\.9/);
});

test("scoreboard Match Details animation is restricted to the mobile-device class", () => {
  assert.match(
    styles,
    /\.mobile-device \.match-details-btn\s*\{[\s\S]*?animation:\s*matchEngagementPulse\s+4\.8s\s+ease-in-out\s+infinite;/,
  );

  const matchDetailsRule = styles.match(/\.match-details-btn\s*\{[\s\S]*?\}/)?.[0];

  assert.ok(matchDetailsRule, "base Match Details rule should exist");
  assert.doesNotMatch(matchDetailsRule, /animation:\s*matchEngagementPulse/);
});

test("the mobile-device class follows mobile detection", async () => {
  const { updateMobileDeviceClass } = await import("../app/js/lifecycle/deviceIdentity.js");
  const { navigator } = window;
  const root = document.documentElement;
  const override = (property, value) =>
    Object.defineProperty(navigator, property, { configurable: true, get: () => value });
  const restore = (property) => delete navigator[property];

  try {
    assert.equal(updateMobileDeviceClass(), false, "the jsdom user agent is not mobile");
    assert.equal(root.classList.contains("mobile-device"), false);

    override("userAgentData", { mobile: true });
    assert.equal(updateMobileDeviceClass(), true, "client hints report a mobile device");
    assert.equal(root.classList.contains("mobile-device"), true);
    restore("userAgentData");

    override("platform", "MacIntel");
    override("maxTouchPoints", 5);
    assert.equal(updateMobileDeviceClass(), true, "iPadOS desktop mode is treated as mobile");
    restore("platform");
    restore("maxTouchPoints");

    override("userAgent", "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36");
    assert.equal(updateMobileDeviceClass(), true, "mobile user agents are detected");
    restore("userAgent");

    assert.equal(updateMobileDeviceClass(), false);
    assert.equal(root.classList.contains("mobile-device"), false);
  } finally {
    for (const property of ["userAgentData", "platform", "maxTouchPoints", "userAgent"]) {
      restore(property);
    }
    updateMobileDeviceClass();
  }
});

test("expandable match details arrow pulses twice while collapsed and stops while expanded", () => {
  assert.match(
    styles,
    /\.dm-details-toggle\[aria-expanded="false"\] \.dm-details-toggle-icon\s*\{[\s\S]*?animation:\s*matchDetailsArrowPulse\s+4\.8s\s+ease-in-out\s+infinite;[\s\S]*?animation-delay:\s*-2\.4s;/,
  );
  assert.match(
    styles,
    /transform:\s*scale\(1\.14\)\s+translateY\(5px\);[\s\S]*?transform:\s*scale\(1\.14\)\s+translateY\(0\);[\s\S]*?transform:\s*scale\(1\.14\)\s+translateY\(5px\);/,
  );
  assert.match(
    styles,
    /\.dm-details-toggle\[aria-expanded="true"\] \.dm-details-toggle-icon\s*\{[\s\S]*?animation:\s*none;[\s\S]*?transform:\s*rotate\(180deg\);/,
  );
});

test("toast positioning is recalculated whenever the viewport changes", async () => {
  const container = document.getElementById("toastContainer");
  const controls = document.querySelector(".floating-controls");
  const originalRect = controls.getBoundingClientRect;
  controls.getBoundingClientRect = () => ({
    top: 500,
    left: 100,
    width: 600,
    height: 60,
    right: 700,
    bottom: 560,
  });

  try {
    container.style.removeProperty("--toast-bottom-offset");
    window.dispatchEvent(new window.Event("resize"));

    assert.equal(
      container.style.getPropertyValue("--toast-bottom-offset"),
      `${window.innerHeight - 500 + 16}px`,
    );
  } finally {
    controls.getBoundingClientRect = originalRect;
  }
});

test("engagement animations are disabled when reduced motion is requested", () => {
  assert.match(
    styles,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.match-details-btn,\s*\.dm-share-btn,\s*\.dm-details-toggle-icon\s*\{[\s\S]*?animation:\s*none;/,
  );
});
