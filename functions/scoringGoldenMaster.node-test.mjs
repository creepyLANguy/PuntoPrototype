// -----------------------------------------------------------------------
// Scoring golden master - live backend integration path.
//
// The jest suite (scoringGoldenMaster.test.js) drives the scoring engine
// directly through its replay / incremental / segmented orchestrations. This
// node:test suite closes the loop by replaying every fixture through the
// harness's mock Firestore backend, which processes score events exactly the
// way functions/index.js onEventCreate does in production (per-court score
// document, stale-scoreVersion guard, history-stripped live payload). If the
// live event pipeline ever diverges from the canonical expected result, this
// fails alongside the direct-engine suite.
//
// See test/fixtures/scoring/README.md for the fixture format.
// -----------------------------------------------------------------------

import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import
{
  firestoreState,
  resetFirestoreState,
  seedDoc,
  writeDoc,
  flushBackendWork,
  getBackendScore
} from "./frontendHarness/mockFirestoreState.mjs";

const require = createRequire(import.meta.url);
const { getCurrentServerLabel, normalizeScoringOptions } = require("./scoringEngine.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(here, "..", "test", "fixtures", "scoring");

function loadFixtures()
{
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((file) => ({ file, ...JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8")) }));
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

// Feed a fixture's events into the mock backend the same way the client does:
// each event is written to courts/<id>/events/<eventId> at the court's active
// scoreVersion, and the backend reduces them into the authoritative score.
function runThroughBackend(fixture)
{
  resetFirestoreState();
  firestoreState.backendEnabled = false; // defer so events process in written order

  const courtId = "golden";
  const options = normalizeScoringOptions(fixture.options);
  seedDoc(`courts/${courtId}`, {
    name: courtId,
    scoreVersion: 0,
    scoringMode: options.scoringMode,
    scoringOptions: options
  });

  fixture.events.forEach((event, index) =>
  {
    const eventId = event.id || `evt-${index + 1}`;
    writeDoc(`courts/${courtId}/events/${eventId}`, {
      eventType: event.eventType,
      scoreVersion: 0,
      createdAt: event.createdAt
    });
  });

  flushBackendWork();

  return getBackendScore(courtId);
}

for (const fixture of loadFixtures())
{
  test(`golden master (live backend): ${fixture.name}`, () =>
  {
    const score = runThroughBackend(fixture);

    if (fixture.events.length === 0)
    {
      // No events were processed, so the backend never wrote a score. The
      // canonical empty-match expectation is covered by the jest suite; here we
      // only assert the pipeline produced nothing to reduce.
      assert.equal(score, undefined);
      return;
    }

    assert.deepEqual(project(score), fixture.expected);
  });
}
