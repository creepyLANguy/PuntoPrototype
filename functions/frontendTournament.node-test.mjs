// Frontend tests for the tournament and match pages (spec section 66.3): the
// club-first court picker, format settings, discovery search ranking, and the
// public dashboard, host control room and match page rendered from a real
// server-built read model.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const { getFormat } = require("./domain/tournaments");
const { buildTournamentView } = require("./domain/tournaments/view");

const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "https://padel.test/t/abcdef" });
for (const name of ["window", "document", "Node", "HTMLElement", "Event"]) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });

const { orderCourtCandidates, reconcileSelection, renderCourtPicker } =
  await import("../app/js/tournament/courtPicker.js");
const { buildFormatConfig, defaultFieldValues, parseTeamLines } =
  await import("../app/js/tournament/formatCatalog.js");
const { searchCourts, searchMatchesAndTournaments, SEARCH_PLACEHOLDER } =
  await import("../app/js/match/discoverySearch.js");
const { renderPublicDashboard } = await import("../app/js/tournament/publicView.js");
const { renderHostDashboard } = await import("../app/js/tournament/hostView.js");
const { renderMatchNotFound, renderMatchPage } = await import("../app/js/match/matchView.js");
const { resolveMatchTitle } = await import("../app/js/match/matchIdentity.js");

const COURTS = [
  { courtId: "c4", name: "Court 4", status: "closed", clubId: "club1" },
  { courtId: "c3", name: "Court 3", status: "open", clubId: null },
  { courtId: "c2", name: "Court 2", status: "open", clubId: "club1" },
  { courtId: "c1", name: "Court 1", status: "open", clubId: "club1" },
  { courtId: "c9", name: "Court 9", status: "open", clubId: "club2" },
];

test("club courts are surfaced first, then other courts, then unavailable ones", () => {
  const ordered = orderCourtCandidates(COURTS, { clubId: "club1" });
  assert.deepEqual(
    ordered.map((court) => court.courtId),
    ["c1", "c2", "c3", "c9", "c4"],
  );
  assert.deepEqual(
    ordered.map((court) => court.group),
    ["club", "club", "other", "other", "unavailable"],
  );
  assert.equal(
    ordered.some((court) => court.selected),
    false,
    "choosing a club never selects courts",
  );
});

test("without a club every open court is equally eligible", () => {
  const ordered = orderCourtCandidates(COURTS, {});
  assert.deepEqual(
    ordered.map((court) => court.group),
    ["other", "other", "other", "other", "unavailable"],
  );
});

test("changing the club re-ranks courts and keeps explicit selections", () => {
  const selected = ["c9", "c3"];
  const ranked = orderCourtCandidates(COURTS, { clubId: "club1", selectedCourtIds: selected });
  assert.deepEqual(
    ranked.filter((court) => court.selected).map((court) => court.courtId),
    ["c3", "c9"],
  );
  assert.deepEqual(reconcileSelection([...selected, "gone"], COURTS), ["c9", "c3"]);
});

test("the court picker labels the selected club's group and courts outside it stay selectable", () => {
  const container = document.createElement("div");
  let changed = null;
  renderCourtPicker(container, {
    courts: COURTS,
    clubId: "club1",
    clubName: "Example Padel Club",
    selectedCourtIds: ["c3"],
    onChange: (next) => {
      changed = next;
    },
  });
  const legends = [...container.querySelectorAll("legend")].map((legend) => legend.textContent);
  assert.deepEqual(legends, ["Example Padel Club courts", "Other courts", "Unavailable"]);
  assert.equal(container.querySelector('input[data-court-id="c3"]').checked, true);

  const outside = container.querySelector('input[data-court-id="c9"]');
  outside.checked = true;
  outside.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(changed, ["c3", "c9"]);
});

test("format settings become a nested configuration with only relevant options", () => {
  const americano = buildFormatConfig("americano", {
    ...defaultFieldValues("americano"),
    "scoring.pointsTarget": "32",
  });
  assert.equal(americano.scoring.pointsTarget, 32);
  assert.equal(americano.scoring.servesPerPlayer, 4);

  const league = buildFormatConfig("roundRobin", {
    ...defaultFieldValues("roundRobin"),
    "scoring.scoringMode": "straight",
  });
  assert.equal(league.scoring.scoringMode, "straight");
  assert.equal(league.scoring.deuceMode, undefined, "deuce only applies to games and sets");

  assert.deepEqual(parseTeamLines("Tigers: Ann & Bo\nCy / Di"), [
    { name: "Tigers", players: ["Ann", "Bo"] },
    { name: "", players: ["Cy", "Di"] },
  ]);
});

