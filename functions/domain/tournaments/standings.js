const { activeParticipants, activeTeams, entryIdsOfSide } = require("./entities");
const { fixtureOutcome } = require("./results");

const TIEBREAKER_LABELS = {
  totalPoints: "Total points",
  competitionPoints: "Competition points",
  wins: "Wins",
  pointDiff: "Point difference",
  pointsFor: "Points for",
  setDiff: "Set difference",
  gameDiff: "Game difference",
  headToHead: "Head-to-head",
  buchholz: "Buchholz",
  seed: "Seed",
  entryId: "Draw order",
};

const TIEBREAKERS = Object.keys(TIEBREAKER_LABELS).reduce((registry, key) => {
  registry[key] = key;
  return registry;
}, {});

function describeTiebreakers(keys) {
  return keys.map((key) => TIEBREAKER_LABELS[key] || key);
}

function calculateStandings(state, options = {}) {
  const entryType =
    options.entryType ||
    (state.tournament?.participantMode === "individual" ? "participant" : "team");
  const rowsById = buildRows(state, entryType, options.groupIdByTeamId || {});
  const headToHead = {};
  const opponents = {};
  const mode = options.mode || "league";
  const pointsForWin = Number(options.pointsForWin ?? 3);
  const pointsForDraw = Number(options.pointsForDraw ?? 1);
  const pointsForLoss = Number(options.pointsForLoss ?? 0);

  for (const fixture of state.fixtures || []) {
    const outcome = fixtureOutcome(fixture);
    const aIds = entryIdsOfSide(fixture.sides?.A);
    const bIds = entryIdsOfSide(fixture.sides?.B);

    if (fixture.status === "bye") {
      for (const id of [...aIds, ...bIds]) if (rowsById[id]) rowsById[id].byes += 1;
      continue;
    }
    if (!outcome) continue;

    const sideEntries = {
      A: aIds.filter((id) => rowsById[id]),
      B: bIds.filter((id) => rowsById[id]),
    };
    const sideTotals = { A: outcome.points.A, B: outcome.points.B };
    for (const side of ["A", "B"]) {
      const other = side === "A" ? "B" : "A";
      for (const id of sideEntries[side]) {
        const row = rowsById[id];
        row.played += 1;
        row.pointsFor += sideTotals[side];
        row.pointsAgainst += sideTotals[other];
        row.pointDiff = row.pointsFor - row.pointsAgainst;
        row.gamesFor += outcome.games[side];
        row.gamesAgainst += outcome.games[other];
        row.gameDiff = row.gamesFor - row.gamesAgainst;
        row.setsFor += outcome.sets[side];
        row.setsAgainst += outcome.sets[other];
        row.setDiff = row.setsFor - row.setsAgainst;
        if (mode === "social") {
          row.totalPoints += sideTotals[side];
          row.lastRoundPoints = sideTotals[side];
        } else {
          const won = outcome.winner === side;
          const draw = outcome.winner === "draw";
          row.wins += won ? 1 : 0;
          row.draws += draw ? 1 : 0;
          row.losses += !won && !draw ? 1 : 0;
          row.competitionPoints += won ? pointsForWin : draw ? pointsForDraw : pointsForLoss;
          row.form.push(won ? "W" : draw ? "D" : "L");
          if (row.form.length > 5) row.form.shift();
        }
        opponents[id] = opponents[id] || new Set();
        for (const opponent of sideEntries[other]) opponents[id].add(opponent);
      }
    }

    for (const a of sideEntries.A)
      for (const b of sideEntries.B) addHeadToHead(headToHead, a, b, outcome);
  }

  for (const round of state.rounds || []) {
    const sitIds =
      entryType === "participant"
        ? round.sittingOutParticipantIds || []
        : round.sittingOutTeamIds || [];
    for (const id of sitIds) if (rowsById[id]) rowsById[id].sittingOut += 1;
  }

  const rows = Object.values(rowsById);
  for (const row of rows) {
    row.avgPerRound = row.played ? row.totalPoints / row.played : 0;
    row.buchholz = [...(opponents[row.entryId] || [])].reduce(
      (sum, opponentId) => sum + (rowsById[opponentId]?.competitionPoints || 0),
      0,
    );
  }

  const tiebreakers = options.tiebreakers || defaultTiebreakers(options.formatId, mode);
  rows.sort((left, right) => compareRows(left, right, tiebreakers, headToHead));
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return {
    entryType,
    columns: ["rank", "name", "played", "wins", "draws", "losses", "points", "diff", "form"],
    tiebreakers,
    tiebreakerLabels: describeTiebreakers(tiebreakers),
    rows,
  };
}

