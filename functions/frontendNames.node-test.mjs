// Unit tests: team and player name rules (app/js/teams). Pure functions; no
// DOM is required.
import assert from "node:assert/strict";
import test from "node:test";

import {
  getPlayerDisplayName,
  getPlayerLineForTeam,
  getServerDisplayLabel,
  getTeamPlayerDisplayPair,
  hasPlayersForTeam,
  normalizePlayerNames,
} from "../app/js/teams/playerNames.js";
import {
  isDefaultTeamName,
  normalizeTeamNames,
  resolvePersistedTeamNames,
  resolveTeamNames,
} from "../app/js/teams/teamNames.js";
import { session } from "../app/js/state/sessionState.js";

test("team names are trimmed and fall back to the defaults", () => {
  assert.deepEqual(normalizeTeamNames({ A: "  Reds ", B: "" }), { A: "Reds", B: "Team B" });
  assert.deepEqual(normalizeTeamNames(null), { A: "Team A", B: "Team B" });
  assert.deepEqual(normalizeTeamNames({ A: 3, B: "Blues" }), { A: "Team A", B: "Blues" });
  assert.deepEqual(resolvePersistedTeamNames({ A: " X " }, { A1: "ignored" }), {
    A: "X",
    B: "Team B",
  });
});

test("default team names are recognised per team", () => {
  assert.equal(isDefaultTeamName("A", "Team A"), true);
  assert.equal(isDefaultTeamName("A", " "), true);
  assert.equal(isDefaultTeamName("B", "Team A"), false);
  assert.equal(isDefaultTeamName("Z", "Team A"), true, "unknown teams are treated as A");
});

test("player names keep only string values for the four slots", () => {
  assert.deepEqual(normalizePlayerNames({ A1: "Ann", A2: 4, B1: " Bo ", extra: "x" }), {
    A1: "Ann",
    A2: "",
    B1: " Bo ",
    B2: "",
  });
  assert.deepEqual(normalizePlayerNames(undefined), { A1: "", A2: "", B1: "", B2: "" });
});

test("team player pairs fill missing slots with the slot label", () => {
  assert.equal(getTeamPlayerDisplayPair("A", { A1: "Ann" }), "Ann / A2");
  assert.equal(getTeamPlayerDisplayPair("B", { B1: " ", B2: "Bea" }), "B1 / Bea");
  assert.equal(getTeamPlayerDisplayPair("A", {}), "");
  assert.equal(hasPlayersForTeam("B", { B2: "Bea" }), true);
  assert.equal(hasPlayersForTeam("B", { A1: "Ann" }), false);
  assert.equal(getPlayerLineForTeam("A", { A1: "Ann", A2: " Al " }), "Ann / Al");
  assert.equal(getPlayerLineForTeam("B", { B1: "Bo" }), "Bo");
  assert.equal(getPlayerLineForTeam("B", {}), "");
});

test("display team names combine team and player names", () => {
  assert.deepEqual(resolveTeamNames({}, {}), { A: "Team A", B: "Team B" });
  assert.deepEqual(resolveTeamNames({}, { A1: "Ann", A2: "Al" }), { A: "Ann / Al", B: "Team B" });
  assert.deepEqual(resolveTeamNames({ A: "Reds", B: "Blues" }, { B1: "Bo" }), {
    A: "Reds",
    B: "Blues - Bo / B2",
  });
});

test("player display names default to the open court's players", () => {
  const previous = session.currentPlayerNames;
  session.currentPlayerNames = { A1: " Ann ", A2: "", B1: "", B2: "" };
  try {
    assert.equal(getPlayerDisplayName("A1"), "Ann");
    assert.equal(getPlayerDisplayName("A2"), "");
    assert.equal(getPlayerDisplayName("A2", undefined, true), "A2");
    assert.equal(getPlayerDisplayName("B1", { B1: "Bo" }), "Bo");
    assert.equal(getServerDisplayLabel("A1"), "Ann");
    assert.equal(getServerDisplayLabel("B2"), "B2");
  } finally {
    session.currentPlayerNames = previous;
  }
});
