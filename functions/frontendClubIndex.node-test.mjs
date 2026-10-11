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
    clubFromData("abch", { name: "  Riverside  ", courtIds: ["abcda", 7], deviceIds: "x" }),
    {
      id: "abch",
      name: "Riverside",
      state: "maintenance",
      courtIds: ["abcda"],
      deviceIds: [],
    },
  );
  assert.equal(clubFromData("xyzz", {}).name, "xyzz", "a club without a name shows its id");
});

test("the index maps courts and devices to their club and sorts clubs by name", () => {
  const riverside = clubFromData("abch", {
    name: "Riverside",
    courtIds: ["abcda"],
    deviceIds: ["HUB-1"],
  });
  const hilltop = clubFromData("jknp", {
    name: "Hilltop",
    courtIds: ["jkmna"],
    deviceIds: [],
  });
  const index = buildClubIndex([riverside, hilltop]);

  assert.deepEqual(
    index.clubs.map((club) => club.id),
    ["jknp", "abch"],
  );
  assert.equal(index.byId.get("abch"), riverside);
  assert.equal(index.clubByCourtId.get("abcda"), riverside);
  assert.equal(index.clubByCourtId.get("jkmna"), hilltop);
  assert.equal(index.clubByDeviceId.get("HUB-1"), riverside);
  assert.equal(index.clubByCourtId.get("efgha"), undefined);
  assert.equal(EMPTY_CLUB_INDEX.clubByCourtId.size, 0);
});

test("clubs without a state default to maintenance state", () => {
  assert.equal(clubFromData("abch", {}).state, "maintenance");
  assert.equal(clubFromData("jknp", { state: "open" }).state, "open");
  assert.equal(clubFromData("qrsy", { state: "closed" }).state, "closed");
});

test("a member listed by two clubs resolves deterministically to the first by name", () => {
  const zulu = clubFromData("zzzz", { name: "Zulu", courtIds: ["abcda"] });
  const alpha = clubFromData("aaaa", { name: "Alpha", courtIds: ["abcda"] });
  assert.equal(buildClubIndex([zulu, alpha]).clubByCourtId.get("abcda").id, "aaaa");
});

test("club summaries carry only the id and name", () => {
  assert.deepEqual(clubSummary(clubFromData("abch", { name: "Riverside", courtIds: ["abcda"] })), {
    id: "abch",
    name: "Riverside",
  });
  assert.equal(clubSummary(undefined), null);
});

test("court search matches the court or its club, by name or id, ignoring case", () => {
  const court = {
    id: "abcda",
    name: "Centre Court",
    club: { id: "abch", name: "Riverside Padel" },
  };
  const clubless = { id: "efgha", name: "Side Court", club: null };

  for (const term of ["centre", "ABCDA", "riverside", "PADEL", "abch", "  river  ", ""]) {
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
