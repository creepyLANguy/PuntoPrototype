// Frontend integration tests: the court QR panel on the scoreboard - its
// rendering, placement, drag / corner-resize interaction and the proximity-
// driven resize handles. Stylesheet and markup contracts are checked
// directly; the interaction runs on the real app booted in jsdom with a small
// layout model (jsdom performs no layout) and a recording canvas context.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bootFrontend,
  joinCourtAsPlayer,
  seedBaseData,
  seedCourt,
  settle,
  waitFor,
} from "./frontendHarness/harness.mjs";

const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
const markup = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const brand = readFileSync(new URL("../app/js/brand.mjs", import.meta.url), "utf8");
const qrLibrary = readFileSync(new URL("../app/js/qrcode.min.js", import.meta.url), "utf8");

const COURT_ID = "qrcourt";
const DEFAULT_PANEL_WIDTH = 200;
const PANEL_ASPECT = 1.24;

let window;
let document;
let panel;
let rectReads = 0;
// jsdom does not apply media queries; tests set this to model the stylesheet
// hiding the panel (display: none) on a phone-sized viewport.
let panelHiddenByStylesheet = false;
const drawLog = [];
const pointerCaptures = [];

function getCssRuleBody(css, selector) {
  const escapedSelector = selector.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escapedSelector + "\\s*\\{([^}]*)\\}"));
  assert.ok(match, "CSS rule not found: " + selector);
  return match[1];
}

// The media queries of every @media block containing a rule whose selector is
// exactly `selector` and that sets `declaration`.
function mediaQueriesWithRule(css, selector, declaration) {
  const queries = [];
  const mediaPattern = /@media([^{]+)\{/g;
  let match;
  while ((match = mediaPattern.exec(css))) {
    let depth = 1;
    let end = mediaPattern.lastIndex;
    while (depth > 0 && end < css.length) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") depth -= 1;
      end += 1;
    }
    const body = css.slice(mediaPattern.lastIndex, end - 1);
    const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    if (
      rules.some(
        ([, ruleSelector, ruleBody]) =>
          ruleSelector.trim() === selector && ruleBody.includes(declaration),
      )
    ) {
      queries.push(match[1].trim());
    }
  }
  return queries;
}

// Evaluates a media query list for a viewport. Only the width, height and
// orientation features are supported; anything else fails the test loudly.
function mediaQueryMatches(queryList, { width, height }) {
  return queryList.split(",").some((query) =>
    [...query.matchAll(/\(([^)]+)\)/g)].every(([, feature]) => {
      const [name, rawValue] = feature.split(":").map((part) => part.trim());
      const value = Number.parseFloat(rawValue);
      switch (name) {
        case "max-width":
          return width <= value;
        case "min-width":
          return width >= value;
        case "max-height":
          return height <= value;
        case "min-height":
          return height >= value;
        case "orientation":
          return rawValue === (width > height ? "landscape" : "portrait");
        default:
          throw new Error("unsupported media feature in test: " + name);
      }
    }),
  );
}

function rect(left, top, width, height) {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height };
}

// Layout model: the scoreboard fills the viewport; the panel is anchored
// bottom-right until it has explicit left/top, and keeps its aspect ratio.
function panelRect() {
  const width = Number.parseFloat(panel.style.width) || DEFAULT_PANEL_WIDTH;
  const height = width * PANEL_ASPECT;
  const left = Number.parseFloat(panel.style.left);
  const top = Number.parseFloat(panel.style.top);
  return rect(
    Number.isFinite(left) ? left : window.innerWidth - 8 - width,
    Number.isFinite(top) ? top : window.innerHeight - 8 - height,
    width,
    height,
  );
}

function installLayoutAndCanvas() {
  window.Element.prototype.getBoundingClientRect = function () {
    rectReads += 1;
    if (this.id === "scoreboardPage") return rect(0, 0, window.innerWidth, window.innerHeight);
    if (this.id === "courtQrPanel") return panelHiddenByStylesheet ? rect(0, 0, 0, 0) : panelRect();
    if (this.id === "courtQrCode") {
      const { width } = panelRect();
      return rect(0, 0, width * 2, width * 2);
    }
    return rect(0, 0, 0, 0);
  };

  window.HTMLCanvasElement.prototype.getContext = function () {
    const canvas = this;
    return new Proxy(
      {},
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          return (...args) => drawLog.push({ canvas, op: prop, args });
        },
        set(target, prop, value) {
          target[prop] = value;
          drawLog.push({ canvas, op: `set:${String(prop)}`, args: [value] });
          return true;
        },
      },
    );
  };

  // The logo image is decoded instantly.
  Object.defineProperty(window.HTMLImageElement.prototype, "complete", { get: () => true });
  Object.defineProperty(window.HTMLImageElement.prototype, "naturalWidth", { get: () => 512 });

  window.eval(qrLibrary);
}

