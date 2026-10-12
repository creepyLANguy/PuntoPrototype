// Play / Spectate discovery search (spec section 31): courts, live matches,
// players, teams and tournaments, ranked exact-match first. Pure functions
// over plain records loaded once per page visit and filtered locally.
import { buildMatchupLabel, resolveMatchTitle } from "./matchIdentity.js";
import { isValidId } from "../config/idContract.js";

export const SEARCH_PLACEHOLDER =
  "Search courts, clubs, matches, players or tournaments";

export const SEARCH_RANKS = {
  MATCH_ID: 1,
  TOURNAMENT_ID: 2,
  COURT_ID: 3,
  COURT_NAME: 4,
  MATCH_NAME: 5,
  PLAYER_OR_TEAM: 6,
  SUBSTRING: 7,
};

function norm(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/\s+/g, " ").trim()
    : "";
}

function matchPeople(match) {
  return [
    match?.teamNames?.A,
    match?.teamNames?.B,
    match?.playerNames?.A1,
    match?.playerNames?.A2,
    match?.playerNames?.B1,
    match?.playerNames?.B2,
  ].filter((value) => typeof value === "string" && value.trim());
}

function bestRank(term, checks) {
  let best = null;
  for (const [rank, values] of checks) {
    if (values.some((value) => norm(value) === term)) {
      best = best === null ? rank : Math.min(best, rank);
    }
  }
  if (best !== null) return best;
  const all = checks.flatMap(([, values]) => values);
  return all.some((value) => norm(value).includes(term))
    ? SEARCH_RANKS.SUBSTRING
    : null;
}

// Rank for a court row; its live match and tournament count as context.
export function rankCourt(court, rawTerm) {
  const term = norm(rawTerm);
  if (!term) return SEARCH_RANKS.SUBSTRING;
  const match = court.match || null;
  return bestRank(
    term,
    [
      [SEARCH_RANKS.MATCH_ID, [match?.matchId]],
      [SEARCH_RANKS.TOURNAMENT_ID, [match?.tournamentId]],
      [SEARCH_RANKS.COURT_ID, [court.id]],
      [SEARCH_RANKS.COURT_NAME, [court.name]],
      [SEARCH_RANKS.MATCH_NAME, [match?.name]],
      [SEARCH_RANKS.PLAYER_OR_TEAM, matchPeople(match)],
      [
        SEARCH_RANKS.SUBSTRING,
        [court.club?.name, court.club?.id, match?.tournamentName],
      ],
    ].map(([rank, values]) => [rank, values.filter(Boolean)]),
  );
}

export function rankMatch(match, rawTerm) {
  const term = norm(rawTerm);
  if (!term) return null;
  return bestRank(
    term,
    [
      [SEARCH_RANKS.MATCH_ID, [match.matchId]],
      [SEARCH_RANKS.TOURNAMENT_ID, [match.tournamentId]],
      [SEARCH_RANKS.COURT_ID, [match.currentCourtId]],
      [SEARCH_RANKS.COURT_NAME, [match.courtName]],
      [SEARCH_RANKS.MATCH_NAME, [match.name]],
      [SEARCH_RANKS.PLAYER_OR_TEAM, matchPeople(match)],
      [
        SEARCH_RANKS.SUBSTRING,
        [match.tournamentName, buildMatchupLabel(match)],
      ],
    ].map(([rank, values]) => [rank, values.filter(Boolean)]),
  );
}

export function rankTournament(tournament, rawTerm) {
  const term = norm(rawTerm);
  if (!term) return null;
  return bestRank(
    term,
    [
      [SEARCH_RANKS.TOURNAMENT_ID, [tournament.tournamentId]],
      [SEARCH_RANKS.MATCH_NAME, [tournament.name]],
      [SEARCH_RANKS.SUBSTRING, [tournament.clubName, tournament.formatLabel]],
    ].map(([rank, values]) => [rank, values.filter(Boolean)]),
  );
}

function byRankThenLabel(left, right) {
  return left.rank - right.rank || left.label.localeCompare(right.label);
}

// Courts that match, best first. An empty term keeps every court in its
// existing order.
export function searchCourts(courts, term) {
  if (!norm(term)) return [...courts];
  return courts
    .map((court) => ({
      court,
      rank: rankCourt(court, term),
      label: court.name || court.id,
    }))
    .filter((entry) => entry.rank !== null)
    .sort(byRankThenLabel)
    .map((entry) => entry.court);
}

// Match and tournament results shown next to the courts, each with the
// context line of spec section 31.3.
export function searchMatchesAndTournaments(
  { matches = [], tournaments = [] },
  term,
  limitCount = 8,
) {
  if (!norm(term)) return [];
  const results = [];
  matches.forEach((match) => {
    const rank = rankMatch(match, term);
    if (rank === null) return;
    results.push({
      kind: "match",
      id: match.matchId,
      rank,
      label: resolveMatchTitle(match, match.matchId),
      lines: [
        match.courtName || match.currentCourtId
          ? `Court: ${match.courtName || match.currentCourtId}`
          : null,
        buildMatchupLabel(match),
        `${String(match.status || "").toUpperCase()} - Match ${match.matchId}`,
      ].filter(Boolean),
    });
  });
  tournaments.forEach((tournament) => {
    const rank = rankTournament(tournament, term);
    if (rank === null) return;
    results.push({
      kind: "tournament",
      id: tournament.tournamentId,
      rank,
      label: tournament.name,
      lines: [
        [tournament.clubName, tournament.formatLabel]
          .filter(Boolean)
          .join(" - ") || null,
        `${String(tournament.status || "").toUpperCase()} - Tournament ${tournament.tournamentId}`,
      ].filter(Boolean),
    });
  });
  return results.sort(byRankThenLabel).slice(0, limitCount);
}

// A term that looks like a match id can find historical matches that are
// not in the live list.
export function looksLikeMatchId(term) {
  return isValidId(
    "match",
    typeof term === "string" ? term.trim().toLowerCase() : term,
  );
}
