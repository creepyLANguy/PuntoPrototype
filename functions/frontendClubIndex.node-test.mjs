// Unit tests: club lookups and club-aware search matching
// (app/js/clubs/clubIndex.js).
import assert from "node:assert/strict";
import test from "node:test";

import {
  anyValueMatches,
  buildClubIndex,
  clubFromData,
  clubSummary,
  courtMatchesSearch,
  EMPTY_CLUB_INDEX,
  normalizeSearchTerm,
} from "../app/js/clubs/clubIndex.js";

test("club documents are normalised to plain records", () => {
  assert.deepEqual(
    clubFromData("rvside", { name: "  Riverside  ", courtIds: ["abcd", 7], deviceIds: "x" }),
    { id: "rvside", name: "Riverside", courtIds: ["abcd"], deviceIds: [] },
  );
  assert.equal(clubFromData("noname", {}).name, "noname", "a club without a name shows its id");
});

test("the index maps courts and devices to their club and sorts clubs by name", () => {
  const riverside = clubFromData("rvside", {
    name: "Riverside",
    courtIds: ["abcd"],
    deviceIds: ["HUB-1"],
  });
  const hilltop = clubFromData("hiltop", { name: "Hilltop", courtIds: ["jkmn"], deviceIds: [] });
  const index = buildClubIndex([riverside, hilltop]);

  assert.deepEqual(
    index.clubs.map((club) => club.id),
    ["hiltop", "rvside"],
  );
  assert.equal(index.byId.get("rvside"), riverside);
  assert.equal(index.clubByCourtId.get("abcd"), riverside);
  assert.equal(index.clubByCourtId.get("jkmn"), hilltop);
  assert.equal(index.clubByDeviceId.get("HUB-1"), riverside);
  assert.equal(index.clubByCourtId.get("efgh"), undefined);
  assert.equal(EMPTY_CLUB_INDEX.clubByCourtId.size, 0);
});

test("a member listed by two clubs resolves deterministically to the first by name", () => {
  const zulu = clubFromData("zzzzzz", { name: "Zulu", courtIds: ["abcd"] });
  const alpha = clubFromData("aaaaaa", { name: "Alpha", courtIds: ["abcd"] });
  assert.equal(buildClubIndex([zulu, alpha]).clubByCourtId.get("abcd").id, "aaaaaa");
});

test("club summaries carry only the id and name", () => {
  assert.deepEqual(clubSummary(clubFromData("rvside", { name: "Riverside", courtIds: ["a"] })), {
    id: "rvside",
    name: "Riverside",
  });
  assert.equal(clubSummary(undefined), null);
});

test("court search matches the court or its club, by name or id, ignoring case", () => {
  const court = {
    id: "abcd",
    name: "Centre Court",
    club: { id: "rvside", name: "Riverside Padel" },
  };
  const clubless = { id: "efgh", name: "Side Court", club: null };

  for (const term of ["centre", "ABCD", "riverside", "PADEL", "rvsi", "  river  ", ""]) {
    assert.equal(courtMatchesSearch(court, term), true, `matches "${term}"`);
  }
  assert.equal(courtMatchesSearch(court, "hilltop"), false);
  assert.equal(courtMatchesSearch(clubless, "riverside"), false);
  assert.equal(courtMatchesSearch(clubless, "side"), true);
});

test("search helpers normalise the term and ignore missing values", () => {
  assert.equal(normalizeSearchTerm("  MiXeD "), "mixed");
  assert.equal(normalizeSearchTerm(undefined), "");
  assert.equal(anyValueMatches("hub", undefined, null, "HUB-1"), true);
  assert.equal(anyValueMatches("hub", undefined, "PULSE-2"), false);
  assert.equal(anyValueMatches("", undefined), true, "an empty term matches everything");
});
