// Team-name rules: normalisation, defaults and the display name that combines a
// team name with its players. Pure functions.
import { DEFAULT_TEAM_NAMES } from "../config/constants.js";
import { getTeamPlayerDisplayPair, hasPlayersForTeam } from "./playerNames.js";

export function normalizeTeamNames(teamNames = {})
{
  const normalizedA = typeof teamNames?.A === "string" ? teamNames.A.trim() : "";
  const normalizedB = typeof teamNames?.B === "string" ? teamNames.B.trim() : "";

  return {
    A: normalizedA || DEFAULT_TEAM_NAMES.A,
    B: normalizedB || DEFAULT_TEAM_NAMES.B
  };
}

export function isDefaultTeamName(team, name)
{
  const normalizedTeam = team === "B" ? "B" : "A";
  const normalizedName = typeof name === "string" ? name.trim() : "";
  return !normalizedName || normalizedName === DEFAULT_TEAM_NAMES[normalizedTeam];
}

export function resolvePersistedTeamNames(teamNames = {}, playerNames = {})
{
  return normalizeTeamNames(teamNames);
}

function formatTeamDisplayName(team, persistedTeamName, playerNames = {})
{
  const normalizedTeam = team === "B" ? "B" : "A";
  const baseName = typeof persistedTeamName === "string" && persistedTeamName.trim()
    ? persistedTeamName.trim()
    : DEFAULT_TEAM_NAMES[normalizedTeam];

  if (isDefaultTeamName(normalizedTeam, baseName))
  {
    if (hasPlayersForTeam(normalizedTeam, playerNames))
    {
      return getTeamPlayerDisplayPair(normalizedTeam, playerNames);
    }
    return DEFAULT_TEAM_NAMES[normalizedTeam];
  }

  var playerDisplayPair = getTeamPlayerDisplayPair(normalizedTeam, playerNames);
  playerDisplayPair = playerDisplayPair === "" ? "" : `- ${playerDisplayPair}`;
  return `${baseName} ${playerDisplayPair}`.trim();
}

export function resolveTeamNames(teamNames = {}, playerNames = {})
{
  const normalizedTeams = normalizeTeamNames(teamNames);

  return {
    A: formatTeamDisplayName("A", normalizedTeams.A, playerNames),
    B: formatTeamDisplayName("B", normalizedTeams.B, playerNames)
  };
}
