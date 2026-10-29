// Shared normal-completion readiness checks for finite tournament formats.
// Keep this in the domain layer so the service guard and host UI use the same
// definition of a tournament that is genuinely ready to be completed.
const { entryIdsOfSide } = require("./entities");
const { fixtureOutcome } = require("./results");

const FINITE_FORMATS = new Set(["roundRobin", "swiss", "groupKnockout"]);

function assessRequiredCompletion(state, format) {
  const formatId = state.tournament?.format?.id;
  if (!FINITE_FORMATS.has(formatId)) {
    return {
      required: false,
      allowed: true,
      reason: null,
      message: null,
      unresolvedFixtureIds: [],
    };
  }

  const rounds = state.rounds || [];
  const fixtures = state.fixtures || [];
  const groupFixtures = fixtures.filter((fixture) => fixture.stage === "group");

  if (!rounds.length || !fixtures.length || (formatId === "groupKnockout" && !groupFixtures.length)) {
    return failure(
      "missing-schedule",
      "The required tournament round or stage has not been generated. Generate it, or explicitly finish early with a reason.",
      [],
    );
  }

  if (
    formatId === "roundRobin" &&
    format?.normalizeConfig(state.tournament?.format?.config || {}).scheduleMode !== "roundByRound" &&
    !hasCompleteFullRoundRobinSchedule(state)
  ) {
    return failure(
      "incomplete-schedule",
      "The full Round Robin schedule is incomplete. Generate the missing rounds, or explicitly finish early with a reason.",
      [],
    );
  }

  const progression =
    typeof format?.canGenerateNextRound === "function"
      ? format.canGenerateNextRound(state)
      : { allowed: false, reason: null };

  if (progression?.allowed) {
    return failure(
      "required-progress",
      formatId === "groupKnockout"
        ? "The group stage is complete but the knockout stage has not been generated. Generate the required stage, or explicitly finish early with a reason."
        : "The tournament still has required rounds to generate. Generate the remaining rounds, or explicitly finish early with a reason.",
      [],
      progression.reason || null,
    );
  }

  const unresolvedFixtures = fixtures.filter(
    (fixture) => !isFixtureResolvedForCompletion(state, fixture, formatId),
  );
  if (unresolvedFixtures.length) {
    return failure(
      "unresolved-fixtures",
      "Required tournament fixtures are unresolved or cancelled without a valid withdrawal record. Resolve them, or explicitly finish early with a reason.",
      unresolvedFixtures.map((fixture) => fixture.fixtureId).filter(Boolean),
      progression?.reason || null,
    );
  }

  // A false progression result is not always proof of normal completion: format
  // implementations also return false when the current round/stage is missing
  // or incomplete. Do not interpret those preconditions as a finished event.
  if (/incomplete|not generated/i.test(String(progression?.reason || ""))) {
    return failure(
      "incomplete-progress",
      "The required tournament round or stage is incomplete. Resolve it, or explicitly finish early with a reason.",
      [],
      progression.reason,
    );
  }

  return {
    required: true,
    allowed: true,
    reason: null,
    message: null,
    unresolvedFixtureIds: [],
    nextRoundReason: progression?.reason || null,
  };
}

function hasCompleteFullRoundRobinSchedule(state) {
  // Full-schedule Round Robin generates every round atomically at the initial
  // draw. Its canGenerateNextRound method is intentionally always false, so
  // verify the generated schedule itself rather than treating that false value
  // as evidence the tournament is terminal.
  const teamIds = new Set(
    (state.teams || [])
      .filter((team) => team.status === "active")
      .map((team) => team.teamId),
  );
  for (const fixture of state.fixtures || []) {
    for (const sideKey of ["A", "B"]) {
      const teamId = fixture.sides?.[sideKey]?.teamId;
      if (teamId) teamIds.add(teamId);
    }
  }

  const teamCount = teamIds.size;
  if (teamCount < 2) return false;
  const expectedRoundCount = teamCount % 2 === 0 ? teamCount - 1 : teamCount;
  const rounds = [...(state.rounds || [])].sort(
    (a, b) => Number(a.roundNumber) - Number(b.roundNumber),
  );
  if (rounds.length !== expectedRoundCount) return false;

  const roundNumbers = new Set(rounds.map((round) => Number(round.roundNumber)));
  if (roundNumbers.size !== expectedRoundCount) return false;
  const firstRoundNumber = Number(rounds[0].roundNumber);
  const fixturesPerRound = Math.ceil(teamCount / 2);
  for (let offset = 0; offset < expectedRoundCount; offset += 1) {
    const roundNumber = firstRoundNumber + offset;
    if (!roundNumbers.has(roundNumber)) return false;
    const fixtureCount = (state.fixtures || []).filter(
      (fixture) => Number(fixture.roundNumber) === roundNumber,
    ).length;
    if (fixtureCount !== fixturesPerRound) return false;
  }
  return true;
}

