// Pure builder for the compact tournament read model (spec section 40). One
// document gives host and spectator pages everything except per-point live
// scores, which come from targeted listeners on the live matches.
const { getFormat } = require("./formats");
const { validateTournamentSetup } = require("./validation");
const { resolveMatchScoringOptions } = require("./scoringProfiles");
const { supportsFullSchedule, forecastRemainingRounds } = require("./forecast");

const DELAY_GRACE_MS = 5 * 60 * 1000;
const SOCIAL_FORMATS = new Set(["americano", "mexicano", "teamAmericano", "teamMexicano"]);

const DEUCE_LABELS = {
  standard: "Advantage at deuce",
  golden: "Golden point at deuce",
  silver: "Silver point: golden point after one advantage",
  star: "Star point: golden point after two advantages",
};

function describeScoring(options = {}) {
  switch (options.scoringMode) {
    case "fixedTotalPoints": {
      const serving = options.serving || {};
      const lines = [`${options.pointsTarget} total points`];
      if (serving.enabled !== false) {
        lines.push(`Serve rotation: ${(serving.order || []).join(", ")}`);
        lines.push(`${serving.serveBlockLength} consecutive serves`);
      }
      lines.push(
        serving.sideSwapRule === "after_all_players_serve_once"
          ? "Swap sides after all players serve once"
          : "No automatic side swap",
      );
      lines.push(
        options.completion?.tieResolution === "golden_point"
          ? "A tie at the target is decided by one golden point"
          : "Draws are allowed",
      );
      return lines;
    }
    case "straight":
      return ["Straight rally points (no games or sets)", "The host completes each match"];
    case "tiebreakTen":
      return ["Single match tie-break to 10, win by 2"];
    default: {
      const tiebreak =
        options.tiebreakMode === "off"
          ? "No tie-break: sets are won by two games"
          : `Tie-break at 6-6 (first to ${options.tiebreakMode === "sixAllTen" ? 10 : 7})`;
      return [
        "Standard padel scoring",
        DEUCE_LABELS[options.deuceMode] || DEUCE_LABELS.standard,
        tiebreak,
        "The host completes each match",
      ];
    }
  }
}

function buildRulesSummary(tournament, standings) {
  const format = getFormat(tournament.format.id);
  const config = tournament.format.config || {};
  const base = format.getRulesSummary(config);
  const scoringOptions = resolveMatchScoringOptions(format.id, config);
  const lines = [...(base.lines || [])];
  if (!SOCIAL_FORMATS.has(format.id)) {
    describeScoring(scoringOptions).forEach((line) => {
      if (!lines.includes(line)) lines.push(line);
    });
  }
  if (format.kind === "rotating") {
    lines.push("Players sitting out a round receive no points and no loss");
  }
  if (["league", "swiss", "groupBracket"].includes(format.kind)) {
    lines.push("A bye is not a loss");
  }
  if (standings?.tiebreakerLabels?.length) {
    lines.push(`Ranking: ${standings.tiebreakerLabels.join(", then ")}`);
  }
  return { title: base.title || format.label.toUpperCase(), lines, scoringOptions };
}

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number")
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  return null;
}

function indexBy(items, key) {
  return Object.fromEntries((items || []).map((item) => [item[key], item]));
}

function sideLabel(side, lookups) {
  if (!side) return null;
  if (side.teamId) {
    const team = lookups.teams[side.teamId];
    if (team?.name) return team.name;
  }
  const names = (side.participantIds || [])
    .map((id) => lookups.participants[id]?.displayName)
    .filter(Boolean);
  return names.length ? names.join(" / ") : null;
}

function sourceLabel(ref, lookups) {
  if (!ref) return "TBD";
  if (ref.fixtureId) {
    const source = lookups.fixtures[ref.fixtureId];
    const label = source?.label || ref.fixtureId;
    return `${ref.outcome === "loser" ? "Loser" : "Winner"} of ${label}`;
  }
  if (ref.groupId) return `Group ${ref.groupId} #${ref.rank}`;
  return "TBD";
}

