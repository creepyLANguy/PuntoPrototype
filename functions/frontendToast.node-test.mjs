// Unit tests: toast notifications and their positioning (app/js/ui/toast.js).
// Each test drives the real module against its own small jsdom document; the
// module reads `document` / `window` at call time, so the globals are swapped
// per test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  appendToast,
  initToastContainerPositionObservers,
  showToast,
  updateToastContainerPosition,
} from "../app/js/ui/toast.js";

function useDocument(markup, { viewport = { width: 1000, height: 800 } } = {}) {
  const dom = new JSDOM(markup);
  Object.defineProperty(dom.window, "innerWidth", { configurable: true, value: viewport.width });
  Object.defineProperty(dom.window, "innerHeight", { configurable: true, value: viewport.height });

  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;

  return {
    dom,
    document: dom.window.document,
    restore() {
      globalThis.document = previous.document;
      globalThis.window = previous.window;
      dom.window.close();
    },
  };
}

function withControls(rect, viewport) {
  const page = useDocument('<div id="toastContainer"></div><div class="floating-controls"></div>', {
    viewport,
  });
  page.container = page.document.getElementById("toastContainer");
  page.document.querySelector(".floating-controls").getBoundingClientRect = () => ({ ...rect });
  return page;
}

const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");

const PORTRAIT_BAR = { top: 700, left: 100, width: 600, height: 60, right: 700, bottom: 760 };

test("toast positioning clears stale offsets before calculating a new position", () => {
  const page = withControls(PORTRAIT_BAR);
  try {
    page.container.style.setProperty("--toast-bottom-offset", "999px");
    page.container.style.setProperty("--toast-right-offset", "888px");

    updateToastContainerPosition();

    assert.equal(page.container.style.getPropertyValue("--toast-bottom-offset"), "116px");
    assert.equal(page.container.style.getPropertyValue("--toast-right-offset"), "");
  } finally {
    page.restore();
  }
});

test("toast positioning reserves the correct right-side clearance in landscape", () => {
  const page = withControls(
    { top: 50, left: 900, width: 70, height: 500, right: 970, bottom: 550 },
    { width: 1000, height: 600 },
  );
  try {
    updateToastContainerPosition();

    assert.equal(page.container.style.getPropertyValue("--toast-right-offset"), "116px");
    assert.equal(page.container.style.getPropertyValue("--toast-bottom-offset"), "");
  } finally {
    page.restore();
  }
});

test("toast positioning enforces a minimum 16px clearance", () => {
  const portrait = withControls({
    top: 800,
    left: 0,
    width: 400,
    height: 40,
    right: 400,
    bottom: 839,
  });
  try {
    updateToastContainerPosition();
    assert.equal(portrait.container.style.getPropertyValue("--toast-bottom-offset"), "16px");
  } finally {
    portrait.restore();
  }

  const landscape = withControls(
    { top: 0, left: 1000, width: 40, height: 400, right: 1040, bottom: 400 },
    { width: 1000, height: 600 },
  );
  try {
    updateToastContainerPosition();
    assert.equal(landscape.container.style.getPropertyValue("--toast-right-offset"), "16px");
  } finally {
    landscape.restore();
  }
});

test("toast positioning falls back to CSS defaults when controls are absent or not measurable", () => {
  const page = useDocument('<div id="toastContainer"></div>');
  try {
    const container = page.document.getElementById("toastContainer");
    container.style.setProperty("--toast-bottom-offset", "123px");
    container.style.setProperty("--toast-right-offset", "456px");

    updateToastContainerPosition();

    assert.equal(container.style.getPropertyValue("--toast-bottom-offset"), "");
    assert.equal(container.style.getPropertyValue("--toast-right-offset"), "");

    const controls = page.document.createElement("div");
    controls.className = "floating-controls";
    controls.getBoundingClientRect = () => ({
      top: 0,
      left: 0,
      width: 0,
      height: 0,
      right: 0,
      bottom: 0,
    });
    page.document.body.appendChild(controls);
    container.style.setProperty("--toast-bottom-offset", "123px");
    container.style.setProperty("--toast-right-offset", "456px");

    updateToastContainerPosition();

    assert.equal(container.style.getPropertyValue("--toast-bottom-offset"), "");
    assert.equal(container.style.getPropertyValue("--toast-right-offset"), "");
  } finally {
    page.restore();
  }
});

