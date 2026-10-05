// Frontend integration tests: clubs in the public court lists (Play and
// Spectate). Each court shows its club in a column of its own, court searches
// match club names and ids, rows with a club still open their court, and the
// lists keep working when there are no clubs or clubs cannot be read.
import assert from "node:assert/strict";
import test from "node:test";

import {
  bootFrontend,
  firestoreState,
  seedBaseData,
  seedCourt,
  seedDoc,
  settle,
  waitFor,
} from "./frontendHarness/harness.mjs";

let window;
let document;

const $ = (id) => document.getElementById(id);
const isShown = (id) => window.getComputedStyle($(id)).display !== "none";
const rowIds = (listId) =>
  [...document.querySelectorAll(`#${listId} .court-item`)].map((row) => row.dataset.courtId);
const row = (listId, courtId) =>
  document.querySelector(`#${listId} .court-item[data-court-id="${courtId}"]`);
const clubCell = (listId, courtId) => row(listId, courtId).querySelector(".court-item-club");

function clickMenuButton(label) {
  const button = [...document.querySelectorAll(".menu-btn")].find(
    (btn) => btn.textContent.trim() === label,
  );
  assert.ok(button, `menu button ${label}`);
  button.click();
}

function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function openList(label, listId, expectedCount) {
  clickMenuButton(label);
  await waitFor(
    () => document.querySelectorAll(`#${listId} .court-item`).length === expectedCount,
    {
      label: `${label} list with ${expectedCount} courts`,
    },
  );
}

async function closeList(closeButtonId) {
  $(closeButtonId).click();
  await waitFor(() => isShown("menuPage"), { label: "menu" });
}

// The scoreboard's back button returns to the menu (asking first if needed).
async function leaveScoreboard() {
  $("backBtn").click();
  await settle(20);
  if (!$("confirmModal").classList.contains("hidden")) {
    $("confirmOkBtn").click();
  }
  await waitFor(() => isShown("menuPage") && !isShown("scoreboardPage"), {
    label: "menu after leaving the court",
  });
}

test.before(async () => {
  seedBaseData();
  seedCourt("abcd", { name: "Alpha Court" });
  seedCourt("efgh", { name: "Beta Court" });
  seedCourt("jkmn", { name: "Gamma Court" });
  seedCourt("pqrs", { name: "Delta Court", status: "private" });
  seedCourt("stux", { name: "Closed Court", status: "closed" });
  seedDoc("clubs/rvside", {
    name: "Riverside Padel",
    state: "open",
    courtIds: ["abcd"],
    deviceIds: [],
  });
  seedDoc("clubs/hiltop", {
    name: "Hilltop Club",
    state: "open",
    courtIds: ["jkmn", "pqrs"],
    deviceIds: [],
  });

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
});

test("Spectate shows each open court's club in a column of its own", async () => {
  await openList("Spectate", "spectateCourtList", 3);

  // The discovery search (spec section 31) still matches club names.
  assert.equal(
    $("spectateCourtSearch").placeholder,
    "Search courts, clubs, matches, players or tournaments",
  );
  assert.equal($("spectateCourtList").classList.contains("has-clubs"), true);
  assert.deepEqual(rowIds("spectateCourtList"), ["abcd", "efgh", "jkmn"], "sorted by court name");
  assert.deepEqual(
    rowIds("spectateCourtList").map((id) => clubCell("spectateCourtList", id).textContent),
    ["Riverside Padel", "", "Hilltop Club"],
  );

  // The club column sits between the court name and id; live match context follows.
  for (const id of rowIds("spectateCourtList")) {
    const classes = [...row("spectateCourtList", id).children].map((child) => child.className);
    assert.deepEqual(classes, [
      "court-item-name",
      "court-item-club",
      "court-item-id",
      "court-item-match",
    ]);
    assert.equal(window.getComputedStyle(clubCell("spectateCourtList", id)).display, "block");
  }
  assert.equal(clubCell("spectateCourtList", "abcd").title, "Riverside Padel");
  assert.equal(
    row("spectateCourtList", "abcd").getAttribute("aria-label"),
    "Alpha Court - abcd - Riverside Padel",
  );
  assert.equal(
    row("spectateCourtList", "efgh").getAttribute("aria-label"),
    "Beta Court - efgh",
    "courts without a club keep their previous label",
  );
});

