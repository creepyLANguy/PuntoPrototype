// Frontend integration tests: the match details view and its momentum panel.
// The momentum graph is fed by its own /momentum/{courtId} endpoint, so the details
// tables must render without waiting for it, and the momentum portion must
// stay hidden until a payload with actual points is in hand.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  seedBaseData,
  seedCourt,
  joinCourtAsPlayer,
  pushScoreSnapshot,
  makeScore,
  waitFor,
  settle,
  callableHandlers,
} from "./frontendHarness/harness.mjs";

const COURT_ID = "courtdetails";

let document;

// While set, every /momentum/ request parks on this gate so a test can inspect the
// view while the momentum payload is still pending.
let momentumGate = null;
let momentumRequests = [];
let momentumPayload = null;

// jsdom ships no canvas backend, so the graph gets a context that swallows
// every 2D call. The assertions are about the panel's states, not its pixels.
function makeNoopCanvasContext() {
  return new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === Symbol.toPrimitive) return () => 0;
        return () => makeNoopCanvasContext();
      },
      set: () => true,
    },
  );
}

function holdMomentumResponses() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  momentumGate = { promise, resolve };
}

function releaseMomentumResponses() {
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
      B: { pointsWon: 31, longestScoringStreak: 3 },
    },
    servePlayerStats: {},
    matchStats: { totalPoints: 71, deuceGames: 1 },
    scoringMode: "standard",
    deuceMode: "standard",
  },
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
  matchComplete: false,
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
  matchComplete: false,
};

test.before(async () => {
  seedBaseData();
  seedCourt(COURT_ID, { teamNames: { A: "Smashers", B: "Lobbers" } });

  const dom = await bootFrontend();
  const window = dom.window;
  document = window.document;

  window.HTMLCanvasElement.prototype.getContext = () => makeNoopCanvasContext();
  window.Path2D = function Path2D() {
    return makeNoopCanvasContext();
  };
  globalThis.Path2D = window.Path2D;

  momentumPayload = PLAYED_MOMENTUM;

  // The details tables come from the callable; the momentum streams never do.
  callableHandlers.set("getDetailedScore", async () => ({ data: DETAILED_SCORE }));

  const baseFetch = window.fetch;
  const momentumFetch = async (url, options) => {
    if (!String(url).includes("/momentum/")) {
      return baseFetch(url, options);
    }

    momentumRequests.push(String(url));

    if (momentumGate) {
      await momentumGate.promise;
    }

    return {
      ok: true,
      status: 200,
      json: async () => momentumPayload,
    };
  };

  window.fetch = momentumFetch;
  globalThis.fetch = momentumFetch;

  await joinCourtAsPlayer(document, COURT_ID);
  pushScoreSnapshot(
    COURT_ID,
    makeScore({
      A: { points: 2, games: 2, sets: 1, totalPoints: 40 },
      B: { points: 1, games: 1, sets: 0, totalPoints: 31 },
      completedSets: [{ A: 6, B: 4, tiebreakPoints: null }],
    }),
  );
  await settle();
});

test("the details tables render while the momentum payload is still in flight", async () => {
  holdMomentumResponses();
  momentumRequests = [];

  document.getElementById("detailsBtn").click();

  // The set breakdown does not wait for the momentum endpoint.
  await waitFor(() => document.querySelectorAll("#dmBody tr").length === 2, {
    label: "set breakdown rows",
  });
  assert.equal(document.getElementById("detailsSetsA").textContent, "1");
  assert.equal(document.getElementById("detailsSetsB").textContent, "0");
  assert.equal(document.getElementById("detailsLoading").classList.contains("hidden"), true);

  assert.equal(momentumRequests.length, 1, "momentum is fetched exactly once per open");
  assert.match(momentumRequests[0], new RegExp(`/momentum/match/m-${COURT_ID}$`));
});

