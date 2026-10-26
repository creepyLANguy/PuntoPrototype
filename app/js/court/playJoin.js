// Joining a court: the Play and Spectate pages (menu entry, dismissal), the court
// password check and the player join prompt shown over the scoreboard. Owns
// #playPage and #spectatePage.
import { getSkeleton } from "../firebase/adminRepository.js";
import { primeAudioForUserGesture } from "../audio/audio.js";
import { NAV_MODALS, NAV_PAGES } from "../config/routes.js";
import { TOAST_TYPES } from "../config/constants.js";
import { transitionScoreboardMatch } from "../ui/animations.js";
import {
  displayPlayCourtList,
  displaySpectateCourtList,
  loadCourtsWithInlineLoader,
} from "./courtLists.js";
import { enterCourt } from "./session.js";
import { getCourt } from "../firebase/courtRepository.js";
import { stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { appState } from "../state/appState.js";
import { session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";
import { hideSpinner, showSpinner } from "../ui/loading.js";
import { showToast } from "../ui/toast.js";

async function attemptCourtJoin({
  passwordInput,
  passwordError,
  nameError = null,
  generalError = null,
  isModal = false,
}) {
  if (appState.isJoiningCourt) return;
  appState.isJoiningCourt = true;

  // Preserve audio-unlock behaviour: this call must occur within the submit
  // gesture, before the Firestore request yields.
  primeAudioForUserGesture();

  const clearError = (element) => {
    if (element) element.textContent = "";
  };
  const showGeneralError = (message) => {
    if (generalError) {
      generalError.textContent = message;
    } else if (nameError) {
      nameError.style.display = "block";
      nameError.textContent = message;
    }
  };

  clearError(passwordError);
  clearError(generalError);
  clearError(nameError);
  if (nameError) nameError.style.display = "none";

  const courtId = appState.selectedPlayCourt;
  const password = passwordInput.value.trim();
  const loadingContainer = isModal
    ? elements.joinCourtModal
    : elements.playPage;
  const wasSpectating = session.isSpectating;
  let modalWasHiddenForJoin = false;

  try {
    if (!courtId) {
      showGeneralError("Court not selected.");
      return;
    }

    if (!password) {
      passwordError.textContent = "Password required.";
      return;
    }

    showSpinner(loadingContainer);
    const snap = await getCourt(courtId);
    if (!snap.exists()) {
      showGeneralError("Court not found.");
      return;
    }

    const adminPassword = await getSkeleton();
    const adminEntry = password === adminPassword;
    if (!adminEntry && snap.data().password !== password) {
      passwordError.textContent = "Incorrect password.";
      return;
    }

    // Replace the modal history entry with the underlying scoreboard before
    // entering; a failed backend request below will restore the modal.
    if (isModal) {
      // Keep loading visible while the modal is hidden for the scoreboard fade.
      showSpinner(elements.scoreboardPage);
      elements.joinCourtModal.classList.add("hidden");
      syncCurrentViewState("replace");
      modalWasHiddenForJoin = true;
    }

    if (!adminEntry) session.currentCourtPassword = password;
    const enterAsPlayer = () =>
      enterCourt(courtId, false, {
        historyMode: "replace",
        ...(adminEntry ? { adminEntry: true } : {}),
        matchId: appState.selectedPlayMatchId,
        followRequestedMatch: Boolean(session.requestedMatchId),
      });
    if (isModal) await transitionScoreboardMatch(enterAsPlayer);
    else await enterAsPlayer();

    // enterCourt can report a vanished court inline and return without throwing.
    // The full Play page owns that error element; copy it into the direct modal
    // rather than silently treating the attempted join as successful.
    if (session.currentCourtId !== courtId || session.isSpectating) {
      if (isModal) {
        throw new Error(
          elements.playCourtNameError?.textContent?.trim() ||
            "Unable to join court. Please try again.",
        );
      }
      return;
    }

    appState.playPageReturnToScoreboard = false;
    appState.selectedPlayMatchId = null;
    appState.playPageTargetId = null;
    appState.playPageTargetType = null;
    passwordInput.value = "";
    if (wasSpectating) {
      showToast("Switched to Player view.", TOAST_TYPES.INFO);
    }
  } catch (error) {
    const message =
      typeof error?.message === "string" && error.message.trim()
        ? error.message
        : typeof error === "string" && error.trim()
          ? error
          : "Unable to join court. Please try again.";
    showGeneralError(message);
    if (isModal && modalWasHiddenForJoin) {
      elements.joinCourtModal.classList.remove("hidden");
      syncCurrentViewState("replace");
    }
  } finally {
    hideSpinner(loadingContainer);
    if (modalWasHiddenForJoin) hideSpinner(elements.scoreboardPage);
    appState.isJoiningCourt = false;
  }
}

export function registerPlayAndSpectatePages() {
  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.textContent.trim();

      if (action === "Play") {
        elements.menuPage.style.display = "none";
        setPlayPageVisible(true);
        elements.playPasswordSection.style.display = "none";
        appState.selectedPlayCourt = null;
        appState.selectedPlayMatchId = null;
        appState.playPageTargetId = null;
        appState.playPageTargetType = null;
        elements.playCourtSearch.value = "";
        elements.playCourtPassword.value = "";
        elements.playCourtNameError.style.display = "none";
        elements.playCourtNameError.textContent = "";
        elements.playCourtPasswordError.textContent = "";

        elements.playCourtSearch.focus();
        await loadCourtsWithInlineLoader(elements.playCourtList, true);
        displayPlayCourtList(appState.allCourts);
        syncCurrentViewState();
        return;
      } else if (action === "Spectate") {
        elements.menuPage.style.display = "none";
        elements.spectatePage.style.display = "flex";
        elements.spectateCourtSearch.value = "";
        elements.spectateCourtNameError.style.display = "none";
        elements.spectateCourtNameError.textContent = "";

        elements.spectateCourtSearch.focus();
        await loadCourtsWithInlineLoader(elements.spectateCourtList, false);
        displaySpectateCourtList(appState.allCourts);
        syncCurrentViewState();
        return;
      }
    });
  });

  elements.closePlayBtn.addEventListener("click", () => {
    void closePlayPage();
  });

  elements.closeSpectateBtn.addEventListener("click", () => {
    void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
  });

  elements.playPage.addEventListener("click", (e) => {
    if (e.target === elements.playPage) {
      void closePlayPage();
    }
  });

  elements.spectatePage.addEventListener("click", (e) => {
    if (e.target === elements.spectatePage) {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
    }
  });

  elements.enterCourtBtn.addEventListener("click", () => {
    void attemptCourtJoin({
      passwordInput: elements.playCourtPassword,
      passwordError: elements.playCourtPasswordError,
      nameError: elements.playCourtNameError,
    });
  });

  elements.joinCourtModalForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void attemptCourtJoin({
      passwordInput: elements.joinCourtModalPassword,
      passwordError: elements.joinCourtModalPasswordError,
      generalError: elements.joinCourtModalError,
      isModal: true,
    });
  });

  const dismissJoinCourtModal = () => {
    if (elements.joinCourtModal.classList.contains("hidden")) return;
    void stepBackInApp(
      createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: session.currentCourtId,
        spectate: session.isSpectating,
        modal: NAV_MODALS.SETTINGS,
      }),
    );
  };

  elements.closeJoinCourtModalBtn?.addEventListener(
    "click",
    dismissJoinCourtModal,
  );
  elements.cancelJoinCourtModalBtn?.addEventListener(
    "click",
    dismissJoinCourtModal,
  );
  elements.joinCourtModal?.addEventListener("click", (event) => {
    if (event.target === elements.joinCourtModal) dismissJoinCourtModal();
  });
}

