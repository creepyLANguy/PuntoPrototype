const { fixtureOutcome } = require("../results");
const { TournamentDomainError } = require("../errors");
const {
  baseRound,
  calculateRoundResult,
  createRng,
  makeFixture,
  nextRoundNumber,
  seedFor,
} = require("./shared");
const {
  advanceBracketState,
  bracketEntries,
  bracketStandings,
  makeByeOrScheduled,
  nextPowerOfTwo,
  seedOrder,
  setFeed,
  sideFromTeam,
} = require("./bracketHelpers");

const doubleElimination = {
  id: "doubleElimination",
  label: "Double Elimination",
  entryMode: "team",
  kind: "bracket",
  supportsNextRound: false,
  defaultConfig: () => ({ draw: "seeded", grandFinalReset: true }),
  normalizeConfig(config = {}) {
    return {
      draw: config.draw === "random" ? "random" : "seeded",
      grandFinalReset: config.grandFinalReset !== false,
    };
  },
  validateConfig() {
    return { errors: [], warnings: [] };
  },
  validateParticipants(state) {
    const active = (state.teams || []).filter((team) => team.status === "active");
    return {
      errors:
        active.length < 3 || active.length > 64
          ? [{ code: "INVALID_TEAM_COUNT", message: "Double elimination supports 3..64 teams." }]
          : [],
      warnings: [],
    };
  },
  generateInitialRound(state) {
    return generateBracket(state);
  },
  generateNextRound() {
    throw new TournamentDomainError(
      "NEXT_ROUND_NOT_AVAILABLE",
      "Double elimination bracket is generated up front.",
    );
  },
  canGenerateNextRound() {
    return { allowed: false, reason: "Double elimination bracket is generated up front." };
  },
  calculateStandings: bracketStandings,
  calculateFinalStandings: bracketStandings,
  calculateRoundResult,
  getRulesSummary(config) {
    const cfg = this.normalizeConfig(config);
    return {
      title: "DOUBLE ELIMINATION",
      lines: [
        "Two losses eliminate a team",
        "Winners and losers brackets",
        cfg.grandFinalReset ? "Grand final reset if required" : "Single grand final",
      ],
    };
  },
  generateBracket,
  advanceBracket(state, completedFixtureId) {
    const result = advanceBracketState(state, completedFixtureId);
    const fixture = (state.fixtures || []).find(
      (candidate) => candidate.fixtureId === completedFixtureId,
    );
    if (fixture?.stage === "grandFinal") {
      const outcome = fixtureOutcome(fixture);
      const reset = (state.fixtures || []).find(
        (candidate) => candidate.stage === "grandFinalReset",
      );
      if (reset && outcome?.winner === "B") {
        result.updates.push({
          fixtureId: reset.fixtureId,
          patch: {
            sides: fixture.sides,
            participantIds: fixture.participantIds,
            teamIds: fixture.teamIds,
            status: "scheduled",
          },
        });
      }
      if (reset && outcome?.winner === "A") {
        result.updates.push({ fixtureId: reset.fixtureId, patch: { status: "cancelled" } });
      }
    }
    return result;
  },
};

function generateBracket(state) {
  const cfg = doubleElimination.normalizeConfig(state.tournament?.format?.config || {});
  const firstRound = nextRoundNumber(state);
  const seed = seedFor(state, firstRound, ":double");
  const entries = bracketEntries(state, cfg.draw, createRng(seed));
  const size = nextPowerOfTwo(entries.length);
  const winnersRounds = Math.log2(size);
  const slots = Array(size).fill(null);
  seedOrder(size).forEach((seedNumber, index) => {
    slots[index] = entries[seedNumber - 1] || null;
  });

  const rounds = [];
  const fixtures = [];
  const byPosition = {};
  const schedule = buildDoubleSchedule(size, winnersRounds);
  const wbPositionsByRound = buildWinners(
    rounds,
    fixtures,
    byPosition,
    slots,
    firstRound,
    seed,
    winnersRounds,
  );
  const lbPositionsByRound = buildLosers(
    rounds,
    fixtures,
    byPosition,
    firstRound,
    seed,
    winnersRounds,
    schedule,
  );
  wireDoubleBracket(byPosition, wbPositionsByRound, lbPositionsByRound, winnersRounds);
  buildGrandFinals(
    rounds,
    fixtures,
    byPosition,
    firstRound,
    seed,
    winnersRounds,
    lbPositionsByRound,
    cfg.grandFinalReset,
  );
  return { rounds, fixtures };
}

