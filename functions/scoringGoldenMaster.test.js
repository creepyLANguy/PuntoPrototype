// -----------------------------------------------------------------------
// Scoring golden master.
//
// A canonical set of fixtures (test/fixtures/scoring/*.json) pins the scoring
// contract: for a given { options, events } the engine must produce exactly the
// stored `expected` score projection. Every scoring orchestration path in the
// codebase must reproduce that same result, so this suite runs each fixture
// through all of them:
//
//   * replay        - full replay from the event log (replayEvents), used by the
//                     resetScoring reconciliation callable in functions/index.js.
//   * incremental   - applyEvent folded from a fresh score, used by the live
//                     per-event handler and the analytics replay.
//   * segmented     - replay a prefix to a resume state (carrying history, like a
//                     score checkpoint) then continue applyEvent from it. Tried at
//                     EVERY split so resuming across any game/set/undo boundary is
//                     covered - this is the invariant the checkpoint optimisation
//                     relies on.
//
// The fixtures are the frozen reference for future rewrites of the frontend or
// backend: a new implementation is correct iff it reproduces every `expected`.
// See test/fixtures/scoring/README.md for the fixture format and the exact
// meaning of the projected `expected` fields.
// -----------------------------------------------------------------------

const fs = require("fs");
const path = require("path");

const {
  defaultScore,
  applyEvent,
  replayEvents,
  getCurrentServerLabel,
  normalizeScoringOptions
} = require("./scoringEngine");

const FIXTURES_DIR = path.resolve(__dirname, "..", "test", "fixtures", "scoring");

function loadFixtures()
{
  const files = fs
    .readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

  return files.map((file) =>
  {
    const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8"));
    return { file, ...fixture };
  });
}

function pickTeam(team = {})
{
  return {
    points: Number(team.points) || 0,
    games: Number(team.games) || 0,
    sets: Number(team.sets) || 0,
    totalPoints: Number(team.totalPoints) || 0
  };
}

// The externally-relevant, engine-authoritative projection of a score. Volatile
// / replay-only fields (history, lastEventId, scoringOptions echo, updatedAt)
// are intentionally excluded - only what a consumer relies on is asserted.
function project(score)
{
  return {
    A: pickTeam(score.A),
    B: pickTeam(score.B),
    completedSets: (score.completedSets || []).map((set) => ({
      A: Number(set.A) || 0,
      B: Number(set.B) || 0,
      tiebreakPoints: set.tiebreakPoints
        ? { A: Number(set.tiebreakPoints.A) || 0, B: Number(set.tiebreakPoints.B) || 0 }
        : null
    })),
    inTiebreak: Boolean(score.inTiebreak),
    deuceCycles: Number(score.deuceCycles) || 0,
    matchComplete: Boolean(score.matchComplete),
    lastPointTeam: score.lastPointTeam ?? null,
    lastGameTeam: score.lastGameTeam ?? null,
    lastSetTeam: score.lastSetTeam ?? null,
    server: getCurrentServerLabel(score)
  };
}

// --- orchestration paths --------------------------------------------------

function pathReplay(events, options)
{
  return project(replayEvents(events, options));
}

function pathIncremental(events, options)
{
  let score = defaultScore(options);
  for (const event of events)
  {
    score = applyEvent(score, event, options);
  }
  return project(score);
}

// Replay [0, split) to a resume state, then continue with applyEvent. Returns
// one projection per split point (0..events.length inclusive).
function pathSegmentedAt(events, options, split)
{
  let score = replayEvents(events.slice(0, split), options);
  for (const event of events.slice(split))
  {
    score = applyEvent(score, event, options);
  }
  return project(score);
}

const fixtures = loadFixtures();

describe("scoring golden master", () =>
{
  test("fixtures directory is present and non-empty", () =>
  {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  test("fixture names are unique and match their filename", () =>
  {
    const seen = new Set();
    for (const fixture of fixtures)
    {
      expect(typeof fixture.name).toBe("string");
      expect(`${fixture.name}.json`).toBe(fixture.file);
      expect(seen.has(fixture.name)).toBe(false);
      seen.add(fixture.name);
    }
  });

  describe.each(fixtures.map((fixture) => [fixture.name, fixture]))(
    "%s",
    (_name, fixture) =>
    {
      const options = normalizeScoringOptions(fixture.options);
      const events = fixture.events;

      test("options normalise to a valid scoring configuration", () =>
      {
        expect(["standard", "straight", "tiebreakTen"]).toContain(options.scoringMode);
        expect(["standard", "golden", "silver", "star"]).toContain(options.deuceMode);
        expect(["off", "sixAllSeven", "sixAllTen"]).toContain(options.tiebreakMode);
      });

      test("replay path reproduces expected", () =>
      {
        expect(pathReplay(events, options)).toEqual(fixture.expected);
      });

      test("incremental path reproduces expected", () =>
      {
        expect(pathIncremental(events, options)).toEqual(fixture.expected);
      });

      test("segmented (checkpoint-resumed) path reproduces expected at every split", () =>
      {
        for (let split = 0; split <= events.length; split++)
        {
          expect(pathSegmentedAt(events, options, split)).toEqual(fixture.expected);
        }
      });
    }
  );
});
