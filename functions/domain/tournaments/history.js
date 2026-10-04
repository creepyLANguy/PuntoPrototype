const { entryIdsOfSide } = require("./entities");
const { fixtureOutcome } = require("./results");

function buildHistory(state) {
  const history = {
    partnerCounts: {},
    opponentCounts: {},
    groupCounts: {},
    sitCounts: {},
    byeCounts: {},
    consecutiveSits: {},
    lastSatOutRound: {},
    playedCounts: {},
    opponentsOf: (id) => Object.keys(history.opponentCounts[id] || {}),
  };

  const rounds = [...(state.rounds || [])].sort(
    (left, right) => left.roundNumber - right.roundNumber,
  );
  for (const round of rounds) {
    for (const id of round.sittingOutParticipantIds || [])
      recordSit(history, id, round.roundNumber);
    for (const id of round.sittingOutTeamIds || []) recordSit(history, id, round.roundNumber);

    const fixtures = (state.fixtures || []).filter((fixture) => fixture.roundId === round.roundId);
    for (const fixture of fixtures) {
      const a = entryIdsOfSide(fixture.sides?.A);
      const b = entryIdsOfSide(fixture.sides?.B);
      if (fixture.status === "bye") {
        for (const id of [...a, ...b]) increment(history.byeCounts, id);
        continue;
      }
      if (!fixtureOutcome(fixture)) continue;
      const all = [...a, ...b];
      for (const id of all) increment(history.playedCounts, id);
      addGroup(history.groupCounts, all);
      addPartners(history.partnerCounts, a);
      addPartners(history.partnerCounts, b);
      addOpponents(history.opponentCounts, a, b);
    }
  }
  return history;
}

function recordSit(history, id, roundNumber) {
  increment(history.sitCounts, id);
  const wasPreviousRound = history.lastSatOutRound[id] === roundNumber - 1;
  history.consecutiveSits[id] = wasPreviousRound ? (history.consecutiveSits[id] || 0) + 1 : 1;
  history.lastSatOutRound[id] = roundNumber;
}

function increment(map, key, by = 1) {
  map[key] = (map[key] || 0) + by;
}

function pairKey(left, right) {
  return [left, right].sort().join("|");
}

function incrementPair(map, left, right) {
  if (!left || !right || left === right) return;
  const key = pairKey(left, right);
  map[left] = map[left] || {};
  map[right] = map[right] || {};
  map[left][right] = (map[left][right] || 0) + 1;
  map[right][left] = (map[right][left] || 0) + 1;
  map[key] = (map[key] || 0) + 1;
}

function addPartners(map, side) {
  for (let i = 0; i < side.length; i += 1) {
    for (let j = i + 1; j < side.length; j += 1) incrementPair(map, side[i], side[j]);
  }
}

function addOpponents(map, a, b) {
  for (const left of a) for (const right of b) incrementPair(map, left, right);
}

function addGroup(map, entries) {
  const key = [...entries].sort().join("|");
  if (key) map[key] = (map[key] || 0) + 1;
}

module.exports = { buildHistory };
