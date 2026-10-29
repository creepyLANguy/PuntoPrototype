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
      } else if (
        refsDone &&
        !hasA &&
        !hasB &&
        !hasUnpropagatedEntrant(byId, fixture) &&
        fixture.status !== "cancelled"
      ) {
        patchFixture(fixture, { status: "cancelled" }, updates);
        changed = true;
      } else if (
        refsDone &&
        hasA !== hasB &&
        !hasUnpropagatedEntrant(byId, fixture) &&
        fixture.status !== "bye"
      ) {
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

// A source may already have a completed result before its winner/loser
// has been propagated into this placeholder. During global progression, an
// unrelated bye can be processed first; do not cancel or auto-advance the
// destination while a resolved source still has an entrant to feed into it.
function hasUnpropagatedEntrant(byId, fixture) {
  return ["A", "B"].some((side) => {
    if (fixture.sides?.[side]) return false;
    const ref = fixture.sourceRefs?.[side];
    if (!ref?.fixtureId) return false;
    const source = byId[ref.fixtureId];
    if (!source || !["completed", "bye"].includes(source.status)) return false;
    const outcome = fixtureOutcome(source) || byeOutcome(source);
    if (!outcome || !["A", "B"].includes(outcome.winner)) return false;
    const sourceSide =
      ref.outcome === "loser" ? (outcome.winner === "A" ? "B" : "A") : outcome.winner;
    return entryIdsOfSide(source.sides?.[sourceSide]).length > 0;
  });
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

function bracketStandings(state, options = {}) {
  const formatId = state.tournament?.format?.id || "singleElimination";
  const fixtureFilter =
    options.fixtureFilter ||
    ((fixture) =>
      formatId !== "groupKnockout" || ["knockout", "thirdPlace"].includes(fixture.stage));
  const result = genericStandings(state, {
    entryType: "team",
    mode: "league",
    tiebreakers: ["entryId"],
    fixtureFilter,
  });
  const fixtures = (state.fixtures || [])
    .filter(fixtureFilter)
    .sort(
      (left, right) =>
        Number(left.roundNumber || 0) - Number(right.roundNumber || 0) ||
        String(left.fixtureId || "").localeCompare(String(right.fixtureId || ""), undefined, {
          numeric: true,
        }),
    );
  const hasKnockoutFixtures = fixtures.some((fixture) =>
    ["knockout", "thirdPlace"].includes(fixture.stage),
  );
  const lossCounts = {};
  const eliminationFixtures = {};
  const qualifiedIds = new Set();

  for (const fixture of fixtures) {
    for (const id of [...entryIdsOfSide(fixture.sides?.A), ...entryIdsOfSide(fixture.sides?.B)])
      qualifiedIds.add(id);

    const outcome = fixture.status === "completed" ? fixtureOutcome(fixture) : null;
    if (!outcome || !["A", "B"].includes(outcome.winner)) continue;
    const loserSide = outcome.winner === "A" ? "B" : "A";
    const threshold = formatId === "doubleElimination" ? 2 : 1;
    for (const id of entryIdsOfSide(fixture.sides?.[loserSide])) {
      lossCounts[id] = (lossCounts[id] || 0) + 1;
      if (lossCounts[id] === threshold) eliminationFixtures[id] = fixture;
    }
  }

  const final = resolveBracketFinal(state, formatId, fixtures);
  const placements = new Map();
  const thirdPlace = fixtures.find(
    (fixture) =>
      fixture.stage === "thirdPlace" || /third[- ]place/i.test(String(fixture.label || "")),
  );
  const thirdOutcome =
    thirdPlace?.status === "completed" &&
    entryIdsOfSide(thirdPlace.sides?.A).length > 0 &&
    entryIdsOfSide(thirdPlace.sides?.B).length > 0
      ? fixtureOutcome(thirdPlace)
      : null;
  const unresolvedThirdPlaceEntryIds = new Set();

  // A scheduled/live/cancelled third-place fixture does not establish the
  // semifinal losers' order. Keep those entries unplaced until that fixture
  // has a recorded result; the rest of the elimination ladder starts at fifth.
  if (thirdPlace && !thirdOutcome) {
    for (const source of Object.values(thirdPlace.sourceRefs || {})) {
      if (!source?.fixtureId) continue;
      const semifinal = fixtures.find((fixture) => fixture.fixtureId === source.fixtureId);
      const outcome =
        semifinal?.status === "completed" ? fixtureOutcome(semifinal) : null;
      if (!outcome || !["A", "B"].includes(outcome.winner)) continue;
      const loserSide = outcome.winner === "A" ? "B" : "A";
      for (const id of entryIdsOfSide(semifinal.sides?.[loserSide]))
        unresolvedThirdPlaceEntryIds.add(id);
    }
  }

  if (final) {
    final.winnerIds.forEach((id) => placements.set(id, 1));
    final.loserIds.forEach((id) => placements.set(id, 2));
    if (thirdPlace && thirdOutcome && ["A", "B"].includes(thirdOutcome.winner)) {
      const loserSide = thirdOutcome.winner === "A" ? "B" : "A";
      for (const id of entryIdsOfSide(thirdPlace.sides?.[thirdOutcome.winner]))
        placements.set(id, 3);
      for (const id of entryIdsOfSide(thirdPlace.sides?.[loserSide])) placements.set(id, 4);
    } else if (thirdPlace && thirdOutcome?.winner === "draw") {
      // A completed drawn third-place match shares third place; unlike a
      // missing/cancelled result, the tie is a sporting outcome.
      for (const side of ["A", "B"]) {
        for (const id of entryIdsOfSide(thirdPlace.sides?.[side])) placements.set(id, 3);
      }
    }

    const groups = new Map();
    for (const [id, fixture] of Object.entries(eliminationFixtures)) {
      if (placements.has(id) || unresolvedThirdPlaceEntryIds.has(id)) continue;
      const key = String(fixture.stage || "knockout") + ":" + fixture.roundNumber;
      groups.set(key, groups.get(key) || { roundNumber: fixture.roundNumber, ids: [] });
      groups.get(key).ids.push(id);
    }
    const orderedGroups = [...groups.values()].sort((a, b) => b.roundNumber - a.roundNumber);
    let nextPlace = thirdPlace ? 5 : 3;
    for (const group of orderedGroups) {
      group.ids.sort((a, b) => String(a).localeCompare(String(b)));
      for (const id of group.ids) placements.set(id, nextPlace);
      nextPlace += group.ids.length;
    }
  }

  const finalFixtureIds = new Set([...(final?.winnerIds || []), ...(final?.loserIds || [])]);
  const placedCounts = {};
  for (const placement of placements.values())
    placedCounts[placement] = (placedCounts[placement] || 0) + 1;

  for (const row of result.rows) {
    row.losses = lossCounts[row.entryId] || 0;
    row.qualified = qualifiedIds.has(row.entryId);
    row.placement = placements.has(row.entryId) ? placements.get(row.entryId) : null;
    row.rank = row.placement;
    row.placementTied = row.placement != null && placedCounts[row.placement] > 1;
    row.eliminated =
      row.qualified &&
      !finalFixtureIds.has(row.entryId) &&
      (row.losses >= (formatId === "doubleElimination" ? 2 : 1) ||
        (Boolean(final) && row.placement != null && row.placement > 1));
    row.placementLabel =
      row.placement == null
        ? row.status === "withdrawn"
          ? "Withdrawn"
          : unresolvedThirdPlaceEntryIds.has(row.entryId)
            ? "Third/fourth place undecided"
            : formatId === "groupKnockout" && !hasKnockoutFixtures
              ? "Qualification not decided"
              : formatId === "groupKnockout" && !row.qualified
                ? "Did not qualify"
                : row.eliminated
                  ? "Eliminated"
                  : final
                    ? "Unplaced"
                    : row.qualified
                      ? "Still in contention"
                      : "Not yet played"
        : row.placementTied
          ? String(row.placement) + " (tied)"
          : String(row.placement);
  }

  result.rows.sort((left, right) => {
    if (left.placement != null && right.placement != null)
      return (
        left.placement - right.placement ||
        String(left.entryId).localeCompare(String(right.entryId))
      );
    if (left.placement != null) return -1;
    if (right.placement != null) return 1;
    if (left.qualified !== right.qualified) return left.qualified ? -1 : 1;
    return (
      left.losses - right.losses ||
      left.seed - right.seed ||
      String(left.entryId).localeCompare(String(right.entryId))
    );
  });
  result.tiebreakers = ["placement", "bracketProgress", "entryId"];
  result.tiebreakerLabels = [
    final
      ? "Final placement (tied entries share a rank)"
      : "Bracket progress (not final placement)",
    "Unresolved entries: qualification status, elimination losses, then initial seed",
    "Entry ID (display order only)",
  ];
  result.finalDecided = Boolean(final);
  result.championId = final?.winnerIds?.[0] || null;
  result.runnerUpId = final?.loserIds?.[0] || null;
  result.championByDefault = Boolean(final?.awardedByQualification);
  result.qualifiedIds = [...qualifiedIds];
  return result;
}

function resolveBracketFinal(state, formatId, fixtures) {
  const resultFor = (fixture) => {
    if (!fixture || fixture.status !== "completed") return null;
    const outcome = fixtureOutcome(fixture);
    if (!outcome || !["A", "B"].includes(outcome.winner)) return null;
    const loser = outcome.winner === "A" ? "B" : "A";
    const winnerIds = entryIdsOfSide(fixture.sides?.[outcome.winner]);
    const loserIds = entryIdsOfSide(fixture.sides?.[loser]);
    // Malformed or incomplete fixtures must never produce a fictional title.
    if (!winnerIds.length || !loserIds.length) return null;
    return { winnerIds, loserIds };
  };

  if (formatId === "doubleElimination") {
    const grandFinal = fixtures.find((fixture) => fixture.stage === "grandFinal");
    const reset = fixtures.find((fixture) => fixture.stage === "grandFinalReset");
    const resetResult = resultFor(reset);
    if (resetResult) return resetResult;
    const grandResult = resultFor(grandFinal);
    if (!grandResult) return null;
    const outcome = fixtureOutcome(grandFinal);
    // With a reset enabled, a losers-bracket win in the first grand final
    // does not decide the championship. Only the winners-bracket side's
    // first-final win correctly cancels the reset and ends the event.
    if (reset && !(outcome?.winner === "A" && reset.status === "cancelled")) return null;
    return grandResult;
  }

  if (formatId === "groupKnockout") {
    const qualificationAward = fixtures.find((fixture) => {
      if (
        fixture.bracketPosition !== "KO-CHAMPION" ||
        fixture.status !== "bye" ||
        entryIdsOfSide(fixture.sides?.A).length !== 1 ||
        entryIdsOfSide(fixture.sides?.B).length !== 0
      ) {
        return false;
      }
      const championId = entryIdsOfSide(fixture.sides?.A)[0];
      // A qualification award is valid only while its sole qualifier remains
      // eligible. A later withdrawal must remove the title on recalculation.
      return (state.teams || []).some(
        (team) => team.teamId === championId && team.status === "active",
      );
    });
    if (qualificationAward) {
      return {
        winnerIds: entryIdsOfSide(qualificationAward.sides.A),
        loserIds: [],
        awardedByQualification: true,
      };
    }
  }

  const finals = fixtures.filter(
    (fixture) =>
      fixture.stage === "knockout" && !/third[- ]place/i.test(String(fixture.label || "")),
  );
  const explicitFinal = finals.filter((fixture) =>
    /^final$/i.test(String(fixture.label || "").trim()),
  );
  const candidates = explicitFinal.length ? explicitFinal : finals;
  const finalFixture = candidates.sort((a, b) => b.roundNumber - a.roundNumber)[0];
  return resultFor(finalFixture);
}

function makeByeOrScheduled(args) {
  const sides = args.sides || {};
  const sourceRefs = args.sourceRefs || {};
  // A missing side is a real bye only when that slot has no pending source.
  // Later-round placeholders can have one known side while the other side is
  // still waiting on a match; treating those as byes can prematurely advance
  // a team into the final and suppress the third-place fixture.
  const isResolvedBye =
    (sides.A && !sides.B && !sourceRefs.B?.fixtureId) ||
    (!sides.A && sides.B && !sourceRefs.A?.fixtureId);
  return makeFixture({
    ...args,
    status: isResolvedBye ? "bye" : "scheduled",
  });
}

function canProduceThirdPlaceLoser(fixture) {
  if (!fixture || fixture.stage !== "knockout") return false;
  const hasBothEntrants = Boolean(fixture.sides?.A && fixture.sides?.B);
  const hasTwoAdvancementSources = Boolean(
    fixture.sourceRefs?.A?.fixtureId && fixture.sourceRefs?.B?.fixtureId,
  );
  return hasBothEntrants || hasTwoAdvancementSources;
}

module.exports = {
  nextPowerOfTwo,
  seedOrder,
  bracketEntries,
  roundLabel,
  setFeed,
  advanceBracketState,
  bracketStandings,
  canProduceThirdPlaceLoser,
  makeByeOrScheduled,
  sideFromTeam,
};
