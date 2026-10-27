// Router: turns the initial URL into a view (deep links), reacts to browser
// back / forward, opens courts from routes and maps the Escape key onto
// in-app back navigation.
import { closeClubEditor } from "../admin/clubEditor.js";
import { TOAST_TYPES } from "../config/constants.js";
import { isValidId } from "../config/idContract.js";
import {
  NAV_HISTORY_STATE_KEY,
  NAV_MODALS,
  NAV_PAGES,
} from "../config/routes.js";
import { closePlayPage } from "../court/playJoin.js";
import { enterCourt } from "../court/session.js";
import { getCourt } from "../firebase/courtRepository.js";
import { getMatch } from "../firebase/matchRepository.js";
import {
  pushNavigationState,
  replaceNavigationState,
  stepBackInApp,
} from "./history.js";
import {
  getCourtIdFromPathname,
  getDirectCourtRouteFromPathname,
  getViewStateFromLocation,
  isAdminRootPathname,
} from "./routeParsers.js";
import { getCurrentViewState, restoreViewState } from "./viewController.js";
import { createViewState } from "./viewState.js";
import { appState } from "../state/appState.js";
import { navigationState } from "../state/navigationState.js";
import { session } from "../state/sessionState.js";
import { elements } from "../ui/dom.js";
import { finishStartupLoading } from "../ui/loading.js";
import { showToast } from "../ui/toast.js";

function showInvalidDirectCourtUrlToast(pathname = window.location.pathname) {
  const route = getDirectCourtRouteFromPathname(pathname);
  if (!route) return;

  const hasValidTargetId =
    route.targetId !== null &&
    (route.targetType === "player"
      ? isValidId("court", route.targetId) || isValidId("match", route.targetId)
      : isValidId("court", route.targetId));

  if (!route.hasInvalidExtraSegments && hasValidTargetId) return;

  if (route.targetType === "player") {
    showToast(
      route.targetId
        ? `Court or match "${route.targetId}" not found.`
        : "Court or match not found.",
      TOAST_TYPES.ERROR,
    );
    return;
  }

  showToast(
    route.targetId
      ? `Court "${route.targetId}" not found.`
      : "Court not found.",
    TOAST_TYPES.ERROR,
  );
}

function showDirectCourtRouteLoadFailureToast(pathname) {
  const route = getDirectCourtRouteFromPathname(pathname);
  if (!route) return;

  const hasValidTargetId =
    route.targetId !== null &&
    (route.targetType === "player"
      ? isValidId("court", route.targetId) || isValidId("match", route.targetId)
      : isValidId("court", route.targetId));

  if (route.hasInvalidExtraSegments || !hasValidTargetId) {
    showInvalidDirectCourtUrlToast(pathname);
    return;
  }

  const targetType = route.targetType === "player" ? "court or match" : "court";
  const target = route.targetId ? ` "${route.targetId}"` : "";
  showToast(
    `Could not open ${targetType}${target}. Please try again.`,
    TOAST_TYPES.ERROR,
  );
}

export function registerEscapeKeyNavigation() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    const isVisible = (el) => window.getComputedStyle(el).display !== "none";

    if (isVisible(elements.joinCourtModal)) {
      void stepBackInApp(
        createViewState({
          page: NAV_PAGES.SCOREBOARD,
          courtId: session.currentCourtId,
          spectate: session.isSpectating,
          modal: NAV_MODALS.SETTINGS,
        }),
      );
      return;
    }

    if (appState.playPageReturnToScoreboard) {
      void closePlayPage();
      return;
    }

    if (isVisible(elements.resetModal)) {
      void stepBackInApp(
        createViewState({
          page: NAV_PAGES.SCOREBOARD,
          courtId: session.currentCourtId,
          spectate: session.isSpectating,
        }),
      );
      return;
    }

    if (isVisible(elements.settingsModal)) {
      void stepBackInApp(
        createViewState({
          page: NAV_PAGES.SCOREBOARD,
          courtId: session.currentCourtId,
          spectate: session.isSpectating,
        }),
      );
      return;
    }

    if (isVisible(elements.detailsModal)) {
      void stepBackInApp(
        createViewState({
          page: NAV_PAGES.SCOREBOARD,
          courtId: session.currentCourtId,
          spectate: session.isSpectating,
        }),
      );
      return;
    }

    if (isVisible(elements.confirmModal)) {
      elements.confirmCancelBtn.click();
      return;
    }

    if (isVisible(elements.playPage)) {
      void stepBackInApp(
        createViewState({
          page:
            appState.playPageReturnToScoreboard && session.currentCourtId
              ? NAV_PAGES.SCOREBOARD
              : NAV_PAGES.MENU,
          courtId: session.currentCourtId,
          spectate: session.isSpectating,
        }),
      );
      return;
    }

    if (isVisible(elements.spectatePage)) {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.scoreboardPage)) {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.adminAuthPage)) {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.adminDashboardPage)) {
      appState.isAdmin = false;
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
      return;
    }

    if (isVisible(elements.createPage)) {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.addDevicePage)) {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.editCourtPage)) {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.editDevicePage)) {
      void stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
      return;
    }

    if (isVisible(elements.editClubPage)) {
      void closeClubEditor();
      return;
    }
  });
}

