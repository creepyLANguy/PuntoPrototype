// View controller: derives the current view state from the visible DOM and
// restores a requested view state onto the DOM (pages, modals, court session).
import { displayAdminCourtList, openEditModal } from "../admin/courts.js";
import { loadDevices, openEditDeviceModal } from "../admin/devices.js";
import { NAV_MODALS, NAV_PAGES } from "../config/routes.js";
import { displayPlayCourtList, displaySpectateCourtList, loadCourtsWithInlineLoader } from "../court/courtLists.js";
import { setPlayPageVisible } from "../court/playJoin.js";
import { enterCourt, leaveCourt } from "../court/session.js";
import { showMatchDetails } from "../details/matchDetails.js";
import { getCourt } from "../firebase/courtRepository.js";
import { getDevice } from "../firebase/deviceRepository.js";
import { createViewState, isAdminProtectedPage, normalizeViewState } from "./viewState.js";
import { syncScoringControls } from "../scoring/settings.js";
import { appState } from "../state/appState.js";
import { navigationState } from "../state/navigationState.js";
import { session } from "../state/sessionState.js";
import { closeAppearanceMenu } from "../ui/appearance.js";
import { elements } from "../ui/dom.js";
import { updateFullscreenButton } from "../ui/fullscreen.js";
import { closeManagedModals } from "../ui/modals.js";
import { syncSettingsTiles } from "../ui/settingsTiles.js";
import { isElementVisible, isOverlayVisible } from "../utils/domHelpers.js";
import { normalizeCourtId } from "../utils/formatting.js";

export function isAdminProtectedViewVisible()
{
  return isElementVisible(elements.adminDashboardPage) ||
    isElementVisible(elements.createPage) ||
    isElementVisible(elements.editCourtPage) ||
    isElementVisible(elements.addDevicePage) ||
    isElementVisible(elements.editDevicePage);
}

export function getCurrentViewState()
{
  if (session.currentCourtId)
  {
    const modalMap = [
      [elements.resetModal, NAV_MODALS.RESET],
      [elements.detailsModal, NAV_MODALS.DETAILS],
      [elements.settingsModal, NAV_MODALS.SETTINGS],
      [elements.confirmModal, NAV_MODALS.CONFIRM],
      [elements.playerNamesModal, NAV_MODALS.PLAYER_NAMES]
    ];

    for (const [element, modal] of modalMap)
    {
      if (isOverlayVisible(element))
      {
        return createViewState({
          page: NAV_PAGES.SCOREBOARD,
          courtId: session.currentCourtId,
          spectate: session.isSpectating,
          modal
        });
      }
    }
  }

  if (isElementVisible(elements.editDevicePage))
  {
    return createViewState({
      page: NAV_PAGES.EDIT_DEVICE,
      entityId: appState.currentDeviceToEdit?.id || null
    });
  }

  if (isElementVisible(elements.addDevicePage))
  {
    return createViewState({ page: NAV_PAGES.ADD_DEVICE });
  }

  if (isElementVisible(elements.editCourtPage))
  {
    return createViewState({
      page: NAV_PAGES.EDIT_COURT,
      entityId: appState.courtToEdit?.id || null
    });
  }

  if (isElementVisible(elements.createPage))
  {
    return createViewState({ page: NAV_PAGES.CREATE_COURT });
  }

  if (isElementVisible(elements.adminDashboardPage))
  {
    return createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD });
  }

  if (isElementVisible(elements.adminAuthPage))
  {
    return createViewState({ page: NAV_PAGES.ADMIN_AUTH });
  }

  if (session.currentCourtId && isElementVisible(elements.playPage) && appState.playPageReturnToScoreboard)
  {
    return createViewState({
      page: NAV_PAGES.PLAY,
      courtId: session.currentCourtId,
      selectedCourtId: appState.selectedPlayCourt || session.currentCourtId,
      returnToScoreboard: true
    });
  }

  if (session.currentCourtId && isElementVisible(elements.scoreboardPage))
  {
    return createViewState({
      page: NAV_PAGES.SCOREBOARD,
      courtId: session.currentCourtId,
      spectate: session.isSpectating
    });
  }

  if (isElementVisible(elements.spectatePage))
  {
    return createViewState({ page: NAV_PAGES.SPECTATE });
  }

  if (isElementVisible(elements.playPage))
  {
    return createViewState({
      page: NAV_PAGES.PLAY,
      selectedCourtId: appState.selectedPlayCourt
    });
  }

  return createViewState({ page: NAV_PAGES.MENU });
}

