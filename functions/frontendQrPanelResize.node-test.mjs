import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/js/script.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");

test("QR panel resize observer does not regenerate the QR", () =>
{
  const observerStart = source.indexOf("const observer = new ResizeObserver(() =>");
  const observerEnd = source.indexOf("observer.observe(panel);", observerStart);

  assert.ok(observerStart >= 0, "QR ResizeObserver should exist");
  assert.ok(observerEnd > observerStart, "QR ResizeObserver block should be complete");

  const observerBlock = source.slice(observerStart, observerEnd);

  assert.match(observerBlock, /if \(isResizingQrPanel\)/);
  assert.doesNotMatch(observerBlock, /renderCourtQr\(/);
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

test("resize interaction has a distinct native-resize state", () =>
{
  assert.match(source, /let isResizingQrPanel = false/);
  assert.match(source, /isResizingQrPanel = true/);
  assert.match(source, /document\.addEventListener\("pointerup", stopInteractionFromPointer\)/);
  assert.match(source, /document\.addEventListener\("pointercancel", stopInteractionFromPointer\)/);
});

test("legacy CSS logo overlay is disabled when the SVG QR is active", () =>
{
  assert.match(styles, /\.court-qr-code\.has-svg-qr::after\s*\{\s*display: none;/);
  assert.match(styles, /\.court-qr-code > svg\s*\{/);
});
