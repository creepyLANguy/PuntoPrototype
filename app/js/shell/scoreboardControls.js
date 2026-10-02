// Scoreboard controls: the point tap zones and the floating / settings controls
// (undo, exit, switch views, mute, server badge, fullscreen, reset, OBS overlay,
// join as player, edit players, switch to spectator).
import { playSound } from "../audio/audio.js";
import { EVENT_TYPES, SOUND_IDS, TOAST_TYPES } from "../config/constants.js";
import { NAV_PAGES } from "../config/routes.js";
import { openPlayerJoinPrompt } from "../court/playJoin.js";
import { enterCourt } from "../court/session.js";
import { showMatchDetails } from "../details/matchDetails.js";
import { stepBackInApp } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { addPoint, undoLastPoint } from "../scoring/actions.js";
import { openResetModal } from "../scoring/reset.js";
import { updateServerIndicator } from "../scoring/serverIndicator.js";
import { appState } from "../state/appState.js";
import { session } from "../state/sessionState.js";
import { themeState } from "../state/themeState.js";
import { openPlayerNamesModal } from "../teams/playerNamesModal.js";
import { $, elements } from "../ui/dom.js";
import { toggleFullscreen } from "../ui/fullscreen.js";
import { showConfirm } from "../ui/modals.js";
import { syncSettingsTiles } from "../ui/settingsTiles.js";
import { showToast } from "../ui/toast.js";

export function registerScoreboardControls()
{
  elements.swapBtn.addEventListener("click", () =>
  {
    playSound(SOUND_IDS.SWOOSH);

    document.querySelector(".scoreboard").classList.toggle("swapped");

    elements.swapBtn.textContent = document.querySelector(".scoreboard").classList.contains("swapped") ? "⇄" : "⇆";

    // Keep the details modal synchronized with the currently visible side orientation.
    if (!elements.detailsModal.classList.contains("hidden"))
    {
      showMatchDetails(false);
    }

    syncSettingsTiles();
  });

  elements.undoBtn.addEventListener("click", async () =>
  {
    if (await showConfirm("Undo the last point?"))
    {
      undoLastPoint();
    }
  });

  elements.backBtn.addEventListener("click", async () =>
  {
    if (await showConfirm("Exit to the main menu?"))
    {
      await stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
    }
  });

  // Reset tile in settings modal (player-only)
  if (elements.resetSettingsBtn)
  {
    elements.resetSettingsBtn.addEventListener("click", () =>
    {
      // Close settings first, then open reset modal
      elements.settingsModal.classList.add("hidden");
      openResetModal();
    });
  }

  // OBS overlay tile in settings modal
  if (elements.obsOverlayBtn)
  {
    elements.obsOverlayBtn.addEventListener("click", async () =>
    {
      if (!session.currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      const baseUrl = window.location.origin.replace(/\/$/, "");
      const overlayUrl = `${baseUrl}/overlay/${encodeURIComponent(session.currentCourtId)}`;

      let copied = false;
      if (navigator.clipboard?.writeText)
      {
        try
        {
          await navigator.clipboard.writeText(overlayUrl);
          copied = true;
        }
        catch (error)
        {
          console.warn("Overlay URL clipboard copy failed:", error);
        }
      }

      window.open(overlayUrl, "_blank", "noopener");
      showToast(copied ? "Overlay opened. URL copied to clipboard." : "Overlay opened.", TOAST_TYPES.SUCCESS);
    });
  }

  if (elements.joinCourtBtn)
  {
    elements.joinCourtBtn.addEventListener("click", () =>
    {
      if (!session.currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      elements.settingsModal.classList.add("hidden");
      openPlayerJoinPrompt(session.currentCourtId);
    });
  }

  if (elements.editPlayersBtn)
  {
    elements.editPlayersBtn.addEventListener("click", () =>
    {
      if (!session.currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      openPlayerNamesModal();
    });
  }

  if (elements.switchToSpectateBtn)
  {
    elements.switchToSpectateBtn.addEventListener("click", () =>
    {
      if (!session.currentCourtId)
      {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      elements.settingsModal.classList.add("hidden");
      enterCourt(session.currentCourtId, true, { historyMode: "replace" });
      showToast("Switched to Spectator view.", TOAST_TYPES.INFO);
    });
  }

  // Server visibility toggle tile (player-only)
  if (elements.serverToggleBtn)
  {
    elements.serverToggleBtn.addEventListener("click", () =>
    {
      themeState.isServerBadgeVisible = !themeState.isServerBadgeVisible;
      elements.serverToggleBtn.textContent = themeState.isServerBadgeVisible ? "⚾︎" : "⭘";
      localStorage.setItem("serverBadge", themeState.isServerBadgeVisible);
      updateServerIndicator();
      syncSettingsTiles();
      playSound(SOUND_IDS.POP);
      showToast(themeState.isServerBadgeVisible ? "Server indicator on" : "Server indicator off", TOAST_TYPES.INFO);
    });
  }

  elements.muteBtn.addEventListener("click", () =>
  {
    appState.muted = !appState.muted;
    elements.muteBtn.textContent = appState.muted ? "♫⃠" : "♫";
      syncSettingsTiles();
    if (!appState.muted)
    {
      playSound(SOUND_IDS.SNAP);
    }
  });

  elements.fullscreenBtn.addEventListener("click", toggleFullscreen);

  $("addPointA").addEventListener("click", () => addPoint(EVENT_TYPES.POINT_TEAM_A));
  $("addPointB").addEventListener("click", () => addPoint(EVENT_TYPES.POINT_TEAM_B));
}