function hideManagedPages()
{
  elements.menuPage.style.display = "none";
  elements.createPage.style.display = "none";
  setPlayPageVisible(false);
  elements.spectatePage.style.display = "none";
  elements.adminAuthPage.style.display = "none";
  elements.adminDashboardPage.style.display = "none";
  elements.editCourtPage.style.display = "none";
  elements.addDevicePage.style.display = "none";
  elements.editDevicePage.style.display = "none";
  elements.scoreboardPage.style.display = "none";
}

function syncPlaySelection(courtId)
{
  appState.selectedPlayCourt = normalizeCourtId(courtId);

  elements.playCourtList.querySelectorAll(".court-item").forEach(item =>
  {
    item.classList.toggle("active", item.dataset.courtId === appState.selectedPlayCourt);
  });

  elements.playPasswordSection.style.display = appState.selectedPlayCourt ? "block" : "none";
}

function showCurrentScoreboardView()
{
  elements.menuPage.style.display = "none";
  elements.createPage.style.display = "none";
  setPlayPageVisible(false);
  elements.spectatePage.style.display = "none";
  elements.adminAuthPage.style.display = "none";
  elements.adminDashboardPage.style.display = "none";
  elements.editCourtPage.style.display = "none";
  elements.addDevicePage.style.display = "none";
  elements.editDevicePage.style.display = "none";

  if (elements.appearanceMenuBtn)
  {
    closeAppearanceMenu();
    elements.appearanceMenuBtn.style.display = "none";
  }

  if (elements.adminLoginBtn)
  {
    elements.adminLoginBtn.style.display = "none";
  }

  if (elements.activateNfcBtn)
  {
    elements.activateNfcBtn.classList.add("hidden");
  }

  elements.scoreboardPage.style.display = "flex";
  document.body.classList.add("scoreboard-active");
}

