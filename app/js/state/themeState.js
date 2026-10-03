// Theme state: appearance preferences persisted in localStorage (theme, waves,
// server badge, per-theme team colours).
import { normalizeTeamColourPair } from "../utils/colour.js";

const TEAM_COLOUR_STORAGE_KEY = "punto_team_colours";

export const DEFAULT_TEAM_COLOURS = {
  dark: { A: "#ffff00", B: "#00ffff" },
  light: { A: "#ad7535", B: "#0a91ac" }
};

function createEmptyTeamColourState()
{
  return {
    dark: null,
    light: null
  };
}

function loadStoredTeamColours()
{
  try
  {
    const stored = JSON.parse(localStorage.getItem(TEAM_COLOUR_STORAGE_KEY) || "null");
    if (!stored) return createEmptyTeamColourState();

    const legacyColours = normalizeTeamColourPair(stored);
    if (legacyColours)
    {
      return {
        dark: { ...legacyColours },
        light: { ...legacyColours }
      };
    }

    return {
      dark: normalizeTeamColourPair(stored.dark),
      light: normalizeTeamColourPair(stored.light)
    };
  }
  catch (err)
  {
    console.warn("Could not load team colours:", err);
    return createEmptyTeamColourState();
  }
}

export function saveStoredTeamColours()
{
  if (!themeState.teamColoursByTheme.dark && !themeState.teamColoursByTheme.light)
  {
    localStorage.removeItem(TEAM_COLOUR_STORAGE_KEY);
    return;
  }

  localStorage.setItem(TEAM_COLOUR_STORAGE_KEY, JSON.stringify(themeState.teamColoursByTheme));
}

// Appearance preferences persisted in localStorage. The values are read from
// storage by initThemeState() during boot.
export const themeState = {
  isLightMode: false,
  isWavesEnabled: true,
  isServerBadgeVisible: true,
  teamColoursByTheme: null,
};

export function initThemeState()
{
  themeState.isLightMode = localStorage.getItem("theme") === "light";
  themeState.isWavesEnabled = localStorage.getItem("waves") !== "false";
  themeState.isServerBadgeVisible = localStorage.getItem("serverBadge") !== "false";
  themeState.teamColoursByTheme = loadStoredTeamColours();
}