test("stat columns are fitted when the detailed panel is expanded after rendering", async () => {
  DETAILED_SCORE.playerNames = {
    A1: "Very Long Player Name",
    A2: "",
    B1: "Another Very Long Player Name",
    B2: "",
  };

  // Open again with the panel collapsed. The render-time fit is expected to see
  // a hidden parent and therefore cannot measure it; expansion must schedule the
  // real measurement after the hidden attribute is removed.
  document.getElementById("detailsBtn").click();

  await waitFor(() => document.querySelector("#dmStatsTeam .dm-stats-table") !== null, {
    label: "stats table for fit test",
  });

  const table = document.querySelector("#dmStatsTeam .dm-stats-table");
  table.getBoundingClientRect = () => ({
    width: 300,
    height: 0,
    top: 0,
    left: 0,
    right: 300,
    bottom: 0,
  });

  const primaryContents = Array.from(
    table.querySelectorAll("tbody .dm-st-val:nth-child(2) .dm-st-value-content"),
  );
  const secondaryContents = Array.from(
    table.querySelectorAll("tbody .dm-st-val:nth-child(3) .dm-st-value-content"),
  );

  primaryContents.forEach((content) => {
    content.getBoundingClientRect = () => ({
      width: 108,
      height: 0,
      top: 0,
      left: 0,
      right: 108,
      bottom: 0,
    });
  });
  secondaryContents.forEach((content) => {
    content.getBoundingClientRect = () => ({
      width: 132,
      height: 0,
      top: 0,
      left: 0,
      right: 132,
      bottom: 0,
    });
  });

  document.getElementById("dmDetailsToggle").click();
  await settle();

  assert.equal(document.getElementById("dmDetailsContent").hidden, false);
  assert.ok(
    Number.parseFloat(table.style.getPropertyValue("--dm-st-secondary-width")) > 36,
    "the overflowing secondary column should receive extra width after expansion",
  );
  assert.ok(
    Number.parseFloat(table.style.getPropertyValue("--dm-st-label-width")) < 28,
    "the label column should give up only the required space",
  );
});

test("the momentum portion stays hidden until its payload arrives", async () => {
  assert.equal(
    document.getElementById("dmMomentumWrap").classList.contains("hidden"),
    true,
    "no momentum heading should appear while the payload is still pending",
  );

  // The rest of the expanded details is already usable in the meantime.
  assert.equal(document.getElementById("dmStatsWrap").classList.contains("hidden"), false);

  releaseMomentumResponses();

  await waitFor(() => !document.getElementById("dmMomentumWrap").classList.contains("hidden"), {
    label: "momentum panel to appear with its graph",
  });

  assert.equal(
    document.getElementById("dmMomentumCanvas").classList.contains("hidden"),
    false,
    "the panel appears with the canvas already showing",
  );
});

test("long final-column stats values tighten the label column just enough", async () => {
  const table = document.querySelector("#dmStatsTeam .dm-stats-table");
  assert.ok(table, "stats table should be rendered");

  const window = document.defaultView;
  table.getBoundingClientRect = () => ({ width: 300 });

  const primaryCells = Array.from(table.querySelectorAll("tbody .dm-st-val:nth-child(2)"));
  const secondaryCells = Array.from(table.querySelectorAll("tbody .dm-st-val:nth-child(3)"));

  primaryCells.forEach((cell) => {
    Object.defineProperty(cell, "scrollWidth", { configurable: true, value: 108 });
  });
  secondaryCells.forEach((cell) => {
    Object.defineProperty(cell, "scrollWidth", { configurable: true, value: 125 });
  });

  window.dispatchEvent(new window.Event("resize"));

  assert.equal(table.style.getPropertyValue("--dm-st-primary-width"), "36%");
  assert.ok(
    Number.parseFloat(table.style.getPropertyValue("--dm-st-secondary-width")) > 36,
    "the overflowing final column should receive the extra width",
  );
  assert.ok(
    Number.parseFloat(table.style.getPropertyValue("--dm-st-label-width")) < 28,
    "the label column should surrender only the required space",
  );
});

