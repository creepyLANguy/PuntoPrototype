const { calculateStandings: standings } = require("../standings");
const { fixtureOutcome } = require("../results");
const {
  baseRound,
  calculateRoundResult,
  canGenerateAfterComplete,
  makeFixture,
  nextRoundNumber,
  seedFor,
  sideFromParticipants,
  sideFromTeam,
  toInt,
} = require("./shared");

const kingCourt = {
  id: "kingCourt",
  label: "King/Queen of the Court",
  entryMode: "either",
  kind: "courtRotation",
  supportsNextRound: true,
  defaultConfig: () => ({
    courtCount: 2,
    roundDurationMinutes: 12,
    movement: { winner: "up_one", loser: "down_one" },
    tieBehaviour: "higher_seed_wins",
    scoringMethod: "courtPoints",
    finalRanking: "courtPosition",
  }),
  normalizeConfig(config = {}) {
    return {
      courtCount: toInt(config.courtCount, 2, 1, 32),
      roundDurationMinutes: toInt(config.roundDurationMinutes, 12, 1, 180),
      movement: { winner: "up_one", loser: "down_one", ...(config.movement || {}) },
      tieBehaviour: ["higher_seed_wins", "stay"].includes(config.tieBehaviour)
        ? config.tieBehaviour
        : "higher_seed_wins",
      scoringMethod: ["courtPoints", "rallyPoints"].includes(config.scoringMethod)
        ? config.scoringMethod
        : "courtPoints",
      finalRanking: ["courtPosition", "points"].includes(config.finalRanking)
        ? config.finalRanking
        : "courtPosition",
    };
  },
  validateConfig() {
    return { errors: [], warnings: [] };
  },
  validateParticipants(state) {
    const mode = state.tournament?.participantMode || "team";
    const count =
      mode === "individual" ? activeParticipants(state).length : activeTeams(state).length;
    const minimum = mode === "individual" ? 4 : 2;
    return {
      errors:
        count < minimum
          ? [{ code: "INSUFFICIENT_ENTRIES", message: "Not enough entries for King Court." }]
          : [],
      warnings: [],
    };
  },
  generateInitialRound(state) {
    return generateRoundFromAssignments(state, initialAssignments(state));
  },
  generateNextRound(state) {
    const allowed = canGenerateAfterComplete(state);
    if (!allowed.allowed) throw new Error(allowed.reason);
    return generateRoundFromAssignments(state, this.calculateNextCourtAssignments(state));
  },
  canGenerateNextRound: canGenerateAfterComplete,
  calculateStandings(state) {
    const mode = state.tournament?.participantMode === "individual" ? "participant" : "team";
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    return standings(state, {
      entryType: mode,
      mode: "league",
      formatId: "kingCourt",
      finalRanking: cfg.finalRanking,
      scoringMethod: cfg.scoringMethod,
      courtCount: cfg.courtCount,
      includeFinalCourtPosition: true,
    });
  },
  calculateRoundResult,
  getRulesSummary(config) {
    const cfg = this.normalizeConfig(config);
    return {
      title: "KING/QUEEN OF THE COURT",
      lines: [
        `${cfg.courtCount} courts`,
        `${cfg.roundDurationMinutes} minute rounds`,
        "Winners move up; losers move down",
        cfg.tieBehaviour === "stay"
          ? "Ties: both sides stay on their current court"
          : "Ties: higher seed wins; equal or missing seeds stay on court",
      ],
    };
  },
  calculateNextCourtAssignments(state) {
    const cfg = this.normalizeConfig(state.tournament?.format?.config || {});
    const lastRound = [...(state.rounds || [])].sort((a, b) => b.roundNumber - a.roundNumber)[0];
    const fixtures = (state.fixtures || [])
      .filter((fixture) => fixture.roundId === lastRound?.roundId)
      .sort((a, b) => a.courtLevel - b.courtLevel);
    const buckets = {};
    const lockedPairs = {};
    const queue = [...(lastRound?.generationSnapshot?.queue || [])];
    const entryMode =
      state.tournament?.participantMode === "individual" ? "individual" : "team";
    for (const fixture of fixtures) {
      if (isWithdrawalCancelledFixture(fixture)) {
        // A cancelled match has no sporting winner. Keep every still-eligible
        // entry from that match in the rotation without bringing the withdrawn
        // entry back into play.
        if (entryMode === "individual") {
          const activeParticipantIds = new Set(
            (state.participants || [])
              .filter((participant) => participant.status === "active")
              .map((participant) => participant.participantId),
          );
          for (const sideKey of ["A", "B"]) {
            const ids = (fixture.sides?.[sideKey]?.participantIds || []).filter(
              (id) => id !== fixture.withdrawnEntryId && activeParticipantIds.has(id),
            );
            if (ids.length === 2 && ids[0] !== ids[1]) queue.push(ids.join("+"));
            else queue.push(...ids);
          }
        } else {
          const eligibleTeamIds = activeTeamIds(state);
          for (const sideKey of ["A", "B"]) {
            const teamId = fixture.sides?.[sideKey]?.teamId;
            if (teamId && teamId !== fixture.withdrawnEntryId && eligibleTeamIds.has(teamId)) {
              queue.push(teamId);
            }
          }
        }
        continue;
      }

      const outcome = fixtureOutcome(fixture);
      const winner = resolveWinner(fixture, outcome, cfg, state);
      if (!winner) {
        // Preserve the tied pairing as an indivisible pair. Other sides that
        // move into this court are handled separately instead of overflowing it.
        lockedPairs[fixture.courtLevel] = [fixture.sides.A, fixture.sides.B];
        continue;
      }
      const loser = winner === "A" ? "B" : "A";
      addToBucket(buckets, Math.max(1, fixture.courtLevel - 1), fixture.sides[winner]);
      const loserLevel = fixture.courtLevel + 1;
      if (loserLevel > cfg.courtCount) queue.push(sideId(fixture.sides[loser]));
      else addToBucket(buckets, loserLevel, fixture.sides[loser]);
    }

    const assignments = [];
    for (let level = 1; level <= cfg.courtCount; level += 1) {
      const sides = buckets[level] || [];
      const lockedPair = lockedPairs[level];
      if (lockedPair) {
        assignments.push({ courtLevel: level, sides: { A: lockedPair[0], B: lockedPair[1] } });
        // Keep every side that was pushed into this occupied court available
        // for another court or the sit-out queue.
        queue.push(...sides.map(sideId));
        continue;
      }

      // A court can host only one match. Never drop a third (or fourth) side
      // when multiple neighbouring courts feed into the same bucket.
      const selected = sides.slice(0, 2);
      queue.push(...sides.slice(2).map(sideId));
      while (selected.length < 2 && queue.length > 0) {
        const queuedSide = takeQueuedSide(state, queue, entryMode);
        if (!queuedSide) break;
        selected.push(queuedSide);
      }
      if (selected.length === 2) {
        assignments.push({ courtLevel: level, sides: { A: selected[0], B: selected[1] } });
      } else if (selected.length === 1) {
        // An unmatched side must remain accounted for; it may be paired in a
        // later round instead of disappearing from this one.
        queue.push(sideId(selected[0]));
      }
    }
    return { assignments, queue };
  },
};

