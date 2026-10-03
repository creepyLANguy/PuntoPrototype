// Frontend integration tests: the shareable Match Details score card.
//
// The real capture pipeline runs against the booted app. jsdom has no canvas
// or image decoding, so canvases get a recording 2D context and images load
// instantly; the assertions are about what the app builds, hands to
// html-to-image, draws on the final canvas and shares.
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
import { holdToBlob, toBlobCalls } from "./frontendHarness/mocks/html-to-image.mjs";

const liveStyles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
const qrLibrary = readFileSync(new URL("../app/js/qrcode.min.js", import.meta.url), "utf8");

const COURT_ID = "sharect";
const SHARE_WIDTH = 1080;
const SHARE_HEIGHT = 1350;
// The share QR is sized from the 192px footer: max(168, min(240, 192 - 48)).
const QR_SIZE = 168;

let window;
let document;
const drawLog = [];
const shares = [];
const qrGenerators = [];

function recordingContext(canvas) {
  const state = {};
  return new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === Symbol.toPrimitive) return () => 0;
      return (...args) => {
        drawLog.push({ canvas, op: prop, args });
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      drawLog.push({ canvas, op: `set:${String(prop)}`, args: [value] });
      return true;
    },
  });
}

class InstantImage {
  constructor() {
    this.complete = false;
    this.naturalWidth = 0;
    this.naturalHeight = 0;
    this.listeners = {};
  }
  set src(value) {
    this.currentSrc = value;
    this.complete = true;
    this.naturalWidth = SHARE_WIDTH * 2;
    this.naturalHeight = SHARE_HEIGHT * 2;
    queueMicrotask(() => (this.listeners.load || []).forEach((listener) => listener()));
  }
  get src() {
    return this.currentSrc;
  }
  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }
  decode() {
    return Promise.resolve();
  }
}

function installBrowserStubs() {
  window.HTMLCanvasElement.prototype.getContext = function () {
    return recordingContext(this);
  };
  window.HTMLCanvasElement.prototype.toDataURL = function () {
    return "data:image/png;base64,TINTED-LOGO";
  };
  window.HTMLCanvasElement.prototype.toBlob = function (callback, type) {
    drawLog.push({ canvas: this, op: "toBlob", args: [type] });
    callback(new window.Blob(["png"], { type }));
  };
  window.Path2D = function Path2D() {};
  globalThis.Path2D = window.Path2D;
  globalThis.Image = InstantImage;

  // Layout for elements sized through inline styles (the export clone is
  // laid out entirely that way); everything else measures as empty.
  window.Element.prototype.getBoundingClientRect = function () {
    const width = Number.parseFloat(this.style?.width) || 0;
    const height = Number.parseFloat(this.style?.height) || 0;
    return { left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height };
  };

  // The QR library ships as a classic script on the real page.
  window.eval(qrLibrary);
  const RealQRCode = window.QRCode;
  window.QRCode = function QRCode(element, options) {
    const instance = new RealQRCode(element, options);
    qrGenerators.push({ element, options, instance });
    return instance;
  };
  window.QRCode.CorrectLevel = RealQRCode.CorrectLevel;

  window.navigator.canShare = () => true;
  window.navigator.share = async (payload) => {
    shares.push(payload);
  };
  window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ success: true }) });
  globalThis.fetch = window.fetch;
}

function scoreWithSets() {
  return makeScore({
    A: { points: 2, games: 3, sets: 1, totalPoints: 40 },
    B: { points: 1, games: 1, sets: 0, totalPoints: 30 },
    completedSets: [{ A: 6, B: 4 }],
  });
}

