// Joining a court: the Play and Spectate pages (menu entry, dismissal), the court
// password check and the player join prompt shown over the scoreboard. Owns
// #playPage and #spectatePage.
import { getSkeleton } from "../firebase/adminRepository.js";
import { primeAudioForUserGesture } from "../audio/audio.js";
import { NAV_PAGES } from "../config/routes.js";
import { displayPlayCourtList, displaySpectateCourtList, loadCourtsWithInlineLoader } from "./courtLists.js";
import { enterCourt } from "./session.js";
import { getCourt } from "../firebase/courtRepository.js";
import { stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { appState } from "../state/appState.js";
import { session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";

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
      elements.joinCourtModal.classList.add("hidden");
      syncCurrentViewState("replace");
      modalWasHiddenForJoin = true;
    }

    if (!adminEntry) session.currentCourtPassword = password;
    await enterCourt(courtId, false, {
      historyMode: "replace",
      ...(adminEntry ? { adminEntry: true } : {}),
      matchId: appState.selectedPlayMatchId,
      followRequestedMatch: Boolean(session.requestedMatchId),
    });

    appState.playPageReturnToScoreboard = false;
    appState.selectedPlayMatchId = null;
    appState.playPageTargetId = null;
    appState.playPageTargetType = null;
    passwordInput.value = "";
  } catch (error) {
    const message = error?.message || "Unable to join court. Please try again.";
    showGeneralError(message);
    if (isModal && modalWasHiddenForJoin) {
      elements.joinCourtModal.classList.remove("hidden");
      syncCurrentViewState("replace");
    }
  } finally {
    appState.isJoiningCourt = false;
  }
}

export function registerPlayAndSpectatePages()
{
  document.querySelectorAll(".menu-btn").forEach(btn =>
  {
    btn.addEventListener("click", async () =>
    {
      const action = btn.textContent.trim();

      if (action === "Play")
      {
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

        await loadCourtsWithInlineLoader(elements.playCourtList, true);
        displayPlayCourtList(appState.allCourts);
        elements.playCourtSearch.focus();
        syncCurrentViewState();
        return;
      }
      else if (action === "Spectate")
      {
        elements.menuPage.style.display = "none";
        elements.spectatePage.style.display = "flex";
        elements.spectateCourtSearch.value = "";
        elements.spectateCourtNameError.style.display = "none";
        elements.spectateCourtNameError.textContent = "";

        await loadCourtsWithInlineLoader(elements.spectateCourtList, false);
        displaySpectateCourtList(appState.allCourts);
        elements.spectateCourtSearch.focus();
        syncCurrentViewState();
        return;
      }
    });
  });

  elements.closePlayBtn.addEventListener("click", () =>
  {
    void closePlayPage();
  });

  elements.closeSpectateBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
  });

  elements.playPage.addEventListener("click", (e) =>
  {
    if (e.target === elements.playPage)
    {
      void closePlayPage();
    }
  });

  elements.spectatePage.addEventListener("click", (e) =>
  {
    if (e.target === elements.spectatePage)
    {
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
    void stepBackInApp(createViewState({
      page: NAV_PAGES.SCOREBOARD,
      courtId: session.currentCourtId,
      spectate: session.isSpectating,
    }));
  };

  elements.closeJoinCourtModalBtn?.addEventListener("click", dismissJoinCourtModal);
  elements.cancelJoinCourtModalBtn?.addEventListener("click", dismissJoinCourtModal);
  elements.joinCourtModal?.addEventListener("click", (event) => {
    if (event.target === elements.joinCourtModal) dismissJoinCourtModal();
  });
}

export function setPlayPageVisible(isVisible)
{
  elements.playPage.style.display = isVisible ? "flex" : "none";
  document.body.classList.toggle("play-page-open", isVisible);
}

export function openPlayerJoinPrompt(courtId, matchId = null)
{
  appState.playPageReturnToScoreboard = false;
  appState.selectedPlayCourt = courtId;
  appState.selectedPlayMatchId = matchId || session.currentMatchId || null;
  appState.playPageTargetId = courtId;
  appState.playPageTargetType = "court";

  const court = appState.allCourts.find((item) => item.id === courtId);
  elements.joinCourtModalTitle.textContent = "Join as a player";
  elements.joinCourtModalCourtName.textContent =
    court?.name || session.currentCourtName || courtId;
  elements.joinCourtModalPassword.value = "";
  elements.joinCourtModalPasswordError.textContent = "";
  elements.joinCourtModalError.textContent = "";
  elements.joinCourtModal.classList.remove("hidden");
  elements.joinCourtModalPassword.focus();

  syncCurrentViewState();
}

export async function closePlayPage()
{
  await stepBackInApp(createViewState({
    page: appState.playPageReturnToScoreboard && session.currentCourtId ? NAV_PAGES.SCOREBOARD : NAV_PAGES.MENU,
    courtId: session.currentCourtId,
    spectate: session.isSpectating
  }));
}