function isFixtureResolvedForCompletion(state, fixture, formatId) {
  if (fixture.status === "completed") {
    const outcome = fixtureOutcome(fixture);
    const hasBothEntrants =
      entryIdsOfSide(fixture.sides?.A).length > 0 &&
      entryIdsOfSide(fixture.sides?.B).length > 0;
    if (!outcome || !hasBothEntrants) return false;

    // Knockout ties do not advance a winner. Third-place draws are a valid
    // sporting result and explicitly share third place.
    if (
      formatId === "groupKnockout" &&
      fixture.stage === "knockout" &&
      outcome.winner === "draw"
    ) {
      return false;
    }
    return true;
  }

  if (fixture.status === "bye") {
    const hasA = entryIdsOfSide(fixture.sides?.A).length > 0;
    const hasB = entryIdsOfSide(fixture.sides?.B).length > 0;
    return hasA !== hasB && !hasUnpropagatedEntrant(state, fixture);
  }

  if (isWithdrawalCancelledFixture(fixture)) return true;

  // Empty, cancelled bracket placeholders are structural only when every
  // source path is resolved and none can still contribute an entrant. A
  // cancelled fixture containing an entrant is never silently discarded.
  if (
    formatId === "groupKnockout" &&
    ["knockout", "thirdPlace"].includes(fixture.stage) &&
    entryIdsOfSide(fixture.sides?.A).length === 0 &&
    entryIdsOfSide(fixture.sides?.B).length === 0 &&
    !hasUnpropagatedEntrant(state, fixture)
  ) {
    return true;
  }

  return false;
}

function isWithdrawalCancelledFixture(fixture) {
  if (
    fixture?.status !== "cancelled" ||
    fixture.cancellationReason !== "entry-withdrawn" ||
    !fixture.withdrawnEntryId
  ) {
    return false;
  }

  return ["A", "B"].some((sideKey) =>
    entryIdsOfSide(fixture.sides?.[sideKey]).includes(fixture.withdrawnEntryId),
  );
}

function hasUnpropagatedEntrant(state, fixture) {
  const byId = new Map(
    (state.fixtures || []).map((candidate) => [candidate.fixtureId, candidate]),
  );

  return ["A", "B"].some((sideKey) => {
    if (entryIdsOfSide(fixture.sides?.[sideKey]).length) return false;
    const ref = fixture.sourceRefs?.[sideKey];
    if (!ref?.fixtureId) return false;

    const source = byId.get(ref.fixtureId);
    if (!source || !["completed", "bye", "cancelled"].includes(source.status)) return true;
    if (source.status === "cancelled") return false;

    const outcome =
      fixtureOutcome(source) ||
      (source.status === "bye" ? byeOutcome(source) : null);
    if (!outcome || !["A", "B"].includes(outcome.winner)) return false;

    if (ref.outcome !== "winner" && ref.outcome !== "loser") return true;
    const sourceSide =
      ref.outcome === "loser"
        ? outcome.winner === "A"
          ? "B"
          : "A"
        : outcome.winner;
    return entryIdsOfSide(source.sides?.[sourceSide]).length > 0;
  });
}

function byeOutcome(fixture) {
  if (fixture.status !== "bye") return null;
  const hasA = entryIdsOfSide(fixture.sides?.A).length > 0;
  const hasB = entryIdsOfSide(fixture.sides?.B).length > 0;
  if (hasA === hasB) return null;
  return { winner: hasA ? "A" : "B" };
}

function failure(reason, message, unresolvedFixtureIds, nextRoundReason = null) {
  return {
    required: true,
    allowed: false,
    reason,
    message,
    unresolvedFixtureIds,
    nextRoundReason,
  };
}

module.exports = {
  FINITE_FORMATS,
  assessRequiredCompletion,
  isFixtureResolvedForCompletion,
};