function displayStatus(fixture, { match, court, now }) {
  if (fixture.status === "bye") return "BYE";
  if (fixture.status === "cancelled") return "CANCELLED";
  if (fixture.status === "completed") return "COMPLETED";
  if (fixture.status === "live" || match?.status === "live") return "LIVE";
  if (!fixture.sides?.A || !fixture.sides?.B) return "TBD";
  if (fixture.scheduledStartAt && now > Number(fixture.scheduledStartAt) + DELAY_GRACE_MS) {
    return "DELAYED";
  }
  if (
    fixture.matchId &&
    fixture.courtId &&
    court &&
    court.status !== "closed" &&
    !court.activeMatchId
  ) {
    return "READY";
  }
  return "SCHEDULED";
}

function compactScore(match) {
  if (!match?.scoreSummary) return null;
  const summary = match.scoreSummary;
  return {
    A: { points: summary.A?.points || 0, games: summary.A?.games || 0, sets: summary.A?.sets || 0 },
    B: { points: summary.B?.points || 0, games: summary.B?.games || 0, sets: summary.B?.sets || 0 },
    completedSets: summary.completedSets || [],
    scoringMode: summary.scoringMode || match.scoringMode || null,
  };
}

function deriveRoundStatus(round, fixtures) {
  const playable = fixtures.filter((fixture) => !["bye", "cancelled"].includes(fixture.status));
  if (playable.length === 0) return fixtures.length ? "completed" : round.status || "scheduled";
  if (playable.every((fixture) => fixture.status === "completed")) return "completed";
  if (playable.some((fixture) => ["live", "completed"].includes(fixture.status))) return "live";
  return "scheduled";
}

function buildFormatState({ tournament, participants, teams, rounds, fixtures }) {
  return {
    tournament,
    participants,
    teams,
    rounds,
    fixtures,
    generationSeed: tournament.tournamentId,
  };
}

