// jsdom-based harness that boots the real frontend (app/index.html and the ES
// module entry point it references, app/js/main.js) against the mocked Firebase
// SDK, so integration tests can drive the actual UI and observe the actual DOM.
import { register } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";

import {
  firestoreState,
  resetFirestoreState,
  seedDoc,
  writeDoc,
  flushBackendWork,
  getBackendScore,
  callableHandlers,
} from "./mockFirestoreState.mjs";

register("./loaderHooks.mjs", import.meta.url);

const harnessDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(harnessDir, "..", "..");
const indexHtmlPath = path.join(repoRoot, "app", "index.html");
const stylesheetPath = path.join(repoRoot, "app", "css", "style.css");

// The module entry point is read from the document itself, so the harness
// always boots exactly what app/index.html loads in the browser.
function resolveModuleEntryPath(html) {
  const entry = html.match(/<script\s+type="module"\s+src="([^"]+)"/i);
  if (!entry) throw new Error("app/index.html does not reference a module entry point");

  const base = html.match(/<base\s+href="([^"]+)"/i)?.[1] || "/app/";
  const { pathname } = new URL(entry[1], new URL(base, "https://padel.test/"));
  return path.join(repoRoot, ...pathname.split("/").filter(Boolean));
}

let booted = false;

function installGlobals(dom) {
  const { window } = dom;

  // Browser API stubs missing from jsdom.
  window.matchMedia =
    window.matchMedia ||
    ((query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));

  window.ResizeObserver =
    window.ResizeObserver ||
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

  window.__audioTestState = { contexts: 0, resumeCalls: 0, starts: 0 };
  window.__clashAudioTestState = { starts: 0 };
  window.Audio = class {
    constructor() {}
    play() {
      window.__clashAudioTestState.starts += 1;
      return Promise.resolve();
    }
  };
  window.AudioContext = class {
    constructor() {
      this.state = "suspended";
      this.destination = {};
      window.__audioTestState.contexts += 1;
    }
    async resume() {
      window.__audioTestState.resumeCalls += 1;
      this.state = "running";
    }
    async decodeAudioData() {
      return {};
    }
    createBufferSource() {
      return {
        connect: () => {},
        start: () => {
          window.__audioTestState.starts += 1;
        },
      };
    }
  };

  window.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(0),
    json: async () => ({}),
    text: async () => "",
  });

  window.navigator.wakeLock = {
    request: async () => ({ release: async () => {}, addEventListener: () => {} }),
  };

  window.HTMLElement.prototype.scrollIntoView =
    window.HTMLElement.prototype.scrollIntoView || (() => {});

  const globalsToExpose = {
    window,
    Audio: window.Audio,
    document: window.document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
    location: window.location,
    history: window.history,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    MutationObserver: window.MutationObserver,
    ResizeObserver: window.ResizeObserver,
    File: window.File,
    FileReader: window.FileReader,
    fetch: window.fetch,
    alert: () => {},
  };

  for (const [name, value] of Object.entries(globalsToExpose)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  Object.defineProperty(globalThis, "navigator", {
    value: window.navigator,
    configurable: true,
  });
}

export async function bootFrontend({ url = "https://padel.test/" } = {}) {
  if (booted) {
    throw new Error(
      "The frontend can only be booted once per process; drive it via helpers instead.",
    );
  }
  booted = true;

  const html = readFileSync(indexHtmlPath, "utf8");
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });

  installGlobals(dom);

  // jsdom does not fetch the external stylesheet, but the app inspects
  // computed styles (e.g. `.hidden { display: none }`), so inline it.
  const styleEl = dom.window.document.createElement("style");
  styleEl.textContent = readFileSync(stylesheetPath, "utf8");
  dom.window.document.head.appendChild(styleEl);

  await import(pathToFileURL(resolveModuleEntryPath(html)).href);

  dom.window.document.dispatchEvent(
    new dom.window.Event("DOMContentLoaded", { bubbles: true, cancelable: false }),
  );

  // Let startup navigation settle.
  await settle();

  return dom;
}

// Flushes microtasks + pending timers up to the given real-time budget.
export async function settle(ms = 25) {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (ms > 0) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export async function waitFor(predicate, { timeoutMs = 3000, label = "condition" } = {}) {
  const startedAt = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await settle(10);
  }
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export const ADMIN_SKELETON_KEY = "test-skeleton-key";

export function seedBaseData() {
  seedDoc("admin/goodies", { skeletonKey: ADMIN_SKELETON_KEY });
}

export function seedCourt(courtId, overrides = {}) {
  const court = {
    name: courtId,
    password: "pw",
    status: "open",
    scoreVersion: 0,
    beaconSidesSwapped: false,
    scoringMode: "standard",
    scoringOptions: {
      scoringMode: "standard",
      deuceMode: "standard",
      tiebreakMode: "sixAllSeven",
    },
    teamNames: { A: "Team A", B: "Team B" },
    playerNames: { A1: "", A2: "", B1: "", B2: "" },
    ...overrides,
  };
  seedDoc(`courts/${courtId}`, court);
  return court;
}

export function pushScoreSnapshot(courtId, score) {
  writeDoc(`courts/${courtId}/score/current`, score);
}

export function makeScore(overrides = {}) {
  return {
    A: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    B: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    lastPointTeam: null,
    lastGameTeam: null,
    lastSetTeam: null,
    inTiebreak: false,
    deuceCycles: 0,
    matchComplete: false,
    completedSets: [],
    scoringOptions: {
      scoringMode: "standard",
      deuceMode: "standard",
      tiebreakMode: "sixAllSeven",
    },
    ...overrides,
  };
}

export async function joinCourtAsPlayer(document, courtId, password = "pw") {
  const playButton = [...document.querySelectorAll(".menu-btn")].find(
    (btn) => btn.textContent.trim() === "Play",
  );
  if (!playButton) throw new Error("Play menu button not found");
  playButton.click();

  await waitFor(() => document.querySelector(`#playCourtList [data-court-id="${courtId}"]`), {
    label: `court '${courtId}' in play list`,
  });

  document.querySelector(`#playCourtList [data-court-id="${courtId}"]`).click();
  await settle();

  document.getElementById("playCourtPassword").value = password;
  document.getElementById("enterCourtBtn").click();

  await waitFor(() => document.getElementById("scoreboardPage").style.display !== "none", {
    label: "scoreboard page to be shown",
  });
  await settle();
}

export function getRenderedScore(document) {
  return {
    pointsA: document.getElementById("pointsA").textContent,
    pointsB: document.getElementById("pointsB").textContent,
    gamesA: document.querySelectorAll("#gamesA .game-dot.filled").length,
    gamesB: document.querySelectorAll("#gamesB .game-dot.filled").length,
    setsA: document.querySelectorAll("#setsA .set-dot.filled").length,
    setsB: document.querySelectorAll("#setsB .set-dot.filled").length,
  };
}

export {
  firestoreState,
  resetFirestoreState,
  seedDoc,
  writeDoc,
  flushBackendWork,
  getBackendScore,
  callableHandlers,
};
