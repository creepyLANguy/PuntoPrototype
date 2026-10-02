// Share content: the text (and optional score card image) shared for a court.
import BRAND from "../brand.mjs";
import { buildCourtQrUrl } from "../qr/courtQr.js";
import { resolveScoreDisplayOptions } from "../scoring/options.js";
import { shareCardState } from "./shareCardState.js";
import { session } from "../state/sessionState.js";
import { getPlayerLineForTeam } from "../teams/playerNames.js";
import { isDefaultTeamName, normalizeTeamNames } from "../teams/teamNames.js";

export function buildTeamsShareLines(teamNames = {}, playerNames = {})
{
  const lines = [];

  const normalizedTeams = normalizeTeamNames(teamNames);
  if (!isDefaultTeamName("A", normalizedTeams.A) && !isDefaultTeamName("B", normalizedTeams.B))
  {
    lines.push(`${normalizedTeams.A} vs ${normalizedTeams.B}`);
  }

  const playersA = getPlayerLineForTeam("A", playerNames);
  const playersB = getPlayerLineForTeam("B", playerNames);
  if (playersA && playersB)
  {
    lines.push(`${playersA} vs ${playersB}`);
  }

  return lines;
}

export function buildCurrentScoreSummary(currentScore = session.score)
{
  if (!currentScore || !currentScore.A || !currentScore.B)
  {
    return "";
  }

  const options = resolveScoreDisplayOptions(currentScore);
  if (options.scoringMode === "straight" || options.scoringMode === "tiebreakTen")
  {
    const pointsA = Number(currentScore.A.totalPoints ?? currentScore.A.points) || 0;
    const pointsB = Number(currentScore.B.totalPoints ?? currentScore.B.points) || 0;
    return `Score: ${pointsA}-${pointsB} points`;
  }

  let buff = "";
  currentScore.completedSets.forEach((set, index) => {
    const gamesA = set.A || 0;
    const gamesB = set.B || 0;
    buff += `${gamesA}-${gamesB}, `;
  });

  if (currentScore.A.games > 0 || currentScore.B.games > 0) 
  {
    const gamesA = currentScore.A.games || 0;
    const gamesB = currentScore.B.games || 0;
    buff += `${gamesA}-${gamesB}`;
  }

  buff.at(-2) === "," ? buff = buff.slice(0, -2) : null;

  return buff;
}

export function getSharePayload(context)
{  
  const payload = { title: "", text: "", files: [] };

  const lines = [];
  lines.push(BRAND.name + "\n");

  lines.push(...buildTeamsShareLines(session.currentRawTeamNames || {}, session.currentPlayerNames || {}));
  const scoreSummary = buildCurrentScoreSummary();
  if (scoreSummary)
  {
    lines.push(scoreSummary + "\n");
  }

  lines.push(`${session.currentCourtName} (${session.currentCourtId.toUpperCase()})\n`);

  lines.push( context === "details" ? `View full match details:` : `View live scoreboard:`);
  lines.push(buildCourtQrUrl(session.currentCourtId));

  payload.text = lines.join("\n");

  if (context === "details" && shareCardState.shareableScoreCardImage)
  {        
    payload.files.push(shareCardState.shareableScoreCardImage);
  }

  return payload;
}
