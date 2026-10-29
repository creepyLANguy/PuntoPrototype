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
const { generateSchedule } = require("./domain/tournaments/forecast");

const dom = new JSDOM("<!DOCTYPE html><body></body>", { url: "https://padel.test/t/abcdefg" });
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
const { looksLikeMatchId, searchCourts, searchMatchesAndTournaments, SEARCH_PLACEHOLDER } =
  await import("../app/js/match/discoverySearch.js");
const { renderPublicDashboard } = await import("../app/js/tournament/publicView.js");
const { renderHostDashboard } = await import("../app/js/tournament/hostView.js");
const { renderMatchNotFound, renderMatchPage } = await import("../app/js/match/matchView.js");
const { resolveMatchTitle } = await import("../app/js/match/matchIdentity.js");

const COURTS = [
  { courtId: "aaada", name: "Court 4", status: "closed", clubId: "abch" },
  { courtId: "aaaca", name: "Court 3", status: "open", clubId: null },
  { courtId: "aaaba", name: "Court 2", status: "open", clubId: "abch" },
  { courtId: "aaaaa", name: "Court 1", status: "open", clubId: "abch" },
  { courtId: "aaaea", name: "Court 9", status: "open", clubId: "jknp" },
];

test("club courts are surfaced first, then other courts, then unavailable ones", () => {
  const ordered = orderCourtCandidates(COURTS, { clubId: "abch" });
  assert.deepEqual(
    ordered.map((court) => court.courtId),
    ["aaaaa", "aaaba", "aaaca", "aaaea", "aaada"],
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
  const selected = ["aaaea", "aaaca"];
  const ranked = orderCourtCandidates(COURTS, { clubId: "abch", selectedCourtIds: selected });
  assert.deepEqual(
    ranked.filter((court) => court.selected).map((court) => court.courtId),
    ["aaaca", "aaaea"],
  );
  assert.deepEqual(reconcileSelection([...selected, "gone"], COURTS), ["aaaea", "aaaca"]);
});

test("the court picker labels the selected club's group and courts outside it stay selectable", () => {
  const container = document.createElement("div");
  let changed = null;
  renderCourtPicker(container, {
    courts: COURTS,
    clubId: "abch",
    clubName: "Example Padel Club",
    selectedCourtIds: ["aaaca"],
    onChange: (next) => {
      changed = next;
    },
  });
  const legends = [...container.querySelectorAll("legend")].map((legend) => legend.textContent);
  assert.deepEqual(legends, ["Example Padel Club courts", "Other courts", "Unavailable"]);
  assert.equal(container.querySelector('input[data-court-id="aaaca"]').checked, true);

  const outside = container.querySelector('input[data-court-id="aaaea"]');
  outside.checked = true;
  outside.dispatchEvent(new dom.window.Event("change"));
  assert.deepEqual(changed, ["aaaca", "aaaea"]);
});

test("format settings become a nested configuration with only relevant options", () => {
  const americano = buildFormatConfig("americano", {
    ...defaultFieldValues("americano"),
    "scoring.pointsTarget": "32",
  });
  assert.equal(americano.scoring.pointsTarget, 32);

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
    { id: "abcda", name: "Centre Court", match: null },
    {
      id: "efgha",
      name: "Court 2",
      match: {
        matchId: "mnprst",
        name: "Sundaya Night Final",
        playerNames: { A1: "Alice", A2: "Ben", B1: "", B2: "" },
        teamNames: { A: "Team A", B: "Team B" },
      },
    },
  ];
  assert.deepEqual(
    searchCourts(courts, "alice").map((court) => court.id),
    ["efgha"],
  );
  assert.deepEqual(
    searchCourts(courts, "abcda").map((court) => court.id),
    ["abcda"],
  );

  const results = searchMatchesAndTournaments(
    {
      matches: [
        {
          matchId: "mnprst",
          name: "Sundaya Night Final",
          status: "live",
          courtName: "Court 2",
          teamNames: { A: "Team A", B: "Team B" },
          playerNames: { A1: "Alice", A2: "Ben", B1: "Sam", B2: "Dave" },
        },
      ],
      tournaments: [{ tournamentId: "sundaya", name: "Sunday Social", status: "live" }],
    },
    "sundaya",
  );
  assert.equal(results[0].kind, "tournament", "an exact tournament id outranks substrings");
  assert.equal(results[1].label, "Sundaya Night Final");
  assert.ok(results[1].lines.includes("Court: Court 2"));
  assert.ok(results[1].lines.includes("LIVE - Match mnprst"));
});