function buildWinners(rounds, fixtures, byPosition, slots, firstRound, seed, winnersRounds) {
  const positions = {};
  let previous = [];
  const size = slots.length;
  for (let wbRound = 1; wbRound <= winnersRounds; wbRound += 1) {
    const roundNumber = firstRound + wbRound - 1;
    const round = baseRound(roundNumber, `Winners Round ${wbRound}`, "winners", seed, {
      algorithm: "double-elimination-v1",
      bracketRound: wbRound,
    });
    positions[wbRound] = [];
    const count = size / 2 ** wbRound;
    for (let index = 0; index < count; index += 1) {
      const position = `WB-R${wbRound}-M${index + 1}`;
      positions[wbRound].push(position);
      let sides;
      let sourceRefs = { A: null, B: null };
      if (wbRound === 1) {
        sides = {
          A: slots[index * 2] ? sideFromTeam(slots[index * 2]) : null,
          B: slots[index * 2 + 1] ? sideFromTeam(slots[index * 2 + 1]) : null,
        };
      } else {
        const left = byPosition[previous[index * 2]];
        const right = byPosition[previous[index * 2 + 1]];
        sides = {
          A: left.status === "bye" ? left.sides.A || left.sides.B : null,
          B: right.status === "bye" ? right.sides.A || right.sides.B : null,
        };
        sourceRefs = {
          A: { fixtureId: left.fixtureId, outcome: "winner" },
          B: { fixtureId: right.fixtureId, outcome: "winner" },
        };
      }
      const fixture = makeByeOrScheduled({
        roundNumber,
        index,
        label:
          wbRound === winnersRounds
            ? "Winners Final"
            : `Winners Round ${wbRound} - Match ${index + 1}`,
        stage: "winners",
        sides,
        bracketPosition: position,
        sourceFixtureIds: [sourceRefs.A?.fixtureId, sourceRefs.B?.fixtureId].filter(Boolean),
        sourceRefs,
      });
      byPosition[position] = fixture;
      fixtures.push(fixture);
      if (wbRound > 1) {
        setFeed(byPosition, previous[index * 2], "winner", fixture, "A");
        setFeed(byPosition, previous[index * 2 + 1], "winner", fixture, "B");
      }
    }
    round.fixtureIds = fixtures
      .filter((fixture) => fixture.roundNumber === roundNumber)
      .map((fixture) => fixture.fixtureId);
    rounds.push(round);
    previous = positions[wbRound];
  }
  return positions;
}

function buildDoubleSchedule(size, winnersRounds) {
  const schedule = {};
  schedule[1] = { count: Math.max(1, size / 4), kind: "initial" };
  for (let wbRound = 2; wbRound <= winnersRounds; wbRound += 1) {
    schedule[2 * wbRound - 2] = { count: size / 2 ** wbRound, kind: "drop", wbRound };
    if (wbRound < winnersRounds)
      schedule[2 * wbRound - 1] = { count: size / 2 ** wbRound / 2, kind: "consolidate" };
  }
  return schedule;
}

function buildLosers(rounds, fixtures, byPosition, firstRound, seed, winnersRounds, schedule) {
  const positions = {};
  const firstLosersRoundNumber = firstRound + winnersRounds;
  const losersRoundCount = Math.max(1, 2 * winnersRounds - 2);
  for (let lbRound = 1; lbRound <= losersRoundCount; lbRound += 1) {
    const meta = schedule[lbRound];
    if (!meta) continue;
    const roundNumber = firstLosersRoundNumber + lbRound - 1;
    const round = baseRound(roundNumber, `Losers Round ${lbRound}`, "losers", seed, {
      algorithm: "double-elimination-v1",
      lbRound,
    });
    positions[lbRound] = [];
    for (let index = 0; index < meta.count; index += 1) {
      const position = `LB-R${lbRound}-M${index + 1}`;
      positions[lbRound].push(position);
      const fixture = makeFixture({
        roundNumber,
        index,
        label: `Losers Round ${lbRound} - Match ${index + 1}`,
        stage: "losers",
        sides: { A: null, B: null },
        bracketPosition: position,
        sourceRefs: { A: null, B: null },
      });
      byPosition[position] = fixture;
      fixtures.push(fixture);
    }
    round.fixtureIds = fixtures
      .filter((fixture) => fixture.roundNumber === roundNumber)
      .map((fixture) => fixture.fixtureId);
    rounds.push(round);
  }
  return positions;
}

function wireDoubleBracket(byPosition, wb, lb, winnersRounds) {
  wireWinnersLosers(byPosition, wb, lb, winnersRounds);
  wireLosersProgression(byPosition, lb, winnersRounds);
}

