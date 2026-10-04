const { calculateStandings: standings } = require("../standings");
const { TournamentDomainError } = require("../errors");
const { fixtureOutcome } = require("../results");
const { advanceBracketState, nextPowerOfTwo, seedOrder, setFeed } = require("./bracketHelpers");
const {
  baseRound,
  calculateRoundResult,
  makeFixture,
  nextRoundNumber,
  seedFor,
  sideFromTeam,
  toInt,
} = require("./shared");

const groupKnockout = {
  id: "groupKnockout",
  label: "Group + Knockout",
  entryMode: "team",
  kind: "groupBracket",
  supportsNextRound: true,
  defaultConfig: () => ({
    groupCount: 2,
    advancePerGroup: 2,
    thirdPlaceMatch: false,
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
  }),
  normalizeConfig(config = {}) {
    return {
      groupCount: toInt(config.groupCount, 2, 1, 16),
      advancePerGroup: toInt(config.advancePerGroup, 2, 1, 8),
      thirdPlaceMatch: Boolean(config.thirdPlaceMatch),
      pointsForWin: toInt(config.pointsForWin, 3),
      pointsForDraw: toInt(config.pointsForDraw, 1),
      pointsForLoss: toInt(config.pointsForLoss, 0),
    };
  },
  validateConfig(config = {}) {
    const cfg = this.normalizeConfig(config);
    const errors = [];
    if (cfg.groupCount < 1)
      errors.push({ code: "INVALID_GROUP_COUNT", message: "groupCount must be positive." });
    if (cfg.advancePerGroup < 1)
      errors.push({ code: "INVALID_ADVANCE_COUNT", message: "advancePerGroup must be positive." });
    return { errors, warnings: [] };
  },
  validateParticipants(state) {
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    const active = (state.teams || []).filter((team) => team.status === "active");
    const errors = [];
    if (active.length < cfg.groupCount * 2)
      errors.push({
        code: "INSUFFICIENT_TEAMS",
        message: "Not enough teams for configured groups.",
      });
    if (cfg.groupCount * cfg.advancePerGroup < 2)
      errors.push({ code: "INVALID_QUALIFIERS", message: "At least two qualifiers are required." });
    return { errors, warnings: [] };
  },
  generateInitialRound(state) {
    return generateGroups(state);
  },
  generateNextRound(state) {
    const allowed = this.canGenerateNextRound(state);
    if (!allowed.allowed)
      throw new TournamentDomainError("NEXT_ROUND_NOT_AVAILABLE", allowed.reason);
    return generateKnockout(state);
  },
  canGenerateNextRound(state) {
    if ((state.fixtures || []).some((fixture) => fixture.stage === "knockout"))
      return { allowed: false, reason: "Knockout already generated." };
    const groupFixtures = (state.fixtures || []).filter((fixture) => fixture.stage === "group");
    if (groupFixtures.length === 0) return { allowed: false, reason: "Group stage not generated." };
    const incomplete = groupFixtures.some(
      (fixture) => fixture.status !== "completed" || !fixtureOutcome(fixture),
    );
    return incomplete
      ? { allowed: false, reason: "Group stage incomplete." }
      : { allowed: true, reason: null };
  },
  calculateStandings(state) {
    const groups = groupAssignments(
      state,
      this.normalizeConfig(state.tournament?.format?.config || {}),
    );
    const groupIdByTeamId = {};
    for (const [groupId, teams] of Object.entries(groups))
      for (const team of teams) groupIdByTeamId[team.teamId] = groupId;
    return standings(state, {
      entryType: "team",
      mode: "league",
      formatId: "roundRobin",
      groupIdByTeamId,
    });
  },
  calculateRoundResult,
  getRulesSummary(config) {
    const cfg = this.normalizeConfig(config);
    return {
      title: "GROUP + KNOCKOUT",
      lines: [
        `${cfg.groupCount} groups`,
        `${cfg.advancePerGroup} advance per group`,
        "Group round robin followed by knockout",
      ],
    };
  },
  generateBracket: generateKnockout,
  advanceBracket(state, completedFixtureId) {
    return advanceBracketState(state, completedFixtureId);
  },
};

function groupAssignments(state, cfg) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const groups = Object.fromEntries(letters.slice(0, cfg.groupCount).map((letter) => [letter, []]));
  const teams = (state.teams || [])
    .filter((team) => team.status === "active")
    .sort((a, b) => (a.seed || 9999) - (b.seed || 9999) || a.teamId.localeCompare(b.teamId));
  teams.forEach((team, index) => {
    const cycle = Math.floor(index / cfg.groupCount);
    const offset = index % cfg.groupCount;
    const groupIndex = cycle % 2 === 0 ? offset : cfg.groupCount - 1 - offset;
    groups[letters[groupIndex]].push(team);
  });
  return groups;
}

