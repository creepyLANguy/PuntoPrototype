const { calculateStandings: standings } = require("../standings");
const { fixtureOutcome } = require("../results");
const {
  baseRound,
  calculateRoundResult,
  canGenerateAfterComplete,
  makeFixture,
  nextRoundNumber,
  seedFor,
  sideFromParticipants,
  sideFromTeam,
  toInt,
} = require("./shared");

const kingCourt = {
  id: "kingCourt",
  label: "King/Queen of the Court",
  entryMode: "either",
  kind: "courtRotation",
  supportsNextRound: true,
  defaultConfig: () => ({
    courtCount: 2,
    roundDurationMinutes: 12,
    movement: { winner: "up_one", loser: "down_one" },
    tieBehaviour: "higher_seed_wins",
    scoringMethod: "courtPoints",
    finalRanking: "courtPosition",
  }),
  normalizeConfig(config = {}) {
    return {
      courtCount: toInt(config.courtCount, 2, 1, 32),
      roundDurationMinutes: toInt(config.roundDurationMinutes, 12, 1, 180),
      movement: { winner: "up_one", loser: "down_one", ...(config.movement || {}) },
      tieBehaviour: ["higher_seed_wins", "stay"].includes(config.tieBehaviour)
        ? config.tieBehaviour
        : "higher_seed_wins",
      scoringMethod: ["courtPoints", "rallyPoints"].includes(config.scoringMethod)
        ? config.scoringMethod
        : "courtPoints",
      finalRanking: ["courtPosition", "points"].includes(config.finalRanking)
        ? config.finalRanking
        : "courtPosition",
    };
  },
  validateConfig() {
    return { errors: [], warnings: [] };
  },
  validateParticipants(state) {
    const mode = state.tournament?.participantMode || "team";
    const count =
      mode === "individual" ? activeParticipants(state).length : activeTeams(state).length;
    const minimum = mode === "individual" ? 4 : 2;
    return {
      errors:
        count < minimum
          ? [{ code: "INSUFFICIENT_ENTRIES", message: "Not enough entries for King Court." }]
          : [],
      warnings: [],
    };
  },
  generateInitialRound(state) {
    return generateRoundFromAssignments(state, initialAssignments(state));
  },
  generateNextRound(state) {
    const allowed = canGenerateAfterComplete(state);
    if (!allowed.allowed) throw new Error(allowed.reason);
    return generateRoundFromAssignments(
      state,
      this.calculateNextCourtAssignments(state).assignments,
    );
  },
  canGenerateNextRound: canGenerateAfterComplete,
  calculateStandings(state) {
    const mode = state.tournament?.participantMode === "individual" ? "participant" : "team";
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    return standings(state, {
      entryType: mode,
      mode: "league",
      formatId: "kingCourt",
      finalRanking: cfg.finalRanking,
      scoringMethod: cfg.scoringMethod,
      includeFinalCourtPosition: true,
    });
  },
  calculateRoundResult,
  getRulesSummary(config) {
    const cfg = this.normalizeConfig(config);
    return {
      title: "KING/QUEEN OF THE COURT",
      lines: [
        `${cfg.courtCount} courts`,
        `${cfg.roundDurationMinutes} minute rounds`,
        "Winners move up; losers move down",
        `Ties: ${cfg.tieBehaviour}`,
      ],
    };
  },
  calculateNextCourtAssignments(state) {
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    const lastRound = [...(state.rounds || [])].sort((a, b) => b.roundNumber - a.roundNumber)[0];
    const fixtures = (state.fixtures || [])
      .filter((fixture) => fixture.roundId === lastRound?.roundId)
      .sort((a, b) => a.courtLevel - b.courtLevel);
    const buckets = {};
    const queue = [...(lastRound?.generationSnapshot?.queue || [])];
    for (const fixture of fixtures) {
      const outcome = fixtureOutcome(fixture);
      const winner = resolveWinner(fixture, outcome, cfg, state);
      if (!winner) {
        // A "stay" tie (or equal/missing seeds) keeps the exact pairing on
        // its current court instead of arbitrarily moving side B down.
        addToBucket(buckets, fixture.courtLevel, fixture.sides.A);
        addToBucket(buckets, fixture.courtLevel, fixture.sides.B);
        continue;
      }
      const loser = winner === "A" ? "B" : "A";
      addToBucket(buckets, Math.max(1, fixture.courtLevel - 1), fixture.sides[winner]);
      const loserLevel = fixture.courtLevel + 1;
      if (loserLevel > cfg.courtCount) queue.push(sideId(fixture.sides[loser]));
      else addToBucket(buckets, loserLevel, fixture.sides[loser]);
    }
    const assignments = [];
    for (let level = 1; level <= cfg.courtCount; level += 1) {
      const sides = buckets[level] || [];
      while (sides.length < 2 && queue.length > 0) sides.push(sideFromQueue(state, queue.shift()));
      if (sides.length >= 2)
        assignments.push({ courtLevel: level, sides: { A: sides[0], B: sides[1] } });
    }
    return { assignments, queue };
  },
};