function activeParticipants(state) {
  return (state.participants || [])
    .filter((participant) => participant.status === "active")
    .sort(
      (a, b) =>
        (a.seed || 9999) - (b.seed || 9999) || a.participantId.localeCompare(b.participantId),
    );
}

function activeTeams(state) {
  return (state.teams || [])
    .filter((team) => team.status === "active")
    .sort((a, b) => (a.seed || 9999) - (b.seed || 9999) || a.teamId.localeCompare(b.teamId));
}

function initialAssignments(state) {
  const cfg = kingCourt.normalizeConfig(state.tournament?.format?.config || {});
  const mode = state.tournament?.participantMode === "individual" ? "individual" : "team";
  const assignments = [];
  const queue = [];
  if (mode === "individual") {
    const entries = activeParticipants(state);
    for (let level = 1; level <= cfg.courtCount && entries.length >= 4; level += 1) {
      const group = entries.splice(0, 4);
      assignments.push({
        courtLevel: level,
        sides: {
          A: sideFromParticipants([group[0].participantId, group[1].participantId]),
          B: sideFromParticipants([group[2].participantId, group[3].participantId]),
        },
      });
    }
    queue.push(...entries.map((entry) => entry.participantId));
  } else {
    const entries = activeTeams(state);
    for (let level = 1; level <= cfg.courtCount && entries.length >= 2; level += 1) {
      assignments.push({
        courtLevel: level,
        sides: { A: sideFromTeam(entries.shift()), B: sideFromTeam(entries.shift()) },
      });
    }
    queue.push(...entries.map((entry) => entry.teamId));
  }
  return { assignments, queue };
}

