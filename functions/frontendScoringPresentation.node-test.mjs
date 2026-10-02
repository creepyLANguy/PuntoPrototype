// Unit tests: scoring option normalisation and score presentation rules
// (app/js/scoring/options.js, app/js/scoring/presentation.js). The backend
// engine stays authoritative; these rules only decide how a score is shown.
import assert from "node:assert/strict";
import test from "node:test";

import {
  areScoringOptionsEqual,
  normalizeScoringOptions,
  resolveScoreDisplayOptions,
  resolveScoringOptions,
} from "../app/js/scoring/options.js";
import {
  getCriticalPointStatus,
  getCurrentServerLabel,
  pointLabel,
} from "../app/js/scoring/presentation.js";
import { defaultScore, session } from "../app/js/state/sessionState.js";

const DEFAULTS = { scoringMode: "standard", deuceMode: "standard", tiebreakMode: "sixAllSeven" };

function score({ a = {}, b = {}, options = DEFAULTS, ...rest } = {}) {
  return {
    A: { points: 0, games: 0, sets: 0, totalPoints: 0, ...a },
    B: { points: 0, games: 0, sets: 0, totalPoints: 0, ...b },
    completedSets: [],
    inTiebreak: false,
    deuceCycles: 0,
    matchComplete: false,
    scoringOptions: options,
    ...rest,
  };
}

function withSession(overrides, fn) {
  const previous = { score: session.score, currentScoringOptions: session.currentScoringOptions };
  Object.assign(session, overrides);
  try {
    fn();
  } finally {
    Object.assign(session, previous);
  }
}

test("scoring options fall back to the defaults field by field", () => {
  assert.deepEqual(normalizeScoringOptions(), DEFAULTS);
  assert.deepEqual(normalizeScoringOptions(null), DEFAULTS);
  assert.deepEqual(
    normalizeScoringOptions({ scoringMode: "straight", deuceMode: "bogus", tiebreakMode: "off" }),
    { scoringMode: "straight", deuceMode: "standard", tiebreakMode: "off" },
  );
  assert.equal(normalizeScoringOptions({ extra: 1 }).extra, 1, "unknown keys are preserved");
});

test("scoring options compare on the three normalised fields only", () => {
  assert.equal(areScoringOptionsEqual({}, DEFAULTS), true);
  assert.equal(areScoringOptionsEqual({ deuceMode: "golden" }, { deuceMode: "silver" }), false);
  assert.equal(areScoringOptionsEqual({ deuceMode: "bad" }, { extra: true }), true);
});

test("settings prefer the court's options; the display prefers the score's", () => {
  withSession({ currentScoringOptions: { ...DEFAULTS, scoringMode: "straight" } }, () => {
    const s = score({ options: { ...DEFAULTS, deuceMode: "golden" } });
    assert.equal(resolveScoringOptions(s).scoringMode, "straight");
    assert.equal(resolveScoreDisplayOptions(s).scoringMode, "standard");
    assert.equal(resolveScoreDisplayOptions(s).deuceMode, "golden");
    assert.equal(resolveScoreDisplayOptions({}).scoringMode, "straight");
  });
});

test("point labels use tennis scoring except for numeric formats", () => {
  withSession({ score: score() }, () => {
    assert.deepEqual([0, 1, 2, 3, 4].map(pointLabel), [0, 15, 30, 40, "Ad"]);
  });
  withSession({ score: score({ inTiebreak: true }) }, () => {
    assert.equal(pointLabel(4), 4);
  });
  withSession({ score: score({ options: { ...DEFAULTS, scoringMode: "straight" } }) }, () => {
    assert.equal(pointLabel(12), 12);
  });
});

test("the serving player rotates A1, B1, A2, B2 game by game", () => {
  const servers = [0, 1, 2, 3, 4].map((games) =>
    getCurrentServerLabel(
      score({ a: { games: Math.ceil(games / 2) }, b: { games: Math.floor(games / 2) } }),
    ),
  );
  assert.deepEqual(servers, ["A1", "B1", "A2", "B2", "A1"]);
  assert.equal(
    getCurrentServerLabel(score({ completedSets: [{ A: 6, B: 4 }] })),
    "A2",
    "the ten games of the completed set count towards the rotation",
  );
});