function pointer(type, target, { x, y, id = 7, button = 0 } = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  });
  Object.defineProperty(event, "pointerId", { value: id });
  target.dispatchEvent(event);
  return event;
}

const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
const handleOpacity = () => panel.style.getPropertyValue("--qr-handle-opacity");
const opsOn = (canvas, op) => drawLog.filter((entry) => entry.canvas === canvas && entry.op === op);

test.before(async () => {
  seedBaseData();
  seedCourt(COURT_ID);

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
  panel = document.getElementById("courtQrPanel");
  installLayoutAndCanvas();

  panel.setPointerCapture = (id) => pointerCaptures.push(id);
  panel.hasPointerCapture = (id) => pointerCaptures.includes(id);
  panel.releasePointerCapture = (id) => pointerCaptures.splice(pointerCaptures.indexOf(id), 1);

  await joinCourtAsPlayer(document, COURT_ID);
  await waitFor(() => !panel.classList.contains("hidden"), { label: "QR panel shown" });
});

test("court QR is rendered to a pixel-snapped canvas with the logo baked into the same surface", () => {
  const code = document.getElementById("courtQrCode");
  assert.equal(code.classList.contains("has-canvas-qr"), true);
  assert.deepEqual(
    [...code.children].map((child) => child.className),
    ["court-qr-canvas", "court-qr-logo-canvas"],
  );
  assert.equal(document.getElementById("courtQrLabel").textContent, COURT_ID);

  const [qrCanvas, logoCanvas] = code.children;
  // max(512, content width x devicePixelRatio)
  assert.equal(qrCanvas.width, 512);
  assert.equal(logoCanvas.width, qrCanvas.width);
  assert.equal(qrCanvas.getAttribute("aria-hidden"), "true");

  const qrOps = drawLog.filter((entry) => entry.canvas === qrCanvas);
  assert.equal(qrOps.find((entry) => entry.op === "set:imageSmoothingEnabled").args[0], false);
  const modules = opsOn(qrCanvas, "fillRect").slice(1);
  assert.ok(modules.length > 100, "one rectangle per dark module");
  for (const { args } of modules) {
    assert.ok(args.every(Number.isInteger), "module edges are snapped to whole pixels");
  }

  const [arc] = opsOn(logoCanvas, "arc");
  assert.deepEqual(arc.args.slice(0, 3), [256, 256, (512 * 0.4) / 2]);
  assert.equal(opsOn(logoCanvas, "drawImage").length, 1, "the logo is drawn into its canvas");

  assert.match(styles, /\.court-qr-code > \.court-qr-canvas[\s\S]*?image-rendering: pixelated;/);
  assert.match(styles, /\.court-qr-code > \.court-qr-logo-canvas[\s\S]*?image-rendering: auto;/);
  assert.match(styles, /\.court-qr-code > canvas[\s\S]*?position: absolute;/);
  assert.doesNotMatch(styles, /\.court-qr-code::after/);
  assert.doesNotMatch(styles, /\.court-qr-code > svg/);
});

