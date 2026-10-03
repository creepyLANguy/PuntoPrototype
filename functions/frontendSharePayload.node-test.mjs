// Unit tests: share content and the court link it carries
// (app/js/sharing/sharePayload.js, app/js/qr/courtQr.js). The URL format is
// printed on existing QR codes and must not change.
import assert from "node:assert/strict";
import test from "node:test";

import BRAND from "../app/js/brand.mjs";
import { buildCourtQrUrl } from "../app/js/qr/courtQr.js";
import {
  buildCurrentScoreSummary,
  buildTeamsShareLines,
  getSharePayload,
} from "../app/js/sharing/sharePayload.js";
import { shareCardState } from "../app/js/sharing/shareCardState.js";
import { session } from "../app/js/state/sessionState.js";

const STANDARD = { scoringMode: "standard", deuceMode: "standard", tiebreakMode: "sixAllSeven" };

function score(overrides = {}) {
  return {
    A: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    B: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    completedSets: [],
    scoringOptions: STANDARD,
    ...overrides,
  };
}

test("court links use the origin and the encoded court id", () => {
  assert.equal(
    buildCourtQrUrl("abcd", "https://www.padelpush.co.za"),
    "https://www.padelpush.co.za/c/abcd",
  );
  assert.equal(
    buildCourtQrUrl("a b", "https://qa.padelpush.co.za/"),
    "https://qa.padelpush.co.za/c/a%20b",
  );
  assert.equal(buildCourtQrUrl(null, "https://x.test"), "https://x.test");
});

test("team lines appear only for custom team names and complete player pairs", () => {
  assert.deepEqual(buildTeamsShareLines({}, {}), []);
  assert.deepEqual(buildTeamsShareLines({ A: "Reds", B: "Team B" }, {}), []);
  assert.deepEqual(buildTeamsShareLines({ A: "Reds", B: "Blues" }, { A1: "Ann", B2: "Bea" }), [
    "Reds vs Blues",
    "Ann vs Bea",
  ]);
  assert.deepEqual(buildTeamsShareLines({}, { A1: "Ann" }), [], "both teams need players");
});

test("score summaries list completed sets then the current set", () => {
  assert.equal(buildCurrentScoreSummary(score()), "");
  assert.equal(
    buildCurrentScoreSummary(
      score({
        completedSets: [
          { A: 6, B: 4 },
          { A: 3, B: 6 },
        ],
        A: { games: 2 },
        B: { games: 1 },
      }),
    ),
    "6-4, 3-6, 2-1",
  );
  assert.equal(buildCurrentScoreSummary(score({ completedSets: [{ A: 6, B: 4 }] })), "6-4");
  assert.equal(
    buildCurrentScoreSummary(
      score({
        scoringOptions: { ...STANDARD, scoringMode: "straight" },
        A: { totalPoints: 12, points: 12 },
        B: { points: 9 },
      }),
    ),
    "Score: 12-9 points",
  );
  assert.equal(buildCurrentScoreSummary(null), "");
});

test("the share payload carries brand, teams, score, court and link", () => {
  const previousWindow = globalThis.window;
  const previous = { ...session };
  globalThis.window = { location: { origin: "https://padel.test" } };
  Object.assign(session, {
    currentCourtId: "abcd",
    currentCourtName: "Centre",
    currentRawTeamNames: { A: "Reds", B: "Blues" },
    currentPlayerNames: { A1: "", A2: "", B1: "", B2: "" },
    score: score({ completedSets: [{ A: 6, B: 2 }] }),
  });

  try {
    const scoreboard = getSharePayload("scoreboard");
    assert.equal(scoreboard.title, "");
    assert.deepEqual(scoreboard.files, []);
    assert.equal(
      scoreboard.text,
      [
        BRAND.name + "\n",
        "Reds vs Blues",
        "6-2\n",
        "Centre (ABCD)\n",
        "View live scoreboard:",
        "https://padel.test/c/abcd",
      ].join("\n"),
    );

    shareCardState.shareableScoreCardImage = { name: "share-image.png" };
    const details = getSharePayload("details");
    assert.match(details.text, /View full match details:\nhttps:\/\/padel\.test\/c\/abcd$/);
    assert.deepEqual(details.files, [{ name: "share-image.png" }]);
    assert.deepEqual(getSharePayload("scoreboard").files, [], "only details shares the image");
  } finally {
    shareCardState.shareableScoreCardImage = null;
    Object.assign(session, previous);
    globalThis.window = previousWindow;
  }
});
