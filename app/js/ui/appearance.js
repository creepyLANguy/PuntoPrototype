// Appearance menu (#appearanceMenu): theme choice, team colour pickers (jscolor)
// and the background waves toggle.
import { playSound } from "../audio/audio.js";
import { SOUND_IDS, TOAST_TYPES } from "../config/constants.js";
import { session } from "../state/sessionState.js";
import { themeState } from "../state/themeState.js";
import { elements } from "./dom.js";
import { syncSettingsTiles } from "./settingsTiles.js";
import { getActiveTeamColours, getCurrentThemeName, getTeamColoursForTheme, resetTeamColours, setTeamColour, setTheme } from "./theme.js";
import { showToast } from "./toast.js";
import { getReadableTextColour, normalizeHexColour } from "../utils/colour.js";

let isPickingColour = false;

let activeTeamColourPickerPanel = null;

let activeTeamColourPickerId = 0;

let TEAM_COLOUR_PICKER_OPTIONS = null;

export function initTeamColourPickerTracking()
{
  TEAM_COLOUR_PICKER_OPTIONS = {
    format: "hex",
    hash: true,
    uppercase: false,
    required: true,
    width: 180,
    height: 180,
    sliderSize: 24,
    padding: 8,
    borderRadius: 4,
    smartPosition: true,
    zIndex: 20000,
    forceStyle: false,
    backgroundColor: themeState.isLightMode ? "#ffffff" : "#000000",
    borderColor: themeState.isLightMode ? "#00000030" : "#ffffff3a",
    controlBorderColor: themeState.isLightMode ? "#ffffff" : "#000000",
    pointerBorderColor: themeState.isLightMode ? "#ffffff" : "#000000",
    pointerColor: themeState.isLightMode ? "#000000" : "#ffffff",

  };

  const teamColourPickerObserver = new MutationObserver(() =>
  {
    bindTeamColourPickerPanel();

    if (!getTeamColourPickerPanel())
    {
      activeTeamColourPickerPanel = null;
    }
  });

  teamColourPickerObserver.observe(document.body, { childList: true });

  document.addEventListener("pointerdown", (event) =>
  {
    const panel = getTeamColourPickerPanel();
    if (!panel || !panel.contains(event.target)) return;

    isPickingColour = true;
    updateTeamColourPickerReveal(event.clientX, event.clientY);
  });

  document.addEventListener("pointermove", (event) =>
  {
    if (!isPickingColour) return;
    updateTeamColourPickerReveal(event.clientX, event.clientY);
  });

  document.addEventListener("pointerup", () =>
  {
    clearTeamColourPickerReveal();
  });

  document.addEventListener("pointercancel", () =>
  {
    clearTeamColourPickerReveal();
  });
}

function getTeamColourPickerPanel()
{
  const pickerZIndex = String(TEAM_COLOUR_PICKER_OPTIONS.zIndex);
  const bodyChildren = Array.from(document.body.children);

  for (let index = bodyChildren.length - 1; index >= 0; index -= 1)
  {
    const candidate = bodyChildren[index];
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate.id === "content-container") continue;

    const computedStyle = window.getComputedStyle(candidate);
    if (computedStyle.zIndex !== pickerZIndex) continue;
    if (computedStyle.position !== "absolute" && computedStyle.position !== "fixed") continue;

    return candidate;
  }

  return null;
}

function clearTeamColourPickerReveal()
{
  if (!activeTeamColourPickerPanel) return;

  activeTeamColourPickerPanel.classList.remove("is-revealing");
  activeTeamColourPickerPanel.style.removeProperty("--picker-reveal-x");
  activeTeamColourPickerPanel.style.removeProperty("--picker-reveal-y");
}

