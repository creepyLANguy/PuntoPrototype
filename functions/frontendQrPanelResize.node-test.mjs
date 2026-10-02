import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/js/script.js", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
const markup = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const brand = readFileSync(new URL("../app/js/brand.mjs", import.meta.url), "utf8");

function getCssRuleBody(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escapedSelector + "\\s*\\{([^}]*)\\}"));
  assert.ok(match, "CSS rule not found: " + selector);
  return match[1];
}
test("QR panel interaction stays frame-synced", () => {
  assert.match(source, /function initializeCourtQrPanelInteractions\(\)/);
  assert.match(source, /const scheduleQrPanelFrame =/);
  assert.match(source, /window\.requestAnimationFrame\(applyPendingQrPanelFrame\)/);
  assert.match(source, /panel\.style\.transform =/);
  assert.match(source, /panel\.style\.width = nextWidth \+ "px"/);
  assert.match(source, /panel\.style\.left = nextLeft \+ "px"/);
  assert.match(source, /panel\.style\.top = nextTop \+ "px"/);
  assert.match(source, /const calculateResizeGeometry =/);
  assert.match(source, /resizeCorner\.endsWith\("e"\)/);
  assert.match(source, /resizeCorner\.startsWith\("s"\)/);
  assert.doesNotMatch(source, /panel\.style\.height =/);
  assert.match(
    source,
    /panel\.classList\.add\("resizing", "qr-panel-resizing", "qr-panel-interacting"\)/,
  );
  assert.match(
    source,
    /panel\.classList\.remove\("dragging", "resizing", "qr-panel-resizing", "qr-panel-interacting"\)/,
  );
  assert.match(source, /event\.target\.closest\("\.qr-resize-handle"\)/);
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
  assert.match(source, /canvas\.className = "court-qr-logo-canvas"/);
  assert.match(source, /createCourtQrLogoCanvas\(qrCanvas\.width\)/);
  assert.match(source, /replaceChildren\(/);
  assert.match(styles, /\.court-qr-code > \.court-qr-canvas[\s\S]*?image-rendering: pixelated;/);
  assert.match(styles, /\.court-qr-code > \.court-qr-logo-canvas[\s\S]*?image-rendering: auto;/);
  assert.match(styles, /\.court-qr-code > canvas[\s\S]*?position: absolute;/);
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
    /\.court-qr-panel\.qr-panel-interacting\s*\{[\s\S]*?backdrop-filter:\s*none;/,
  );
  assert.match(styles, /\.court-qr-panel\.qr-panel-interacting\s*\{[\s\S]*?box-shadow:\s*none;/);
  assert.match(styles, /\.court-qr-panel\.dragging\s*\{[\s\S]*?will-change:\s*transform;/);
});

test("QR panel exposes four corner resize handles", () => {
  assert.equal(markup.match(/class="qr-resize-handle/g)?.length, 4);
  for (const corner of ["nw", "ne", "sw", "se"]) {
    assert.match(markup, new RegExp("qr-resize-handle qr-resize-handle--" + corner));
    assert.match(markup, new RegExp('data-corner="' + corner + '"'));
  }

  assert.match(styles, /\.qr-resize-handle\s*\{[\s\S]*?opacity:\s*var\(--qr-handle-opacity, 0\);/);
  assert.match(
    styles,
    /\.qr-resize-handle::before\s*\{[\s\S]*?border:\s*1\.5px solid currentColor;/,
  );
  assert.match(
    styles,
    /\.qr-resize-handle--nw::before\s*\{[\s\S]*?border-top-left-radius:\s*10px;/,
  );
  assert.match(
    styles,
    /\.qr-resize-handle--ne::before\s*\{[\s\S]*?border-top-right-radius:\s*10px;/,
  );
  assert.match(
    styles,
    /\.qr-resize-handle--sw::before\s*\{[\s\S]*?border-bottom-left-radius:\s*10px;/,
  );
  assert.match(
    styles,
    /\.qr-resize-handle--se::before\s*\{[\s\S]*?border-bottom-right-radius:\s*10px;/,
  );
  assert.match(styles, /\.court-qr-panel\.qr-panel-resizing\s*\{[\s\S]*?--qr-handle-opacity:\s*1;/);
  assert.match(
    styles,
    /\.court-qr-panel\.qr-panel-resizing \.qr-resize-handle\s*\{[\s\S]*?opacity:\s*1 !important;/,
  );
  assert.match(styles, /\.court-qr-panel\s*\{[\s\S]*?border-bottom-right-radius:\s*12px;/);
  assert.match(styles, /\.qr-resize-handle--nw\s*\{[\s\S]*?cursor:\s*nwse-resize;/);
  assert.match(styles, /\.qr-resize-handle--ne\s*\{[\s\S]*?cursor:\s*nesw-resize;/);
  assert.match(styles, /\.qr-resize-handle--sw\s*\{[\s\S]*?cursor:\s*nesw-resize;/);
  assert.match(styles, /\.qr-resize-handle--se\s*\{[\s\S]*?cursor:\s*nwse-resize;/);
  assert.match(styles, /\.court-qr-panel\s*\{[\s\S]*?--qr-handle-opacity:\s*0;/);
  assert.doesNotMatch(styles, /\.pull-tab\s*\{/);
});

test("QR panel spawns from the bottom-right corner in every orientation", () => {
  assert.match(styles, /\.court-qr-panel\s*\{[\s\S]*?bottom:\s*8px;[\s\S]*?right:\s*8px;/);
  assert.match(source, /elements\.courtQrPanel\.style\.bottom = "8px";/);
  assert.match(source, /courtQrPanelVisible = false;/);
  assert.match(source, /courtQrPanelVisible = true;/);
  assert.match(source, /elements\.courtQrPanel\.style\.right = "8px";/);
  assert.match(
    source,
    /if \(!Number\.isFinite\(currentLeft\) && !Number\.isFinite\(currentTop\)\)[\s\S]*?panel\.style\.left = "auto";[\s\S]*?panel\.style\.top = "auto";/,
  );
  assert.match(source, /panel\.style\.right = \`\$\{safeGap\}px\`;/);
  assert.match(source, /panel\.style\.bottom = \`\$\{safeGap\}px\`;/);
  assert.doesNotMatch(
    styles,
    /@media \(orientation: landscape\)[\s\S]*?\.court-qr-panel\s*\{[\s\S]*?display:\s*none\s*!important;/,
  );
  assert.doesNotMatch(
    styles,
    /@media \(max-width: 768px\)[\s\S]*?\.court-qr-panel\s*\{[\s\S]*?display:\s*none\s*!important;/,
  );
});

test("QR resize visibility is cached, logarithmic, and inactivity-aware", () => {
  assert.match(source, /let courtQrPanelVisible = false;/);
  assert.match(source, /let courtQrPanelGeometry = null;/);
  assert.match(source, /function initializeCourtQrResizeHandleVisibility\(\)/);
  assert.match(source, /const cachePanelGeometry =/);
  assert.match(source, /panel\.getBoundingClientRect\(\)/);
  assert.match(source, /centerX: rect\.left \+ rect\.width \/ 2/);
  assert.match(source, /centerY: rect\.top \+ rect\.height \/ 2/);
  assert.match(source, /radius: Math\.max\(rect\.width, rect\.height\)/);
  assert.match(source, /const inactivityTimeoutMs = 3000;/);
  assert.match(source, /const maxHandleOpacity = 1;/);
  assert.match(source, /const opacityStartTravelPercentage = 0\.3;/);
  assert.match(source, /const distanceFromPanelCenter = Math\.hypot\(/);
  assert.match(source, /const effectiveDistance = distanceFromPanelCenter - geometry\.radius;/);
  assert.match(source, /const effectiveMaxDistance = distanceToScreenEdge - geometry\.radius;/);
  assert.match(source, /Math\.log1p\(logarithmicCurveStrength \* travelPercentage\)/);
  assert.match(source, /window\.setTimeout\(/);
  assert.match(source, /lastPointerMoveTime = performance\.now\(\)/);
  assert.match(source, /if \(inactivityTimer\)/);
  assert.match(source, /if \(!courtQrPanelVisible\)/);
  assert.match(source, /if \(isPanelInteractionActive\(\)\)[\s\S]*?clearHandleUpdateTimer\(\)/);
  assert.match(source, /refreshCourtQrResizeHandleVisibility/);
  assert.match(
    source,
    /refreshCourtQrResizeHandleVisibility = \(startFreshVisibilityWindow = false\)/,
  );
  assert.match(
    source,
    /if \(startFreshVisibilityWindow\)[\s\S]*?clearInactivityTimer\(\);[\s\S]*?lastPointerMoveTime = performance\.now\(\);/,
  );
  assert.doesNotMatch(styles, /\.qr-resize-handle:hover\s*\{/);

  const renderStart = source.indexOf("  function renderCourtQr(courtId)");
  const renderEnd = source.indexOf("  function enableSpectateMode()", renderStart);
  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  const renderBlock = source.slice(renderStart, renderEnd);
  const renderRefreshIndex = renderBlock.lastIndexOf(
    "refreshCourtQrResizeHandleVisibility?.(true);",
  );
  const renderLabelIndex = renderBlock.indexOf("elements.courtQrLabel.textContent = courtId;");
  assert.ok(renderRefreshIndex > renderLabelIndex);

  const courtOpenStart = source.indexOf("    currentCourtId = courtId;");
  const renderCallIndex = source.indexOf("    renderCourtQr(courtId);", courtOpenStart);
  const scoreboardVisibleIndex = source.indexOf(
    '    elements.scoreboardPage.style.display = "flex";',
    courtOpenStart,
  );
  assert.ok(scoreboardVisibleIndex >= 0 && renderCallIndex > scoreboardVisibleIndex);

  const visibilityFunctionStart = source.indexOf(
    "function initializeCourtQrResizeHandleVisibility()",
  );
  const pointerMoveStart = source.indexOf(
    '    document.addEventListener("pointermove", (event) =>',
    visibilityFunctionStart,
  );
  const pointerMoveEnd = source.indexOf(
    "    refreshCourtQrResizeHandleVisibility =",
    pointerMoveStart,
  );
  assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
  const pointerMoveBlock = source.slice(pointerMoveStart, pointerMoveEnd);
  assert.match(
    pointerMoveBlock,
    /if \(!courtQrPanelVisible\)\s*\{[\s\S]*?lastPointerX = event\.clientX;[\s\S]*?lastPointerY = event\.clientY;[\s\S]*?hasPointerPosition = true;[\s\S]*?lastPointerMoveTime = performance\.now\(\);[\s\S]*?return;/,
  );
  assert.match(pointerMoveBlock, /event\.clientX === lastPointerX/);
  assert.doesNotMatch(pointerMoveBlock, /getBoundingClientRect\(\)/);
  assert.doesNotMatch(pointerMoveBlock, /getClientRects\(\)/);
  assert.doesNotMatch(pointerMoveBlock, /clearTimeout\(inactivityTimer\)/);
});

test("QR resize updates one corner geometry set per animation frame", () => {
  assert.doesNotMatch(source, /resizeStartPanelScale/);
  assert.match(source, /const calculateResizeGeometry =/);
  assert.match(source, /const nextWidth = pendingWidth/);
  assert.match(source, /panel\.style\.width = nextWidth \+ "px"/);
  assert.match(source, /panel\.style\.left = nextLeft \+ "px"/);
  assert.match(source, /panel\.style\.top = nextTop \+ "px"/);
  assert.doesNotMatch(source, /panel\.style\.height =/);
  assert.match(source, /panel\.style\.transform = ""/);
  assert.doesNotMatch(source, /createCourtQrCanvas\(refreshedQrUrl\)/);
  assert.doesNotMatch(source, /createCourtQrLogoCanvas\(refreshedQrCanvas\.width\)/);
  assert.match(styles, /\.qr-resize-handle\s*\{[\s\S]*?width: 30px;/);
  assert.match(styles, /\.qr-resize-handle\s*\{[\s\S]*?height: 30px;/);
  assert.match(styles, /\.qr-resize-handle--nw\s*\{[\s\S]*?cursor:/);
  assert.match(styles, /\.qr-resize-handle--ne\s*\{[\s\S]*?cursor:/);
  assert.match(styles, /\.qr-resize-handle--sw\s*\{[\s\S]*?cursor:/);
  assert.match(styles, /\.qr-resize-handle--se\s*\{[\s\S]*?cursor:/);
  assert.match(styles, /min-width: 130px;/);
  assert.doesNotMatch(styles, /--qr-panel-scale/);
  assert.doesNotMatch(source, /const resizeHandleZone = 28;/);
});

test("QR resize keeps the QR canvas stable across all corner interactions", () => {
  assert.match(source, /rerasterizeCourtQrLogoAtCurrentSize\(\);/);
  assert.match(source, /resizeCorner = null;/);
  assert.match(source, /activeResizeHandle\.classList\.add\("is-active"\)/);
  assert.doesNotMatch(source, /createCourtQrCanvas\(refreshedQrUrl\)/);
  assert.doesNotMatch(source, /createCourtQrLogoCanvas\(refreshedQrCanvas\.width\)/);
});

test("QR resize leaves QR canvases in place on release and rerasterizes only the logo", () => {
  assert.match(source, /function getCourtQrBackingSize\(\)/);
  assert.match(source, /const backingSize = getCourtQrBackingSize\(\);/);
  assert.match(source, /function rerasterizeCourtQrLogoAtCurrentSize\(\)/);
  assert.match(source, /elements\.courtQrCode\?\.querySelector\("\.court-qr-logo-canvas"\)/);
  assert.match(source, /if \(canvas\.width === backingSize && canvas\.height === backingSize\)/);
  assert.match(source, /canvas\.width = backingSize;/);
  assert.match(source, /canvas\.height = backingSize;/);
  assert.match(source, /drawCourtQrLogo\(context, backingSize\);/);
  assert.match(
    source,
    /if \(modeAtStop === "resize"\)\s*\{\s*clampCourtQrPanelToViewport\(\);\s*rerasterizeCourtQrLogoAtCurrentSize\(\);\s*\}/,
  );
  assert.doesNotMatch(source, /elements\.courtQrCode\.replaceChildren\(\s*refreshedQrCanvas/);

  const pointerMoveStart = source.indexOf(
    '    document.addEventListener("pointermove", (event) =>',
  );
  const pointerMoveEnd = source.indexOf("    const stopInteractionFromPointer", pointerMoveStart);
  assert.ok(pointerMoveStart >= 0 && pointerMoveEnd > pointerMoveStart);
  const pointerMoveBlock = source.slice(pointerMoveStart, pointerMoveEnd);
  assert.doesNotMatch(pointerMoveBlock, /rerasterizeCourtQrLogoAtCurrentSize/);
});

test("QR resize keeps the compositor hint on drag only", () => {
  const interactingRule = getCssRuleBody(styles, ".court-qr-panel.qr-panel-interacting");
  const draggingRule = getCssRuleBody(styles, ".court-qr-panel.dragging");

  assert.match(draggingRule, /will-change:\s*transform;/);
  assert.doesNotMatch(interactingRule, /will-change:\s*transform;/);
});
