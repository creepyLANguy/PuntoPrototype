// Frontend integration tests: the OBS score overlay (app/overlay.html).
// Boots the real page in jsdom with the public score APIs stubbed, and covers
// the parts with logic behind them: the shared stats/momentum scale and width
// knobs, the legacy setting rename, and the momentum card's data source and
// loading / graph / unavailable states.
import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const overlayPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "app",
  "overlay.html"
);

const COURT_ID = "bnrm";
const STORAGE_KEY = "padelPushOverlaySettings:" + COURT_ID;

const SCORE_PAYLOAD = {
  success: true,
  courtId: COURT_ID,
  revision: "rev-1",
  teamNames: { A: "Smashers", B: "Lobbers" },
  playerNames: { A1: "Ann", A2: "Al", B1: "Bo", B2: "Bea" },
  scoringOptions: { scoringMode: "standard", deuceMode: "standard", tiebreakMode: "sixAllSeven" },
  scoringMode: "standard",
  teams: {
    A: { sets: 0, games: 1, points: 2, pointsDisplay: "30" },
    B: { sets: 0, games: 0, points: 1, pointsDisplay: "15" }
  },
  completedSets: [],
  inTiebreak: false,
  deuceCycles: 0,
  matchComplete: false,
  server: "A1",
  scoreVersion: 0
};

const MOMENTUM_PAYLOAD = {
  success: true,
  courtId: COURT_ID,
  pointHistory: ["A", "A", "B", "A", "A", "B"],
  momentumTimeline: [13.2, 26.8, 27.1, 32.3, 52.4, 51],
  setPointMarkers: [],
  gameMarkers: [5],
  totalPoints: 6,
  scoringMode: "standard",
  matchComplete: false
};

// jsdom ships no canvas backend, so the graph draws into a context that
// swallows every call. These tests are about the card's states, not its pixels.
function makeNoopCanvasContext()
{
  return new Proxy({}, {
    get: (_target, prop) =>
    {
      if (prop === Symbol.toPrimitive) return () => 0;
      return () => makeNoopCanvasContext();
    },
    set: () => true
  });
}

// Booted per test: the overlay reads localStorage and the query string once at
// startup, so each scenario needs its own page.
async function bootOverlay({ search = "", stored = null, momentumResponse = "ok" } = {})
{
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (err) => errors.push("jsdomError: " + err.message));

  const requested = [];
  let releaseMomentum = null;

  const dom = new JSDOM(readFileSync(overlayPath, "utf8"), {
    url: "https://padel.test/b/" + COURT_ID + search,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window)
    {
      if (stored)
      {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      }

      window.HTMLCanvasElement.prototype.getContext = () => makeNoopCanvasContext();
      window.Path2D = function Path2D() { return makeNoopCanvasContext(); };

      window.fetch = async (url) =>
      {
        const target = String(url);
        requested.push(target);

        if (!target.includes("/m/"))
        {
          return { ok: true, status: 200, json: async () => SCORE_PAYLOAD };
        }

        if (releaseMomentum)
        {
          await new Promise((resolve) => { releaseMomentum = resolve; });
        }

        if (momentumResponse === "html")
        {
          // What an undeployed hosting rewrite actually returns: a 200 with the
          // SPA's index.html, which json() cannot parse.
          return {
            ok: true,
            status: 200,
            json: async () => { throw new SyntaxError("Unexpected token <"); }
          };
        }

        return { ok: true, status: 200, json: async () => MOMENTUM_PAYLOAD };
      };
    }
  });

  await settle(50);

  return {
    dom,
    window: dom.window,
    errors,
    requested,
    $: (id) => dom.window.document.getElementById(id),
    holdMomentum: () => { releaseMomentum = () => {}; },
    releaseMomentum: () =>
    {
      const resolve = releaseMomentum;
      releaseMomentum = null;
      resolve();
    }
  };
}