function bindTeamColourPickerPanel()
{
  const panel = getTeamColourPickerPanel();
  if (!panel || panel === activeTeamColourPickerPanel) return;

  activeTeamColourPickerPanel = panel;
  activeTeamColourPickerId += 1;
  panel.dataset.teamColourPickerId = String(activeTeamColourPickerId);
  panel.classList.add("team-colour-picker-panel");
  clearTeamColourPickerReveal();
}

function updateTeamColourPickerReveal(clientX, clientY)
{
  const panel = getTeamColourPickerPanel();
  if (!panel) return;

  if (panel !== activeTeamColourPickerPanel)
  {
    bindTeamColourPickerPanel();
  }

  const panelRect = panel.getBoundingClientRect();
  const revealX = Math.max(0, Math.min(clientX - panelRect.left, panelRect.width));
  const revealY = Math.max(0, Math.min(clientY - panelRect.top, panelRect.height));

  panel.style.setProperty("--picker-reveal-x", `${revealX}px`);
  panel.style.setProperty("--picker-reveal-y", `${revealY}px`);
  panel.classList.add("is-revealing");
}

export function initializeTeamColourPickers()
{
  const pickers = document.querySelectorAll("[data-team-colour]");
  const JsColor = window.JSColor || window.jscolor;

  if (!JsColor)
  {
    return;
  }

  pickers.forEach((picker) =>
  {
    if (!picker.jscolor)
    {
      new JsColor(picker, {
        ...TEAM_COLOUR_PICKER_OPTIONS,
        onInput()
        {
          isPickingColour = true;
          bindTeamColourPickerPanel();
          elements.settingsModal.classList.add("hidden");

          const pickedColour = normalizeHexColour(this.toHEXString());
          if (!pickedColour) return;
          setTeamColour(picker.dataset.teamColour, pickedColour);
        },
        onChange()
        {
          isPickingColour = false;
          clearTeamColourPickerReveal();
          if (session.currentCourtId)
          {
            elements.settingsModal.classList.remove("hidden");
          }

          const pickedColour = normalizeHexColour(this.toHEXString());
          if (!pickedColour) return;
          setTeamColour(picker.dataset.teamColour, pickedColour);
        },

      });
    }
  });
}

function updateTeamColourInput(picker, colour)
{
  picker.value = colour;
  picker.style.setProperty("--picker-colour", colour);

  if (!picker.jscolor) return;

  const pickerColour = normalizeHexColour(picker.jscolor.toHEXString());
  if (pickerColour !== colour)
  {
    picker.jscolor.fromString(colour);
  }

  picker.jscolor.backgroundColor = themeState.isLightMode ? "#ffffff" : "#000000";
  picker.jscolor.borderColor = themeState.isLightMode ? "#00000030" : "#ffffff3a";
  picker.jscolor.controlBorderColor = themeState.isLightMode ? "#ffffff" : "#000000";
  picker.jscolor.pointerBorderColor = themeState.isLightMode ? "#ffffff" : "#000000";
  picker.jscolor.pointerColor = themeState.isLightMode ? "#000000" : "#ffffff";
}

