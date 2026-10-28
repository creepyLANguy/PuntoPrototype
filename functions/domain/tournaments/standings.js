const { activeParticipants, activeTeams, entryIdsOfSide } = require("./entities");
const { fixtureOutcome } = require("./results");

const TIEBREAKER_LABELS = {
  placement: "Final placement",
  totalPoints: "Total points",
  competitionPoints: "Competition points",
  wins: "Wins",
  pointDiff: "Point difference",
  pointsFor: "Points for",
  setDiff: "Set difference",
  gameDiff: "Game difference",
  headToHead: "Head-to-head match points",
  buchholz: "Buchholz (opponent competition points, counting each encounter)",
  seed: "Seed",
  finalCourtPosition: "Final court position",
  courtPoints: "Court-level points",
  rallyPoints: "Rally points",
  entryId: "Draw order (display only)",
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
  // An array is intentional here: Buchholz counts every encounter, including
  // a rematch against the same opponent, rather than each opponent only once.
  const opponents = {};
  const mode = options.mode || "league";
  const pointsForWin = Number(options.pointsForWin ?? 3);
  const pointsForDraw = Number(options.pointsForDraw ?? 1);
  const pointsForLoss = Number(options.pointsForLoss ?? 0);

  for (const fixture of state.fixtures || []) {
    if (typeof options.fixtureFilter === "function" && !options.fixtureFilter(fixture)) continue;
    if (fixture.status === "bye") {
      const ids = [
        ...entryIdsOfSide(fixture.sides?.A),
        ...entryIdsOfSide(fixture.sides?.B),
      ];
      for (const id of ids) if (rowsById[id]) rowsById[id].byes += 1;
      continue;
    }
    const outcome = fixtureOutcome(fixture);
    if (!outcome || fixture.status !== "completed") continue;

    const aIds = entryIdsOfSide(fixture.sides?.A).filter((id) => rowsById[id]);
    const bIds = entryIdsOfSide(fixture.sides?.B).filter((id) => rowsById[id]);
    const sideEntries = { A: aIds, B: bIds };
    const sideTotals = { A: Number(outcome.points?.A) || 0, B: Number(outcome.points?.B) || 0 };
    const gameTotals = { A: Number(outcome.games?.A) || 0, B: Number(outcome.games?.B) || 0 };
    const setTotals = { A: Number(outcome.sets?.A) || 0, B: Number(outcome.sets?.B) || 0 };
    for (const side of ["A", "B"]) {
      const other = side === "A" ? "B" : "A";
      for (const id of sideEntries[side]) {
        const row = rowsById[id];
        row.played += 1;
        row.pointsFor += sideTotals[side];
        row.pointsAgainst += sideTotals[other];
        row.pointDiff = row.pointsFor - row.pointsAgainst;
        row.gamesFor += gameTotals[side];
        row.gamesAgainst += gameTotals[other];
        row.gameDiff = row.gamesFor - row.gamesAgainst;
        row.setsFor += setTotals[side];
        row.setsAgainst += setTotals[other];
        row.setDiff = row.setsFor - row.setsAgainst;
        row.rallyPoints += sideTotals[side];
        if (Number.isFinite(Number(fixture.courtLevel))) {
          if (outcome.winner === side) row.courtPoints += Number(fixture.courtLevel);
        }
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
        opponents[id] = opponents[id] || [];
        for (const opponent of sideEntries[other]) opponents[id].push(opponent);
      }
    }

    for (const a of sideEntries.A)
      for (const b of sideEntries.B)
        addHeadToHead(headToHead, a, b, outcome, pointsForWin, pointsForDraw, pointsForLoss);
  }

  for (const round of state.rounds || []) {
    const sitIds =
      entryType === "participant"
        ? round.sittingOutParticipantIds || []
        : round.sittingOutTeamIds || [];
    for (const id of sitIds) if (rowsById[id]) rowsById[id].sittingOut += 1;
  }

  if (options.includeFinalCourtPosition) applyFinalCourtPositions(state, rowsById, entryType);

  const rows = Object.values(rowsById);
  for (const row of rows) {
    row.avgPerRound = row.played ? row.totalPoints / row.played : 0;
    row.buchholz = (opponents[row.entryId] || []).reduce(
      (sum, opponentId) => sum + (rowsById[opponentId]?.competitionPoints || 0),
      0,
    );
  }

  let tiebreakers = options.tiebreakers || defaultTiebreakers(options.formatId, mode, options);
  if (options.usePointDiff === false) tiebreakers = tiebreakers.filter((key) => key !== "pointDiff");
  rows.sort((left, right) => compareRows(left, right, tiebreakers, headToHead));

  // Rank is a sporting position, not the deterministic row order. Entries that
  // tie on every configured sporting tiebreaker share a competition rank (1, 1,
  // 3); entryId is only a stable display-order fallback and never breaks a tie.
  let rank = 0;
  let previous = null;
  rows.forEach((row, index) => {
    if (
      index === 0 ||
      compareRows(row, previous, tiebreakers.filter((key) => key !== "entryId"), headToHead, false) !== 0
    ) {
      rank = index + 1;
    }
    row.rank = rank;
    previous = row;
  });

  return {
    entryType,
    columns: ["rank", "name", "played", "wins", "draws", "losses", "points", "diff", "form"],
    tiebreakers,
    tiebreakerLabels: describeTiebreakers(tiebreakers),
    rows,
  };
}

