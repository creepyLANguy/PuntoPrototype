// Settings modal tiles: keeps each tile's active state and label in sync with
// the session and preferences.
import { appState } from "../state/appState.js";
import { session } from "../state/sessionState.js";
import { themeState } from "../state/themeState.js";
import { elements } from "./dom.js";
import { getFullscreenElement } from "./fullscreen.js";

export function syncSettingsTiles()
{
  const updateItem = (button, active, activeLabel, inactiveLabel) =>
  {
    if (!button) return;
    const wrapper = button.closest(".setting-item");
    if (!wrapper) return;
    wrapper.classList.toggle("active", Boolean(active));
    const label = wrapper.querySelector("span");
    if (label)
    {
      label.textContent = active ? activeLabel : inactiveLabel;
    }
    button.setAttribute("aria-pressed", active ? "true" : "false");
  };

  const syncChangeoverItem = () =>
  {
    const button = elements.changeoverBtn;
    const wrapper = elements.changeoverTile;
    if (!button || !wrapper) return;

    const label = wrapper.querySelector(":scope > span");

    wrapper.classList.toggle("active", Boolean(session.beaconSidesSwapped));
    wrapper.classList.toggle("processing", session.changeoverProcessing);

    if (session.changeoverProcessing)
    {
      button.disabled = true;
      button.classList.add("processing");
      button.setAttribute("aria-busy", "true");
      button.setAttribute("aria-label", "Changing court over");
      button.title = "Changing court over";
      button.innerHTML = '<span class="changeover-spinner" aria-hidden="true"></span>';

      if (label)
      {
        label.textContent = "Changing over…";
      }
      return;
    }

    button.disabled = false;
    button.classList.remove("processing");
    button.removeAttribute("aria-busy");
    button.setAttribute("aria-label", "Changeover");
    button.title = "Changeover";
    button.innerHTML = "↔";

    if (label)
    {
      label.textContent = session.beaconSidesSwapped ? "Changeover *" : "Changeover";
    }
  };

  updateItem(elements.muteBtn, appState.muted, "Muted", "Mute");
  updateItem(elements.waveToggleScoreboardBtn, themeState.isWavesEnabled, "Waves on", "Waves off");
  updateItem(elements.fullscreenBtn, Boolean(getFullscreenElement()), "Exit full", "Fullscreen");
  updateItem(
    elements.swapBtn,
    document.querySelector(".scoreboard")?.classList.contains("swapped"),
    "Swap views *",
    "Switch views",
  );
  syncChangeoverItem();
  updateItem(elements.serverToggleBtn, themeState.isServerBadgeVisible, "Server on", "Server off");
}