test("QR panel spawns from the bottom-right corner", () => {
  assert.equal(panel.style.left, "auto");
  assert.equal(panel.style.top, "auto");
  assert.equal(panel.style.right, "8px");
  assert.equal(panel.style.bottom, "8px");

  assert.match(styles, /\.court-qr-panel\s*\{[\s\S]*?bottom:\s*8px;[\s\S]*?right:\s*8px;/);
});

test("resize handles fade in on a logarithmic curve as the pointer approaches", async () => {
  const geometry = panelRect();
  const centerX = geometry.left + geometry.width / 2;
  const centerY = geometry.top + geometry.height / 2;
  const radius = Math.max(geometry.width, geometry.height);
  const moveTo = async (x, y) => {
    pointer("pointermove", document, { x, y });
    await settle(80);
  };

  await moveTo(centerX, centerY);
  assert.equal(handleOpacity(), "1.000", "inside the interaction circle");

  await moveTo(0, centerY);
  assert.equal(handleOpacity(), "0.000", "at the screen edge");

  // 60px outside the circle, travelling towards the left edge.
  const x = centerX - radius - 60;
  await moveTo(x, centerY);
  const travel = 60 / (centerX - radius);
  const expected = 1 - Math.log1p(12 * travel) / Math.log1p(12 * 0.3);
  assert.equal(handleOpacity(), expected.toFixed(3));

  // Beyond 30% of the way to the screen edge the handles are fully hidden.
  await moveTo(centerX - radius - 0.31 * (centerX - radius), centerY);
  assert.equal(handleOpacity(), "0.000");

  assert.doesNotMatch(styles, /\.qr-resize-handle:hover\s*\{/);
});

test("resize handles hide after three seconds without pointer movement outside the panel", async () => {
  const geometry = panelRect();
  pointer("pointermove", document, { x: geometry.left - 40, y: geometry.top + 40 });
  await settle(80);
  assert.notEqual(handleOpacity(), "0.000");

  await settle(3200);
  assert.equal(handleOpacity(), "0.000", "calculations are suspended after inactivity");

  pointer("pointermove", document, { x: geometry.left - 41, y: geometry.top + 40 });
  await settle(80);
  assert.notEqual(handleOpacity(), "0.000", "movement resumes the proximity updates");
});

test("dragging moves the panel on the compositor once per frame without layout reads", async () => {
  const start = panelRect();
  const grab = { x: start.left + 34, y: start.top + 88 };

  const down = pointer("pointerdown", panel, grab);
  assert.equal(down.defaultPrevented, true);
  assert.deepEqual(pointerCaptures, [7], "the pointer is captured");
  assert.equal(panel.classList.contains("dragging"), true);
  assert.equal(panel.classList.contains("qr-panel-interacting"), true);
  assert.equal(panel.style.left, `${start.left}px`);
  assert.equal(panel.style.top, `${start.top}px`);
  assert.equal(panel.style.right, "auto");

  const readsBefore = rectReads;
  pointer("pointermove", document, { x: grab.x - 100, y: grab.y - 50 });
  pointer("pointermove", document, { x: grab.x - 150, y: grab.y - 100 });
  assert.equal(rectReads, readsBefore, "pointermove performs no layout reads");
  assert.equal(panel.style.transform, "", "nothing is applied before the next frame");

  await nextFrame();
  assert.equal(panel.style.transform, "translate3d(-150px, -100px, 0)");
  assert.equal(panel.style.left, `${start.left}px`, "left/top stay put while dragging");

  pointer("pointerup", document, { x: grab.x - 150, y: grab.y - 100 });
  assert.equal(panel.style.left, `${start.left - 150}px`);
  assert.equal(panel.style.top, `${start.top - 100}px`);
  assert.equal(panel.style.transform, "");
  assert.equal(panel.classList.contains("dragging"), false);
  assert.equal(panel.classList.contains("qr-panel-interacting"), false);
  assert.deepEqual(pointerCaptures, [], "the pointer capture is released");
});

test("corner resize keeps the aspect ratio and applies one geometry set per frame", async () => {
  const start = panelRect();
  const handle = panel.querySelector('.qr-resize-handle[data-corner="nw"]');
  const qrCanvas = document.querySelector("#courtQrCode .court-qr-canvas");
  const logoCanvas = document.querySelector("#courtQrCode .court-qr-logo-canvas");
  const logoArcsBefore = opsOn(logoCanvas, "arc").length;
  const qrRectsBefore = opsOn(qrCanvas, "fillRect").length;

  pointer("pointerdown", handle, { x: start.left + 4, y: start.top + 4 });
  assert.equal(handle.classList.contains("is-active"), true);
  for (const className of ["resizing", "qr-panel-resizing", "qr-panel-interacting"]) {
    assert.equal(panel.classList.contains(className), true, className);
  }

  pointer("pointermove", document, { x: start.left + 4 - 60, y: start.top + 4 });
  pointer("pointermove", document, { x: start.left + 4 - 100, y: start.top + 4 });
  assert.equal(panel.style.width, "", "nothing is applied before the next frame");

  await nextFrame();
  const width = start.width + 100;
  assert.equal(panel.style.width, `${width}px`);
  assert.equal(panel.style.left, `${start.right - width}px`, "the opposite corner stays fixed");
  assert.equal(panel.style.top, `${start.bottom - width * PANEL_ASPECT}px`);
  assert.equal(panel.style.height, "", "height always follows from the width");

  pointer("pointerup", document, { x: start.left + 4 - 100, y: start.top + 4 });
  assert.equal(handle.classList.contains("is-active"), false);
  assert.equal(panel.classList.contains("resizing"), false);

  // Releasing re-rasterises only the logo, at the panel's new size.
  assert.equal(document.querySelector("#courtQrCode .court-qr-canvas"), qrCanvas);
  assert.equal(document.querySelector("#courtQrCode .court-qr-logo-canvas"), logoCanvas);
  assert.equal(opsOn(qrCanvas, "fillRect").length, qrRectsBefore, "the QR modules are not redrawn");
  assert.equal(logoCanvas.width, width * 2);
  assert.equal(opsOn(logoCanvas, "arc").length, logoArcsBefore + 1);
  assert.equal(qrCanvas.width, 512);

  assert.match(styles, /\.qr-resize-handle\s*\{[\s\S]*?width: 30px;/);
  assert.match(styles, /\.qr-resize-handle\s*\{[\s\S]*?height: 30px;/);
  assert.match(styles, /min-width: 130px;/);
  assert.doesNotMatch(styles, /--qr-panel-scale/);
});

test("the panel is kept inside the scoreboard when the window resizes", () => {
  panel.style.left = `${window.innerWidth + 50}px`;
  window.dispatchEvent(new window.Event("resize"));

  const geometry = panelRect();
  assert.equal(panel.style.left, `${window.innerWidth - geometry.width - 8}px`);
});

test("the QR panel is hidden on phone-sized viewports and shown on desktop", () => {
  const hidingQueries = mediaQueriesWithRule(styles, ".court-qr-panel", "display: none !important");
  assert.ok(hidingQueries.length > 0, "a media query hides the QR panel");
  const hiddenAt = (viewport) => hidingQueries.some((query) => mediaQueryMatches(query, viewport));

  for (const phone of [
    { width: 360, height: 780 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 780, height: 360 },
    { width: 932, height: 430 },
  ]) {
    assert.equal(hiddenAt(phone), true, `hidden at ${phone.width}x${phone.height}`);
  }

  for (const desktop of [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1080, height: 1920 },
  ]) {
    assert.equal(hiddenAt(desktop), false, `shown at ${desktop.width}x${desktop.height}`);
  }
});

test("a panel hidden by the stylesheet is not resized while hidden", () => {
  const saved = { left: panel.style.left, top: panel.style.top, width: panel.style.width };
  panel.style.left = "300px";
  panel.style.top = "200px";
  panel.style.width = "250px";

  try {
    panelHiddenByStylesheet = true;
    window.dispatchEvent(new window.Event("resize"));
    assert.deepEqual(
      { left: panel.style.left, top: panel.style.top, width: panel.style.width },
      { left: "300px", top: "200px", width: "250px" },
      "the hidden panel keeps its size and position",
    );

    panelHiddenByStylesheet = false;
    window.dispatchEvent(new window.Event("resize"));
    assert.equal(panel.style.width, "250px", "the panel returns at the size it had");
  } finally {
    panelHiddenByStylesheet = false;
    Object.assign(panel.style, saved);
  }
});

test("QR panel uses the custom pointer interaction instead of native CSS resize", () => {
  assert.match(styles, /\.court-qr-panel\s*\{[\s\S]*?resize: none;/);
  assert.doesNotMatch(brand, /qr-resize-interaction/);

  const ignored = pointer("pointerdown", panel, { x: 10, y: 10, button: 2 });
  assert.equal(ignored.defaultPrevented, false, "only the primary button starts an interaction");
  assert.equal(panel.classList.contains("qr-panel-interacting"), false);
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

test("QR resize keeps the compositor hint on drag only", () => {
  const interactingRule = getCssRuleBody(styles, ".court-qr-panel.qr-panel-interacting");
  const draggingRule = getCssRuleBody(styles, ".court-qr-panel.dragging");

  assert.match(draggingRule, /will-change:\s*transform;/);
  assert.doesNotMatch(interactingRule, /will-change:\s*transform;/);
});

test("leaving the court hides the panel and resets it to the bottom-right corner", async () => {
  document.getElementById("backBtn").click();
  await waitFor(() => !document.getElementById("confirmModal").classList.contains("hidden"), {
    label: "exit confirmation",
  });
  document.getElementById("confirmOkBtn").click();
  await waitFor(() => panel.classList.contains("hidden"), { label: "QR panel hidden" });

  assert.equal(panel.style.left, "auto");
  assert.equal(panel.style.top, "auto");
  assert.equal(panel.style.right, "8px");
  assert.equal(panel.style.bottom, "8px");
  assert.equal(panel.style.width, "");
  assert.equal(document.getElementById("courtQrCode").children.length, 0);
  assert.equal(handleOpacity(), "0.000");
});