test("discovery search ranks exact ids first and finds players, matches and tournaments", () => {
  assert.equal(SEARCH_PLACEHOLDER, "Search courts, clubs, matches, players or tournaments");
  const courts = [
    { id: "abcd", name: "Centre Court", match: null },
    {
      id: "efgh",
      name: "Court 2",
      match: {
        matchId: "m1234567",
        name: "Friday Night Final",
        playerNames: { A1: "Alice", A2: "Ben", B1: "", B2: "" },
        teamNames: { A: "Team A", B: "Team B" },
      },
    },
  ];
  assert.deepEqual(
    searchCourts(courts, "alice").map((court) => court.id),
    ["efgh"],
  );
  assert.deepEqual(
    searchCourts(courts, "abcd").map((court) => court.id),
    ["abcd"],
  );

  const results = searchMatchesAndTournaments(
    {
      matches: [
        {
          matchId: "m1234567",
          name: "Friday Night Final",
          status: "live",
          courtName: "Court 2",
          teamNames: { A: "Team A", B: "Team B" },
          playerNames: { A1: "Alice", A2: "Ben", B1: "Sam", B2: "Dave" },
        },
      ],
      tournaments: [{ tournamentId: "friday", name: "Friday Social", status: "live" }],
    },
    "friday",
  );
  assert.equal(results[0].kind, "tournament", "an exact tournament id outranks substrings");
  assert.equal(results[1].label, "Friday Night Final");
  assert.ok(results[1].lines.includes("Court: Court 2"));
  assert.ok(results[1].lines.includes("LIVE - Match m1234567"));
});

// ---------------------------------------------------------------------------
// Dashboards rendered from a server-built read model
// ---------------------------------------------------------------------------

function americanoState() {
  const participants = ["Alice", "Ben", "Chris", "Dan", "Eva", "Finn", "Gina", "Hugo", "Iris"].map(
    (displayName, index) => ({
      participantId: `p${index + 1}`,
      displayName,
      shortName: displayName,
      seed: null,
      status: "active",
    }),
  );
  const tournament = {
    tournamentId: "abcdef",
    name: "Friday Night Padel Social",
    description: "",
    status: "live",
    visibility: "public",
    participantMode: "individual",
    format: { id: "americano", version: 1, config: getFormat("americano").normalizeConfig({}) },
    courtPool: ["c1", "c2"],
    scheduling: { timezone: "UTC", startAt: null, defaultMatchDurationMinutes: 15 },
  };
  const state = {
    tournament,
    participants,
    teams: [],
    rounds: [],
    fixtures: [],
    generationSeed: "abcdef",
  };
  const generation = getFormat("americano").generateInitialRound(state);
  const fixtures = generation.fixtures.map((fixture, index) => ({
    ...fixture,
    matchId: `m${index + 1}`,
    courtId: index === 0 ? "c1" : "c2",
  }));
  fixtures[0] = {
    ...fixtures[0],
    status: "completed",
    resultSnapshot: {
      winner: "A",
      points: { A: 19, B: 17 },
      games: { A: 0, B: 0 },
      sets: { A: 1, B: 0 },
      scoringMode: "fixedTotalPoints",
    },
  };
  fixtures[1] = { ...fixtures[1], status: "live" };
  return { tournament, participants, rounds: generation.rounds, fixtures };
}

function buildView() {
  const state = americanoState();
  return buildTournamentView({
    ...state,
    teams: [],
    matches: [
      {
        matchId: "m2",
        status: "live",
        currentCourtId: "c2",
        name: "Round 1 - Match 2",
        scoreSummary: {
          A: { points: 12, games: 0, sets: 0 },
          B: { points: 9, games: 0, sets: 0 },
          scoringMode: "fixedTotalPoints",
        },
      },
    ],
    courts: [
      { courtId: "c1", name: "Court 1", status: "open" },
      { courtId: "c2", name: "Court 2", status: "open", activeMatchId: "m2" },
    ],
    club: { clubId: "club1", name: "Example Padel Club" },
    now: Date.now(),
  });
}