test("historical match discovery accepts only normalized six-letter match IDs", () => {
  assert.equal(looksLikeMatchId("  ABCDEF  "), true);
  for (const term of [
    "abcda",
    "abcdefg",
    "abch",
    "abc12345",
    "abcdefgi",
    "abcdefgl",
    "abcdefgo",
    "abcdefgv",
    "abcdefgw",
    "abcd-efg",
    null,
    12345678,
  ]) {
    assert.equal(looksLikeMatchId(term), false, String(term));
  }
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
    tournamentId: "abcdefg",
    name: "Friday Night Padel Social",
    description: "",
    status: "live",
    visibility: "public",
    participantMode: "individual",
    format: {
      id: "americano",
      version: 1,
      config: getFormat("americano").normalizeConfig({
        scoring: { sideSwapRule: "after_all_players_serve_once" },
      }),
    },
    courtPool: ["aaaaa", "aaaba"],
    scheduling: {
      timezone: "UTC",
      startAt: null,
      defaultMatchDurationMinutes: 15,
      targetRoundCount: 3,
    },
  };
  const state = {
    tournament,
    participants,
    teams: [],
    rounds: [],
    fixtures: [],
    generationSeed: "abcdefg",
  };
  const generation = generateSchedule(getFormat("americano"), state);
  const fixtures = generation.fixtures.map((fixture, index) => ({
    ...fixture,
    matchId: `m${"abcdefghjkmnpqrstuxyz"[index]}aaaa`,
    courtId: index % 2 === 0 ? "aaaaa" : "aaaba",
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
        matchId: "mbaaaa",
        status: "live",
        currentCourtId: "aaaba",
        name: "Round 1 - Match 2",
        scoreSummary: {
          A: { points: 12, games: 0, sets: 0 },
          B: { points: 9, games: 0, sets: 0 },
          scoringMode: "fixedTotalPoints",
        },
      },
    ],
    courts: [
      { courtId: "aaaaa", name: "Court 1", status: "open" },
      { courtId: "aaaba", name: "Court 2", status: "open", activeMatchId: "mbaaaa" },
    ],
    club: { clubId: "abch", name: "Example Padel Club" },
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
  assert.match(text, /Round 3 - scheduled/);
  assert.match(text, /SITTING OUT/);
  assert.match(text, /36 total points/);
  assert.match(text, /1 consecutive serves/);
  assert.match(text, /Swap sides after all players serve once/);

  const headers = [...page.querySelectorAll(".standings-table th")].map((th) => th.textContent);
  assert.deepEqual(headers.slice(0, 4), ["#", "Player", "Rounds", "Points"]);
  assert.ok(!headers.includes("W"), "social formats do not show win/loss columns");
  const top = page.querySelector(".standings-table tbody tr");
  assert.match(top.textContent, /19/);

  const liveLink = page.querySelector('.fx-live a[href="/m/mbaaaa"]');
  assert.ok(liveLink, "live cards link to the durable match page");
});

test("result-dependent formats forecast slots without pretending future pairings are known", () => {
  const state = americanoState();
  state.tournament.format = { id: "mexicano", config: getFormat("mexicano").normalizeConfig({}) };
  state.rounds = state.rounds.slice(0, 1);
  state.fixtures = state.fixtures.filter((fixture) => fixture.roundNumber === 1);
  const view = buildTournamentView({ ...state, teams: [], matches: [], courts: [], now: 100000 });
  assert.deepEqual(
    view.roundForecast.map((round) => round.roundNumber),
    [2, 3],
  );
  assert.equal(view.fixtures.length, 2);
  assert.equal(view.nextRound.allowed, false);
  assert.equal(view.format.supportsNextRound, true);
  const page = renderPublicDashboard(view, new Map());
  assert.match(page.textContent, /Round 3 - forecast \(pairings pending\)/);
  assert.match(page.textContent, /this is not a playable match/);
});

