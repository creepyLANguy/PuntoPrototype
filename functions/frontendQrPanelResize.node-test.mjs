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
  const pointerMoveEnd = source.indexOf("    const stopInteractionFromPointer", pointerMoveStart);
  assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
  const pointerMoveBlock = source.slice(pointerMoveStart, pointerMoveEnd);
  assert.doesNotMatch(pointerMoveBlock, /getBoundingClientRect\(\)/);
  assert.doesNotMatch(pointerMoveBlock, /clientWidth/);
  assert.doesNotMatch(pointerMoveBlock, /clientHeight/);
});

test("court QR is rendered to a pixel-snapped canvas with the logo baked into the same surface", () => {
  assert.match(source, /function createCourtQrCanvas\(qrUrl\)/);
  assert.match(source, /matrix = qr\?\._oQRCode/);
  assert.match(source, /const devicePixelRatio = Math\.max\(1, window\.devicePixelRatio \|\| 1\)/);
  assert.match(source, /context\.imageSmoothingEnabled = false/);
  assert.match(source, /const x0 = Math\.round\(column \* moduleScale\)/);
  assert.match(source, /const x1 = Math\.round\(\(column \+ 1\) \* moduleScale\)/);
  assert.match(source, /canvas\.className = "court-qr-canvas"/);
  assert.match(source, /function drawCourtQrLogo\(context, size\)/);
  assert.match(source, /context\.arc\(size \/ 2, size \/ 2/);
  assert.match(source, /context\.drawImage\(/);
  assert.match(source, /courtQrLogoImage = typeof window\.Image === "function"/);
  assert.doesNotMatch(source, /function createCourtQrSvg\(qrUrl\)/);
  assert.doesNotMatch(styles, /\.court-qr-code::after/);
  assert.doesNotMatch(styles, /\.court-qr-code > svg/);
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
  assert.ok(styles.includes("transparent 0 4px,"));
  assert.ok(styles.includes("rgba(255, 255, 255, 0.9) 4px 6px,"));
  assert.ok(styles.includes("transparent 6px 8px"));
  assert.match(styles, /\.pull-tab\s*\{[\s\S]*?cursor:\s*nwse-resize;/);
  assert.match(styles, /\.court-qr-panel:hover\s+\.pull-tab\s*\{[\s\S]*?opacity:\s*0\.75;/);
  assert.match(source, /const resizeHandleZone = 28;/);
});

test("legacy CSS logo overlay is disabled when the SVG QR is active", () => {
  assert.match(styles, /\.court-qr-code\.has-svg-qr::after\s*\{\s*display: none;/);
  assert.match(styles, /\.court-qr-code > svg\s*\{/);
});

test("QR resize commits through the original panel width and height state model", () => {
  assert.doesNotMatch(source, /resizeStartPanelScale/);
  assert.doesNotMatch(source, /--qr-panel-scale/);
  assert.match(source, /panel\.style\.width = \(resizeStartWidth \* scale\) \+ "px"/);
  assert.match(source, /panel\.style\.height =/);
  assert.match(source, /panel\.style\.transform = ""/);
  assert.match(source, /const refreshedQrCanvas = createCourtQrCanvas\(buildCourtQrUrl\(currentCourtId\)\)/);
  assert.match(styles, /padding: 12px;/);
  assert.match(styles, /gap: 8px;/);
  assert.match(styles, /border-radius: 12px;/);
  assert.match(styles, /width: 28px;/);
  assert.match(styles, /clip-path: polygon\(0px 28px, 28px 100%, 100% 0%\);/);
});

test("QR panel does not introduce an independent panel scaling state", () => {
  assert.doesNotMatch(source, /panel\.style\.transform = "scale\("/);
  assert.doesNotMatch(source, /--qr-panel-scale/);
  assert.doesNotMatch(styles, /var\(--qr-panel-scale/);
});