test("serve statistics appear only when serving is valid, preserving legitimate 0/0 values", async () => {
  const scenarios = [
    {
      name: "standard scoring",
      scoringMode: "standard",
      scoringOptions: {
        scoringMode: "standard",
        deuceMode: "standard",
        tiebreakMode: "sixAllSeven",
      },
      expectServeStats: true,
    },
    {
      name: "straight points",
      scoringMode: "straight",
      scoringOptions: {
        scoringMode: "straight",
        deuceMode: "standard",
        tiebreakMode: "sixAllSeven",
      },
      expectServeStats: false,
    },
    {
      name: "tiebreak tens",
      scoringMode: "tiebreakTen",
      scoringOptions: {
        scoringMode: "tiebreakTen",
        deuceMode: "standard",
        tiebreakMode: "off",
      },
      expectServeStats: true,
    },
    {
      name: "fixed total points with serving enabled",
      scoringMode: "fixedTotalPoints",
      scoringOptions: {
        scoringMode: "fixedTotalPoints",
        deuceMode: "standard",
        tiebreakMode: "off",
        pointsTarget: 36,
        serving: {
          enabled: true,
          order: ["A1", "B1", "A2", "B2"],
          serveBlockLength: 1,
          sideSwapRule: "after_all_players_serve_once",
        },
      },
      expectServeStats: true,
    },
    {
      name: "fixed total points with serving disabled",
      scoringMode: "fixedTotalPoints",
      scoringOptions: {
        scoringMode: "fixedTotalPoints",
        deuceMode: "standard",
        tiebreakMode: "off",
        pointsTarget: 36,
        serving: {
          enabled: false,
          order: ["A1", "B1", "A2", "B2"],
          serveBlockLength: 1,
          sideSwapRule: "after_all_players_serve_once",
        },
      },
      expectServeStats: false,
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    DETAILED_SCORE.scoringMode = scenario.scoringMode;
    DETAILED_SCORE.scoringOptions = scenario.scoringOptions;
    DETAILED_SCORE.advancedStats.scoringMode = scenario.scoringMode;
    DETAILED_SCORE.advancedStats.deuceMode = scenario.scoringOptions.deuceMode;
    DETAILED_SCORE.advancedStats.servePlayerStats = {
      A1: { pointsServed: 1, pointsWonOnServe: 1, serveWinPct: 100 },
      A2: { pointsServed: 0, pointsWonOnServe: 0, serveWinPct: 0 },
      B1: { pointsServed: 0, pointsWonOnServe: 0, serveWinPct: 0 },
      B2: { pointsServed: 0, pointsWonOnServe: 0, serveWinPct: 0 },
    };

    const pointCount = index + 2;
    DETAILED_SCORE.points = { A: pointCount, B: 1 };
    DETAILED_SCORE.currentGames = {
      A: scenario.scoringMode === "standard" ? 1 : 0,
      B: 0,
    };
    DETAILED_SCORE.advancedStats.matchStats.totalPoints = pointCount + 1;
    DETAILED_SCORE.advancedStats.teamStats.A.pointsWon = pointCount;
    DETAILED_SCORE.advancedStats.teamStats.B.pointsWon = 1;

    pushScoreSnapshot(
      COURT_ID,
      makeScore({
        A: {
          points: pointCount,
          games: scenario.scoringMode === "standard" ? 1 : 0,
          sets: 0,
          totalPoints: pointCount,
        },
        B: { points: 1, games: 0, sets: 0, totalPoints: 1 },
      }),
    );

    document.getElementById("detailsBtn").click();

    await waitFor(
      () => document.querySelector("#dmStatsTeam .dm-stats-table"),
      { label: `${scenario.name} stats table` },
    );

    const statsTable = document.querySelector("#dmStatsTeam .dm-stats-table");
    assert.ok(statsTable, `${scenario.name}: stats table should render`);

    const serveHeader = Array.from(
      statsTable.querySelectorAll(".dm-st-section-hdr"),
    ).find((row) => row.textContent.trim() === "On Serve");

    assert.equal(
      Boolean(serveHeader),
      scenario.expectServeStats,
      `${scenario.name}: serve section applicability`,
    );

    if (scenario.expectServeStats) {
      const firstServeRow = serveHeader.nextElementSibling;
      const secondServeRow = firstServeRow?.nextElementSibling;

      assert.ok(firstServeRow, `${scenario.name}: Player 1 serve row should exist`);
      assert.ok(secondServeRow, `${scenario.name}: Player 2 serve row should exist`);
      assert.match(firstServeRow.textContent, /0\/0 \(0%\)/,
        `${scenario.name}: an unserved Player 1 slot should show 0/0 (0%)`);
      assert.match(secondServeRow.textContent, /0\/0 \(0%\)/,
        `${scenario.name}: unserved Player 2 slots should show 0/0 (0%)`);
      assert.match(firstServeRow.textContent, /1\/1 \(100%\)/,
        `${scenario.name}: the player who has served must show actual serve statistics`);
    } else {
      assert.doesNotMatch(
        statsTable.textContent,
        /On Serve/,
        `${scenario.name}: no On Serve section should be rendered`,
      );
    }
  }
});
test("a match with no momentum data keeps the panel hidden", async () => {
  momentumPayload = EMPTY_MOMENTUM;
  momentumRequests = [];

  // A new point invalidates the cached details and momentum, so the open modal
  // refreshes both from scratch.
  pushScoreSnapshot(
    COURT_ID,
    makeScore({
      A: { points: 3, games: 2, sets: 1, totalPoints: 41 },
      B: { points: 1, games: 1, sets: 0, totalPoints: 31 },
      completedSets: [{ A: 6, B: 4, tiebreakPoints: null }],
    }),
  );

  await waitFor(() => momentumRequests.length > 0, { label: "momentum refetch after a new point" });
  await waitFor(() => document.getElementById("dmMomentumWrap").classList.contains("hidden"), {
    label: "momentum panel to close for an empty timeline",
  });
});