function settle(ms = 30)
{
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cssVar(window, name)
{
  return window.document.documentElement.style.getPropertyValue(name);
}

test("one slider drives the scale of both the stat and momentum cards", async () =>
{
  const page = await bootOverlay();

  assert.equal(page.$("setMomentumScale"), null, "the momentum-only slider is gone");
  assert.ok(page.$("setStatsScale"), "a shared scale slider is present");

  const slider = page.$("setStatsScale");
  slider.value = "1.5";
  slider.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await settle();

  assert.equal(cssVar(page.window, "--ov-stats-scale"), "1.5");
  assert.equal(page.$("statsScaleValue").textContent, "150%");

  // Both cards resolve their type size from the same variable.
  const overlayCss = readFileSync(overlayPath, "utf8");
  ["\\.stat-card \\{", "\\.momentum-card \\{"].forEach((selector) =>
  {
    const block = new RegExp(selector + "[^}]*}").exec(overlayCss)[0];
    assert.match(block, /--ov-stats-scale/, selector + " uses the shared scale");
    assert.match(block, /--ov-stats-width/, selector + " uses the shared width");
  });

  page.dom.window.close();
});

test("the width slider drives both cards and persists", async () =>
{
  const page = await bootOverlay();

  const slider = page.$("setStatsWidth");
  assert.ok(slider, "a shared width slider is present");

  slider.value = "0.75";
  slider.dispatchEvent(new page.window.Event("input", { bubbles: true }));
  await settle();

  assert.equal(cssVar(page.window, "--ov-stats-width"), "0.75");
  assert.equal(page.$("statsWidthValue").textContent, "75%");

  const stored = JSON.parse(page.window.localStorage.getItem(STORAGE_KEY));
  assert.equal(stored.statsWidth, 0.75);

  page.dom.window.close();
});

test("a stored momentumScale is adopted as statsScale", async () =>
{
  const page = await bootOverlay({ stored: { momentumScale: 1.4 } });

  assert.equal(cssVar(page.window, "--ov-stats-scale"), "1.4");
  assert.equal(page.$("setStatsScale").value, "1.4");

  const stored = JSON.parse(page.window.localStorage.getItem(STORAGE_KEY) || "{}");
  assert.equal(stored.momentumScale, undefined, "the legacy key is not written back");

  page.dom.window.close();
});

test("a momentumScale share URL still applies", async () =>
{
  const page = await bootOverlay({ search: "?momentumScale=0.8" });

  assert.equal(cssVar(page.window, "--ov-stats-scale"), "0.8");

  page.dom.window.close();
});

test("the momentum card loads from /m/{courtId} and swaps the loader for the graph", async () =>
{
  const page = await bootOverlay();
  page.holdMomentum();

  page.$("momentumBtn").dispatchEvent(new page.window.Event("click", { bubbles: true }));

  assert.equal(page.$("momentumCard").classList.contains("hidden"), false,
    "the card is on screen before the request resolves");
  assert.equal(page.$("momentumLoading").classList.contains("hidden"), false,
    "the loader runs while the payload is pending");
  assert.equal(page.$("momentumCanvas").classList.contains("hidden"), true,
    "the canvas stays hidden while the payload is pending");

  page.releaseMomentum();
  await settle();

  assert.equal(page.$("momentumLoading").classList.contains("hidden"), true);
  assert.equal(page.$("momentumCanvas").classList.contains("hidden"), false);
  assert.equal(page.$("momentumMessage").classList.contains("hidden"), true);

  assert.ok(
    page.requested.some((url) => url.endsWith("/m/" + COURT_ID)),
    "momentum came from the momentum endpoint, saw: " + JSON.stringify(page.requested)
  );
  assert.ok(
    !page.requested.some((url) => url.includes("/s/")),
    "the stats endpoint is not used for momentum"
  );

  assert.deepEqual(page.errors, []);
  page.dom.window.close();
});

test("an undeployed momentum endpoint says so instead of showing an empty card", async () =>
{
  const page = await bootOverlay({ momentumResponse: "html" });

  page.$("momentumBtn").dispatchEvent(new page.window.Event("click", { bubbles: true }));
  await settle(60);

  assert.equal(page.$("momentumCard").classList.contains("hidden"), false,
    "the card stays up so the failure is visible");
  assert.equal(page.$("momentumMessage").classList.contains("hidden"), false);
  assert.equal(page.$("momentumMessage").textContent, "Momentum unavailable.");
  assert.equal(page.$("momentumLoading").classList.contains("hidden"), true);
  assert.equal(page.$("momentumCanvas").classList.contains("hidden"), true);

  page.dom.window.close();
});
