// Pure mapping from a tournament fixture to the normal Padel Push match that
// plays it (spec sections 2.2, 8.6 and 52).
const { resolveMatchScoringOptions } = require("./scoringProfiles");

const TEAM_NAME_MAX = 40;
const BRACKET_FORMATS = new Set(["singleElimination", "doubleElimination"]);
const KNOCKOUT_STAGES = new Set(["knockout", "winners", "losers", "grandFinal", "grandFinalReset"]);

function fixtureSidesComplete(fixture) {
  return Boolean(fixture?.sides?.A && fixture?.sides?.B);
}

function participantName(participantsById, id) {
  return participantsById[id]?.displayName || "";
}

function sideTeamName(side, { teamsById }) {
  if (!side) return "";
  if (side.teamId && teamsById[side.teamId]?.name) {
    return teamsById[side.teamId].name.slice(0, TEAM_NAME_MAX);
  }
  // Rotating partners have no team identity: the scoreboard shows the players
  // under the default side names instead of repeating them as a team name.
  return "";
}

function buildFixtureMatchSpec({ tournament, fixture, participantsById, teamsById }) {
  const lookups = { participantsById, teamsById };
  const sideA = fixture.sides?.A || null;
  const sideB = fixture.sides?.B || null;
  const playersA = sideA?.participantIds || [];
  const playersB = sideB?.participantIds || [];
  const scoringOptions = resolveMatchScoringOptions(
    tournament.format.id,
    tournament.format.config || {},
  );
  // Knockout matches need a winner: a fixed-total tie is decided by a golden
  // point instead of ending as a draw.
  const knockout = KNOCKOUT_STAGES.has(fixture.stage) || BRACKET_FORMATS.has(tournament.format.id);
  if (knockout && fixture.stage !== "group" && scoringOptions.scoringMode === "fixedTotalPoints") {
    scoringOptions.completion = { ...scoringOptions.completion, tieResolution: "golden_point" };
  }

  return {
    name: fixture.label || null,
    teamNames: {
      A: sideTeamName(sideA, lookups) || "Team A",
      B: sideTeamName(sideB, lookups) || "Team B",
    },
    playerNames: {
      A1: participantName(participantsById, playersA[0]),
      A2: participantName(participantsById, playersA[1]),
      B1: participantName(participantsById, playersB[0]),
      B2: participantName(participantsById, playersB[1]),
    },
    // The scoring profile is snapshotted onto every match so later changes to
    // tournament defaults never rewrite historical rules.
    scoringOptions,
    visibility: tournament.visibility === "private" ? "private" : "public",
  };
}

function matchNamesDiffer(match, spec) {
  return (
    JSON.stringify(match?.teamNames || {}) !== JSON.stringify(spec.teamNames) ||
    JSON.stringify(match?.playerNames || {}) !== JSON.stringify(spec.playerNames)
  );
}

module.exports = { fixtureSidesComplete, buildFixtureMatchSpec, matchNamesDiffer };
