const { TournamentDomainError } = require("./errors");

function supportsFullSchedule(format) {
  return ["americano", "teamAmericano"].includes(format.id);
}

function forecastRoundCount(format, state) {
  const { tournament } = state;
  const configured = tournament.scheduling?.targetRoundCount || tournament.forecastRoundCount;
  if (configured) return configured;
  const teamMode = state.tournament.participantMode === "team" || format.entryMode === "team";
  const entries = teamMode ? state.teams : state.participants;
  const count = (entries || []).filter((entry) => entry.status === "active").length;
  const courts = Math.max(1, tournament.courtPool?.length || 1);
  const perRound = teamMode ? Math.ceil(Math.floor(count / 2) / courts) : 1;
  const minutes =
    (tournament.scheduling?.defaultMatchDurationMinutes || 20) +
    (tournament.scheduling?.defaultChangeoverMinutes || 0);
  const { startAt, plannedEndAt } = tournament.scheduling || {};
  if (startAt && plannedEndAt > startAt) {
    return Math.max(
      1,
      Math.min(200, Math.floor((plannedEndAt - startAt) / (60000 * minutes * perRound))),
    );
  }
  return Math.max(1, Math.min(200, teamMode && count % 2 ? count : count - 1));
}

function generateSchedule(format, state, target = forecastRoundCount(format, state)) {
  if (Math.max(0, ...(state.rounds || []).map((round) => round.roundNumber)) >= target) {
    return { rounds: [], fixtures: [] };
  }
  const validation = format.validateParticipants(state);
  if (validation.errors.length) {
    throw new TournamentDomainError(validation.errors[0].code, validation.errors[0].message);
  }
  const working = {
    ...state,
    scheduleForecast: true,
    rounds: [...(state.rounds || [])],
    fixtures: [...(state.fixtures || [])],
  };
  const generation = { rounds: [], fixtures: [] };
  let last = Math.max(0, ...working.rounds.map((round) => round.roundNumber));
  while (last < target) {
    // Americano pairings do not need scores, but must count earlier planned pairings.
    const next = format.generateInitialRound(working);
    generation.rounds.push(...next.rounds);
    generation.fixtures.push(...next.fixtures);
    working.rounds.push(...next.rounds);
    working.fixtures.push(...next.fixtures);
    last = Math.max(...next.rounds.map((round) => round.roundNumber));
  }
  return generation;
}

function forecastRemainingRounds(format, state, nowMs) {
  if (
    !format.supportsNextRound ||
    supportsFullSchedule(format) ||
    !state.rounds.length ||
    ["completed", "cancelled"].includes(state.tournament.status)
  )
    return [];
  const target =
    format.id === "swiss"
      ? state.tournament.format.config.roundCount ||
        state.tournament.scheduling?.targetRoundCount ||
        Math.ceil(
          Math.log2(Math.max(2, state.teams.filter((team) => team.status === "active").length)),
        ) + 1
      : forecastRoundCount(format, state);
  const last = Math.max(...state.rounds.map((round) => round.roundNumber));
  const fixtures = state.fixtures.filter((fixture) => fixture.roundNumber === last);
  const scheduling = state.tournament.scheduling || {};
  const minutes =
    (scheduling.defaultMatchDurationMinutes || 20) + (scheduling.defaultChangeoverMinutes || 0);
  const courts = Math.max(1, state.tournament.courtPool?.length || 1);
  const roundMinutes =
    Math.max(1, Math.ceil(fixtures.filter((fixture) => fixture.status !== "bye").length / courts)) *
    minutes;
  const start = Math.max(
    nowMs,
    ...fixtures.map((fixture) => Number(fixture.scheduledStartAt || 0) + minutes * 60000),
  );
  return Array.from({ length: Math.max(0, target - last) }, (_, index) => ({
    roundNumber: last + index + 1,
    label: `Round ${last + index + 1}`,
    scheduledStartAt: start + index * roundMinutes * 60000,
    pairingsPending: true,
  }));
}

module.exports = {
  supportsFullSchedule,
  forecastRoundCount,
  generateSchedule,
  forecastRemainingRounds,
};