test("Spectate search matches court names, court ids, club names and club ids", async () => {
  const search = $("spectateCourtSearch");
  const cases = [
    ["riverside", ["abcd"]],
    ["HILTOP", ["jkmn"]],
    ["club", ["jkmn"]],
    ["beta", ["efgh"]],
    ["EFGH", ["efgh"]],
    ["court", ["abcd", "efgh", "jkmn"]],
    ["nothing-matches", []],
    ["", ["abcd", "efgh", "jkmn"]],
  ];
  for (const [term, expected] of cases) {
    typeInto(search, term);
    assert.deepEqual(rowIds("spectateCourtList"), expected, `search "${term}"`);
  }

  typeInto(search, "beta");
  assert.equal(
    $("spectateCourtList").classList.contains("has-clubs"),
    true,
    "the column does not disappear while the visible rows have no club",
  );
  typeInto(search, "");
});

test("selecting a court with a club from Spectate opens that court", async () => {
  clubCell("spectateCourtList", "jkmn").click();
  await waitFor(() => isShown("scoreboardPage"), { label: "scoreboard" });
  assert.equal(window.location.pathname, "/c/jkmn");
  assert.equal(window.history.state.viewState.spectate, true, "joined as a spectator");

  await leaveScoreboard();
});

test("Play lists open and private courts with their club and joins through a club row", async () => {
  await openList("Play", "playCourtList", 4);

  assert.equal(
    $("playCourtSearch").placeholder,
    "Search courts, clubs, matches, players or tournaments",
  );
  assert.deepEqual(rowIds("playCourtList"), ["abcd", "efgh", "pqrs", "jkmn"]);
  assert.equal(clubCell("playCourtList", "pqrs").textContent, "Hilltop Club");

  typeInto($("playCourtSearch"), "hilltop");
  assert.deepEqual(rowIds("playCourtList"), ["pqrs", "jkmn"]);

  // Clicking the club text selects the court, like clicking anywhere in the row.
  clubCell("playCourtList", "jkmn").click();
  assert.equal(row("playCourtList", "jkmn").classList.contains("active"), true);
  assert.equal($("playCourtSearch").value, "Gamma Court");
  assert.equal($("playPasswordSection").style.display, "block");

  $("playCourtPassword").value = "pw";
  $("enterCourtBtn").click();
  await waitFor(() => isShown("scoreboardPage"), { label: "scoreboard as player" });
  assert.equal(window.location.pathname, "/c/jkmn");
  assert.equal(window.history.state.viewState.spectate, false, "joined as a player");

  await leaveScoreboard();
});

test("lists still load, without club names, when clubs cannot be read", async () => {
  firestoreState.failingCollections.add("clubs");
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));

  try {
    await openList("Spectate", "spectateCourtList", 3);
    assert.equal($("spectateCourtList").classList.contains("has-clubs"), false);
    for (const id of rowIds("spectateCourtList")) {
      assert.equal(clubCell("spectateCourtList", id).textContent, "");
      assert.equal(window.getComputedStyle(clubCell("spectateCourtList", id)).display, "none");
    }
    typeInto($("spectateCourtSearch"), "gamma");
    assert.deepEqual(rowIds("spectateCourtList"), ["jkmn"], "court search still works");
    typeInto($("spectateCourtSearch"), "");
    assert.ok(warnings.some((warning) => warning.includes("Could not load clubs")));
  } finally {
    firestoreState.failingCollections.delete("clubs");
    console.warn = originalWarn;
  }

  await closeList("closeSpectateBtn");
});

test("courts belonging to maintenance or closed clubs stay out of user lists", async () => {
  firestoreState.docs.set("clubs/closedc", {
    name: "Closed Club",
    state: "closed",
    courtIds: ["cclos"],
    deviceIds: [],
  });
  firestoreState.docs.set("clubs/maintc", {
    name: "Maintenance Club",
    state: "maintenance",
    courtIds: ["cmaint"],
    deviceIds: [],
  });
  seedCourt("cclos", { name: "Closed Club Court", status: "open", clubId: "closedc" });
  seedCourt("cmaint", { name: "Maintenance Court", status: "open", clubId: "maintc" });

  await loadCourtsWithInlineLoader(document.getElementById("playCourtList"), true);
  const names = [...document.querySelectorAll("#playCourtList .court-item")].map((el) => el.textContent);
  assert.equal(names.some((text) => /Closed Club Court|Maintenance Court/.test(text)), false);
});

test("the club column is hidden when no court belongs to a club", async () => {
  firestoreState.docs.delete("clubs/rvside");
  firestoreState.docs.delete("clubs/hiltop");

  await openList("Play", "playCourtList", 4);
  assert.equal($("playCourtList").classList.contains("has-clubs"), false);
  for (const id of rowIds("playCourtList")) {
    assert.equal(window.getComputedStyle(clubCell("playCourtList", id)).display, "none");
  }
  typeInto($("playCourtSearch"), "riverside");
  assert.deepEqual(rowIds("playCourtList"), [], "a deleted club no longer matches");
  typeInto($("playCourtSearch"), "");

  await closeList("closePlayBtn");
});