function buildTournamentView({
  tournament,
  participants = [],
  teams = [],
  rounds = [],
  fixtures = [],
  matches = [],
  courts = [],
  club = null,
  now = 0,
}) {
  const format = getFormat(tournament.format.id);
  const lookups = {
    participants: indexBy(participants, "participantId"),
    teams: indexBy(teams, "teamId"),
    fixtures: indexBy(fixtures, "fixtureId"),
    matches: indexBy(matches, "matchId"),
    courts: indexBy(courts, "courtId"),
  };
  const state = buildFormatState({ tournament, participants, teams, rounds, fixtures });

  const standings = rounds.length > 0 ? format.calculateStandings(state) : null;
  // A bracket's current table and its final placements have different rules:
  // group tables must stay group-only, while the podium reads the resolved
  // knockout finish. Other formats reuse their normal standings rules.
  const finalStandings = rounds.length > 0
    ? typeof format.calculateFinalStandings === "function"
      ? format.calculateFinalStandings(state)
      : standings
    : null;
  const rulesSummary = buildRulesSummary(tournament, standings);
  const sortedRounds = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);

  const fixtureViews = [...fixtures]
    .sort(
      (a, b) =>
        a.roundNumber - b.roundNumber ||
        a.fixtureId.localeCompare(b.fixtureId, undefined, { numeric: true }),
    )
    .map((fixture) => {
      const match = fixture.matchId ? lookups.matches[fixture.matchId] : null;
      const courtId = match?.currentCourtId || fixture.courtId || null;
      const court = courtId ? lookups.courts[courtId] : null;
      const canStart =
        !supportsFullSchedule(format) ||
        !fixtures.some(
          (earlier) =>
            earlier.roundNumber < fixture.roundNumber &&
            !["completed", "bye", "cancelled"].includes(earlier.status),
        );
      const status = displayStatus(fixture, { match, court, now });
      return {
        fixtureId: fixture.fixtureId,
        roundId: fixture.roundId,
        roundNumber: fixture.roundNumber,
        label: match?.name || fixture.label || null,
        stage: fixture.stage || null,
        groupId: fixture.groupId || null,
        courtLevel: fixture.courtLevel ?? null,
        bracketPosition: fixture.bracketPosition || null,
        sides: ["A", "B"].reduce((acc, key) => {
          const side = fixture.sides?.[key] || null;
          acc[key] = side
            ? {
                label: sideLabel(side, lookups),
                participantIds: side.participantIds || [],
                teamId: side.teamId || null,
              }
            : { label: null, placeholder: sourceLabel(fixture.sourceRefs?.[key], lookups) };
          return acc;
        }, {}),
        status: fixture.status,
        displayStatus: status === "READY" && !canStart ? "SCHEDULED" : status,
        matchId: fixture.matchId || null,
        matchStatus: match?.status || null,
        canStart,
        courtId,
        courtName: court?.name || courtId,
        scheduledStartAt: fixture.scheduledStartAt ?? null,
        startedAt: toMillis(match?.startedAt),
        score: compactScore(match),
        result: fixture.resultSnapshot
          ? {
              winner: fixture.resultSnapshot.winner,
              points: fixture.resultSnapshot.points,
              games: fixture.resultSnapshot.games,
              sets: fixture.resultSnapshot.sets,
              corrected: Boolean(fixture.resultSnapshot.corrected),
              walkover: Boolean(fixture.resultSnapshot.walkover),
              scoringMode: fixture.resultSnapshot.scoringMode || null,
            }
          : null,
        dependsOn: (fixture.sourceFixtureIds || []).filter(Boolean),
        feeds: fixture.feeds || null,
      };
    });
  const fixtureViewById = indexBy(fixtureViews, "fixtureId");

  const roundViews = sortedRounds.map((round) => {
    const roundFixtures = fixtures.filter((fixture) => fixture.roundId === round.roundId);
    const sittingOutIds = [
      ...(round.sittingOutParticipantIds || []),
      ...(round.sittingOutTeamIds || []),
    ];
    return {
      roundId: round.roundId,
      roundNumber: round.roundNumber,
      label: round.label,
      stage: round.stage || null,
      status: deriveRoundStatus(round, roundFixtures),
      fixtureIds: roundFixtures.map((fixture) => fixture.fixtureId),
      sittingOut: sittingOutIds.map((id) => ({
        id,
        name: lookups.participants[id]?.displayName || lookups.teams[id]?.name || id,
      })),
      byes: roundFixtures
        .filter((fixture) => fixture.status === "bye")
        .map(
          (fixture) =>
            fixtureViewById[fixture.fixtureId]?.sides.A?.label ||
            fixtureViewById[fixture.fixtureId]?.sides.B?.label,
        )
        .filter(Boolean),
      generatedAt: toMillis(round.generatedAt),
      generationSeed: round.generationSnapshot?.seed || null,
    };
  });

  const currentRound =
    roundViews.find((round) => round.status !== "completed") ||
    roundViews[roundViews.length - 1] ||
    null;

  const liveMatches = fixtureViews
    .filter((fixture) => fixture.displayStatus === "LIVE")
    .map((fixture) => ({
      matchId: fixture.matchId,
      matchName: fixture.label,
      fixtureId: fixture.fixtureId,
      roundNumber: fixture.roundNumber,
      courtId: fixture.courtId,
      courtName: fixture.courtName,
      sides: { A: fixture.sides.A.label, B: fixture.sides.B.label },
      score: fixture.score,
      status: "live",
      scheduledStartAt: fixture.scheduledStartAt,
    }));

  const playable = fixtureViews.filter(
    (fixture) => !["BYE", "CANCELLED"].includes(fixture.displayStatus),
  );
  const countBy = (status) =>
    fixtureViews.filter((fixture) => fixture.displayStatus === status).length;
  const poolCourts = (tournament.courtPool || [])
    .map((courtId) => lookups.courts[courtId])
    .filter(Boolean);
  const completedCount = countBy("COMPLETED");

  const incremental = format.supportsNextRound && !supportsFullSchedule(format);
  const nextRoundCheck = incremental
    ? rounds.length === 0
      ? { allowed: false, reason: "Generate the first round first." }
      : format.canGenerateNextRound(state)
    : { allowed: false, reason: "This format schedules every round automatically." };

  const view = {
    tournamentId: tournament.tournamentId,
    name: tournament.name,
    description: tournament.description || "",
    status: tournament.status,
    finishedEarly: Boolean(tournament.finishedEarly),
    completionReason: tournament.completionReason || null,
    visibility: tournament.visibility,
    club: club ? { clubId: club.clubId, name: club.name || club.clubId } : null,
    format: {
      id: format.id,
      label: format.label,
      kind: format.kind,
      entryMode: tournament.participantMode,
      supportsNextRound: Boolean(incremental),
      supportsFullSchedule: supportsFullSchedule(format),
      config: tournament.format.config,
    },
    rulesSummary: { title: rulesSummary.title, lines: rulesSummary.lines },
    scoringOptions: rulesSummary.scoringOptions,
    scheduling: tournament.scheduling,
    courtPool: tournament.courtPool || [],
    courts: poolCourts.map((court) => ({
      courtId: court.courtId,
      name: court.name || court.courtId,
      status: court.status || "open",
      clubId: court.clubId || null,
      activeMatchId: court.activeMatchId || null,
    })),
    participants: participants.map((participant) => ({
      participantId: participant.participantId,
      displayName: participant.displayName,
      shortName: participant.shortName || null,
      seed: participant.seed ?? null,
      status: participant.status,
      gender: participant.gender || null,
    })),
    teams: teams.map((team) => ({
      teamId: team.teamId,
      name: team.name,
      participantIds: team.participantIds || [],
      seed: team.seed ?? null,
      status: team.status,
    })),
    currentRound: currentRound
      ? {
          roundId: currentRound.roundId,
          roundNumber: currentRound.roundNumber,
          label: currentRound.label,
          status: currentRound.status,
        }
      : null,
    rounds: roundViews,
    roundForecast: forecastRemainingRounds(format, state, now),
    fixtures: fixtureViews,
    liveMatches,
    standings,
    finalStandings,
    bracket: ["bracket", "groupBracket"].includes(format.kind)
      ? buildBracketSummary(fixtureViews)
      : null,
    sittingOut: currentRound ? currentRound.sittingOut : [],
    nextRound: nextRoundCheck,
    canGenerateInitialRound: rounds.length === 0,
    stats: {
      totalFixtures: playable.length,
      completed: completedCount,
      live: countBy("LIVE"),
      ready: countBy("READY"),
      waiting: countBy("TBD") + countBy("SCHEDULED"),
      delayed: countBy("DELAYED"),
      completionPct: playable.length ? Math.round((completedCount / playable.length) * 100) : 0,
      sittingOut: currentRound ? currentRound.sittingOut.length : 0,
      courtsActive: poolCourts.filter((court) => court.activeMatchId).length,
      courtsAvailable: poolCourts.filter(
        (court) => court.status !== "closed" && !court.activeMatchId,
      ).length,
    },
    exceptions: buildExceptions({
      tournament,
      fixtureViews,
      poolCourts,
      participants,
      teams,
      rounds,
      lookups,
    }),
    setupValidation:
      tournament.status === "draft" || tournament.status === "published"
        ? validateTournamentSetup({
            format: tournament.format,
            participantMode: tournament.participantMode,
            participants: participants.filter((participant) => participant.status !== "removed"),
            teams: teams.filter((team) => team.status !== "removed"),
            courtPool: tournament.courtPool || [],
          })
        : null,
  };
  return view;
}