export async function restoreViewState(viewState)
{
  const state = normalizeViewState(viewState);
  const wasOnAdminProtectedView = isAdminProtectedViewVisible();
  const navigatingToAdminProtectedView = isAdminProtectedPage(state.page);

  if (wasOnAdminProtectedView && !navigatingToAdminProtectedView)
  {
    appState.isAdmin = false;
  }

  if (navigatingToAdminProtectedView && !appState.isAdmin)
  {
    state.page = NAV_PAGES.ADMIN_AUTH;
    state.entityId = null;
  }

  navigationState.isRestoringNavigation = true;

  try
  {
    closeManagedModals();

    const shouldKeepCurrentCourt = (
      state.page === NAV_PAGES.SCOREBOARD &&
      state.courtId === session.currentCourtId &&
      state.spectate === session.isSpectating
    ) || (
      state.page === NAV_PAGES.PLAY &&
      state.returnToScoreboard &&
      state.courtId === session.currentCourtId
    );

    if (session.currentCourtId && !shouldKeepCurrentCourt)
    {
      leaveCourt("skip");
    }

    hideManagedPages();

    if (state.page === NAV_PAGES.SCOREBOARD)
    {
      if (!state.courtId)
      {
        elements.menuPage.style.display = "flex";
        return;
      }

      if (session.currentCourtId !== state.courtId)
      {
        if (state.spectate)
        {
          await enterCourt(state.courtId, true, { historyMode: "skip" });
        }
        else 
        {
          await restoreViewState(createViewState({ page: NAV_PAGES.PLAY }));
          return;
        }
      }
      else 
      {
        showCurrentScoreboardView();
      }              

      if (state.modal === NAV_MODALS.SETTINGS)
      {
        updateFullscreenButton();
        syncScoringControls();
        elements.settingsModal.classList.remove("hidden");
        syncSettingsTiles();
      }
      else if (state.modal === NAV_MODALS.DETAILS)
      {
        await showMatchDetails(false);
      }      

      return;
    }

    if (state.page === NAV_PAGES.PLAY)
    {
      appState.playPageReturnToScoreboard = state.returnToScoreboard;

      if (state.returnToScoreboard && session.currentCourtId === state.courtId)
      {
        showCurrentScoreboardView();
      }

      setPlayPageVisible(true);
      elements.playCourtSearch.value = "";
      elements.playCourtPassword.value = "";
      elements.playCourtNameError.style.display = "none";
      elements.playCourtNameError.textContent = "";
      elements.playCourtPasswordError.textContent = "";
      await loadCourtsWithInlineLoader(elements.playCourtList, true);
      displayPlayCourtList(appState.allCourts);
      syncPlaySelection(state.selectedCourtId || state.courtId);
      if (appState.selectedPlayCourt)
      {
        const selectedCourt = appState.allCourts.find((court) => court.id === appState.selectedPlayCourt);
        elements.playCourtSearch.value = selectedCourt?.name || appState.selectedPlayCourt;
        elements.playCourtPassword.focus();
      }
      return;
    }

    appState.playPageReturnToScoreboard = false;

    if (state.page === NAV_PAGES.SPECTATE)
    {
      elements.spectatePage.style.display = "flex";
      elements.spectateCourtSearch.value = "";
      elements.spectateCourtNameError.style.display = "none";
      elements.spectateCourtNameError.textContent = "";
      await loadCourtsWithInlineLoader(elements.spectateCourtList, false);
      displaySpectateCourtList(appState.allCourts);
      return;
    }

    if (state.page === NAV_PAGES.ADMIN_AUTH)
    {
      elements.adminAuthPage.style.display = "flex";
      elements.adminAuthPassword.value = "";
      elements.adminAuthError.textContent = "";
      return;
    }

    if (state.page === NAV_PAGES.ADMIN_DASHBOARD)
    {
      elements.adminDashboardPage.style.display = "flex";
      void displayAdminCourtList();
      return;
    }

    if (state.page === NAV_PAGES.CREATE_COURT)
    {
      elements.createPage.style.display = "flex";
      return;
    }

    if (state.page === NAV_PAGES.EDIT_COURT)
    {
      if (appState.courtToEdit?.id === state.entityId)
      {
        elements.editCourtPage.style.display = "flex";
        return;
      }

      if (state.entityId)
      {
        const snap = await getCourt(state.entityId);
        if (snap.exists())
        {
          openEditModal({ id: snap.id, ...snap.data() }, false);
          return;
        }
      }

      elements.adminDashboardPage.style.display = "flex";
      void displayAdminCourtList();
      return;
    }

    if (state.page === NAV_PAGES.ADD_DEVICE)
    {
      elements.addDevicePage.style.display = "flex";
      return;
    }

    if (state.page === NAV_PAGES.EDIT_DEVICE)
    {
      if (appState.currentDeviceToEdit?.id === state.entityId)
      {
        elements.editDevicePage.style.display = "flex";
        return;
      }

      if (state.entityId)
      {
        const snap = await getDevice(state.entityId);
        if (snap.exists())
        {
          await openEditDeviceModal({ id: snap.id, ...snap.data() }, false);
          return;
        }
      }

      elements.adminDashboardPage.style.display = "flex";
      void loadDevices();
      return;
    }

    elements.menuPage.style.display = "flex";
  }
  finally
  {
    navigationState.isRestoringNavigation = false;
  }
}