function generateRoundFromAssignments(state, assignmentResult) {
  const assignments = Array.isArray(assignmentResult)
    ? assignmentResult
    : assignmentResult.assignments;
  const queue = Array.isArray(assignmentResult) ? [] : assignmentResult.queue;
  const roundNumber = nextRoundNumber(state);
  const seed = seedFor(state, roundNumber, ":king");
  const round = baseRound(roundNumber, `Round ${roundNumber}`, "kingCourt", seed, {
    algorithm: "king-court-v1",
    queue,
  });
  const fixtures = assignments.map((assignment, index) =>
    makeFixture({
      roundNumber,
      index,
      label: `Court ${assignment.courtLevel} - Round ${roundNumber}`,
      stage: null,
      sides: assignment.sides,
      courtLevel: assignment.courtLevel,
    }),
  );
  round.fixtureIds = fixtures.map((fixture) => fixture.fixtureId);
  return { rounds: [round], fixtures };
}

function resolveWinner(fixture, outcome, cfg, state) {
  if (!outcome || outcome.winner === "draw") {
    if (cfg.tieBehaviour === "stay") return null;
    const seedA = seedOfSide(state, fixture.sides.A);
    const seedB = seedOfSide(state, fixture.sides.B);
    if (seedA == null || seedB == null || seedA === seedB) return null;
    return seedA < seedB ? "A" : "B";
  }
  return outcome.winner === "A" || outcome.winner === "B" ? outcome.winner : null;
}

function seedOfSide(state, side) {
  if (side?.teamId) {
    const team = (state.teams || []).find((entry) => entry.teamId === side.teamId);
    const seed = Number(team?.seed);
    return team?.seed != null && Number.isFinite(seed) ? seed : null;
  }
  const ids = side?.participantIds || [];
  const entries = ids.map((id) =>
    (state.participants || []).find((entry) => entry.participantId === id),
  );
  // Do not invent a comparison from a partial pair seed or infer seeds from IDs.
  if (!entries.length || entries.some((entry) => entry?.seed == null || !Number.isFinite(Number(entry.seed))))
    return null;
  return entries.reduce((sum, entry) => sum + Number(entry.seed), 0) / entries.length;
}

function addToBucket(buckets, level, side) {
  buckets[level] = buckets[level] || [];
  buckets[level].push(side);
}

function sideId(side) {
  return side.teamId || side.participantIds.join("+");
}

function isWithdrawalCancelledFixture(fixture) {
  if (
    fixture?.status !== "cancelled" ||
    fixture.cancellationReason !== "entry-withdrawn" ||
    !fixture.withdrawnEntryId
  ) {
    return false;
  }

  return ["A", "B"].some((sideKey) => {
    const side = fixture.sides?.[sideKey];
    return (
      side?.teamId === fixture.withdrawnEntryId ||
      (side?.participantIds || []).includes(fixture.withdrawnEntryId)
    );
  });
}