test("tiebreak service changes after the first point and then every two points", () => {
  const tiebreak = (pointsA, pointsB) =>
    getCurrentServerLabel(
      score({
        a: { games: 6, points: pointsA },
        b: { games: 6, points: pointsB },
        inTiebreak: true,
      }),
    );
  assert.deepEqual(
    [tiebreak(0, 0), tiebreak(1, 0), tiebreak(1, 1), tiebreak(2, 1), tiebreak(2, 2)],
    ["A1", "B1", "B1", "A2", "A2"],
  );
});

test("no server is shown for straight scoring or a finished tiebreak-tens match", () => {
  assert.equal(getCurrentServerLabel(null), null);
  assert.equal(
    getCurrentServerLabel(score({ options: { ...DEFAULTS, scoringMode: "straight" } })),
    null,
  );
  assert.equal(
    getCurrentServerLabel(
      score({ options: { ...DEFAULTS, scoringMode: "tiebreakTen" }, matchComplete: true }),
    ),
    null,
  );
  assert.equal(
    getCurrentServerLabel(score({ matchComplete: true })),
    "A1",
    "a stale matchComplete flag does not hide the server outside tiebreak tens",
  );
});

test("critical points are flagged as game, set or match point", () => {
  assert.deepEqual(getCriticalPointStatus(score({ a: { points: 3 }, b: { points: 1 } })), {
    A: "Game",
    B: null,
  });
  assert.deepEqual(
    getCriticalPointStatus(score({ a: { points: 3, games: 5 }, b: { points: 0, games: 3 } })),
    { A: "Set", B: null },
  );
  assert.deepEqual(
    getCriticalPointStatus(score({ a: { points: 3, games: 5, sets: 1 }, b: { games: 2 } })),
    { A: "Match", B: null },
  );
  assert.deepEqual(getCriticalPointStatus(score({ a: { points: 4 }, b: { points: 3 } })), {
    A: "Game",
    B: null,
  });
  assert.deepEqual(getCriticalPointStatus(score({ a: { points: 3 }, b: { points: 3 } })), {
    A: null,
    B: null,
  });
});

test("deuce modes decide whether deuce is a deciding point", () => {
  const deuce = (deuceMode, deuceCycles) =>
    getCriticalPointStatus(
      score({
        a: { points: 3 },
        b: { points: 3 },
        deuceCycles,
        options: { ...DEFAULTS, deuceMode },
      }),
    );
  assert.deepEqual(deuce("golden", 0), { A: "Game", B: "Game" });
  assert.deepEqual(deuce("silver", 0), { A: null, B: null });
  assert.deepEqual(deuce("silver", 1), { A: "Game", B: "Game" });
  assert.deepEqual(deuce("star", 1), { A: null, B: null });
  assert.deepEqual(deuce("star", 2), { A: "Game", B: "Game" });
});

test("tiebreak and tiebreak-tens critical points", () => {
  assert.deepEqual(
    getCriticalPointStatus(
      score({ a: { games: 6, points: 6 }, b: { games: 6, points: 5 }, inTiebreak: true }),
    ),
    { A: "Set", B: null },
  );
  assert.deepEqual(
    getCriticalPointStatus(
      score({
        a: { games: 6, points: 6 },
        b: { games: 6, points: 5 },
        inTiebreak: true,
        options: { ...DEFAULTS, tiebreakMode: "sixAllTen" },
      }),
    ),
    { A: null, B: null },
  );
  assert.deepEqual(
    getCriticalPointStatus(
      score({
        a: { points: 9 },
        b: { points: 8 },
        options: { ...DEFAULTS, scoringMode: "tiebreakTen" },
      }),
    ),
    { A: "Match", B: null },
  );
  assert.deepEqual(
    getCriticalPointStatus(
      score({ a: { points: 5 }, options: { ...DEFAULTS, scoringMode: "straight" } }),
    ),
    { A: null, B: null },
  );
});

test("the session starts from an empty default score", () => {
  assert.deepEqual(defaultScore(), {
    A: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    B: { points: 0, games: 0, sets: 0, totalPoints: 0 },
    lastPointTeam: null,
    lastGameTeam: null,
    lastSetTeam: null,
    inTiebreak: false,
    matchComplete: false,
    scoringOptions: DEFAULTS,
  });
  assert.notEqual(defaultScore(), defaultScore(), "each call returns a fresh object");
});
