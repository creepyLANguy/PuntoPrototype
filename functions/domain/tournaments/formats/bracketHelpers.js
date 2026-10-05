const { calculateStandings: genericStandings } = require("../standings");
const { TournamentDomainError } = require("../errors");
const { fixtureOutcome } = require("../results");
const { entryIdsOfSide, sideFromTeam } = require("../entities");
const { makeFixture } = require("./shared");

function nextPowerOfTwo(value) {
  let power = 1;
  while (power < value) power *= 2;
  return power;
}

function seedOrder(size) {
  if (size === 1) return [1];
  const previous = seedOrder(size / 2);
  return previous.flatMap((seed) => [seed, size + 1 - seed]);
}

function bracketEntries(state, draw = "seeded", rng = null) {
  let entries = (state.teams || [])
    .filter((team) => team.status === "active")
    .sort((a, b) => (a.seed || 9999) - (b.seed || 9999) || a.teamId.localeCompare(b.teamId));
  if (draw === "random" && rng) entries = require("../random").shuffle(entries, rng);
  return entries;
}

function roundLabel(totalRounds, roundIndex, matchIndex, prefix = "") {
  const remaining = totalRounds - roundIndex - 1;
  const p = prefix ? `${prefix} ` : "";
  if (remaining === 0) return `${p}Final`;
  if (remaining === 1) return `${p}Semi-final ${matchIndex + 1}`;
  if (remaining === 2) return `${p}Quarter-final ${matchIndex + 1}`;
  return `${p}Round of ${2 ** (remaining + 1)} - Match ${matchIndex + 1}`;
}

function setFeed(fixturesByPosition, sourcePosition, outcome, destinationFixture, side) {
  const source = fixturesByPosition[sourcePosition];
  if (!source) return;
  source.feeds = source.feeds || { winner: null, loser: null };
  source.feeds[outcome] = { fixtureId: destinationFixture.fixtureId, side };
}

function advanceBracketState(state, completedFixtureId) {
  const byId = Object.fromEntries(
    (state.fixtures || []).map((fixture) => [fixture.fixtureId, cloneFixture(fixture)]),
  );
  const updates = [];
  const completed = byId[completedFixtureId];
  if (!completed)
    throw new TournamentDomainError(
      "FIXTURE_NOT_FOUND",
      `Fixture ${completedFixtureId} not found.`,
    );
  propagateFixture(byId, completed, updates);
  autoResolve(byId, updates);
  return { updates };
}

function propagateFixture(byId, fixture, updates) {
  const outcome = fixtureOutcome(fixture) || byeOutcome(fixture);
  if (!outcome || outcome.winner === "draw") return;
  const winnerSide = outcome.winner;
  const loserSide = winnerSide === "A" ? "B" : "A";
  const destinations = [
    { feed: fixture.feeds?.winner, side: fixture.sides?.[winnerSide] },
    { feed: fixture.feeds?.loser, side: fixture.sides?.[loserSide] },
  ];
  for (const { feed, side } of destinations) {
    if (!feed || !side) continue;
    const dest = byId[feed.fixtureId];
    if (!dest) continue;
    patchSide(dest, feed.side, side, updates);
  }
}

function autoResolve(byId, updates) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const fixture of Object.values(byId)) {
      if (["completed", "cancelled"].includes(fixture.status)) continue;
      const refsDone = ["A", "B"].every(
        (side) => !fixture.sourceRefs?.[side] || sourceResolved(byId, fixture.sourceRefs[side]),
      );
      const hasA = Boolean(fixture.sides?.A);
      const hasB = Boolean(fixture.sides?.B);
      if (hasA && hasB && fixture.status !== "scheduled") {
        patchFixture(fixture, { status: "scheduled" }, updates);
        changed = true;
      } else if (refsDone && !hasA && !hasB && fixture.status !== "cancelled") {
        patchFixture(fixture, { status: "cancelled" }, updates);
        changed = true;
      } else if (refsDone && hasA !== hasB && fixture.status !== "bye") {
        patchFixture(fixture, { status: "bye" }, updates);
        propagateFixture(byId, fixture, updates);
        changed = true;
      } else if (fixture.stage === "grandFinalReset") {
        const source = Object.values(byId).find(
          (candidate) => candidate.feeds?.winner?.fixtureId === fixture.fixtureId,
        );
        const outcome = source && fixtureOutcome(source);
        if (outcome?.winner === "A") {
          patchFixture(fixture, { status: "cancelled" }, updates);
          changed = true;
        }
      }
    }
  }
}