function activeParticipants(state) {
  return (state.participants || [])
    .filter((participant) => participant.status === "active")
    .sort(
      (a, b) =>
        (a.seed || 9999) - (b.seed || 9999) || a.participantId.localeCompare(b.participantId),
    );
}

function activeTeams(state) {
  return (state.teams || [])
    .filter((team) => team.status === "active")
    .sort((a, b) => (a.seed || 9999) - (b.seed || 9999) || a.teamId.localeCompare(b.teamId));
}

function initialAssignments(state) {
  const cfg = kingCourt.normalizeConfig(state.tournament?.format?.config || {});
  const mode = state.tournament?.participantMode === "individual" ? "individual" : "team";
  const assignments = [];
  const queue = [];
  if (mode === "individual") {
    const entries = activeParticipants(state);
    for (let level = 1; level <= cfg.courtCount && entries.length >= 4; level += 1) {
      const group = entries.splice(0, 4);
      assignments.push({
        courtLevel: level,
        sides: {
          A: sideFromParticipants([group[0].participantId, group[1].participantId]),
          B: sideFromParticipants([group[2].participantId, group[3].participantId]),
        },
      });
    }
    queue.push(...entries.map((entry) => entry.participantId));
  } else {
    const entries = activeTeams(state);
    for (let level = 1; level <= cfg.courtCount && entries.length >= 2; level += 1) {
      assignments.push({
        courtLevel: level,
        sides: { A: sideFromTeam(entries.shift()), B: sideFromTeam(entries.shift()) },
      });
    }
    queue.push(...entries.map((entry) => entry.teamId));
  }
  return { assignments, queue };
}

function generateRoundFromAssignments(state, assignmentResult) {
  const assignments = Array.isArray(assignmentResult)
    ? assignmentResult
    : assignmentResult.assignments;
  const queue = Array.isArray(assignmentResult) ? [] : assignmentResult.queue;
  const roundNumber = nextRoundNumber(state);
  const seed = seedFor(state, roundNumber, ":king");
  const round = baseRound(roundNumber, `Round ${roundNumber}`, "kingCourt", seed, {
    algorithm: "king-court-v1",
    queue,
  });
  const fixtures = assignments.map((assignment, index) =>
    makeFixture({
      roundNumber,
      index,
      label: `Court ${assignment.courtLevel} - Round ${roundNumber}`,
      stage: null,
      sides: assignment.sides,
      courtLevel: assignment.courtLevel,
    }),
  );
  round.fixtureIds = fixtures.map((fixture) => fixture.fixtureId);
  return { rounds: [round], fixtures };
}

function resolveWinner(fixture, outcome, cfg, state) {
  if (!outcome || outcome.winner === "draw") {
    if (cfg.tieBehaviour === "stay") return null;
    const seedA = seedOfSide(state, fixture.sides.A);
    const seedB = seedOfSide(state, fixture.sides.B);
    if (seedA === seedB) return null;
    return seedA < seedB ? "A" : "B";
  }
  return outcome.winner === "A" || outcome.winner === "B" ? outcome.winner : null;
}

function seedOfSide(state, side) {
  if (side?.teamId) {
    const team = (state.teams || []).find((entry) => entry.teamId === side.teamId);
    const seed = Number(team?.seed);
    return team?.seed != null && Number.isFinite(seed) ? seed : Number.MAX_SAFE_INTEGER;
  }
  const seeds = (side?.participantIds || [])
    .map((id) => (state.participants || []).find((entry) => entry.participantId === id)?.seed)
    .map((seed) => Number(seed))
    .filter((seed) => Number.isFinite(seed));
  // A pair's average seed is comparable; missing seeds are not guessed from IDs.
  return seeds.length
    ? seeds.reduce((sum, seed) => sum + seed, 0) / seeds.length
    : Number.MAX_SAFE_INTEGER;
}

function addToBucket(buckets, level, side) {
  buckets[level] = buckets[level] || [];
  buckets[level].push(side);
}

function sideId(side) {
  return side.teamId || side.participantIds.join("+");
}

function sideFromQueue(state, id) {
  const team = (state.teams || []).find((candidate) => candidate.teamId === id);
  if (team) return sideFromTeam(team);
  return sideFromParticipants(String(id).split("+"));
}

module.exports = kingCourt;