function buildRows(state, entryType, groupIdByTeamId) {
  const entries =
    entryType === "participant"
      ? state.participants || activeParticipants(state)
      : state.teams || activeTeams(state);
  const idKey = entryType === "participant" ? "participantId" : "teamId";
  const nameKey = entryType === "participant" ? "displayName" : "name";
  const rows = {};
  for (const entry of entries) {
    rows[entry[idKey]] = {
      rank: null,
      entryId: entry[idKey],
      name: entry[nameKey] || entry.shortName || entry[idKey],
      status: entry.status || "active",
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      byes: 0,
      sittingOut: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      gamesFor: 0,
      gamesAgainst: 0,
      gameDiff: 0,
      setsFor: 0,
      setsAgainst: 0,
      setDiff: 0,
      competitionPoints: 0,
      totalPoints: 0,
      avgPerRound: 0,
      lastRoundPoints: 0,
      buchholz: 0,
      form: [],
      groupId: groupIdByTeamId[entry[idKey]] || null,
      eliminated: false,
      placement: null,
      seed: entry.seed == null ? Number.MAX_SAFE_INTEGER : Number(entry.seed),
    };
  }
  return rows;
}

function defaultTiebreakers(formatId, mode) {
  if (formatId === "americano") return ["totalPoints", "pointDiff", "pointsFor", "entryId"];
  if (formatId === "mexicano" || formatId === "teamMexicano") {
    return ["totalPoints", "pointDiff", "pointsFor", "headToHead", "seed", "entryId"];
  }
  if (formatId === "teamAmericano")
    return ["totalPoints", "pointDiff", "pointsFor", "seed", "entryId"];
  if (formatId === "swiss") {
    return ["competitionPoints", "wins", "pointDiff", "buchholz", "pointsFor", "seed", "entryId"];
  }
  if (mode === "social") return ["totalPoints", "pointDiff", "pointsFor", "entryId"];
  return [
    "competitionPoints",
    "wins",
    "headToHead",
    "setDiff",
    "gameDiff",
    "pointDiff",
    "pointsFor",
    "seed",
    "entryId",
  ];
}

function compareRows(left, right, tiebreakers, headToHead) {
  for (const key of tiebreakers) {
    let diff = 0;
    if (key === "entryId") diff = String(left.entryId).localeCompare(String(right.entryId));
    else if (key === "seed") diff = left.seed - right.seed;
    else if (key === "headToHead")
      diff =
        (headToHead[right.entryId]?.[left.entryId] || 0) -
        (headToHead[left.entryId]?.[right.entryId] || 0);
    else diff = Number(right[key] || 0) - Number(left[key] || 0);
    if (diff !== 0) return diff;
  }
  return String(left.entryId).localeCompare(String(right.entryId));
}

function addHeadToHead(table, a, b, outcome) {
  table[a] = table[a] || {};
  table[b] = table[b] || {};
  table[a][b] = (table[a][b] || 0) + outcome.points.A - outcome.points.B;
  table[b][a] = (table[b][a] || 0) + outcome.points.B - outcome.points.A;
}

module.exports = { calculateStandings, TIEBREAKERS, describeTiebreakers };