function sourceResolved(byId, ref) {
  if (!ref?.fixtureId) return true;
  const source = byId[ref.fixtureId];
  if (!source) return false;
  if (source.status === "bye" && ref.outcome === "loser") return true;
  return ["completed", "bye", "cancelled"].includes(source.status);
}

function patchSide(fixture, sideKey, side, updates) {
  const current = fixture.sides?.[sideKey];
  if (JSON.stringify(current) === JSON.stringify(side)) return;
  fixture.sides = { ...fixture.sides, [sideKey]: side };
  fixture.participantIds = [
    ...(fixture.sides.A?.participantIds || []),
    ...(fixture.sides.B?.participantIds || []),
  ];
  fixture.teamIds = [fixture.sides.A?.teamId, fixture.sides.B?.teamId].filter(Boolean);
  patchFixture(
    fixture,
    { sides: fixture.sides, participantIds: fixture.participantIds, teamIds: fixture.teamIds },
    updates,
  );
}

function patchFixture(fixture, patch, updates) {
  Object.assign(fixture, patch);
  const existing = updates.find((update) => update.fixtureId === fixture.fixtureId);
  if (existing) existing.patch = { ...existing.patch, ...patch };
  else updates.push({ fixtureId: fixture.fixtureId, patch });
}

function byeOutcome(fixture) {
  if (fixture.status !== "bye") return null;
  if (fixture.sides?.A && !fixture.sides?.B) return { winner: "A" };
  if (fixture.sides?.B && !fixture.sides?.A) return { winner: "B" };
  return null;
}

function cloneFixture(fixture) {
  return {
    ...fixture,
    sides: {
      A: fixture.sides?.A
        ? { ...fixture.sides.A, participantIds: [...(fixture.sides.A.participantIds || [])] }
        : null,
      B: fixture.sides?.B
        ? { ...fixture.sides.B, participantIds: [...(fixture.sides.B.participantIds || [])] }
        : null,
    },
    feeds: {
      winner: fixture.feeds?.winner ? { ...fixture.feeds.winner } : null,
      loser: fixture.feeds?.loser ? { ...fixture.feeds.loser } : null,
    },
    sourceRefs: {
      A: fixture.sourceRefs?.A ? { ...fixture.sourceRefs.A } : null,
      B: fixture.sourceRefs?.B ? { ...fixture.sourceRefs.B } : null,
    },
  };
}

function bracketStandings(state) {
  const result = genericStandings(state, {
    entryType: "team",
    mode: "league",
    tiebreakers: ["entryId"],
  });
  const lossCounts = {};
  const winnerIds = new Set();
  for (const fixture of state.fixtures || []) {
    const outcome = fixtureOutcome(fixture);
    if (!outcome || outcome.winner === "draw") continue;
    const loser = outcome.winner === "A" ? "B" : "A";
    for (const id of entryIdsOfSide(fixture.sides?.[loser]))
      lossCounts[id] = (lossCounts[id] || 0) + 1;
    for (const id of entryIdsOfSide(fixture.sides?.[outcome.winner])) winnerIds.add(id);
  }
  for (const row of result.rows) {
    row.losses = lossCounts[row.entryId] || 0;
    row.eliminated = row.losses > 0;
    row.placement = row.losses === 0 && winnerIds.has(row.entryId) ? 1 : null;
  }
  result.tiebreakers = ["placement", "entryId"];
  result.tiebreakerLabels = ["Placement", "Entry ID"];
  return result;
}

function makeByeOrScheduled(args) {
  const sides = args.sides;
  return makeFixture({
    ...args,
    status: (sides.A && !sides.B) || (!sides.A && sides.B) ? "bye" : "scheduled",
  });
}

module.exports = {
  nextPowerOfTwo,
  seedOrder,
  bracketEntries,
  roundLabel,
  setFeed,
  advanceBracketState,
  bracketStandings,
  makeByeOrScheduled,
  sideFromTeam,
};