test("the public dashboard shows identity, live matches, round, sitting out, standings and rules", () => {
  const view = buildView();
  const page = renderPublicDashboard(view, new Map());
  const text = page.textContent;

  assert.match(text, /Friday Night Padel Social/);
  assert.match(text, /Example Padel Club - Americano/);
  assert.ok(page.querySelector(".fx-card.fx-live"), "live match card");
  assert.match(text, /Live now/);
  assert.match(text, /Round 1/);
  assert.match(text, /SITTING OUT/);
  assert.match(text, /36 total points/);
  assert.match(text, /4 serves per player/);
  assert.match(text, /Swap sides after each player serves once/);

  const headers = [...page.querySelectorAll(".standings-table th")].map((th) => th.textContent);
  assert.deepEqual(headers.slice(0, 4), ["#", "Player", "Rounds", "Points"]);
  assert.ok(!headers.includes("W"), "social formats do not show win/loss columns");
  const top = page.querySelector(".standings-table tbody tr");
  assert.match(top.textContent, /19/);

  const liveLink = page.querySelector('.fx-live a[href="/m/m2"]');
  assert.ok(liveLink, "live cards link to the durable match page");
});

test("live points update the card score from the live match listener", () => {
  const view = buildView();
  const live = new Map([
    [
      "m2",
      {
        scoreSummary: {
          A: { points: 20, games: 0, sets: 0 },
          B: { points: 10, games: 0, sets: 0 },
          scoringMode: "fixedTotalPoints",
        },
      },
    ],
  ]);
  const page = renderPublicDashboard(view, live);
  const scores = [...page.querySelectorAll(".fx-live .fx-side-score")].map((el) => el.textContent);
  assert.deepEqual(scores.slice(0, 2), ["20", "10"]);
});

test("the host control room shows KPIs, primary controls and inline court operations", () => {
  const view = { ...buildView(), revision: 4 };
  const page = renderHostDashboard({
    view,
    liveMatches: new Map(),
    isHost: true,
    hostKey: "secret-key",
    accessCode: null,
    courtOptions: [],
    clubs: [],
    statusArea: document.createElement("div"),
    run: () => {},
    confirmRun: () => {},
    finishTournament: () => {},
    cancelTournament: () => {},
  });
  const text = page.textContent;
  assert.match(text, /Control room/);
  assert.match(text, /Current round/);
  assert.match(text, /Courts free/);
  const buttons = [...page.querySelectorAll("button")].map((button) => button.textContent);
  assert.ok(buttons.includes("Generate Round 2"));
  assert.ok(
    page.querySelector("button[disabled]")?.textContent === "Generate Round 2",
    "the next round waits for the current round",
  );
  assert.ok(buttons.includes("Move"));
  assert.ok(buttons.includes("Complete"));
  assert.ok(text.includes("Correct result"));
  assert.match(page.querySelector(".host-link").textContent, /\/t\/abcdef\?host=secret-key$/);
});

test("the match page puts the match name first and the court second", () => {
  const container = document.createElement("div");
  renderMatchPage(container, {
    matchId: "k3h8fq2a",
    match: {
      name: "Friday Night Final",
      status: "live",
      currentCourtId: "c7",
      teamNames: { A: "John & Mike", B: "Sam & Dave" },
      playerNames: { A1: "John", A2: "Mike", B1: "Sam", B2: "Dave" },
      scoringOptions: { scoringMode: "standard", deuceMode: "golden", tiebreakMode: "sixAllSeven" },
      tournamentId: "abcdef",
      roundId: "r3",
    },
    score: {
      A: { sets: 1, games: 2, points: 3 },
      B: { sets: 0, games: 1, points: 1 },
      completedSets: [{ A: 6, B: 4 }],
    },
    court: { name: "Court 07" },
    tournament: { name: "Club Championship" },
  });
  assert.equal(container.querySelector(".mp-title").textContent, "Friday Night Final");
  assert.equal(container.querySelector(".mp-court").textContent, "Court 07");
  assert.equal(
    container.querySelector(".mp-tournament").textContent,
    "Club Championship - Round 3",
  );
  assert.equal(container.querySelector(".mp-tournament").getAttribute("href"), "/t/abcdef");
  assert.equal(container.querySelector('a[href="/c/c7"]').textContent, "Open live scoreboard");
  assert.match(container.textContent, /Golden point at deuce/);

  renderMatchNotFound(container, "nope");
  assert.equal(container.querySelector(".mp-title").textContent, "Match not found");
});

test("match identity falls back to the matchup, then the match id, never the court", () => {
  assert.equal(
    resolveMatchTitle({
      teamNames: { A: "Team A", B: "Team B" },
      playerNames: { A1: "Ann", A2: "Al" },
    }),
    "Ann & Al vs Team B",
  );
  assert.equal(resolveMatchTitle({ currentCourtId: "c1" }, "k3h8fq2a"), "k3h8fq2a");
});