export async function initializeAppNavigation() {
  const initialPathname = window.location.pathname;
  try {
    const routeState = getViewStateFromLocation();
    if (isAdminRootPathname()) {
      replaceNavigationState(routeState);
    } else {
      replaceNavigationState(createViewState({ page: NAV_PAGES.MENU }));
    }

    if (routeState.page === NAV_PAGES.SCOREBOARD && routeState.courtId) {
      const opened = await openCourtFromRoute("skip", routeState.courtId);
      if (opened) {
        pushNavigationState(getCurrentViewState());
        return;
      }
    } else if (routeState.page === NAV_PAGES.PLAY) {
      // /play/<target> and /p/<target> express intent to join as a player. Resolve
      // the target first; whether it is a court or a live match determines the
      // spectator scoreboard we stage underneath the password prompt.
      let resolvedRouteState = routeState;
      let opened = true;

      if (routeState.playTargetId) {
        let resolved = null;
        try {
          resolved = await resolvePlayRouteTarget(routeState.playTargetId);
        } catch (error) {
          console.warn("Could not resolve the requested court/match route:", error);
          showDirectCourtRouteLoadFailureToast(initialPathname);
        }
        if (resolved) {
          resolvedRouteState = createViewState({
            ...routeState,
            courtId: resolved.courtId,
            selectedCourtId: resolved.courtId,
            playTargetId: routeState.playTargetId,
            playTargetType: resolved.type,
            spectate: true,
            returnToScoreboard: true,
          });
          opened = await openCourtFromRoute(
            "skip",
            resolved.courtId,
            resolved.type === "match" ? resolved.matchId : null,
          );
        } else {
          opened = false;
        }
      }

      if (opened) {
        if (resolvedRouteState.courtId) {
          // Make the spectator view the entry the prompt falls back to when dismissed.
          replaceNavigationState(
            createViewState({
              page: NAV_PAGES.SCOREBOARD,
              courtId: resolvedRouteState.courtId,
              spectate: true,
            }),
          );
        }

        await restoreViewState(resolvedRouteState);
        pushNavigationState(getCurrentViewState());
        return;
      }

      await restoreViewState(createViewState({ page: NAV_PAGES.PLAY }));
      pushNavigationState(getCurrentViewState());
      return;
    } else if (
      routeState.page === NAV_PAGES.ADMIN_DASHBOARD ||
      routeState.page === NAV_PAGES.ADMIN_AUTH ||
      isAdminRootPathname()
    ) {
      await restoreViewState(routeState);
      pushNavigationState(getCurrentViewState());
      return;
    } else if (routeState.page === NAV_PAGES.SPECTATE) {
      await restoreViewState(routeState);
      pushNavigationState(getCurrentViewState());
      return;
    }

    await restoreViewState(createViewState({ page: NAV_PAGES.MENU }));
    replaceNavigationState(getCurrentViewState());
    showInvalidDirectCourtUrlToast(initialPathname);
  } catch (error) {
    console.warn("Could not initialize navigation from the requested URL:", error);
    if (getDirectCourtRouteFromPathname(initialPathname)) {
      try {
        await restoreViewState(createViewState({ page: NAV_PAGES.MENU }));
        replaceNavigationState(getCurrentViewState());
      } catch (restoreError) {
        console.warn("Could not recover to the menu after a route failure:", restoreError);
      }
      showDirectCourtRouteLoadFailureToast(initialPathname);
    }
  } finally {
    finishStartupLoading();
  }
}

