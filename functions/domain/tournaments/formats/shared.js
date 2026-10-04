const {
  fixtureId,
  flatParticipants,
  flatTeams,
  roundId,
  sideFromParticipants,
  sideFromTeam,
} = require("../entities");
const { createRng, shuffle } = require("../random");
const { buildHistory } = require("../history");
const { fixtureOutcome } = require("../results");
const { TournamentDomainError } = require("../errors");
const {
  validateFixedTotalPointsConfig,
  normalizeFixedTotalPointsConfig,
} = require("../scoringProfiles");

function toInt(value, fallback, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  const int = Number.isFinite(number) ? Math.trunc(number) : fallback;
  return Math.max(min, Math.min(max, int));
}

function maxRoundNumber(state) {
  return (state.rounds || []).reduce(
    (max, round) => Math.max(max, Number(round.roundNumber || 0)),
    0,
  );
}

function nextRoundNumber(state) {
  return maxRoundNumber(state) + 1;
}

function baseRound(roundNumber, label, stage, seed, snapshot = {}) {
  return {
    roundId: roundId(roundNumber),
    roundNumber,
    label,
    stage,
    status: "scheduled",
    fixtureIds: [],
    sittingOutParticipantIds: [],
    sittingOutTeamIds: [],
    generationSnapshot: {
      seed,
      algorithm: snapshot.algorithm || "deterministic",
      version: 1,
      ...snapshot,
    },
  };
}

function makeFixture({
  roundNumber,
  index,
  label,
  stage = null,
  groupId = null,
  sides,
  status = "scheduled",
  courtLevel = null,
  bracketPosition = null,
  sourceFixtureIds = [],
  feeds = { winner: null, loser: null },
  sourceRefs = { A: null, B: null },
}) {
  return {
    fixtureId: fixtureId(roundNumber, index),
    roundId: roundId(roundNumber),
    roundNumber,
    label,
    stage,
    groupId,
    sides,
    participantIds: flatParticipants(sides),
    teamIds: flatTeams(sides),
    status,
    matchId: null,
    courtId: null,
    scheduledStartAt: null,
    courtLevel,
    bracketPosition,
    sourceFixtureIds,
    feeds,
    sourceRefs,
    resultSnapshot: null,
  };
}

function seedFor(state, roundNumber, suffix = "") {
  return `${state.generationSeed || state.tournament?.tournamentId || "tournament"}:${roundNumber}${suffix}`;
}

function socialDefaultConfig(overrides = {}) {
  return {
    scoring: normalizeFixedTotalPointsConfig(overrides.scoring || {}),
    maxCourts: toInt(overrides.maxCourts, 0, 0),
    mixed: Boolean(overrides.mixed),
    usePointDiff: overrides.usePointDiff !== false,
  };
}

function socialConfigValidation(config) {
  return validateFixedTotalPointsConfig(config.scoring);
}

function canGenerateAfterComplete(state) {
  const lastRound = [...(state.rounds || [])].sort((a, b) => b.roundNumber - a.roundNumber)[0];
  if (!lastRound) return { allowed: true, reason: null };
  const fixtures = (state.fixtures || []).filter(
    (fixture) => fixture.roundId === lastRound.roundId && fixture.status !== "bye",
  );
  const incomplete = fixtures.some(
    (fixture) => fixture.status !== "completed" || !fixture.resultSnapshot,
  );
  return incomplete
    ? { allowed: false, reason: "Previous round is incomplete." }
    : { allowed: true, reason: null };
}

function requireNextRoundAllowed(state) {
  const allowed = canGenerateAfterComplete(state);
  if (!allowed.allowed) throw new TournamentDomainError("NEXT_ROUND_NOT_AVAILABLE", allowed.reason);
}

function chooseSitters(entries, count, history, rng, rankById = {}) {
  if (count <= 0) return [];
  return [...entries]
    .map((entry) => ({ entry, jitter: rng() }))
    .sort((left, right) => {
      const leftId = entryId(left.entry);
      const rightId = entryId(right.entry);
      const sitDiff = (history.sitCounts[leftId] || 0) - (history.sitCounts[rightId] || 0);
      if (sitDiff !== 0) return sitDiff;
      const consecutiveDiff =
        (history.consecutiveSits[leftId] || 0) - (history.consecutiveSits[rightId] || 0);
      if (consecutiveDiff !== 0) return consecutiveDiff;
      const rankDiff = (rankById[rightId] || 0) - (rankById[leftId] || 0);
      if (rankDiff !== 0) return rankDiff;
      if (left.jitter !== right.jitter) return left.jitter - right.jitter;
      return leftId.localeCompare(rightId);
    })
    .slice(0, count)
    .map(({ entry }) => entry);
}

function pairSocialGroup(ids, history) {
  const patterns = [
    [
      [ids[0], ids[3]],
      [ids[1], ids[2]],
    ],
    [
      [ids[0], ids[1]],
      [ids[2], ids[3]],
    ],
    [
      [ids[0], ids[2]],
      [ids[1], ids[3]],
    ],
  ];
  return patterns
    .map((pattern) => ({ pattern, cost: socialPatternCost(pattern, history) }))
    .sort(
      (left, right) =>
        left.cost - right.cost ||
        JSON.stringify(left.pattern).localeCompare(JSON.stringify(right.pattern)),
    )[0].pattern;
}

function socialPatternCost(pattern, history) {
  const [a, b] = pattern;
  const groupKey = [...a, ...b].sort().join("|");
  let cost = (history.groupCounts[groupKey] || 0) * 25;
  cost += pairCount(history.partnerCounts, a[0], a[1]) * 100;
  cost += pairCount(history.partnerCounts, b[0], b[1]) * 100;
  for (const left of a)
    for (const right of b) cost += pairCount(history.opponentCounts, left, right) * 10;
  return cost;
}

function pairCount(map, left, right) {
  return map[left]?.[right] || 0;
}

function entryId(entry) {
  return entry.participantId || entry.teamId;
}

function completedRound(state, roundIdValue) {
  const fixtures = (state.fixtures || []).filter(
    (fixture) => fixture.roundId === roundIdValue && fixture.status !== "bye",
  );
  return (
    fixtures.length > 0 &&
    fixtures.every((fixture) => fixture.status === "completed" && fixtureOutcome(fixture))
  );
}

function calculateRoundResult(state, roundIdValue) {
  const fixtures = (state.fixtures || []).filter((fixture) => fixture.roundId === roundIdValue);
  return {
    roundId: roundIdValue,
    complete: fixtures
      .filter((fixture) => fixture.status !== "bye")
      .every((fixture) => fixtureOutcome(fixture)),
    results: fixtures.map((fixture) => ({
      fixtureId: fixture.fixtureId,
      outcome: fixtureOutcome(fixture),
    })),
  };
}

function activeEntriesByMode(state, mode) {
  return mode === "individual"
    ? (state.participants || []).filter((participant) => participant.status === "active")
    : (state.teams || []).filter((team) => team.status === "active");
}

module.exports = {
  toInt,
  maxRoundNumber,
  nextRoundNumber,
  baseRound,
  makeFixture,
  seedFor,
  createRng,
  shuffle,
  buildHistory,
  sideFromParticipants,
  sideFromTeam,
  socialDefaultConfig,
  socialConfigValidation,
  canGenerateAfterComplete,
  requireNextRoundAllowed,
  chooseSitters,
  pairSocialGroup,
  socialPatternCost,
  pairCount,
  entryId,
  completedRound,
  calculateRoundResult,
  activeEntriesByMode,
};
