// Player-name rules: normalisation and display of the four player slots
// (A1, A2, B1, B2). Pure functions apart from defaulting to the open court.
import { session } from "../state/sessionState.js";

export function normalizePlayerNames(playerNames = {})
{
  return {
    A1: typeof playerNames?.A1 === "string" ? playerNames.A1 : "",
    A2: typeof playerNames?.A2 === "string" ? playerNames.A2 : "",
    B1: typeof playerNames?.B1 === "string" ? playerNames.B1 : "",
    B2: typeof playerNames?.B2 === "string" ? playerNames.B2 : ""
  };
}

function hasAnyPlayerNames(playerNames = {})
{
  const normalized = normalizePlayerNames(playerNames);
  return Object.values(normalized).some(name => name.trim().length > 0);
}

function getTeamSlots(team)
{
  return team === "B" ? ["B1", "B2"] : ["A1", "A2"];
}

export function hasPlayersForTeam(team, playerNames = {})
{
  const normalizedPlayers = normalizePlayerNames(playerNames);
  const [slot1, slot2] = getTeamSlots(team);
  return Boolean(normalizedPlayers[slot1].trim() || normalizedPlayers[slot2].trim());
}

export function getTeamPlayerDisplayPair(team, playerNames = {})
{
  const normalizedPlayers = normalizePlayerNames(playerNames);
  const [slot1, slot2] = getTeamSlots(team);
  const first = normalizedPlayers[slot1].trim() || slot1;
  const second = normalizedPlayers[slot2].trim() || slot2;

  if (first === slot1 && second === slot2) {
    return "";
  }

  return `${first} / ${second}`;
}

export function getPlayerDisplayName(slot, playerNames = session.currentPlayerNames, defaultToSlot = false)
{
  const normalized = normalizePlayerNames(playerNames);
  const value = typeof normalized[slot] === "string" ? normalized[slot].trim() : "";
  return value || (defaultToSlot ? slot : "");
}

export function getServerDisplayLabel(serverLabel)
{
  return getPlayerDisplayName(serverLabel, session.currentPlayerNames, true); 
}

export function getPlayerLineForTeam(team, playerNames = {})
{
  const normalizedTeam = team === "B" ? "B" : "A";
  const normalizedPlayers = normalizePlayerNames(playerNames);
  const slots = normalizedTeam === "A" ? ["A1", "A2"] : ["B1", "B2"];
  const playerValues = slots
    .map(slot => (typeof normalizedPlayers[slot] === "string" ? normalizedPlayers[slot].trim() : ""))
    .filter(Boolean);

  return playerValues.length > 0 ? playerValues.join(" / ") : "";
}
