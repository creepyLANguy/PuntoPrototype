import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/js/script.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
const brand = readFileSync(new URL("../app/js/brand.mjs", import.meta.url), "utf8");

test("QR panel interaction coalesces drag and resize writes to animation frames", () =>
{
  assert.match(source, /function initializeCourtQrPanelInteractions\(\)/);
  assert.match(source, /const scheduleQrPanelFrame =/);
  assert.match(source, /window\.requestAnimationFrame\(applyPendingQrPanelFrame\)/);
  assert.match(source, /document\.addEventListener\("pointermove"/);
  assert.match(source, /const stopInteraction =/);
  assert.doesNotMatch(source, /new ResizeObserver\(/);
});

test("court QR is rendered as one SVG tree containing both QR modules and logo", () =>
{
  assert.match(source, /function createCourtQrSvg\(qrUrl\)/);
  assert.match(source, /matrix = qr\?\._oQRCode/);
  assert.match(source, /setAttribute\("shape-rendering", "crispEdges"\)/);
  assert.match(source, /logoBackground = document\.createElementNS/);
  assert.match(source, /logoImage = document\.createElementNS/);
  assert.match(source, /logoImage\.setAttribute\("href", "\/media\/logo\.svg"\)/);
});

test("QR panel uses the custom pointer interaction instead of native CSS resize", () =>
{
  assert.match(source, /isResizingQrPanel = true/);
  assert.match(source, /panel\.setPointerCapture\(event\.pointerId\)/);
  assert.match(styles, /\.court-qr-panel\s*\{[\s\S]*?resize: none;/);
  assert.doesNotMatch(brand, /qr-resize-interaction/);
});

test("legacy CSS logo overlay is disabled when the SVG QR is active", () =>
{
  assert.match(styles, /\.court-qr-code\.has-svg-qr::after\s*\{\s*display: none;/);
  assert.match(styles, /\.court-qr-code > svg\s*\{/);
});