test.before(async () => {
  seedBaseData();
  seedCourt(COURT_ID, {
    name: "Centre Court",
    teamNames: { A: "The Extraordinarily Long Team Name Smashers", B: "Lobbers" },
  });
  pushScoreSnapshot(COURT_ID, scoreWithSets());

  callableHandlers.set("getDetailedScore", async () => ({
    data: {
      sets: [{ A: 6, B: 4 }],
      currentGames: { A: 3, B: 1 },
      points: { A: 2, B: 1 },
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
  installBrowserStubs();

  await waitFor(() => document.getElementById("scoreboardPage").style.display !== "none", {
    label: "scoreboard",
  });
});

async function waitForCapture(count) {
  await waitFor(() => toBlobCalls.length >= count, { label: `capture ${count}` });
  await waitFor(() => !document.getElementById("shareDetailsBtn").classList.contains("hidden"), {
    label: "share button ready",
  });
  await settle();
}

const captureNode = (index = toBlobCalls.length - 1) => toBlobCalls[index].node;

test("opening Match Details captures a 1080x1350 card at 2x from the modal surface", async () => {
  document.getElementById("detailsBtn").click();
  await waitForCapture(1);

  const { node, options } = toBlobCalls[0];
  const modalBox = document.getElementById("dmBox");
  const cardBackground = window.getComputedStyle(modalBox).backgroundColor;

  assert.equal(options.width, SHARE_WIDTH);
  assert.equal(options.height, SHARE_HEIGHT);
  assert.equal(options.canvasWidth, SHARE_WIDTH);
  assert.equal(options.canvasHeight, SHARE_HEIGHT);
  assert.equal(options.pixelRatio, 2);
  assert.equal(options.backgroundColor, cardBackground);

  assert.notEqual(node, modalBox, "a clone is captured, not the live modal");
  assert.equal(node.style.width, `${SHARE_WIDTH}px`);
  assert.equal(node.style.height, `${SHARE_HEIGHT}px`);
  assert.equal(node.style.minWidth, `${SHARE_WIDTH}px`);
  assert.equal(node.style.maxHeight, `${SHARE_HEIGHT}px`);
  assert.equal(node.style.background, cardBackground);
  assert.equal(node.style.padding, "40px 56px 16px");

  assert.equal(
    document.querySelectorAll("#dmBox").length,
    1,
    "the off-screen staging copy is removed after capture",
  );
});

test("interactive details UI is excluded before capture and by the serializer", () => {
  const node = captureNode(0);
  for (const selector of [
    ".dm-close",
    ".dm-share-btn",
    ".dm-details-panel",
    ".dm-empty-state",
    ".dm-error-state",
  ]) {
    assert.equal(node.querySelector(selector), null, `${selector} removed from the clone`);
  }

  const { filter } = toBlobCalls[0].options;
  const element = (className, tag = "div") => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  };
  for (const className of [
    "dm-close",
    "dm-share-btn",
    "dm-details-panel",
    "dm-empty-state",
    "dm-error-state",
    "hidden",
    "invisible",
    "sr-only",
    "no-print",
  ]) {
    assert.equal(filter(element(className)), false, `.${className} is filtered out`);
  }
  assert.equal(filter(element("", "img")), false, "an <img> without a source is dropped");
  const image = element("", "img");
  image.setAttribute("src", "data:image/png;base64,x");
  assert.equal(filter(image), true);
  assert.equal(filter(element("dm-name")), true);
  assert.equal(filter(document.createTextNode("text")), true);
});

test("long team names wrap rather than ellipsize", () => {
  const names = [...captureNode(0).querySelectorAll(".dm-name")];
  assert.ok(names.length >= 2);
  for (const name of names) {
    assert.equal(name.style.whiteSpace, "normal");
    assert.equal(name.style.overflow, "visible");
    assert.equal(name.style.textOverflow, "clip");
    assert.equal(name.style.overflowWrap, "anywhere");
    assert.equal(name.style.wordBreak, "break-word");
    assert.equal(name.style.maxWidth, "100%");
    assert.equal(name.style.width, "100%");
    assert.equal(name.style.lineHeight, "1.15");
    assert.equal(name.style.fontSize, "2.8rem");
  }
  assert.match(names[0].textContent, /Extraordinarily Long Team Name/);
});

test("share content uses an 840px column with 720px score and QR panels", () => {
  const node = captureNode(0);
  assert.equal(node.querySelector(".dm-header").style.width, "840px");
  assert.equal(node.querySelector(".dm-mid-section").style.width, "840px");

  const tableWrap = node.querySelector(".dm-table-wrap");
  assert.equal(tableWrap.style.width, "720px");
  assert.equal(tableWrap.style.padding, "16px 24px");
  assert.equal(tableWrap.style.borderRadius, "32px");

  const table = node.querySelector(".dm-table");
  assert.equal(table.style.width, "100%");
  assert.equal(table.style.minWidth, "0");
  for (const th of table.querySelectorAll("thead th")) {
    assert.equal(th.style.padding, "6px 16px 12px");
    assert.equal(th.style.fontSize, "1.9rem");
  }
  for (const td of table.querySelectorAll("tbody td:not(.dm-marker-cell)")) {
    assert.equal(td.style.padding, "14px 16px");
    assert.equal(td.style.minWidth, "84px");
    assert.equal(td.style.fontSize, "3.5rem");
  }
  for (const marker of table.querySelectorAll(".dm-marker-cell")) {
    assert.equal(marker.style.paddingRight, "20px");
    assert.equal(marker.style.width, "12px");
    assert.equal(marker.querySelector("span").style.minHeight, "72px");
  }

  assert.equal(node.querySelector(".dm-logo").style.width, "144px");
  assert.equal(node.querySelector(".dm-title").style.fontSize, "4rem");
  for (const sets of node.querySelectorAll(".dm-sets")) {
    assert.equal(sets.style.fontSize, "6.5rem");
  }

  const footer = node.lastElementChild;
  assert.equal(footer.style.width, "720px");
  assert.equal(footer.style.justifyContent, "flex-start");
  assert.equal(footer.style.paddingLeft, "104px");
  assert.equal(footer.style.position, "static");
});

test("the QR footer is centred between the score details and the image bottom", () => {
  const node = captureNode(0);
  const footer = node.lastElementChild;
  // With the inline-style layout used here the score table has no height and
  // the footer box measures 0, so the centring rule places the footer half
  // way down the 1350px card.
  assert.equal(footer.style.marginTop, `${(SHARE_HEIGHT - 0 - 0) / 2}px`);
});

test("the QR payload keeps the full URL while the visible URL omits the protocol", () => {
  const footer = captureNode(0).lastElementChild;
  const [, text] = footer.children;
  assert.deepEqual(
    [...text.children].map((line) => line.textContent),
    ["Scan for match details", `Court ID: ${COURT_ID.toUpperCase()}`, `padel.test/c/${COURT_ID}`],
  );

  const generator = qrGenerators.find(
    ({ options }) => options.text.endsWith(`/c/${COURT_ID}`) && options.width === QR_SIZE,
  );
  assert.ok(generator, "the share QR is generated for the court link");
  assert.equal(generator.options.text, `https://padel.test/c/${COURT_ID}`);
  assert.equal(generator.element.isConnected, false, "the QR is generated off-DOM");
  assert.equal(footer.querySelector("canvas, img, table"), null, "no QR raster in the export DOM");
});

test("the QR is composited pixel-aligned after the smoothed downsample and before PNG encoding", () => {
  const output = drawLog.find(
    ({ op, args }) => op === "drawImage" && args.length === 9 && args[7] === SHARE_WIDTH,
  )?.canvas;
  assert.ok(output, "the high-resolution render is downsampled onto the output canvas");
  assert.equal(output.width, SHARE_WIDTH);
  assert.equal(output.height, SHARE_HEIGHT);

  const ops = drawLog.filter((entry) => entry.canvas === output);
  const downsample = ops.findIndex(({ op }) => op === "drawImage");
  const encode = ops.findIndex(({ op }) => op === "toBlob");
  const smoothing = ops
    .filter(({ op }) => op === "set:imageSmoothingEnabled")
    .map(({ args }) => args[0]);
  const quality = ops.find(({ op }) => op === "set:imageSmoothingQuality");

  assert.deepEqual(smoothing, [true, false], "smoothed downsample, then an unsmoothed QR");
  assert.equal(quality.args[0], "high");
  assert.deepEqual(ops[downsample].args.slice(5), [0, 0, SHARE_WIDTH, SHARE_HEIGHT]);
  assert.equal(ops[encode].args[0], "image/png");

  const qrRects = ops
    .slice(downsample + 1, encode)
    .filter(({ op }) => op === "fillRect")
    .map(({ args }) => args);
  const [background, ...modules] = qrRects;
  const { instance } = qrGenerators.find(({ options }) => options.width === QR_SIZE);
  const model = instance._oQRCode;
  const moduleCount = model.getModuleCount();
  let darkModules = 0;
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      if (model.isDark(row, column)) darkModules += 1;
    }
  }

  const modulePixels = Math.ceil(QR_SIZE / moduleCount);
  assert.deepEqual(background, [0, 0, moduleCount * modulePixels, moduleCount * modulePixels]);
  assert.equal(modules.length, darkModules, "one rectangle per dark module");
  for (const [x, y, width, height] of modules) {
    assert.ok(Number.isInteger(x) && Number.isInteger(y), "module origins are pixel-aligned");
    assert.equal(width, modulePixels);
    assert.equal(height, modulePixels);
  }
  assert.ok(encode > downsample);
});

test("the dark theme watermark is a white-tinted logo embedded as a data URL", () => {
  const watermark = captureNode(0).querySelector(".dm-watermark img");
  assert.equal(watermark.getAttribute("src"), "data:image/png;base64,TINTED-LOGO");
  assert.equal(watermark.hasAttribute("srcset"), false);
  assert.equal(watermark.style.filter, "none");
  assert.equal(watermark.style.opacity, "0.06");
  assert.equal(watermark.style.width, "88%");
  assert.equal(watermark.style.maxWidth, "none");

  const tints = drawLog
    .filter(({ op, canvas }) => op === "set:fillStyle" && canvas.width === 256)
    .map(({ args }) => args[0]);
  assert.deepEqual(tints, ["#ffffff"]);
});

test("sharing details attaches the captured PNG file", async () => {
  document.getElementById("shareDetailsBtn").click();
  await waitFor(() => shares.length === 1, { label: "native share" });

  const [payload] = shares;
  assert.equal(payload.files.length, 1);
  assert.equal(payload.files[0].name, "share-image.png");
  assert.equal(payload.files[0].type, "image/png");
  assert.match(payload.text, /View full match details:\nhttps:\/\/padel\.test\/c\/sharect$/);
});

test("a fresh details render invalidates the old image and sharing waits for the new one", async () => {
  const release = holdToBlob();
  const capturesBefore = toBlobCalls.length;

  // A live score update re-renders the open details and starts a new capture.
  pushScoreSnapshot(
    COURT_ID,
    makeScore({ ...scoreWithSets(), A: { points: 3, games: 3, sets: 1, totalPoints: 41 } }),
  );
  await waitFor(() => toBlobCalls.length === capturesBefore + 1, {
    label: "second capture started",
  });

  document.getElementById("shareDetailsBtn").click();
  await settle(50);
  assert.equal(shares.length, 1, "sharing waits while the capture is in flight");

  release();
  await waitFor(() => shares.length === 2, { label: "share after capture" });
  assert.equal(shares[1].files.length, 1);
  assert.notEqual(shares[1].files[0], shares[0].files[0], "the new render's image is shared");
});

test("the light theme watermark is tinted dark", async () => {
  document.getElementById("closeDetailsBtn").click();
  await waitFor(() => document.getElementById("detailsModal").classList.contains("hidden"), {
    label: "details closed",
  });
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "t", bubbles: true }));
  assert.equal(document.body.classList.contains("light-mode"), true);

  const captures = toBlobCalls.length;
  document.getElementById("detailsBtn").click();
  await waitForCapture(captures + 1);

  const tints = drawLog
    .filter(({ op, canvas }) => op === "set:fillStyle" && canvas.width === 256)
    .map(({ args }) => args[0]);
  assert.deepEqual(tints, ["#ffffff", "#111111"], "one cached tint per theme colour");
});

test("share-only sizing does not alter the live modal stylesheet", () => {
  assert.match(liveStyles, /\.dm-box\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*480px;/);
  assert.match(liveStyles, /\.dm-table\s*\{[\s\S]*?width:\s*100%;/);
  assert.doesNotMatch(liveStyles, /SHARE_IMAGE_(?:EXPORT|CSS)_/);
  assert.doesNotMatch(liveStyles, /shareContentWidth/);

  const liveName = document.querySelector("#dmBox .dm-name");
  assert.equal(liveName.style.whiteSpace, "", "the live modal is never restyled");
});