function activeTeamIds(state) {
  const activeParticipantIds = new Set(
    (state.participants || [])
      .filter((participant) => participant.status === "active")
      .map((participant) => participant.participantId),
  );
  return new Set(
    (state.teams || [])
      .filter(
        (team) =>
          team.status === "active" &&
          (team.participantIds || []).every((id) => activeParticipantIds.has(id)),
      )
      .map((team) => team.teamId),
  );
}

function takeQueuedSide(state, queue, entryMode) {
  if (entryMode !== "individual") {
    const eligibleTeamIds = activeTeamIds(state);

    // A queue is a snapshot from the previous round. Entries may have since
    // withdrawn, so skip stale IDs instead of letting one invalid head block
    // all later queued teams.
    while (queue.length > 0) {
      const id = String(queue.shift());
      if (!eligibleTeamIds.has(id)) continue;
      const side = sideFromQueue(state, id, entryMode);
      if (side) return side;
    }
    return null;
  }

  const activeParticipantIds = new Set(
    (state.participants || [])
      .filter((participant) => participant.status === "active")
      .map((participant) => participant.participantId),
  );

  // Normalise the saved queue against the current roster. Keep valid singles
  // and doubles sides, drop withdrawn/unknown players, and preserve an active
  // partner as a single when their queued partner is no longer eligible.
  // Also avoid scheduling an individual twice if a stale queue contains
  // overlapping single/pair records.
  const alreadyQueued = new Set();
  for (let index = 0; index < queue.length; ) {
    const ids = String(queue[index]).split("+");
    if (ids.length < 1 || ids.length > 2 || ids.some((id) => !id)) {
      queue.splice(index, 1);
      continue;
    }

    const eligible = ids.filter(
      (id, idIndex) =>
        activeParticipantIds.has(id) &&
        ids.indexOf(id) === idIndex &&
        !alreadyQueued.has(id),
    );

    if (eligible.length === ids.length && ids.length <= 2) {
      eligible.forEach((id) => alreadyQueued.add(id));
      index += 1;
      continue;
    }

    if (eligible.length === 1) {
      queue[index] = eligible[0];
      alreadyQueued.add(eligible[0]);
      index += 1;
      continue;
    }

    queue.splice(index, 1);
  }

  const singles = [];
  for (let index = 0; index < queue.length; index += 1) {
    if (activeParticipantIds.has(queue[index])) singles.push({ index, id: queue[index] });
  }

  // Players who sat out are individual IDs. Pair two of them before filling a
  // court with a previously formed side, so queueing does not create 1-v-2
  // fixtures and waiting players get a fair opportunity.
  if (singles.length >= 2) {
    const first = singles[0];
    const second = singles[1];
    queue.splice(second.index, 1);
    queue.splice(first.index, 1);
    return sideFromParticipants([first.id, second.id]);
  }

  // A side that moved off the bottom court is stored as "playerA+playerB".
  // It is already a complete doubles side and can be reused as-is.
  for (let index = 0; index < queue.length; index += 1) {
    const ids = String(queue[index]).split("+");
    if (ids.length !== 2 || !ids.every((id) => activeParticipantIds.has(id))) continue;
    const id = queue[index];
    queue.splice(index, 1);
    return sideFromQueue(state, id, entryMode);
  }

  // Preserve an unmatched active individual until another player is available
  // instead of creating an invalid one-player side.
  return null;
}

function sideFromQueue(state, id, entryMode) {
  if (entryMode === "individual") {
    const participantIds = String(id).split("+");
    const activeIds = new Set(
      (state.participants || [])
        .filter((participant) => participant.status === "active")
        .map((participant) => participant.participantId),
    );
    if (
      participantIds.length !== 2 ||
      participantIds[0] === participantIds[1] ||
      !participantIds.every((participantId) => activeIds.has(participantId))
    ) {
      return null;
    }
    return sideFromParticipants(participantIds);
  }

  const team = (state.teams || []).find(
    (candidate) => candidate.teamId === id && candidate.status === "active",
  );
  return team ? sideFromTeam(team) : null;
}
module.exports = kingCourt;
