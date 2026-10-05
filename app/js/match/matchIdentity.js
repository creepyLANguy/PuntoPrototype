// Match identity (spec section 30): the match name is the primary title, then
// the generated matchup, then the match id. The court is never the identity;
// it is shown as secondary location context. Mirrors
// functions/domain/matches/lifecycle.js.
import { DEFAULT_TEAM_NAMES } from "../config/constants.js";

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function getSideLabel(match, team) {
  const teamName = clean(match?.teamNames?.[team]);
  if (teamName && teamName !== DEFAULT_TEAM_NAMES[team]) return teamName;

  const players = [
    match?.playerNames?.[`${team}1`],
    match?.playerNames?.[`${team}2`],
  ]
    .map(clean)
    .filter(Boolean);
  if (players.length > 0) return players.join(" & ");
  return teamName || null;
}

export function buildMatchupLabel(match) {
  const sideA = getSideLabel(match, "A");
  const sideB = getSideLabel(match, "B");
  if (!sideA && !sideB) return null;
  return `${sideA || DEFAULT_TEAM_NAMES.A} vs ${sideB || DEFAULT_TEAM_NAMES.B}`;
}

export function resolveMatchTitle(match, matchId = null) {
  if (!match) return matchId || null;
  return (
    clean(match.name) ||
    buildMatchupLabel(match) ||
    match.matchId ||
    matchId ||
    null
  );
}

export function getMatchPath(matchId) {
  return `/m/${encodeURIComponent(matchId)}`;
}

export function getTournamentPath(tournamentId) {
  return `/t/${encodeURIComponent(tournamentId)}`;
}

export const MATCH_STATUS_LABELS = {
  scheduled: "SCHEDULED",
  live: "LIVE",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
};

// Compact score line for lists: "6-4 3-2" for games and sets, "21-15" for
// point-based modes.
export function formatScoreLine(summary, scoringMode = summary?.scoringMode) {
  if (!summary?.A || !summary?.B) return "";
  if (scoringMode && scoringMode !== "standard") {
    return `${summary.A.points ?? 0}-${summary.B.points ?? 0}`;
  }
  const sets = (summary.completedSets || []).map((set) => `${set.A}-${set.B}`);
  sets.push(`${summary.A.games ?? 0}-${summary.B.games ?? 0}`);
  return sets.join(" ");
}
