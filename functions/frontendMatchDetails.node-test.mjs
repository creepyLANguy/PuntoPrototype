// Frontend integration tests: the match details view and its momentum panel.
// The momentum graph is fed by its own /m/{courtId} endpoint, so the details
// tables must render without waiting for it, and the panel must show the
// loading animation until the momentum payload lands.
import assert from "node:assert/strict";
import test from "node:test";

import
{
  bootFrontend,
  seedBaseData,
  seedCourt,
  joinCourtAsPlayer,
  pushScoreSnapshot,
  makeScore,
  waitFor,
  settle,
  callableHandlers
} from "./frontendHarness/harness.mjs";

const COURT_ID = "courtdetails";

let document;

// While set, every /m/ request parks on this gate so a test can inspect the
// loading state before the payload arrives.
let momentumGate = null;
let momentumRequests = [];
let momentumPayload = null;

// jsdom ships no canvas backend, so the graph gets a context that swallows
// every 2D call. The assertions are about the panel's states, not its pixels.
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

function holdMomentumResponses()
{
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  momentumGate = { promise, resolve };
}

function releaseMomentumResponses()
{
  const gate = momentumGate;
  momentumGate = null;
  gate.resolve();
}

const DETAILED_SCORE = {
  sets: [{ A: 6, B: 4, tiebreakPoints: null }],
  currentGames: { A: 2, B: 1 },
  points: { A: 2, B: 1 },
  setsA: 1,
  setsB: 0,
  scoringMode: "standard",
  matchComplete: false,
  playerNames: { A1: "", A2: "", B1: "", B2: "" },
  advancedStats: {
    teamStats: {
      A: { pointsWon: 40, longestScoringStreak: 4 },
      B: { pointsWon: 31, longestScoringStreak: 3 }
    },
    servePlayerStats: {},
    matchStats: { totalPoints: 71, deuceGames: 1 },
    scoringMode: "standard",
    deuceMode: "standard"
  }
};

const PLAYED_MOMENTUM = {
  success: true,
  courtId: COURT_ID,
  pointHistory: ["A", "B", "A", "A", "B", "A"],
  momentumTimeline: [10, 2, 13, 24, 15, 27],
  setPointMarkers: [],
  gameMarkers: [6],
  totalPoints: 6,
  scoringMode: "standard",
  matchComplete: false
};

const EMPTY_MOMENTUM = {
  success: true,
  courtId: COURT_ID,
  pointHistory: [],
  momentumTimeline: [],
  setPointMarkers: [],
  gameMarkers: [],
  totalPoints: 0,
  scoringMode: "standard",
  matchComplete: false
};

test.before(async () =>
{
  seedBaseData();
  seedCourt(COURT_ID, { teamNames: { A: "Smashers", B: "Lobbers" } });

  const dom = await bootFrontend();
  const window = dom.window;
  document = window.document;

  window.HTMLCanvasElement.prototype.getContext = () => makeNoopCanvasContext();
  window.Path2D = function Path2D() { return makeNoopCanvasContext(); };
  globalThis.Path2D = window.Path2D;

  momentumPayload = PLAYED_MOMENTUM;

  // The details tables come from the callable; the momentum streams never do.
  callableHandlers.set("getDetailedScore", async () => ({ data: DETAILED_SCORE }));

  const baseFetch = window.fetch;
  const momentumFetch = async (url, options) =>
  {
    if (!String(url).includes("/m/"))
    {
      return baseFetch(url, options);
    }

    momentumRequests.push(String(url));

    if (momentumGate)
    {
      await momentumGate.promise;
    }

    return {
      ok: true,
      status: 200,
      json: async () => momentumPayload
    };
  };

  window.fetch = momentumFetch;
  globalThis.fetch = momentumFetch;

  await joinCourtAsPlayer(document, COURT_ID);
  pushScoreSnapshot(COURT_ID, makeScore({
    A: { points: 2, games: 2, sets: 1, totalPoints: 40 },
    B: { points: 1, games: 1, sets: 0, totalPoints: 31 },
    completedSets: [{ A: 6, B: 4, tiebreakPoints: null }]
  }));
  await settle();
});

test("the details tables render while the momentum payload is still in flight", async () =>
{
  holdMomentumResponses();
  momentumRequests = [];

  document.getElementById("detailsBtn").click();

  // The set breakdown does not wait for the momentum endpoint.
  await waitFor(
    () => document.querySelectorAll("#dmBody tr").length === 2,
    { label: "set breakdown rows" }
  );
  assert.equal(document.getElementById("detailsSetsA").textContent, "1");
  assert.equal(document.getElementById("detailsSetsB").textContent, "0");
  assert.equal(document.getElementById("detailsLoading").classList.contains("hidden"), true);

  assert.equal(momentumRequests.length, 1, "momentum is fetched exactly once per open");
  assert.match(momentumRequests[0], new RegExp(`/m/${COURT_ID}$`));
});

test("the momentum panel shows the loading animation until its payload arrives", async () =>
{
  assert.equal(
    document.getElementById("dmMomentumWrap").classList.contains("hidden"),
    false,
    "the momentum panel should be on screen while it loads"
  );
  assert.equal(
    document.getElementById("dmMomentumLoading").classList.contains("hidden"),
    false,
    "the loader should be visible while the momentum payload is pending"
  );
  assert.equal(
    document.getElementById("dmMomentumCanvas").classList.contains("hidden"),
    true,
    "the canvas should stay hidden while the momentum payload is pending"
  );

  releaseMomentumResponses();

  await waitFor(
    () => document.getElementById("dmMomentumLoading").classList.contains("hidden"),
    { label: "momentum loader to clear" }
  );

  assert.equal(
    document.getElementById("dmMomentumCanvas").classList.contains("hidden"),
    false,
    "the canvas should be visible once the graph has been drawn"
  );
  assert.equal(document.getElementById("dmMomentumWrap").classList.contains("hidden"), false);
});

test("a match with no momentum data hides the panel instead of leaving the loader up", async () =>
{
  momentumPayload = EMPTY_MOMENTUM;
  momentumRequests = [];

  // A new point invalidates the cached details and momentum, so the open modal
  // refreshes both from scratch.
  pushScoreSnapshot(COURT_ID, makeScore({
    A: { points: 3, games: 2, sets: 1, totalPoints: 41 },
    B: { points: 1, games: 1, sets: 0, totalPoints: 31 },
    completedSets: [{ A: 6, B: 4, tiebreakPoints: null }]
  }));

  await waitFor(
    () => momentumRequests.length > 0,
    { label: "momentum refetch after a new point" }
  );
  await waitFor(
    () => document.getElementById("dmMomentumWrap").classList.contains("hidden"),
    { label: "momentum panel to close for an empty timeline" }
  );

  assert.equal(document.getElementById("dmMomentumLoading").classList.contains("hidden"), true);
});
