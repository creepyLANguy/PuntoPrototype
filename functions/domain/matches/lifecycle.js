// Pure match lifecycle rules (spec section 6). A match is the durable scoring
// identity; courts only point at the match currently being played on them.
const { DEFAULT_TEAM_NAMES, DEFAULT_PLAYER_NAMES } = require("../../services/constants");

const MATCH_STATUSES = ["scheduled", "live", "completed", "cancelled"];

const TRANSITIONS = {
  scheduled: ["live", "cancelled"],
  live: ["completed", "cancelled", "scheduled"],
  completed: ["live"],
  cancelled: [],
};

const MATCH_NAME_MAX_LENGTH = 80;
const TEAM_NAME_MAX_LENGTH = 40;
const PLAYER_NAME_MAX_LENGTH = 40;

class MatchRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MatchRuleError";
    this.code = code;
  }
}

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new MatchRuleError(
      "INVALID_TRANSITION",
      `A ${from || "missing"} match cannot become ${to}.`,
    );
  }
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeMatchName(value) {
  const name = cleanText(value, MATCH_NAME_MAX_LENGTH);
  return name || null;
}

function normalizeTeamNames(teamNames = {}) {
  return {
    A: cleanText(teamNames?.A, TEAM_NAME_MAX_LENGTH) || DEFAULT_TEAM_NAMES.A,
    B: cleanText(teamNames?.B, TEAM_NAME_MAX_LENGTH) || DEFAULT_TEAM_NAMES.B,
  };
}

function normalizePlayerNames(playerNames = {}) {
  const names = { ...DEFAULT_PLAYER_NAMES };
  Object.keys(names).forEach((slot) => {
    names[slot] = cleanText(playerNames?.[slot], PLAYER_NAME_MAX_LENGTH);
  });
  return names;
}

function sideLabel(match, team) {
  const teamName = cleanText(match?.teamNames?.[team], TEAM_NAME_MAX_LENGTH);
  if (teamName && teamName !== DEFAULT_TEAM_NAMES[team]) return teamName;

  const players = [match?.playerNames?.[`${team}1`], match?.playerNames?.[`${team}2`]]
    .map((name) => cleanText(name, PLAYER_NAME_MAX_LENGTH))
    .filter(Boolean);
  if (players.length > 0) return players.join(" & ");
  return teamName || null;
}

// Generated matchup label, e.g. "John & Mike vs Sam & Dave"; null when the
// match has no names at all.
function buildMatchupLabel(match) {
  const sideA = sideLabel(match, "A");
  const sideB = sideLabel(match, "B");
  if (!sideA && !sideB) return null;
  return `${sideA || DEFAULT_TEAM_NAMES.A} vs ${sideB || DEFAULT_TEAM_NAMES.B}`;
}

// Scoreboard identity (spec section 30): the match name is primary, then the
// generated matchup, then the match id. Never the court.
function resolveMatchTitle(match) {
  if (!match) return null;
  return normalizeMatchName(match.name) || buildMatchupLabel(match) || match.matchId || null;
}

function buildMatchDocument({
  matchId,
  name = null,
  teamNames,
  playerNames,
  scoringOptions,
  kind = "casual",
  visibility = "public",
  tournamentId = null,
  roundId = null,
  fixtureId = null,
  status = "scheduled",
  now,
}) {
  if (!MATCH_STATUSES.includes(status)) {
    throw new MatchRuleError("INVALID_STATUS", `Unknown match status ${status}.`);
  }

  return {
    matchId,
    name: normalizeMatchName(name),
    kind,
    visibility,
    status,
    currentCourtId: null,
    lastCourtId: null,
    lastCourtName: null,
    teamNames: normalizeTeamNames(teamNames),
    playerNames: normalizePlayerNames(playerNames),
    scoringOptions,
    scoringMode: scoringOptions.scoringMode,
    scoreVersion: 0,
    scoreSummary: null,
    result: null,
    tournamentId,
    roundId,
    fixtureId,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
  };
}

// Compact score summary stored on the match document so match lists and
// tournament dashboards never need one read per score document.
function buildScoreSummary(score) {
  const side = (team) => ({
    points: Number(score?.[team]?.points) || 0,
    games: Number(score?.[team]?.games) || 0,
    sets: Number(score?.[team]?.sets) || 0,
    totalPoints: Number(score?.[team]?.totalPoints) || 0,
  });

  return {
    A: side("A"),
    B: side("B"),
    completedSets: Array.isArray(score?.completedSets)
      ? score.completedSets.map((set) => ({ A: Number(set?.A) || 0, B: Number(set?.B) || 0 }))
      : [],
    inTiebreak: Boolean(score?.inTiebreak),
    matchComplete: Boolean(score?.matchComplete),
    scoringMode: score?.scoringOptions?.scoringMode || null,
  };
}

module.exports = {
  MATCH_STATUSES,
  MatchRuleError,
  canTransition,
  assertTransition,
  normalizeMatchName,
  normalizeTeamNames,
  normalizePlayerNames,
  buildMatchupLabel,
  resolveMatchTitle,
  buildMatchDocument,
  buildScoreSummary,
};
