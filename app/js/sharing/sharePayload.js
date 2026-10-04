// Share content: the text (and optional score card image) shared for the match
// on the open court. The canonical match link is /m/{matchId}.
import BRAND from "../brand.mjs";
import { buildCourtQrUrl } from "../qr/courtQr.js";
import { getMatchPath } from "../match/matchIdentity.js";
import { resolveScoreDisplayOptions } from "../scoring/options.js";
import { shareCardState } from "./shareCardState.js";
import { session } from "../state/sessionState.js";
import { getPlayerLineForTeam } from "../teams/playerNames.js";
import { isDefaultTeamName, normalizeTeamNames } from "../teams/teamNames.js";

export function buildTeamsShareLines(teamNames = {}, playerNames = {}) {
  const lines = [];

  const normalizedTeams = normalizeTeamNames(teamNames);
  if (
    !isDefaultTeamName("A", normalizedTeams.A) &&
    !isDefaultTeamName("B", normalizedTeams.B)
  ) {
    lines.push(`${normalizedTeams.A} vs ${normalizedTeams.B}`);
  }

  const playersA = getPlayerLineForTeam("A", playerNames);
  const playersB = getPlayerLineForTeam("B", playerNames);
  if (playersA && playersB) {
    lines.push(`${playersA} vs ${playersB}`);
  }

  return lines;
}

export function buildCurrentScoreSummary(currentScore = session.score) {
  if (!currentScore || !currentScore.A || !currentScore.B) {
    return "";
  }

  const options = resolveScoreDisplayOptions(currentScore);
  if (
    options.scoringMode === "straight" ||
    options.scoringMode === "tiebreakTen" ||
    options.scoringMode === "fixedTotalPoints"
  ) {
    const pointsA =
      Number(currentScore.A.totalPoints ?? currentScore.A.points) || 0;
    const pointsB =
      Number(currentScore.B.totalPoints ?? currentScore.B.points) || 0;
    return `Score: ${pointsA}-${pointsB} points`;
  }

  let buff = "";
  currentScore.completedSets.forEach((set, index) => {
    const gamesA = set.A || 0;
    const gamesB = set.B || 0;
    buff += `${gamesA}-${gamesB}, `;
  });

  if (currentScore.A.games > 0 || currentScore.B.games > 0) {
    const gamesA = currentScore.A.games || 0;
    const gamesB = currentScore.B.games || 0;
    buff += `${gamesA}-${gamesB}`;
  }

  buff.at(-2) === "," ? (buff = buff.slice(0, -2)) : null;

  return buff;
}

export function buildMatchUrl(matchId) {
  if (!matchId) return null;
  return `${window.location.origin}${getMatchPath(matchId)}`;
}

export function getSharePayload(context) {
  const payload = { title: "", text: "", files: [] };

  const lines = [];
  lines.push(BRAND.name + "\n");

  if (session.currentMatchName) {
    lines.push(session.currentMatchName);
  }
  lines.push(
    ...buildTeamsShareLines(
      session.currentRawTeamNames || {},
      session.currentPlayerNames || {},
    ),
  );
  const scoreSummary = buildCurrentScoreSummary();
  if (scoreSummary) {
    lines.push(scoreSummary + "\n");
  }

  lines.push(
    `${session.currentCourtName} (${session.currentCourtId.toUpperCase()})\n`,
  );

  // The match link is canonical and survives court reuse; the court link
  // follows whatever is played on that court next.
  const matchUrl = buildMatchUrl(session.currentMatchId);
  if (context === "details" && matchUrl) {
    lines.push("View full match details:");
    lines.push(matchUrl);
  } else {
    lines.push("View live scoreboard:");
    lines.push(buildCourtQrUrl(session.currentCourtId));
    if (matchUrl) {
      lines.push("\nThis match:");
      lines.push(matchUrl);
    }
  }

  payload.text = lines.join("\n");

  if (context === "details" && shareCardState.shareableScoreCardImage) {
    payload.files.push(shareCardState.shareableScoreCardImage);
  }

  return payload;
}