test("showToast recalculates positioning, appends a typed toast, and removes it after the toast duration", (t) => {
  const page = withControls(PORTRAIT_BAR);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    showToast("Saved", "success");

    assert.equal(page.container.children.length, 1);
    assert.equal(page.container.firstElementChild.textContent, "Saved");
    assert.equal(page.container.firstElementChild.className, "toast success");
    assert.equal(page.container.style.getPropertyValue("--toast-bottom-offset"), "116px");

    t.mock.timers.tick(2999);
    assert.equal(page.container.children.length, 1);
    t.mock.timers.tick(1);
    assert.equal(page.container.children.length, 0);
  } finally {
    page.restore();
  }
});

test("appendToast adds a typed toast without repositioning the container", () => {
  const page = withControls(PORTRAIT_BAR);
  const timers = [];
  page.dom.window.setTimeout = (callback, delay) => timers.push({ callback, delay });
  try {
    page.container.style.setProperty("--toast-bottom-offset", "999px");

    appendToast("Changeover complete");
    appendToast("Changeover failed", "error");

    assert.deepEqual(
      [...page.container.children].map((toast) => [toast.className, toast.textContent]),
      [
        ["toast success", "Changeover complete"],
        ["toast error", "Changeover failed"],
      ],
    );
    assert.equal(page.container.style.getPropertyValue("--toast-bottom-offset"), "999px");
    assert.deepEqual(
      timers.map(({ delay }) => delay),
      [3000, 3000],
    );

    timers.forEach(({ callback }) => callback());
    assert.equal(page.container.children.length, 0);
  } finally {
    page.restore();
  }
});

test("toast positioning reacts to scoreboard and floating-control layout changes", () => {
  let rect = { ...PORTRAIT_BAR };
  const page = useDocument(
    '<div id="scoreboardPage"><div class="scoreboard-body"><div class="floating-controls"></div></div></div><div id="toastContainer"></div>',
  );
  const { window } = page.dom;
  const container = page.document.getElementById("toastContainer");
  page.document.querySelector(".floating-controls").getBoundingClientRect = () => ({ ...rect });

  const frames = [];
  window.requestAnimationFrame = (callback) => frames.push(callback);
  const flushFrames = () => frames.splice(0).forEach((callback) => callback());

  const resizeObservers = [];
  const mutationObservers = [];
  window.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      resizeObservers.push(this);
    }
    observe(target) {
      this.targets.push(target);
    }
  };
  window.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      mutationObservers.push(this);
    }
    observe(target, options) {
      this.targets.push({ target, options });
    }
  };

  try {
    initToastContainerPositionObservers();
    flushFrames();

    assert.equal(resizeObservers.length, 1);
    assert.equal(resizeObservers[0].targets.length, 3);
    assert.equal(mutationObservers.length, 1);
    assert.deepEqual(
      mutationObservers[0].targets.map(({ options }) => options.subtree === true),
      [false, true],
      "the scoreboard body subtree is observed",
    );
    assert.equal(container.style.getPropertyValue("--toast-bottom-offset"), "116px");

    rect = { ...rect, top: 650, bottom: 710 };
    resizeObservers[0].callback();
    resizeObservers[0].callback();
    assert.equal(frames.length, 1, "updates are coalesced into one animation frame");
    flushFrames();
    assert.equal(container.style.getPropertyValue("--toast-bottom-offset"), "166px");

    rect = { ...rect, top: 600, bottom: 660 };
    mutationObservers[0].callback();
    flushFrames();
    assert.equal(container.style.getPropertyValue("--toast-bottom-offset"), "216px");

    initToastContainerPositionObservers();
    assert.equal(resizeObservers.length, 1, "observers are only installed once");
  } finally {
    page.restore();
  }
});

test("toast CSS keeps stacked notifications centered with a 10px gap and responsive widths", () => {
  const toastContainerBlocks = [...styles.matchAll(/\.toast-container\s*\{[\s\S]*?\n\}/g)].map(
    (match) => match[0],
  );
  assert.ok(
    toastContainerBlocks.length >= 2,
    "both toast container definitions should remain covered",
  );

  for (const block of toastContainerBlocks.slice(0, 2)) {
    assert.match(block, /display:\s*flex;/);
    assert.match(block, /flex-direction:\s*column;/);
    assert.match(block, /align-items:\s*center;/);
    assert.match(block, /gap:\s*10px;/);
    assert.match(
      block,
      /bottom:\s*calc\(var\(--toast-bottom-offset, 20px\)\s*\+\s*env\(safe-area-inset-bottom, 0px\)\);/,
    );
  }

  assert.match(styles, /width:\s*min\(420px,\s*100%\);/);
  assert.match(styles, /min-width:\s*min\(200px,\s*100%\);/);
  assert.match(
    styles,
    /@media\s*\(orientation:\s*landscape\)[\s\S]*?right:\s*calc\(var\(--toast-right-offset, 20px\)\s*\+\s*env\(safe-area-inset-right, 0px\)\);/,
  );
});
