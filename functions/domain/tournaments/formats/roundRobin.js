const { calculateStandings: standings } = require("../standings");
const {
  baseRound,
  calculateRoundResult,
  completedRound,
  makeFixture,
  nextRoundNumber,
  seedFor,
  sideFromTeam,
  toInt,
} = require("./shared");
const { TournamentDomainError } = require("../errors");

const roundRobin = {
  id: "roundRobin",
  label: "Round Robin",
  entryMode: "team",
  kind: "league",
  supportsNextRound: true,
  defaultConfig: () => ({
    scheduleMode: "full",
    pointsForWin: 3,
    pointsForDraw: 1,
    pointsForLoss: 0,
  }),
  normalizeConfig(config = {}) {
    return {
      scheduleMode: config.scheduleMode === "roundByRound" ? "roundByRound" : "full",
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
          ? [{ code: "INSUFFICIENT_TEAMS", message: "Round Robin needs at least 2 teams." }]
          : [],
      warnings: [],
    };
  },
  generateInitialRound(state) {
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    const schedule = buildSchedule(state);
    return buildGeneration(
      state,
      schedule,
      cfg.scheduleMode === "full" ? schedule.rounds.length : 1,
      0,
    );
  },
  generateNextRound(state) {
    const allowed = this.canGenerateNextRound(state);
    if (!allowed.allowed)
      throw new TournamentDomainError("NEXT_ROUND_NOT_AVAILABLE", allowed.reason);
    const schedule = buildSchedule(state);
    return buildGeneration(state, schedule, 1, (state.rounds || []).length);
  },
  canGenerateNextRound(state) {
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    if (cfg.scheduleMode !== "roundByRound")
      return { allowed: false, reason: "Full schedule is generated initially." };
    const schedule = buildSchedule(state);
    if ((state.rounds || []).length >= schedule.rounds.length)
      return { allowed: false, reason: "Round Robin complete." };
    const last = [...(state.rounds || [])].sort((a, b) => b.roundNumber - a.roundNumber)[0];
    if (last && !completedRound(state, last.roundId))
      return { allowed: false, reason: "Previous round is incomplete." };
    return { allowed: true, reason: null };
  },
  calculateStandings(state) {
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    return standings(state, { entryType: "team", mode: "league", formatId: "roundRobin", ...cfg });
  },
  calculateRoundResult,
  getRulesSummary(config) {
    const cfg = this.normalizeConfig(config);
    return {
      title: "ROUND ROBIN",
      lines: [
        "Every team plays every other team once",
        `${cfg.pointsForWin} points for a win`,
        `${cfg.pointsForDraw} point for a draw`,
        "Tie-breaks: competition points, wins, head-to-head, set/game/point difference",
      ],
    };
  },
};

function buildSchedule(state) {
  const teams = (state.teams || [])
    .filter((team) => team.status === "active")
    .sort((a, b) => (a.seed || 9999) - (b.seed || 9999) || a.teamId.localeCompare(b.teamId));
  const entries = teams.length % 2 === 0 ? [...teams] : [...teams, null];
  const rounds = [];
  const n = entries.length;
  for (let roundIndex = 0; roundIndex < n - 1; roundIndex += 1) {
    const pairs = [];
    for (let i = 0; i < n / 2; i += 1) pairs.push([entries[i], entries[n - 1 - i]]);
    rounds.push(pairs);
    entries.splice(1, 0, entries.pop());
  }
  return { teams, rounds };
}

function buildGeneration(state, schedule, count, startScheduleIndex) {
  const rounds = [];
  const fixtures = [];
  const firstRoundNumber = nextRoundNumber(state);
  for (let offset = 0; offset < count; offset += 1) {
    const roundNumber = firstRoundNumber + offset;
    const scheduleIndex = startScheduleIndex + offset;
    const seed = seedFor(state, roundNumber);
    const round = baseRound(roundNumber, `Round ${roundNumber}`, null, seed, {
      algorithm: "round-robin-circle-v1",
      scheduleIndex,
    });
    for (const [left, right] of schedule.rounds[scheduleIndex] || []) {
      const index = fixtures.filter((fixture) => fixture.roundNumber === roundNumber).length;
      if (!left || !right) {
        const team = left || right;
        round.sittingOutTeamIds.push(team.teamId);
        fixtures.push(
          makeFixture({
            roundNumber,
            index,
            label: `Round ${roundNumber} - Bye`,
            sides: { A: sideFromTeam(team), B: null },
            status: "bye",
          }),
        );
      } else {
        fixtures.push(
          makeFixture({
            roundNumber,
            index,
            label: `Round ${roundNumber} - Match ${index + 1}`,
            sides: { A: sideFromTeam(left), B: sideFromTeam(right) },
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

module.exports = roundRobin;
