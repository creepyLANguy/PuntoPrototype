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

  elements.enterCourtBtn.addEventListener("click", async () =>
  {
    if (appState.isJoiningCourt) return;
    appState.isJoiningCourt = true;

    // Direct /p joins do their Firestore work before enterCourt() reaches the
    // join sound. Start/resume audio from the actual player gesture first so
    // the later sound playback is not blocked by autoplay policy.
    primeAudioForUserGesture();

    try
    {
      const courtId = appState.selectedPlayCourt;
      const password = elements.playCourtPassword.value.trim();

      elements.playCourtNameError.style.display = "none";
      elements.playCourtNameError.textContent = "";
      elements.playCourtPasswordError.textContent = "";

      if (!courtId)
      {
        elements.playCourtNameError.style.display = "block";
        elements.playCourtNameError.textContent = "Court not selected.";
        return;
      }

      if (!password)
      {
        elements.playCourtPasswordError.textContent = "Password required.";
        return;
      }

      const snap = await getCourt(courtId);

      if (!snap.exists())
      {
        elements.playCourtNameError.style.display = "block";
        elements.playCourtNameError.textContent = "Court not found.";
        return;
      }

      var adminPassword = await getSkeleton();
      if (password === adminPassword)
      {
        await enterCourt(courtId, false, { historyMode: "replace", adminEntry: true });
        return;
      }

      if (snap.data().password !== password)
      {
        elements.playCourtPasswordError.textContent = "Incorrect password.";
        return;
      }

      session.currentCourtPassword = password;
      await enterCourt(courtId, false, { historyMode: "replace" });
      appState.playPageReturnToScoreboard = false;

      elements.playCourtPassword.value = "";
    }
    finally
    {
      appState.isJoiningCourt = false;
    }
  });
}

export function setPlayPageVisible(isVisible)
{
  elements.playPage.style.display = isVisible ? "flex" : "none";
  document.body.classList.toggle("play-page-open", isVisible);
}

export async function openPlayerJoinPrompt(courtId)
{
  appState.playPageReturnToScoreboard = true;
  appState.selectedPlayCourt = courtId;

  if (appState.allCourts.length === 0)
  {
    await loadCourtsWithInlineLoader(elements.playCourtList, true);
  }

  displayPlayCourtList(appState.allCourts);

  const court = appState.allCourts.find((item) => item.id === courtId);
  setPlayPageVisible(true);
  elements.playPasswordSection.style.display = "block";
  elements.playCourtSearch.value = court?.name || session.currentCourtName || courtId;
  elements.courtNameError.style.display = "none";
  elements.playCourtNameError.textContent = "";
  elements.playCourtPasswordError.textContent = "";
  elements.playCourtPassword.value = "";

  const selectedItem = elements.playCourtList.querySelector(`[data-court-id="${courtId}"]`);
  if (selectedItem)
  {
    elements.playCourtList.querySelectorAll(".court-item").forEach(el => el.classList.remove("active"));
    selectedItem.classList.add("active");
  }

  elements.playCourtPassword.focus();
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
