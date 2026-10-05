function activeParticipants(state) {
  return (state.participants || [])
    .filter((participant) => participant.status === "active")
    .sort(compareSeeded("participantId"));
}

function activeTeams(state) {
  return (state.teams || [])
    .filter((team) => team.status === "active")
    .sort(compareSeeded("teamId"));
}

function compareSeeded(idKey) {
  return (left, right) => {
    const leftSeed = left.seed == null ? Number.MAX_SAFE_INTEGER : Number(left.seed);
    const rightSeed = right.seed == null ? Number.MAX_SAFE_INTEGER : Number(right.seed);
    if (leftSeed !== rightSeed) return leftSeed - rightSeed;
    return String(left[idKey]).localeCompare(String(right[idKey]));
  };
}

function entryMode(state) {
  return state?.tournament?.participantMode === "individual" ? "individual" : "team";
}

function entryIdsOfSide(side) {
  if (!side) return [];
  if (side.teamId) return [side.teamId];
  return [...(side.participantIds || [])];
}

function sideEntries(fixture) {
  return {
    A: entryIdsOfSide(fixture?.sides?.A),
    B: entryIdsOfSide(fixture?.sides?.B),
  };
}

function roundId(n) {
  return `r${n}`;
}

function fixtureId(roundNumber, index) {
  return `r${roundNumber}-m${index + 1}`;
}

function sideFromParticipants(participantIds) {
  return { participantIds: [...participantIds], teamId: null };
}

function sideFromTeam(team) {
  return { participantIds: [...(team.participantIds || [])], teamId: team.teamId };
}

function flatParticipants(sides) {
  return [...(sides.A?.participantIds || []), ...(sides.B?.participantIds || [])];
}

function flatTeams(sides) {
  return [sides.A?.teamId, sides.B?.teamId].filter(Boolean);
}

module.exports = {
  activeParticipants,
  activeTeams,
  entryMode,
  entryIdsOfSide,
  sideEntries,
  roundId,
  fixtureId,
  sideFromParticipants,
  sideFromTeam,
  flatParticipants,
  flatTeams,
};
