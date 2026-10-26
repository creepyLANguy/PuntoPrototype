// Unit tests for the shared device-classification heuristic used by NFC messaging.
import assert from "node:assert/strict";
import test from "node:test";

import { isLikelyMobileDevice } from "../app/js/lifecycle/deviceIdentity.js";

test("recognizes explicit mobile user-agent data and mobile user agents", () => {
  assert.equal(isLikelyMobileDevice({ userAgentData: { mobile: true }, userAgent: "desktop" }), true);
  assert.equal(
    isLikelyMobileDevice({
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    isLikelyMobileDevice({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
      platform: "iPhone",
      maxTouchPoints: 5,
    }),
    true,
  );
});

test("recognizes iPadOS desktop mode through the existing MacIntel touch fallback", () => {
  assert.equal(
    isLikelyMobileDevice({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    true,
  );
});

test("does not classify touchscreen laptops or ordinary Chromebooks as mobile", () => {
  assert.equal(
    isLikelyMobileDevice({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      platform: "Win32",
      maxTouchPoints: 10,
    }),
    false,
  );
  assert.equal(
    isLikelyMobileDevice({
      userAgent: "Mozilla/5.0 (X11; CrOS x86_64 15474.61.0) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      platform: "Linux x86_64",
      maxTouchPoints: 0,
    }),
    false,
  );
});

test("treats an unfamiliar or reduced user agent conservatively", () => {
  assert.equal(isLikelyMobileDevice({ userAgent: "", platform: "Unknown", maxTouchPoints: 0 }), false);
});