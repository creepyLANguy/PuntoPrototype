// Scoreboard controls: the point tap zones and the floating / settings controls
// (undo, exit, swap views, mute, server badge, fullscreen, reset, OBS overlay,
// join as player, edit players, switch to spectator).
import { playSound } from "../audio/audio.js";
import { EVENT_TYPES, SOUND_IDS, TOAST_TYPES } from "../config/constants.js";
import { NAV_PAGES } from "../config/routes.js";
import { openPlayerJoinPrompt } from "../court/playJoin.js";
import { enterCourt } from "../court/session.js";
import { showMatchDetails } from "../details/matchDetails.js";
import { manageMatch } from "../firebase/callables.js";
import { stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { addPoint, undoLastPoint } from "../scoring/actions.js";
import { openResetModal } from "../scoring/reset.js";
import { updateServerIndicator } from "../scoring/serverIndicator.js";
import { appState } from "../state/appState.js";
import { getCourtCredentials } from "../state/credentialsState.js";
import { session } from "../state/sessionState.js";
import { themeState } from "../state/themeState.js";
import { openPlayerNamesModal } from "../teams/playerNamesModal.js";
import { $, elements } from "../ui/dom.js";
import {
  swapScoreboardViews,
  transitionScoreboardMatch,
} from "../ui/animations.js";
import { toggleFullscreen } from "../ui/fullscreen.js";
import { setButtonIcon } from "../ui/icons.js";
import { showConfirm } from "../ui/modals.js";
import { canStartNewMatch, syncSettingsTiles } from "../ui/settingsTiles.js";
import { showToast } from "../ui/toast.js";

export function registerScoreboardControls() {
  if (elements.newMatchBtn) {
    elements.newMatchBtn.addEventListener("click", async () => {
      const button = elements.newMatchBtn;
      if (!canStartNewMatch() || button.getAttribute("aria-busy") === "true")
        return;

      const courtId = session.currentCourtId;
      const courtAllocationId = session.currentCourtAllocationId;
      const matchId = session.currentMatchId;
      const matchAllocationId = session.currentMatchAllocationId;
      const listenerToken = session.activeCourtListenerToken;
      const isSameCourtSession = () =>
        session.currentCourtId === courtId &&
        session.currentCourtAllocationId === courtAllocationId &&
        session.activeCourtListenerToken === listenerToken &&
        !session.isSpectating;

      // Same warning sound the Reset tile plays when it opens its modal.
      playSound(SOUND_IDS.WARNING);

      button.setAttribute("aria-busy", "true");
      syncSettingsTiles();

      // The settings modal and the confirm modal share the same overlay layer and
      // the settings modal is later in the DOM, so it would cover the
      // confirmation. Close settings first (as the Reset tile does) and bring it
      // back if the user cancels or the request fails.
      const settingsWasOpen =
        !elements.settingsModal.classList.contains("hidden");
      elements.settingsModal.classList.add("hidden");
      let started = false;
      try {
        if (
          !(await showConfirm(
            "Start a new match?\nThe current match and its score history will be saved.",
          ))
        )
          return;
        if (
          !isSameCourtSession() ||
          !canStartNewMatch() ||
          session.currentMatchId !== matchId ||
          session.currentMatchAllocationId !== matchAllocationId
        )
          return;

        const result = await manageMatch(
          "newCourtMatch",
          { courtId, matchId },
          getCourtCredentials(),
        );
        if (!isSameCourtSession()) return;

        await transitionScoreboardMatch(() =>
          enterCourt(courtId, false, {
            historyMode: "replace",
            adminEntry: session.enteredCourtAsAdmin,
            matchId: result.matchId,
            followRequestedMatch: Boolean(session.requestedMatchId),
            courtAllocationId,
            matchAllocationId: result.allocationId,
          }),
        );
        started = true;
        elements.settingsModal.classList.add("hidden");
        syncCurrentViewState("replace");
        showToast(
          "Previous match saved. New match started.",
          TOAST_TYPES.SUCCESS,
        );
      } catch (error) {
        console.error("New match failed:", error);
        if (isSameCourtSession()) {
          showToast(
            "New Match Failed: " + (error.message || "Unknown error"),
            TOAST_TYPES.ERROR,
          );
        }
      } finally {
        if (!started && settingsWasOpen && isSameCourtSession()) {
          elements.settingsModal.classList.remove("hidden");
        }
        button.removeAttribute("aria-busy");
        syncSettingsTiles();
      }
    });
  }

  elements.swapBtn.addEventListener("click", () => {
    playSound(SOUND_IDS.SWOOSH);

    const swapped = swapScoreboardViews();

    setButtonIcon(elements.swapBtn, swapped ? "swap-alt" : "swap");
    elements.swapBtn.setAttribute("aria-pressed", String(swapped));

    // Keep the details modal synchronized with the currently visible side orientation.
    if (!elements.detailsModal.classList.contains("hidden")) {
      showMatchDetails(false);
    }

    syncSettingsTiles();
  });

  elements.undoBtn.addEventListener("click", async () => {
    if (await showConfirm("Undo the last point?")) {
      undoLastPoint();
    }
  });

  elements.backBtn.addEventListener("click", async () => {
    if (await showConfirm("Exit to the main menu?")) {
      await stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
    }
  });

  // Reset tile in settings modal (player-only)
  if (elements.resetSettingsBtn) {
    elements.resetSettingsBtn.addEventListener("click", () => {
      // Close settings first, then open reset modal
      elements.settingsModal.classList.add("hidden");
      openResetModal();
    });
  }

  // OBS overlay tile in settings modal
  if (elements.obsOverlayBtn) {
    elements.obsOverlayBtn.addEventListener("click", async () => {
      if (!session.currentCourtId) {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      const baseUrl = window.location.origin.replace(/\/$/, "");
      const overlayUrl = `${baseUrl}/overlay/${encodeURIComponent(session.currentCourtId)}`;

      let copied = false;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(overlayUrl);
          copied = true;
        } catch (error) {
          console.warn("Overlay URL clipboard copy failed:", error);
        }
      }

      window.open(overlayUrl, "_blank", "noopener");
      showToast(
        copied ? "Overlay opened. URL copied to clipboard." : "Overlay opened.",
        TOAST_TYPES.SUCCESS,
      );
    });
  }

  if (elements.joinCourtBtn) {
    elements.joinCourtBtn.addEventListener("click", () => {
      if (!session.currentCourtId) {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      elements.settingsModal.classList.add("hidden");
      openPlayerJoinPrompt(session.currentCourtId, session.currentMatchId);
    });
  }

  if (elements.editPlayersBtn) {
    elements.editPlayersBtn.addEventListener("click", () => {
      if (!session.currentCourtId) {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      openPlayerNamesModal();
    });
  }

  if (elements.switchToSpectateBtn) {
    elements.switchToSpectateBtn.addEventListener("click", async () => {
      if (!session.currentCourtId) {
        showToast("No court is currently open.", TOAST_TYPES.ERROR);
        return;
      }

      elements.settingsModal.classList.add("hidden");
      try {
        await transitionScoreboardMatch(() =>
          enterCourt(session.currentCourtId, true, { historyMode: "replace" }),
        );
        showToast("Switched to Spectator view.", TOAST_TYPES.INFO);
      } catch (error) {
        console.error("Switching to spectator mode failed:", error);
        elements.settingsModal.classList.remove("hidden");
        showToast(
          "Could not switch to spectator mode. Please try again.",
          TOAST_TYPES.ERROR,
        );
      }
    });
  }

  // Server visibility toggle tile
  if (elements.serverToggleBtn) {
    elements.serverToggleBtn.addEventListener("click", () => {
      themeState.isServerBadgeVisible = !themeState.isServerBadgeVisible;
      setButtonIcon(
        elements.serverToggleBtn,
        themeState.isServerBadgeVisible ? "server" : "server-off",
      );
      localStorage.setItem("serverBadge", themeState.isServerBadgeVisible);
      updateServerIndicator();
      syncSettingsTiles();
      playSound(SOUND_IDS.POP);
      showToast(
        themeState.isServerBadgeVisible
          ? "Server indicator on"
          : "Server indicator off",
        TOAST_TYPES.INFO,
      );
    });
  }

  elements.muteBtn.addEventListener("click", () => {
    appState.muted = !appState.muted;
    setButtonIcon(elements.muteBtn, appState.muted ? "music-muted" : "music");
    elements.muteBtn.title = appState.muted ? "Unmute" : "Mute";
    elements.muteBtn.setAttribute(
      "aria-label",
      appState.muted ? "Unmute audio" : "Mute audio",
    );
    syncSettingsTiles();
    if (!appState.muted) {
      playSound(SOUND_IDS.SNAP);
    }
  });

  elements.fullscreenBtn.addEventListener("click", toggleFullscreen);

  $("addPointA").addEventListener("click", () =>
    addPoint(EVENT_TYPES.POINT_TEAM_A),
  );
  $("addPointB").addEventListener("click", () =>
    addPoint(EVENT_TYPES.POINT_TEAM_B),
  );
}