export function syncAppearanceControls()
{
  const activeTheme = getCurrentThemeName();
  const activeColours = getActiveTeamColours();

  document.querySelectorAll("[data-theme-choice]").forEach((button) =>
  {
    const choiceTheme = button.dataset.themeChoice;
    const previewColours = getTeamColoursForTheme(choiceTheme);
    const isActive = button.dataset.themeChoice === activeTheme;
    const readableTextColour = getReadableTextColour(previewColours);

    button.style.setProperty("--theme-choice-a", previewColours.A);
    button.style.setProperty("--theme-choice-b", previewColours.B);
    button.style.setProperty("--theme-choice-text", readableTextColour);
    button.style.setProperty("--theme-choice-shadow", readableTextColour === "#000000" ? "#ffffff" : "#000000");
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  document.querySelectorAll("[data-team-colour]").forEach((input) =>
  {
    updateTeamColourInput(input, activeColours[input.dataset.teamColour]);
  });
}

function openAppearanceMenu()
{
  if (!elements.appearanceMenu || !elements.appearanceMenuBtn) return;

  syncAppearanceControls();
  elements.appearanceMenu.classList.remove("hidden");
  elements.appearanceMenuBtn.setAttribute("aria-expanded", "true");
}

export function closeAppearanceMenu()
{
  if (!elements.appearanceMenu || !elements.appearanceMenuBtn) return;

  elements.appearanceMenu.classList.add("hidden");
  elements.appearanceMenuBtn.setAttribute("aria-expanded", "false");
}

function toggleAppearanceMenu()
{
  if (!elements.appearanceMenu) return;

  if (elements.appearanceMenu.classList.contains("hidden")) openAppearanceMenu();
  else closeAppearanceMenu();
}

export function initializeWaves()
{
  updateWavesVisibility();
}

export function toggleWaves()
{
  themeState.isWavesEnabled = !themeState.isWavesEnabled;
  localStorage.setItem("waves", themeState.isWavesEnabled);
  elements.waveToggleScoreboardBtn.textContent = themeState.isWavesEnabled ? "♒︎" : "═";

  updateWavesVisibility();
  syncSettingsTiles();

  playSound(SOUND_IDS.POP);

  showToast(themeState.isWavesEnabled ? "Waves enabled" : "Waves disabled", TOAST_TYPES.INFO);
}

export function updateWavesVisibility()
{
  const waveContainer = document.querySelector(".wave-container");
  if (!waveContainer) return;

  // The toggle only affects the Scoreboard and Spectate (court list) views.
  // On the homepage and other pre-game screens, waves should always be visible.
  const onScoreboard = elements.scoreboardPage && window.getComputedStyle(elements.scoreboardPage).display !== "none";
  const onSpectate = elements.spectatePage && window.getComputedStyle(elements.spectatePage).display !== "none";

  const shouldHide = (onScoreboard || onSpectate) && !themeState.isWavesEnabled;
  const holdsHiddenClass = waveContainer.classList.contains("waves-hidden");

  if (shouldHide !== holdsHiddenClass)
  {
    waveContainer.classList.toggle("waves-hidden", shouldHide);
  }
}

export function registerAppearanceControls()
{
  if (elements.appearanceMenuBtn)
  {
    elements.appearanceMenuBtn.addEventListener("click", (e) =>
    {
      e.stopPropagation();
      toggleAppearanceMenu();
    });
  }
  document.querySelectorAll("[data-theme-choice]").forEach((button) =>
  {
    button.addEventListener("click", () => setTheme(button.dataset.themeChoice));
  });

  document.querySelectorAll("[data-team-colour]").forEach((input) =>
  {
    input.addEventListener("input", () => setTeamColour(input.dataset.teamColour, input.value));
    input.addEventListener("change", () => setTeamColour(input.dataset.teamColour, input.value));
  });

  document.querySelectorAll(".reset-theme-colours-btn").forEach((button) =>
  {
    button.addEventListener("click", resetTeamColours);
  });
}

export function registerAppearanceMenuDismissal()
{
  document.addEventListener("click", (e) =>
  {
    if (!elements.appearanceMenu || elements.appearanceMenu.classList.contains("hidden")) return;
    if (elements.appearanceMenu.contains(e.target) || elements.appearanceMenuBtn?.contains(e.target)) return;
    if (document.querySelector("[data-team-colour].jscolor-active")) return;

    closeAppearanceMenu();
  });

  document.addEventListener("keydown", (e) =>
  {
    if (e.key === "Escape") closeAppearanceMenu();
  });
}

export function registerWaveToggleButtons()
{
  if (elements.waveToggleScoreboardBtn)
  {
    elements.waveToggleScoreboardBtn.addEventListener("click", toggleWaves);
  }

  if (elements.waveToggleSpectateBtn)
  {
    elements.waveToggleSpectateBtn.addEventListener("click", toggleWaves);
  }
}