export function registerHistoryNavigation() {
  window.addEventListener("popstate", async (event) => {
    let nextState = event.state?.[NAV_HISTORY_STATE_KEY]
      ? event.state.viewState
      : getViewStateFromLocation();

    if (
      nextState.modal &&
      event.state?.courtSessionId !==
        navigationState.currentCourtHistorySessionId
    ) {
      window.history.back();
      return;
    }

    if (typeof event.state?.index === "number") {
      navigationState.appNavigationIndex = event.state.index;
    } else if (navigationState.appNavigationIndex > 0) {
      navigationState.appNavigationIndex -= 1;
    }

    if (
      nextState.page === NAV_PAGES.PLAY &&
      nextState.playTargetType === "unknown" &&
      nextState.playTargetId
    ) {
      try {
        const resolved = await resolvePlayRouteTarget(nextState.playTargetId);
        nextState = resolved
          ? createViewState({
              ...nextState,
              courtId: resolved.courtId,
              selectedCourtId: resolved.courtId,
              playTargetType: resolved.type,
              spectate: true,
              returnToScoreboard: true,
            })
          : createViewState({ page: NAV_PAGES.PLAY });
      } catch (error) {
        console.warn("Could not resolve the requested court/match route:", error);
        showDirectCourtRouteLoadFailureToast(window.location.pathname);
        nextState = createViewState({ page: NAV_PAGES.PLAY });
      }
    }

    try {
      await restoreViewState(nextState);
    } catch (error) {
      const pathname = window.location.pathname;
      console.warn("Could not restore the requested route:", error);
      if (!getDirectCourtRouteFromPathname(pathname)) throw error;

      try {
        await restoreViewState(createViewState({ page: NAV_PAGES.MENU }));
        replaceNavigationState(getCurrentViewState());
      } catch (restoreError) {
        console.warn("Could not recover to the menu after a route failure:", restoreError);
      }
      showDirectCourtRouteLoadFailureToast(pathname);
      return;
    }

    showInvalidDirectCourtUrlToast();
  });
}

async function openCourtFromRoute(
  historyMode = "replace",
  courtId = null,
  matchId = null,
) {
  const resolvedCourtId = courtId !== null ? courtId : getCourtIdFromPathname();
  if (!isValidId("court", resolvedCourtId)) {
    showToast("Court not found.", TOAST_TYPES.ERROR);
    return false;
  }
  if (matchId !== null && !isValidId("match", matchId)) return false;

  let courtSnap;
  try {
    courtSnap = await getCourt(resolvedCourtId);
  } catch (error) {
    console.warn("Could not look up the requested court:", error);
    showToast(
      `Could not open court "${resolvedCourtId}". Please try again.`,
      TOAST_TYPES.ERROR,
    );
    return false;
  }
  if (!courtSnap.exists()) {
    showToast(`Court "${resolvedCourtId}" not found.`, TOAST_TYPES.ERROR);
    return false;
  }

  elements.menuPage.style.display = "none";
  elements.spectatePage.style.display = "none";

  try {
    await enterCourt(resolvedCourtId, true, {
      historyMode,
      matchId,
      followRequestedMatch: Boolean(matchId),
    });
  } catch (error) {
    console.warn("Could not open the requested court/match:", error);
    showToast(
      error?.message || "Could not open the requested match.",
      TOAST_TYPES.ERROR,
    );
    return false;
  }

  if (!session.currentCourtId) {
    elements.menuPage.style.display = "flex";
    showToast(`Court "${resolvedCourtId}" not found.`, TOAST_TYPES.ERROR);
    return false;
  }

  return session.currentCourtId !== null;
}

async function resolvePlayRouteTarget(targetId) {
  if (isValidId("court", targetId)) {
    const courtSnap = await getCourt(targetId);
    if (courtSnap.exists()) {
      const court = courtSnap.data();
      return {
        type: "court",
        courtId: targetId,
        matchId: court.activeMatchId || court.lastMatchId || null,
      };
    }
    showToast(`Court "${targetId}" not found.`, TOAST_TYPES.ERROR);
    return null;
  }

  if (!isValidId("match", targetId)) {
    showToast("Court or match not found.", TOAST_TYPES.ERROR);
    return null;
  }

  const matchSnap = await getMatch(targetId);
  if (!matchSnap.exists()) {
    showToast(`Court or match "${targetId}" not found.`, TOAST_TYPES.ERROR);
    return null;
  }

  const match = matchSnap.data() || {};
  if (match.status !== "live" || !isValidId("court", match.currentCourtId)) {
    showToast(
      "This match is not currently being played on a court.",
      TOAST_TYPES.ERROR,
    );
    return null;
  }

  const matchCourtSnap = await getCourt(match.currentCourtId);
  if (!matchCourtSnap.exists()) {
    showToast(
      "The court for this match could not be found.",
      TOAST_TYPES.ERROR,
    );
    return null;
  }

  return {
    type: "match",
    courtId: match.currentCourtId,
    matchId: targetId,
  };
}