function applyFinalCourtPositions(state, rowsById, entryType) {
  const lastCompletedRound = [...(state.rounds || [])]
    .sort((a, b) => b.roundNumber - a.roundNumber)
    .find((round) =>
      (state.fixtures || []).some(
        (fixture) =>
          fixture.roundId === round.roundId &&
          fixture.status === "completed" &&
          fixtureOutcome(fixture),
      ),
    );
  if (!lastCompletedRound) return;
  for (const fixture of state.fixtures || []) {
    if (fixture.roundId !== lastCompletedRound.roundId || fixture.status !== "completed") continue;
    const position = Number(fixture.courtLevel);
    if (!Number.isFinite(position) || position < 1) continue;
    const ids = entryType === "participant"
      ? [...(fixture.sides?.A?.participantIds || []), ...(fixture.sides?.B?.participantIds || [])]
      : [fixture.sides?.A?.teamId, fixture.sides?.B?.teamId].filter(Boolean);
    for (const id of ids) if (rowsById[id]) rowsById[id].finalCourtPosition = position;
  }
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
      seed: entry.seed == null || !Number.isFinite(Number(entry.seed))
        ? Number.MAX_SAFE_INTEGER
        : Number(entry.seed),
      finalCourtPosition: Number.MAX_SAFE_INTEGER,
      courtPoints: 0,
      rallyPoints: 0,
    };
  }
  return rows;
}

function defaultTiebreakers(formatId, mode, options = {}) {
  if (formatId === "americano") return ["totalPoints", "pointDiff", "pointsFor", "entryId"];
  if (formatId === "mexicano" || formatId === "teamMexicano") {
    return ["totalPoints", "pointDiff", "pointsFor", "headToHead", "seed", "entryId"];
  }
  if (formatId === "teamAmericano")
    return ["totalPoints", "pointDiff", "pointsFor", "seed", "entryId"];
  if (formatId === "swiss") {
    return ["competitionPoints", "wins", "pointDiff", "buchholz", "pointsFor", "seed", "entryId"];
  }
  if (formatId === "kingCourt") {
    if (options.finalRanking === "points") {
      return options.scoringMethod === "rallyPoints"
        ? ["rallyPoints", "courtPoints", "finalCourtPosition", "entryId"]
        : ["courtPoints", "rallyPoints", "finalCourtPosition", "entryId"];
    }
    return ["finalCourtPosition", "courtPoints", "rallyPoints", "entryId"];
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

function compareRows(left, right, tiebreakers, headToHead, stableFallback = true) {
  for (const key of tiebreakers) {
    let diff = 0;
    if (key === "entryId") diff = String(left.entryId).localeCompare(String(right.entryId));
    else if (key === "seed") diff = left.seed - right.seed;
    else if (key === "headToHead")
      diff =
        (headToHead[right.entryId]?.[left.entryId] || 0) -
        (headToHead[left.entryId]?.[right.entryId] || 0);
    else if (key === "finalCourtPosition" || key === "placement")
      diff = Number(left[key] ?? Number.MAX_SAFE_INTEGER) - Number(right[key] ?? Number.MAX_SAFE_INTEGER);
    else diff = Number(right[key] || 0) - Number(left[key] || 0);
    if (diff !== 0) return diff;
  }
  return stableFallback
    ? String(left.entryId).localeCompare(String(right.entryId))
    : 0;
}

function addHeadToHead(table, a, b, outcome, pointsForWin, pointsForDraw, pointsForLoss) {
  table[a] = table[a] || {};
  table[b] = table[b] || {};
  const wonA = outcome.winner === "A";
  const wonB = outcome.winner === "B";
  const draw = outcome.winner === "draw";
  const aPoints = wonA ? pointsForWin : draw ? pointsForDraw : pointsForLoss;
  const bPoints = wonB ? pointsForWin : draw ? pointsForDraw : pointsForLoss;
  table[a][b] = (table[a][b] || 0) + aPoints;
  table[b][a] = (table[b][a] || 0) + bPoints;
}

module.exports = { calculateStandings, TIEBREAKERS, describeTiebreakers };
