// Router: turns the initial URL into a view (deep links), reacts to browser
// back / forward, opens courts from routes and maps the Escape key onto
// in-app back navigation.
import { TOAST_TYPES } from "../config/constants.js";
import { NAV_HISTORY_STATE_KEY, NAV_PAGES } from "../config/routes.js";
import { closePlayPage } from "../court/playJoin.js";
import { enterCourt } from "../court/session.js";
import { getCourt } from "../firebase/courtRepository.js";
import { pushNavigationState, replaceNavigationState, stepBackInApp } from "./history.js";
import { getCourtIdFromPathname, getViewStateFromLocation, isAdminRootPathname } from "./routeParsers.js";
import { getCurrentViewState, restoreViewState } from "./viewController.js";
import { createViewState } from "./viewState.js";
import { appState } from "../state/appState.js";
import { navigationState } from "../state/navigationState.js";
import { session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";
import { finishStartupLoading } from "../ui/loading.js";
import { showToast } from "../ui/toast.js";

export function registerEscapeKeyNavigation()
{
  document.addEventListener("keydown", (e) =>
  {
    if (e.key !== "Escape") return;

    const isVisible = (el) =>
      window.getComputedStyle(el).display !== "none";

    if (appState.playPageReturnToScoreboard)
    {
      void closePlayPage();
      return;
    }

    if (isVisible(elements.resetModal))
    {
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: session.currentCourtId,
        spectate: session.isSpectating
      }));
      return;
    }

    if (isVisible(elements.settingsModal))
    {
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: session.currentCourtId,
        spectate: session.isSpectating
      }));
      return;
    }

    if (isVisible(elements.detailsModal))
    {
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: session.currentCourtId,
        spectate: session.isSpectating
      }));
      return;
    }

    if (isVisible(elements.confirmModal))
    {
      elements.confirmCancelBtn.click();
      return;
    }

    if (isVisible(elements.playPage))
    {
      void stepBackInApp(createViewState({
        page: appState.playPageReturnToScoreboard && session.currentCourtId ? NAV_PAGES.SCOREBOARD : NAV_PAGES.MENU,
        courtId: session.currentCourtId,
        spectate: session.isSpectating
      }));
      return;
    }

    if (isVisible(elements.spectatePage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.scoreboardPage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.adminAuthPage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.adminDashboardPage))
    {
      appState.isAdmin = false;
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.createPage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.addDevicePage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.editCourtPage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.editDevicePage))
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }
  });
}

export async function initializeAppNavigation()
{
  try
  {
    const routeState = getViewStateFromLocation();
    if (isAdminRootPathname())
    {
      replaceNavigationState(routeState);
    }
    else
    {
      replaceNavigationState(createViewState({ page: NAV_PAGES.MENU }));
    }

    if (routeState.page === NAV_PAGES.SCOREBOARD && routeState.courtId)
    {
      const opened = await openCourtFromRoute("skip", routeState.courtId);
      if (opened)
      {
        pushNavigationState(getCurrentViewState());
        return;
      }
    }
    else if (routeState.page === NAV_PAGES.PLAY)
    {
      // /play/<court> (and /p/<court>) drop straight into the join prompt on top of the
      // court's spectator view, so dismissing the prompt leaves the viewer spectating.
      const opened = routeState.courtId
        ? await openCourtFromRoute("skip", routeState.courtId)
        : true;

      if (opened)
      {
        if (routeState.courtId)
        {
          // Make the spectator view the entry the prompt falls back to when dismissed.
          replaceNavigationState(createViewState({
            page: NAV_PAGES.SCOREBOARD,
            courtId: routeState.courtId,
            spectate: true
          }));
        }

        await restoreViewState(routeState);
        pushNavigationState(getCurrentViewState());
        return;
      }
    }
    else if (
      routeState.page === NAV_PAGES.ADMIN_DASHBOARD ||
      routeState.page === NAV_PAGES.ADMIN_AUTH ||
      isAdminRootPathname()
    )
    {
      await restoreViewState(routeState);
      pushNavigationState(getCurrentViewState());
      return;
    }
    else if (routeState.page === NAV_PAGES.SPECTATE)
    {
      await restoreViewState(routeState);
      pushNavigationState(getCurrentViewState());
      return;
    }

    await restoreViewState(createViewState({ page: NAV_PAGES.MENU }));
    replaceNavigationState(getCurrentViewState());
  }
  finally
  {
    finishStartupLoading();
  }
}

export function registerHistoryNavigation()
{
  window.addEventListener("popstate", (event) =>
  {
    const nextState = event.state?.[NAV_HISTORY_STATE_KEY]
      ? event.state.viewState
      : getViewStateFromLocation();

    if (nextState.modal && event.state?.courtSessionId !== navigationState.currentCourtHistorySessionId)
    {
      window.history.back();
      return;
    }

    if (typeof event.state?.index === "number")
    {
      navigationState.appNavigationIndex = event.state.index;
    }
    else if (navigationState.appNavigationIndex > 0)
    {
      navigationState.appNavigationIndex -= 1;
    }

    void restoreViewState(nextState);
  });
}

async function openCourtFromRoute(historyMode = "replace", courtId = null)
{
  const resolvedCourtId = courtId !== null ? courtId : getCourtIdFromPathname();
  if (!resolvedCourtId) return false;

  const courtSnap = await getCourt(resolvedCourtId);
  if (!courtSnap.exists())
  {
    showToast(`Court "${resolvedCourtId}" not found.`, TOAST_TYPES.ERROR);
    return false;
  }

  elements.menuPage.style.display = "none";
  elements.spectatePage.style.display = "none";

  await enterCourt(resolvedCourtId, true, { historyMode });
  if (!session.currentCourtId)
  {
    elements.menuPage.style.display = "flex";
    showToast(`Court "${resolvedCourtId}" not found.`, TOAST_TYPES.ERROR);
    return false;
  }

  return session.currentCourtId !== null;
}
