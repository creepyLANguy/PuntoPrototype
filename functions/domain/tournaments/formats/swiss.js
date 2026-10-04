const { calculateStandings: standings } = require("../standings");
const { entryIdsOfSide } = require("../entities");
const {
  baseRound,
  buildHistory,
  calculateRoundResult,
  chooseSitters,
  completedRound,
  createRng,
  makeFixture,
  nextRoundNumber,
  seedFor,
  sideFromTeam,
  toInt,
} = require("./shared");
const { TournamentDomainError } = require("../errors");

const swiss = {
  id: "swiss",
  label: "Swiss",
  entryMode: "team",
  kind: "swiss",
  supportsNextRound: true,
  defaultConfig: () => ({
    roundCount: null,
    initialDraw: "seeded",
    useBuchholz: true,
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
  }),
  normalizeConfig(config = {}) {
    return {
      roundCount: config.roundCount == null ? null : toInt(config.roundCount, 1, 1, 20),
      initialDraw: config.initialDraw === "random" ? "random" : "seeded",
      useBuchholz: config.useBuchholz !== false,
      pointsForWin: toInt(config.pointsForWin, 3),
      pointsForDraw: toInt(config.pointsForDraw, 1),
      pointsForLoss: toInt(config.pointsForLoss, 0),
    };
  },
  validateConfig() {
    return { errors: [], warnings: [] };
  },
  validateParticipants(state) {
    const active = (state.teams || []).filter((team) => team.status === "active");
    return {
      errors:
        active.length < 2
          ? [{ code: "INSUFFICIENT_TEAMS", message: "Swiss needs at least 2 teams." }]
          : [],
      warnings: [],
    };
  },
  generateInitialRound(state) {
    return generateRound(state);
  },
  generateNextRound(state) {
    const allowed = this.canGenerateNextRound(state);
    if (!allowed.allowed)
      throw new TournamentDomainError("NEXT_ROUND_NOT_AVAILABLE", allowed.reason);
    return generateRound(state);
  },
  canGenerateNextRound(state) {
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    const activeCount = (state.teams || []).filter((team) => team.status === "active").length;
    const roundCount = cfg.roundCount || Math.ceil(Math.log2(Math.max(2, activeCount))) + 1;
    if ((state.rounds || []).length >= roundCount)
      return { allowed: false, reason: "Swiss round count reached." };
    const last = [...(state.rounds || [])].sort((a, b) => b.roundNumber - a.roundNumber)[0];
    if (last && !completedRound(state, last.roundId))
      return { allowed: false, reason: "Previous round is incomplete." };
    return { allowed: true, reason: null };
  },
  calculateStandings(state) {
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    const tiebreakers = cfg.useBuchholz
      ? ["competitionPoints", "wins", "pointDiff", "buchholz", "pointsFor", "seed", "entryId"]
      : ["competitionPoints", "wins", "pointDiff", "pointsFor", "seed", "entryId"];
    return standings(state, {
      entryType: "team",
      mode: "league",
      formatId: "swiss",
      tiebreakers,
      ...cfg,
    });
  },
  calculateRoundResult,
  getRulesSummary(config) {
    const cfg = this.normalizeConfig(config);
    return {
      title: "SWISS",
      lines: [
        `${cfg.roundCount || "Auto"} rounds`,
        "Pair by current score groups",
        "Avoid repeat opponents where possible",
        "Tie-breaks: competition points, wins, point difference, Buchholz, points for",
      ],
    };
  },
};

function generateRound(state) {
  const cfg = swiss.normalizeConfig(state.tournament?.format?.config || {});
  const roundNumber = nextRoundNumber(state);
  const seed = seedFor(state, roundNumber);
  const rng = createRng(seed);
  const history = buildHistory(state);
  let teams = (state.teams || []).filter((team) => team.status === "active");
  if (roundNumber === 1) {
    teams = [...teams].sort(
      (a, b) => (a.seed || 9999) - (b.seed || 9999) || a.teamId.localeCompare(b.teamId),
    );
    if (cfg.initialDraw === "random") teams = require("../random").shuffle(teams, rng);
  } else {
    const byId = Object.fromEntries(teams.map((team) => [team.teamId, team]));
    teams = swiss
      .calculateStandings(state)
      .rows.map((row) => byId[row.entryId])
      .filter(Boolean);
  }
  const byes = chooseSitters(
    teams,
    teams.length % 2,
    { sitCounts: history.byeCounts, consecutiveSits: {} },
    rng,
  );
  const byeIds = new Set(byes.map((team) => team.teamId));
  const playing = teams.filter((team) => !byeIds.has(team.teamId));
  const pairs =
    roundNumber === 1 && cfg.initialDraw === "seeded"
      ? pairTopHalf(playing)
      : pairSwiss(playing, state);
  const round = baseRound(roundNumber, `Round ${roundNumber}`, null, seed, {
    algorithm: "swiss-greedy-v1",
  });
  round.sittingOutTeamIds = [...byeIds].sort();
  const fixtures = [];
  for (const bye of byes) {
    fixtures.push(
      makeFixture({
        roundNumber,
        index: fixtures.length,
        label: `Round ${roundNumber} - Bye`,
        sides: { A: sideFromTeam(bye), B: null },
        status: "bye",
      }),
    );
  }
  for (const [a, b] of pairs) {
    fixtures.push(
      makeFixture({
        roundNumber,
        index: fixtures.length,
        label: `Round ${roundNumber} - Match ${fixtures.length + 1}`,
        sides: { A: sideFromTeam(a), B: sideFromTeam(b) },
      }),
    );
  }
  round.fixtureIds = fixtures.map((fixture) => fixture.fixtureId);
  return { rounds: [round], fixtures };
}

function pairTopHalf(teams) {
  const half = teams.length / 2;
  const pairs = [];
  for (let i = 0; i < half; i += 1) pairs.push([teams[i], teams[i + half]]);
  return pairs;
}

function pairSwiss(teams, state) {
  const seen = priorPairs(state);
  const remaining = [...teams];
  const pairs = [];
  while (remaining.length >= 2) {
    const left = remaining.shift();
    let bestIndex = 0;
    for (let i = 1; i < remaining.length; i += 1) {
      const current = pairKey(left.teamId, remaining[i].teamId);
      const best = pairKey(left.teamId, remaining[bestIndex].teamId);
      if ((seen.has(best) ? 1 : 0) > (seen.has(current) ? 1 : 0)) bestIndex = i;
    }
    pairs.push([left, remaining.splice(bestIndex, 1)[0]]);
  }
  return pairs;
}

function priorPairs(state) {
  const seen = new Set();
  for (const fixture of state.fixtures || []) {
    const a = entryIdsOfSide(fixture.sides?.A)[0];
    const b = entryIdsOfSide(fixture.sides?.B)[0];
    if (a && b) seen.add(pairKey(a, b));
  }
  return seen;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}

module.exports = swiss;