function generateGroups(state) {
  const cfg = groupKnockout.normalizeConfig(state.tournament?.format?.config || {});
  const groups = groupAssignments(state, cfg);
  const schedules = Object.entries(groups).map(([groupId, teams]) => [groupId, circle(teams)]);
  const maxRounds = Math.max(...schedules.map(([, rounds]) => rounds.length));
  const firstRound = nextRoundNumber(state);
  const seed = seedFor(state, firstRound, ":groups");
  const rounds = [];
  const fixtures = [];
  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex += 1) {
    const roundNumber = firstRound + roundIndex;
    const round = baseRound(roundNumber, `Group Round ${roundIndex + 1}`, "group", seed, {
      algorithm: "group-round-robin-v1",
      groupRound: roundIndex + 1,
    });
    for (const [groupId, groupRounds] of schedules) {
      for (const [a, b] of groupRounds[roundIndex] || []) {
        fixtures.push(
          makeFixture({
            roundNumber,
            index: fixtures.filter((fixture) => fixture.roundNumber === roundNumber).length,
            label: `Group ${groupId} - Round ${roundIndex + 1}`,
            stage: "group",
            groupId,
            sides: { A: sideFromTeam(a), B: sideFromTeam(b) },
          }),
        );
      }
    }
    round.fixtureIds = fixtures
      .filter((fixture) => fixture.roundNumber === roundNumber)
      .map((fixture) => fixture.fixtureId);
    rounds.push(round);
  }
  return { rounds, fixtures };
}

function circle(teams) {
  if (teams.length < 2) return [];
  const entries = teams.length % 2 === 0 ? [...teams] : [...teams, null];
  const rounds = [];
  for (let round = 0; round < entries.length - 1; round += 1) {
    const pairs = [];
    for (let i = 0; i < entries.length / 2; i += 1) {
      const a = entries[i];
      const b = entries[entries.length - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    rounds.push(pairs);
    entries.splice(1, 0, entries.pop());
  }
  return rounds;
}

function generateKnockout(state) {
  const cfg = groupKnockout.normalizeConfig(state.tournament?.format?.config || {});
  const rowsByGroup = {};
  for (const row of groupKnockout.calculateStandings(state).rows) {
    rowsByGroup[row.groupId] = rowsByGroup[row.groupId] || [];
    rowsByGroup[row.groupId].push(row);
  }
  const teamById = Object.fromEntries((state.teams || []).map((team) => [team.teamId, team]));
  const qualifiers = [];
  for (const groupId of Object.keys(rowsByGroup).sort()) {
    for (const row of rowsByGroup[groupId].slice(0, cfg.advancePerGroup))
      qualifiers.push({ groupId, rank: row.rank, team: teamById[row.entryId] });
  }
  const firstRound = nextRoundNumber(state);
  const seed = seedFor(state, firstRound, ":ko");
  const fixtures = [];
  const rounds = [];
  const size = nextPowerOfTwo(qualifiers.length);
  const ordered = crossSeed(qualifiers).flat();
  while (ordered.length < size) ordered.push(null);
  const slots = Array(size).fill(null);
  seedOrder(size).forEach((seedNumber, index) => {
    slots[index] = ordered[seedNumber - 1] || null;
  });
  const totalRounds = Math.log2(size);
  const byPosition = {};
  let previous = [];
  for (let bracketRound = 1; bracketRound <= totalRounds; bracketRound += 1) {
    const roundNumber = firstRound + bracketRound - 1;
    const round = baseRound(
      roundNumber,
      bracketRound === totalRounds ? "Final" : `Knockout Round ${bracketRound}`,
      "knockout",
      seed,
      { algorithm: "group-knockout-v1", bracketRound },
    );
    const positions = [];
    const matches = size / 2 ** bracketRound;
    for (let index = 0; index < matches; index += 1) {
      const position = `KO-R${bracketRound}-M${index + 1}`;
      positions.push(position);
      let sides;
      let sourceRefs = { A: null, B: null };
      if (bracketRound === 1) {
        const left = slots[index * 2];
        const right = slots[index * 2 + 1];
        sides = {
          A: left ? sideFromTeam(left.team) : null,
          B: right ? sideFromTeam(right.team) : null,
        };
        sourceRefs = {
          A: left ? { groupId: left.groupId, rank: left.rank } : null,
          B: right ? { groupId: right.groupId, rank: right.rank } : null,
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
      const fixture = makeFixture({
        roundNumber,
        index,
        label:
          bracketRound === totalRounds
            ? "Final"
            : `Knockout Round ${bracketRound} - Match ${index + 1}`,
        stage: "knockout",
        sides,
        status: (sides.A && !sides.B) || (!sides.A && sides.B) ? "bye" : "scheduled",
        bracketPosition: position,
        sourceFixtureIds: [sourceRefs.A?.fixtureId, sourceRefs.B?.fixtureId].filter(Boolean),
        sourceRefs,
      });
      byPosition[position] = fixture;
      fixtures.push(fixture);
      if (bracketRound > 1) {
        setFeed(byPosition, previous[index * 2], "winner", fixture, "A");
        setFeed(byPosition, previous[index * 2 + 1], "winner", fixture, "B");
      }
    }
    round.fixtureIds = fixtures
      .filter((fixture) => fixture.roundNumber === roundNumber)
      .map((fixture) => fixture.fixtureId);
    rounds.push(round);
    previous = positions;
  }
  return { rounds, fixtures };
}

function crossSeed(qualifiers) {
  const sorted = [...qualifiers].sort(
    (a, b) => a.rank - b.rank || a.groupId.localeCompare(b.groupId),
  );
  const pairs = [];
  while (sorted.length > 0) {
    const left = sorted.shift();
    let index = sorted.findIndex((candidate) => candidate.groupId !== left.groupId);
    if (index < 0) index = sorted.length - 1;
    const right = index >= 0 ? sorted.splice(index, 1)[0] : null;
    pairs.push([left, right]);
  }
  return pairs;
}

module.exports = groupKnockout;
