// Theme: light / dark mode and the per-theme team colours applied as CSS custom
// properties.
import { TOAST_TYPES } from "../config/constants.js";
import { DEFAULT_TEAM_COLOURS, saveStoredTeamColours, themeState } from "../state/themeState.js";
import { initializeTeamColourPickers, syncAppearanceControls } from "./appearance.js";
import { showToast } from "./toast.js";
import { getReadableTextColourForBackground, normalizeHexColour } from "../utils/colour.js";

export function initializeTheme()
{
  if (themeState.isLightMode)
  {
    document.body.classList.add("light-mode");
  }

  initializeTeamColourPickers();
  applyTeamColours();
  syncAppearanceControls();
}

export function setTheme(theme)
{
  themeState.isLightMode = theme === "light";
  document.body.classList.toggle("light-mode", themeState.isLightMode);
  localStorage.setItem("theme", themeState.isLightMode ? "light" : "dark");
  applyTeamColours();
  syncAppearanceControls();
}

export function toggleTheme()
{
  setTheme(themeState.isLightMode ? "dark" : "light");
}

export function getCurrentThemeName()
{
  return themeState.isLightMode ? "light" : "dark";
}

export function getActiveTeamColours()
{
  return getTeamColoursForTheme(getCurrentThemeName());
}

export function getTeamColoursForTheme(theme)
{
  return themeState.teamColoursByTheme[theme] || DEFAULT_TEAM_COLOURS[theme];
}

function applyTeamColours()
{
  const activeTheme = getCurrentThemeName();
  const customColours = themeState.teamColoursByTheme[activeTheme];

  if (customColours)
  {
    document.body.style.setProperty("--teamAcolour", customColours.A);
    document.body.style.setProperty("--teamBcolour", customColours.B);
    updateAdminToolButtonTextColours(customColours);
    return;
  }

  const defaultColours = DEFAULT_TEAM_COLOURS[activeTheme];
  document.body.style.removeProperty("--teamAcolour");
  document.body.style.removeProperty("--teamBcolour");
  updateAdminToolButtonTextColours(defaultColours);
}

function updateAdminToolButtonTextColours(colours)
{
  if (!colours?.A || !colours?.B) return;

  const nfcToolButton = document.getElementById("nfcToolBtn");
  const deviceHarnessButton = document.getElementById("deviceHarnessBtn");

  if (nfcToolButton)
  {
    nfcToolButton.style.color = getReadableTextColourForBackground(colours.B);
  }

  if (deviceHarnessButton)
  {
    deviceHarnessButton.style.color = getReadableTextColourForBackground(colours.A);
  }
}

export function setTeamColour(team, colour)
{
  const normalizedColour = normalizeHexColour(colour);
  if (!normalizedColour || !["A", "B"].includes(team)) return;

  const activeTheme = getCurrentThemeName();

  themeState.teamColoursByTheme[activeTheme] = {
    ...getTeamColoursForTheme(activeTheme),
    [team]: normalizedColour
  };

  saveStoredTeamColours();
  applyTeamColours();
  syncAppearanceControls();
}

export function resetTeamColours()
{
  const activeTheme = getCurrentThemeName();

  themeState.teamColoursByTheme[activeTheme] = null;
  saveStoredTeamColours();
  applyTeamColours();
  syncAppearanceControls();
  showToast(`${activeTheme[0].toUpperCase()}${activeTheme.slice(1)} colours reset`, TOAST_TYPES.INFO);
}
