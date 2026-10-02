// Settings modal (#settingsModal) open / close and its clickable option tiles.
import { NAV_PAGES } from "../config/routes.js";
import { stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { syncScoringControls } from "../scoring/settings.js";
import { session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";
import { updateFullscreenButton } from "../ui/fullscreen.js";
import { syncSettingsTiles } from "../ui/settingsTiles.js";

export function registerSettingsModal()
{
  // Settings Modal logic
  elements.settingsBtn.addEventListener("click", () =>
  {
    updateFullscreenButton();
    syncScoringControls();
    elements.settingsModal.classList.remove("hidden");
    syncSettingsTiles();
    syncCurrentViewState();
  });

  elements.closeSettingsBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({
      page: NAV_PAGES.SCOREBOARD,
      courtId: session.currentCourtId,
      spectate: session.isSpectating
    }));
  });

  elements.settingsModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.settingsModal)
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: session.currentCourtId,
        spectate: session.isSpectating
      }));
  });

  // Make option tiles clickable
  document.querySelectorAll(".setting-item").forEach(item =>
  {
    item.addEventListener("click", (e) =>
    {
      const btn = item.querySelector("button");
      if (btn && e.target !== btn)
      {
        btn.click();
      }
    });
  });
}