export function setPlayPageVisible(isVisible) {
  elements.playPage.style.display = isVisible ? "flex" : "none";
  document.body.classList.toggle("play-page-open", isVisible);
}

export function openPlayerJoinPrompt(
  courtId,
  matchId = null,
  targetId = courtId,
  targetType = "court",
) {
  appState.playPageReturnToScoreboard = false;
  appState.selectedPlayCourt = courtId;
  appState.selectedPlayMatchId = matchId || session.currentMatchId || null;
  appState.playPageTargetId = targetId || courtId;
  appState.playPageTargetType = targetType === "match" ? "match" : "court";

  const court = appState.allCourts.find((item) => item.id === courtId);
  elements.joinCourtModalTitle.textContent = "Join as a player";
  elements.joinCourtModalCourtName.textContent =
    court?.name || session.currentCourtName || courtId;
  elements.joinCourtModalPassword.value = "";
  elements.joinCourtModalPasswordError.textContent = "";
  elements.joinCourtModalError.textContent = "";
  elements.settingsModal?.classList.add("hidden");

  // Mirror the actual Options surface so the join prompt stays fully opaque
  // and theme-matched even if a later generic .create-card rule is loaded.
  const joinPanel = elements.joinCourtModal.querySelector(
    ".join-court-modal-card",
  );
  const optionsPanel = elements.settingsModal?.querySelector(".settings-box");
  if (joinPanel && optionsPanel) {
    const optionsBackground =
      window.getComputedStyle(optionsPanel).backgroundColor;
    joinPanel.style.setProperty(
      "background-color",
      optionsBackground,
      "important",
    );
  }

  elements.joinCourtModal.classList.remove("hidden");
  elements.joinCourtModalPassword.focus();

  syncCurrentViewState();
}

export async function closePlayPage() {
  await stepBackInApp(
    createViewState({
      page:
        appState.playPageReturnToScoreboard && session.currentCourtId
          ? NAV_PAGES.SCOREBOARD
          : NAV_PAGES.MENU,
      courtId: session.currentCourtId,
      spectate: session.isSpectating,
    }),
  );
}