function wireWinnersLosers(byPosition, wb, lb, winnersRounds) {
  wireDrops(byPosition, wb[1], lb[1], "A", "B");
  for (let wbRound = 2; wbRound <= winnersRounds; wbRound += 1) {
    const lbRound = 2 * wbRound - 2;
    wireDrops(byPosition, wb[wbRound], lb[lbRound], "B", "A");
  }
}

function wireDrops(byPosition, sources = [], destinations = [], firstSide, secondSide) {
  if (sources.length === destinations.length) {
    for (let i = 0; i < sources.length; i += 1) {
      const dest = byPosition[destinations[i]];
      if (!dest) continue;
      const side = firstSide;
      setFeed(byPosition, sources[i], "loser", dest, side);
      dest.sourceRefs[side] = { fixtureId: byPosition[sources[i]].fixtureId, outcome: "loser" };
      dest.sourceFixtureIds = [
        ...new Set([...dest.sourceFixtureIds, byPosition[sources[i]].fixtureId]),
      ];
    }
    return;
  }
  for (let i = 0; i < sources.length; i += 1) {
    const dest = byPosition[destinations[Math.floor(i / 2)]];
    if (!dest) continue;
    const side = i % 2 === 0 ? firstSide : secondSide;
    setFeed(byPosition, sources[i], "loser", dest, side);
    dest.sourceRefs[side] = { fixtureId: byPosition[sources[i]].fixtureId, outcome: "loser" };
    dest.sourceFixtureIds = [
      ...new Set([...dest.sourceFixtureIds, byPosition[sources[i]].fixtureId]),
    ];
  }
}

function wireLosersProgression(byPosition, lb, winnersRounds) {
  const losersRoundCount = Math.max(1, 2 * winnersRounds - 2);
  for (let round = 1; round < losersRoundCount; round += 1) {
    const current = lb[round] || [];
    const next = lb[round + 1] || [];
    if (next.length === 0) continue;
    for (let i = 0; i < current.length; i += 1) {
      const dest = byPosition[next[Math.floor(i / (current.length / next.length))]];
      const side = round % 2 === 1 ? "A" : i % 2 === 0 ? "A" : "B";
      setFeed(byPosition, current[i], "winner", dest, side);
      dest.sourceRefs[side] = { fixtureId: byPosition[current[i]].fixtureId, outcome: "winner" };
      dest.sourceFixtureIds = [
        ...new Set([...dest.sourceFixtureIds, byPosition[current[i]].fixtureId]),
      ];
    }
  }
}

function buildGrandFinals(
  rounds,
  fixtures,
  byPosition,
  firstRound,
  seed,
  winnersRounds,
  lb,
  resetEnabled,
) {
  const losersRoundCount = Math.max(1, 2 * winnersRounds - 2);
  const roundNumber = firstRound + winnersRounds + losersRoundCount;
  const round = baseRound(roundNumber, "Grand Final", "grandFinal", seed, {
    algorithm: "double-elimination-v1",
  });
  const wbFinal = byPosition[`WB-R${winnersRounds}-M1`];
  const lbFinal = byPosition[(lb[losersRoundCount] || [])[0]];
  const gf = makeFixture({
    roundNumber,
    index: 0,
    label: "Grand Final",
    stage: "grandFinal",
    sides: { A: null, B: null },
    bracketPosition: "GF",
    sourceFixtureIds: [wbFinal.fixtureId, lbFinal.fixtureId],
    sourceRefs: {
      A: { fixtureId: wbFinal.fixtureId, outcome: "winner" },
      B: { fixtureId: lbFinal.fixtureId, outcome: "winner" },
    },
  });
  fixtures.push(gf);
  byPosition.GF = gf;
  setFeed(byPosition, wbFinal.bracketPosition, "winner", gf, "A");
  setFeed(byPosition, lbFinal.bracketPosition, "winner", gf, "B");
  if (resetEnabled) {
    const reset = makeFixture({
      roundNumber,
      index: 1,
      label: "Grand Final (Reset)",
      stage: "grandFinalReset",
      sides: { A: null, B: null },
      status: "scheduled",
      bracketPosition: "GFR",
      sourceFixtureIds: [gf.fixtureId],
      sourceRefs: {
        A: { fixtureId: gf.fixtureId, outcome: "winner" },
        B: { fixtureId: gf.fixtureId, outcome: "loser" },
      },
    });
    fixtures.push(reset);
    gf.feeds.winner = { fixtureId: reset.fixtureId, side: "A" };
    byPosition.GFR = reset;
  }
  round.fixtureIds = fixtures
    .filter((fixture) => fixture.roundNumber === roundNumber)
    .map((fixture) => fixture.fixtureId);
  rounds.push(round);
}

module.exports = doubleElimination;
