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
  entryId: "Entry ID (display only)",
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
        const courtLevel = Number(fixture.courtLevel);
        const courtCount = Number(options.courtCount);
        if (
          fixture.courtLevel != null &&
          Number.isInteger(courtLevel) &&
          courtLevel >= 1 &&
          Number.isInteger(courtCount) &&
          courtCount >= courtLevel
        ) {
          // Court-priority points reward the court played, not the match winner.
          // Court 1 is the highest court, so its value is courtCount.
          row.courtPoints += courtCount - courtLevel + 1;
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

  // Evaluate each tie-breaker inside the group still tied on previous rules.
  // In particular, head-to-head is a mini-table against the other tied entries,
  // not a pairwise score-margin comparator (which can be non-transitive in a
  // three-way circular tie). IDs order tied rows for display only.
  const partitions = [];
  if (options.rankByGroup) {
    const byGroup = new Map();
    for (const row of rows) {
      const groupId = row.groupId || "";
      if (!byGroup.has(groupId)) byGroup.set(groupId, []);
      byGroup.get(groupId).push(row);
    }
    for (const [groupId, groupRows] of [...byGroup.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      partitions.push({ groupId, groups: rankRows(groupRows, tiebreakers, headToHead) });
    }
  } else {
    partitions.push({ groupId: null, groups: rankRows(rows, tiebreakers, headToHead) });
  }

  const rankedRows = [];
  for (const partition of partitions) {
    let position = 1;
    for (const group of partition.groups) {
      group.forEach((row) => {
        row.rank = position;
        rankedRows.push(row);
      });
      position += group.length;
    }
  }

  return {
    entryType,
    columns: ["rank", "name", "played", "wins", "draws", "losses", "points", "diff", "form"],
    tiebreakers,
    tiebreakerLabels: describeTiebreakers(tiebreakers),
    rows: rankedRows,
  };
}

function applyFinalCourtPositions(state, rowsById, entryType) {
  // A player/team may sit out the last round. Use their most recent court
  // appearance rather than demoting them to an invented, infinitely low court.
  const fixtures = (state.fixtures || [])
    .filter(
      (fixture) =>
        fixture.status === "completed" &&
        fixtureOutcome(fixture) &&
        Number.isFinite(Number(fixture.courtLevel)) &&
        Number(fixture.courtLevel) >= 1,
    )
    .sort(
      (a, b) =>
        b.roundNumber - a.roundNumber ||
        Number(a.courtLevel) - Number(b.courtLevel) ||
        String(a.fixtureId).localeCompare(String(b.fixtureId)),
    );
  for (const fixture of fixtures) {
    const position = Number(fixture.courtLevel);
    const ids =
      entryType === "participant"
        ? [...(fixture.sides?.A?.participantIds || []), ...(fixture.sides?.B?.participantIds || [])]
        : [fixture.sides?.A?.teamId, fixture.sides?.B?.teamId].filter(Boolean);
    for (const id of ids) {
      const row = rowsById[id];
      if (row && row.finalCourtPosition === Number.MAX_SAFE_INTEGER)
        row.finalCourtPosition = position;
    }
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
    const pointTieBreakers =
      options.scoringMethod === "rallyPoints"
        ? ["rallyPoints", "courtPoints"]
        : ["courtPoints", "rallyPoints"];
    if (options.finalRanking === "points")
      return [...pointTieBreakers, "finalCourtPosition", "entryId"];
    return ["finalCourtPosition", ...pointTieBreakers, "entryId"];
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

function rankRows(rows, tiebreakers, headToHead) {
  const criteria = tiebreakers.filter((candidate) => candidate !== "entryId");
  const headToHeadIndex = criteria.indexOf("headToHead");

  function rankGroup(group, startIndex) {
    if (group.length < 2) return [group];

    for (let index = startIndex; index < criteria.length; index += 1) {
      const key = criteria[index];
      const buckets = bucketRows(group, key, headToHead);
      if (buckets.length === 1) continue;

      const rankedGroups = [];
      for (const bucket of buckets) {
        if (bucket.length < 2) {
          rankedGroups.push(bucket);
          continue;
        }

        if (key === "headToHead") {
          // A mini-table that separates entries must be recalculated for the
          // entries still tied, rather than carrying the larger table forward.
          rankedGroups.push(...rankGroup(bucket, index));
          continue;
        }

        if (headToHeadIndex >= 0 && headToHeadIndex < index) {
          // A later tie-breaker may leave only a subset tied. Re-evaluate
          // head-to-head within that subset before applying the remaining rules.
          const headToHeadBuckets = bucketRows(bucket, "headToHead", headToHead);
          if (headToHeadBuckets.length > 1) {
            rankedGroups.push(
              ...headToHeadBuckets.flatMap((tiedGroup) =>
                rankGroup(tiedGroup, headToHeadIndex),
              ),
            );
            continue;
          }
        }

        rankedGroups.push(...rankGroup(bucket, index + 1));
      }
      return rankedGroups;
    }

    return [group];
  }

  return rankGroup(rows, 0).map((group) =>
    group.sort((left, right) => String(left.entryId).localeCompare(String(right.entryId))),
  );
}

function bucketRows(rows, key, headToHead) {
  const ordered = [...rows].sort((left, right) =>
    compareForKey(left, right, key, rows, headToHead),
  );
  const buckets = [];
  let bucket = [];
  let previous = null;

  for (const row of ordered) {
    if (
      previous &&
      compareForKey(row, previous, key, rows, headToHead) !== 0
    ) {
      buckets.push(bucket);
      bucket = [];
    }
    bucket.push(row);
    previous = row;
  }
  if (bucket.length) buckets.push(bucket);
  return buckets;
}

function compareForKey(left, right, key, tiedGroup, headToHead) {
  const leftValue = tiebreakerValue(left, key, tiedGroup, headToHead);
  const rightValue = tiebreakerValue(right, key, tiedGroup, headToHead);
  if (leftValue === rightValue) return 0;
  if (key === "seed" || key === "finalCourtPosition" || key === "placement")
    return leftValue < rightValue ? -1 : 1;
  return leftValue > rightValue ? -1 : 1;
}

function tiebreakerValue(row, key, tiedGroup, headToHead) {
  if (key === "entryId") return String(row.entryId);
  if (key === "seed") return row.seed;
  if (key === "headToHead") {
    return tiedGroup.reduce(
      (sum, opponent) => sum + (headToHead[row.entryId]?.[opponent.entryId] || 0),
      0,
    );
  }
  const value = Number(row[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
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