function buildBracketSummary(fixtureViews) {
  const bracketFixtures = fixtureViews.filter((fixture) => fixture.bracketPosition);
  const stages = [];
  for (const fixture of bracketFixtures) {
    const stageKey = fixture.stage || "knockout";
    let stage = stages.find((entry) => entry.stage === stageKey);
    if (!stage) {
      stage = { stage: stageKey, rounds: [] };
      stages.push(stage);
    }
    let round = stage.rounds.find((entry) => entry.roundNumber === fixture.roundNumber);
    if (!round) {
      round = { roundNumber: fixture.roundNumber, fixtureIds: [] };
      stage.rounds.push(round);
    }
    round.fixtureIds.push(fixture.fixtureId);
  }
  return { stages };
}

function buildExceptions({
  tournament,
  fixtureViews,
  poolCourts,
  participants,
  teams,
  rounds,
  lookups,
}) {
  if (!["published", "live"].includes(tournament.status)) return [];
  const exceptions = [];
  poolCourts
    .filter((court) => court.status === "closed")
    .forEach((court) =>
      exceptions.push({
        code: "COURT_UNAVAILABLE",
        message: `${court.name || court.courtId} is closed.`,
        courtId: court.courtId,
      }),
    );
  (tournament.courtPool || [])
    .filter((courtId) => !lookups.courts[courtId])
    .forEach((courtId) =>
      exceptions.push({
        code: "COURT_MISSING",
        message: `Court ${courtId} no longer exists.`,
        courtId,
      }),
    );

  const withdrawn = new Set([
    ...participants.filter((p) => p.status === "withdrawn").map((p) => p.participantId),
    ...teams.filter((t) => t.status === "withdrawn").map((t) => t.teamId),
  ]);
  for (const fixture of fixtureViews) {
    if (["COMPLETED", "CANCELLED", "BYE"].includes(fixture.displayStatus)) continue;
    if (fixture.displayStatus !== "TBD" && !fixture.courtId) {
      exceptions.push({
        code: "FIXTURE_UNASSIGNED",
        message: `${fixture.label} has no court.`,
        fixtureId: fixture.fixtureId,
      });
    }
    if (fixture.displayStatus === "DELAYED") {
      exceptions.push({
        code: "MATCH_DELAYED",
        message: `${fixture.label} is running late.`,
        fixtureId: fixture.fixtureId,
      });
    }
    const entries = ["A", "B"].flatMap((key) => [
      ...(fixture.sides[key]?.participantIds || []),
      ...(fixture.sides[key]?.teamId ? [fixture.sides[key].teamId] : []),
    ]);
    if (entries.some((id) => withdrawn.has(id))) {
      exceptions.push({
        code: "PLAYER_WITHDRAWN",
        message: `${fixture.label} includes a withdrawn entry.`,
        fixtureId: fixture.fixtureId,
      });
    }
  }

  const sitCounts = {};
  rounds.forEach((round) =>
    [...(round.sittingOutParticipantIds || []), ...(round.sittingOutTeamIds || [])].forEach(
      (id) => {
        sitCounts[id] = (sitCounts[id] || 0) + 1;
      },
    ),
  );
  const activeIds = [
    ...participants.filter((p) => p.status === "active").map((p) => p.participantId),
    ...teams.filter((t) => t.status === "active").map((t) => t.teamId),
  ];
  const counts = activeIds.map((id) => sitCounts[id] || 0);
  if (counts.length && Math.max(...counts) - Math.min(...counts) > 1) {
    exceptions.push({
      code: "BYE_IMBALANCE",
      message: "Sitting-out turns are uneven across players.",
    });
  }
  return exceptions;
}

module.exports = {
  buildTournamentView,
  buildRulesSummary,
  describeScoring,
  displayStatus,
  buildFormatState,
};
