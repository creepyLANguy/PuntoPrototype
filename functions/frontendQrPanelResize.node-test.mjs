import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/js/script.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
const brand = readFileSync(new URL("../app/js/brand.mjs", import.meta.url), "utf8");

test("QR panel interaction stays frame-synced and compositor-driven", () => {
  assert.match(source, /function initializeCourtQrPanelInteractions\(\)/);
  assert.match(source, /const scheduleQrPanelFrame =/);
  assert.match(source, /window\.requestAnimationFrame\(applyPendingQrPanelFrame\)/);
  assert.match(source, /panel\.style\.transform =/);
  assert.match(source, /panel\.classList\.add\("resizing", "qr-panel-interacting"\)/);
  assert.match(source, /panel\.classList\.add\("dragging", "qr-panel-interacting"\)/);
  assert.match(source, /const stopInteraction =/);
  assert.doesNotMatch(source, /new ResizeObserver\(/);

  const pointerMoveStart = source.indexOf(
    '    document.addEventListener("pointermove", (event) =>',
  );
  const pointerMoveEnd = source.indexOf('    const stopInteractionFromPointer', pointerMoveStart);
  assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
  const pointerMoveBlock = source.slice(pointerMoveStart, pointerMoveEnd);
  assert.doesNotMatch(pointerMoveBlock, /getBoundingClientRect\(\)/);
  assert.doesNotMatch(pointerMoveBlock, /clientWidth/);
  assert.doesNotMatch(pointerMoveBlock, /clientHeight/);
});

test("court QR is rendered as one SVG tree containing both QR modules and logo", () => {
  assert.match(source, /function createCourtQrSvg\(qrUrl\)/);
  assert.match(source, /matrix = qr\?\._oQRCode/);
  assert.match(source, /setAttribute\("shape-rendering", "crispEdges"\)/);
  assert.match(source, /logoBackground = document\.createElementNS/);
  assert.match(source, /logoImage = document\.createElementNS/);
  assert.match(source, /logoImage\.setAttribute\("href", "\/media\/logo\.svg"\)/);
});

test("QR panel uses the custom pointer interaction instead of native CSS resize", () => {
  assert.match(source, /interactionMode = "resize"/);
  assert.match(source, /panel\.setPointerCapture\(event\.pointerId\)/);
  assert.match(styles, /\.court-qr-panel\s*\{[\s\S]*?resize: none;/);
  assert.doesNotMatch(brand, /qr-resize-interaction/);
});

test("QR interaction disables expensive paint effects while active", () => {
  assert.match(
    styles,
    /\.court-qr-panel\.qr-panel-interacting\s*\{[\s\S]*?will-change:\s*transform;/,
  );
  assert.match(
    styles,
    /\.court-qr-panel\.qr-panel-interacting\s*\{[\s\S]*?backdrop-filter:\s*none;/,
  );
  assert.match(styles, /\.court-qr-panel\.qr-panel-interacting\s*\{[\s\S]*?box-shadow:\s*none;/);
});

test("QR panel pull tab looks and behaves like a resize handle", () => {
  assert.match(styles, /\.pull-tab\s*\{[\s\S]*?opacity:\s*0\.2;/);
  assert.match(styles, /\.pull-tab\s*\{[\s\S]*?repeating-linear-gradient\(/);
  assert.match(styles, /transparent 0 4px,/);
  assert.match(styles, /rgba\\(255, 255, 255, 0\\.9\\) 4px 6px,/);
  assert.match(styles, /transparent 6px 8px/);
  assert.match(styles, /\.pull-tab\s*\{[\s\S]*?cursor:\s*nwse-resize;/);
  assert.match(styles, /\.court-qr-panel:hover\s+\.pull-tab\s*\{[\s\S]*?opacity:\s*0\.75;/);
  assert.match(source, /const resizeHandleZone = 28;/);
});

test("legacy CSS logo overlay is disabled when the SVG QR is active", () => {
  assert.match(styles, /\.court-qr-code\.has-svg-qr::after\s*\{\s*display: none;/);
  assert.match(styles, /\.court-qr-code > svg\s*\{/);
});