test("live points update the card score from the live match listener", () => {
  const view = buildView();
  const live = new Map([
    [
      "mbaaaa",
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
  assert.ok(!buttons.some((label) => /^Generate Round/.test(label)));
  assert.ok(buttons.includes("Recalculate remaining schedule"));
  assert.ok(
    [...page.querySelectorAll("button[disabled]")].some((button) => button.textContent === "Start"),
    "future rounds are forecast, not immediately startable",
  );
  assert.ok(buttons.includes("Move"));
  assert.ok(buttons.includes("Complete"));
  assert.ok(text.includes("Correct result"));
  assert.match(page.querySelector(".host-link").textContent, /\/t\/abcdefg\?host=secret-key$/);
});

test("the match page puts the match name first and the court second", () => {
  const container = document.createElement("div");
  renderMatchPage(container, {
    matchId: "khfqab",
    match: {
      name: "Friday Night Final",
      status: "live",
      currentCourtId: "aaafa",
      teamNames: { A: "John & Mike", B: "Sam & Dave" },
      playerNames: { A1: "John", A2: "Mike", B1: "Sam", B2: "Dave" },
      scoringOptions: { scoringMode: "standard", deuceMode: "golden", tiebreakMode: "sixAllSeven" },
      tournamentId: "abcdefg",
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
  assert.equal(container.querySelector(".mp-tournament").getAttribute("href"), "/t/abcdefg");
  assert.equal(container.querySelector(".mp-id").textContent, "Match khfqab");
  assert.equal(container.querySelector('a[href="/c/aaafa"]').textContent, "Open live scoreboard");
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
  assert.equal(resolveMatchTitle({ currentCourtId: "aaaaa" }, "khfqab"), "khfqab");
});


test("completed social tournament shows a podium; live tournament does not", () => {
  const liveView = buildView();
  const livePage = renderPublicDashboard(liveView, new Map());
  assert.equal(livePage.querySelector(".tournament-podium"), null);

  const view = {
    ...liveView,
    status: "completed",
    finishedEarly: false,
    finalStandings: {
      entryType: "participant",
      tiebreakers: ["totalPoints", "pointDiff", "pointsFor", "entryId"],
      tiebreakerLabels: ["Total points", "Point difference", "Points for"],
      rows: [
        { rank: 1, entryId: "p1", name: "Alice", played: 3, totalPoints: 30, pointDiff: 12, pointsFor: 30 },
        { rank: 2, entryId: "p2", name: "Ben", played: 3, totalPoints: 26, pointDiff: 8, pointsFor: 26 },
        { rank: 3, entryId: "p3", name: "Chris", played: 3, totalPoints: 22, pointDiff: 2, pointsFor: 22 },
      ],
    },
  };
  const page = renderPublicDashboard(view, new Map());

  assert.ok(page.querySelector(".tournament-podium"));
  assert.match(page.textContent, /Tournament complete/);
  assert.match(page.textContent, /Winner: Alice/);
  assert.equal(page.querySelectorAll(".podium-rank-1 .podium-entry").length, 1);
  assert.equal(page.querySelectorAll(".podium-rank-2 .podium-entry").length, 1);
  assert.equal(page.querySelectorAll(".podium-rank-3 .podium-entry").length, 1);
  assert.equal(page.querySelector(".ev-match-history")?.querySelector("summary")?.textContent, "Review rounds and match results");
});

test("completed finite tournaments stay provisional while required rounds remain", () => {
  const base = buildView();
  const view = {
    ...base,
    status: "completed",
    finishedEarly: false,
    completionReason: null,
    format: {
      ...base.format,
      id: "roundRobin",
      label: "Round Robin",
      kind: "league",
    },
    nextRound: { allowed: true, reason: "Round 2 remains to be generated" },
    finalStandings: {
      entryType: "team",
      rows: [
        { rank: 1, entryId: "t1", name: "Team One", played: 1, competitionPoints: 3 },
        { rank: 2, entryId: "t2", name: "Team Two", played: 1, competitionPoints: 0 },
      ],
    },
  };
  const page = renderPublicDashboard(view, new Map());

  assert.match(page.textContent, /Tournament ended before the schedule was complete/);
  assert.match(page.textContent, /Required tournament rounds remain to be generated/);
  assert.doesNotMatch(page.textContent, /Winner: Team One|Joint winners:/);
  assert.equal(page.querySelector(".tournament-podium"), null);
});

test("a sporting tie is shown as joint winners rather than an invented second place", () => {
  const view = {
    ...buildView(),
    status: "completed",
    finalStandings: {
      entryType: "participant",
      tiebreakers: ["totalPoints", "pointDiff", "entryId"],
      tiebreakerLabels: ["Total points", "Point difference"],
      rows: [
        { rank: 1, entryId: "p1", name: "Alice", played: 3, totalPoints: 24 },
        { rank: 1, entryId: "p2", name: "Ben", played: 3, totalPoints: 24 },
        { rank: 3, entryId: "p3", name: "Chris", played: 3, totalPoints: 18 },
      ],
    },
  };
  const page = renderPublicDashboard(view, new Map());

  assert.match(page.textContent, /Joint winners: Alice, Ben/);
  assert.equal(page.querySelectorAll(".podium-rank-1 .podium-entry").length, 2);
  assert.equal(page.querySelector(".podium-rank-2"), null);
  assert.equal(page.querySelectorAll(".podium-rank-3 .podium-entry").length, 1);
  assert.deepEqual(
    Array.from(page.querySelector(".tournament-podium").children).map((tier) =>
      Array.from(tier.classList).find((name) => /^podium-rank-/.test(name)),
    ),
    ["podium-rank-1", "podium-rank-3"],
  );
});

test("an unresolved knockout bracket does not invent a champion or podium", () => {
  const view = {
    ...buildView(),
    status: "completed",
    format: {
      ...buildView().format,
      id: "singleElimination",
      kind: "bracket",
      entryMode: "team",
    },
    finalStandings: {
      entryType: "team",
      finalDecided: false,
      tiebreakers: ["placement", "eliminationStage", "entryId"],
      tiebreakerLabels: ["Bracket progress"],
      rows: [
        { rank: null, placement: null, placementLabel: "Still in contention", entryId: "t1", name: "Team One", played: 2 },
      ],
    },
    bracket: null,
  };
  const page = renderPublicDashboard(view, new Map());

  assert.match(page.textContent, /Final result not decided/);
  assert.match(page.textContent, /No champion or final podium can be declared/);
  assert.equal(page.querySelector(".tournament-podium"), null);
});

test("early completion explains that positions are based on recorded results", () => {
  const view = {
    ...buildView(),
    status: "completed",
    finishedEarly: true,
    completionReason: "Venue closing",
    finalStandings: {
      entryType: "participant",
      tiebreakers: ["totalPoints", "entryId"],
      tiebreakerLabels: ["Total points"],
      rows: [
        { rank: 1, entryId: "p1", name: "Alice", played: 1, totalPoints: 12 },
        { rank: 2, entryId: "p2", name: "Ben", played: 1, totalPoints: 8 },
      ],
    },
  };
  const page = renderPublicDashboard(view, new Map());

  assert.match(page.textContent, /Tournament ended early/);
  assert.match(page.textContent, /recorded results only/);
  assert.doesNotMatch(page.textContent, /Winner: Alice/);
  assert.equal(page.querySelector(".tournament-podium"), null);
});


test("a completed tournament with no recorded match results does not announce a winner", () => {
  const view = {
    ...buildView(),
    status: "completed",
    finishedEarly: false,
    completionReason: null,
    finalStandings: {
      entryType: "participant",
      tiebreakers: ["totalPoints", "pointDiff", "entryId"],
      tiebreakerLabels: ["Total points", "Point difference"],
      rows: [
        { rank: 1, entryId: "p1", name: "Alice", played: 0, totalPoints: 0, pointDiff: 0 },
        { rank: 1, entryId: "p2", name: "Ben", played: 0, totalPoints: 0, pointDiff: 0 },
      ],
    },
  };
  const page = renderPublicDashboard(view, new Map());

  assert.match(page.textContent, /No match results have been recorded/);
  assert.doesNotMatch(page.textContent, /Winner: Alice|Joint winners: Alice, Ben/);
  assert.equal(page.querySelector(".tournament-podium"), null);
});


test("completed group-knockout results remain visible when no knockout stage was generated", () => {
  const base = buildView();
  const view = {
    ...base,
    status: "completed",
    format: {
      ...base.format,
      id: "groupKnockout",
      label: "Group + Knockout",
      kind: "groupBracket",
      entryMode: "team",
      config: { groupCount: 2, advancePerGroup: 1 },
    },
    currentRound: null,
    rounds: [],
    roundForecast: [],
    bracket: null,
    fixtures: [
      {
        fixtureId: "group-a-match",
        stage: "group",
        groupId: "A",
        status: "completed",
        displayStatus: "COMPLETED",
      },
      {
        fixtureId: "group-b-match",
        stage: "group",
        groupId: "B",
        status: "completed",
        displayStatus: "COMPLETED",
      },
    ],
    participants: [],
    teams: [
      { teamId: "t1", name: "Tigers", participantIds: [], status: "active", seed: 1 },
      { teamId: "t2", name: "Falcons", participantIds: [], status: "active", seed: 2 },
      { teamId: "t3", name: "Panthers", participantIds: [], status: "active", seed: 3 },
      { teamId: "t4", name: "Hawks", participantIds: [], status: "active", seed: 4 },
    ],
    standings: {
      entryType: "team",
      columns: ["rank", "name", "played", "wins", "draws", "losses", "competitionPoints", "pointDiff", "form"],
      tiebreakers: ["competitionPoints", "wins", "entryId"],
      tiebreakerLabels: ["Competition points", "Wins"],
      rows: [
        { rank: 1, entryId: "t1", name: "Tigers", groupId: "A", status: "active", played: 2, wins: 2, draws: 0, losses: 0, competitionPoints: 6, pointDiff: 8, form: ["W", "W"] },
        { rank: 2, entryId: "t2", name: "Falcons", groupId: "A", status: "active", played: 2, wins: 1, draws: 0, losses: 1, competitionPoints: 3, pointDiff: 0, form: ["W", "L"] },
        { rank: 1, entryId: "t3", name: "Panthers", groupId: "B", status: "active", played: 2, wins: 2, draws: 0, losses: 0, competitionPoints: 6, pointDiff: 7, form: ["W", "W"] },
        { rank: 2, entryId: "t4", name: "Hawks", groupId: "B", status: "active", played: 2, wins: 1, draws: 0, losses: 1, competitionPoints: 3, pointDiff: -1, form: ["W", "L"] },
      ],
    },
    finalStandings: {
      entryType: "team",
      finalDecided: false,
      championId: null,
      championByDefault: false,
      tiebreakers: ["placement", "eliminationStage", "entryId"],
      tiebreakerLabels: ["Bracket progress", "Elimination stage"],
      rows: [
        { rank: null, placement: null, placementLabel: "Qualification not decided", entryId: "t1", name: "Tigers", status: "active", played: 0 },
        { rank: null, placement: null, placementLabel: "Qualification not decided", entryId: "t2", name: "Falcons", status: "active", played: 0 },
        { rank: null, placement: null, placementLabel: "Qualification not decided", entryId: "t3", name: "Panthers", status: "active", played: 0 },
        { rank: null, placement: null, placementLabel: "Qualification not decided", entryId: "t4", name: "Hawks", status: "active", played: 0 },
      ],
    },
  };

  const page = renderPublicDashboard(view, new Map());
  const pageText = page.textContent;

  assert.match(pageText, /Group-stage results are recorded, but the knockout stage has not been generated/);
  assert.match(pageText, /Overall finishing positions have not been established/);
  assert.match(pageText, /Group A/);
  assert.match(pageText, /Group B/);
  assert.match(pageText, /Tigers/);
  assert.match(pageText, /Panthers/);
  assert.doesNotMatch(pageText, /No match results have been recorded/);
  assert.equal(page.querySelector(".tournament-podium"), null);
});

