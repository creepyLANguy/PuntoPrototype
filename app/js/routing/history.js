// Browser history ownership: pushState / replaceState / back, the app's own
// navigation stack (state/navigationState.js) and history-change notification.
//
// Features record navigation through syncCurrentViewState() and stepBackInApp().
// Both need the view controller, which itself depends on the features, so the
// composition root binds it here (bindViewController) instead of this module
// importing it. That keeps the dependency graph acyclic.
import { NAV_HISTORY_STATE_KEY, NAV_PAGES } from "../config/routes.js";
import { buildUrlForViewState } from "./routeParsers.js";
import { createViewState, normalizeViewState, viewStatesEqual } from "./viewState.js";
import { navigationState } from "../state/navigationState.js";

const viewController = {
  getCurrentViewState: null,
  restoreViewState: null,
};

export function bindViewController({ getCurrentViewState, restoreViewState })
{
  viewController.getCurrentViewState = getCurrentViewState;
  viewController.restoreViewState = restoreViewState;
}

function getCurrentViewState()
{
  return viewController.getCurrentViewState();
}

function restoreViewState(viewState)
{
  return viewController.restoreViewState(viewState);
}

function buildHistoryPayload(viewState, index)
{
  return {
    [NAV_HISTORY_STATE_KEY]: true,
    index,
    viewState: normalizeViewState(viewState),
    courtSessionId: navigationState.currentCourtHistorySessionId
  };
}

export function replaceNavigationState(viewState)
{
  const normalized = normalizeViewState(viewState);

  if (navigationState.appNavigationIndex === -1)
  {
    navigationState.appNavigationStack = [normalized];
    navigationState.appNavigationIndex = 0;
  }
  else
  {
    if (viewStatesEqual(navigationState.appNavigationStack[navigationState.appNavigationIndex], normalized))
    {
      return;
    }

    navigationState.appNavigationStack[navigationState.appNavigationIndex] = normalized;
  }

  window.history.replaceState(
    buildHistoryPayload(normalized, navigationState.appNavigationIndex),
    "",
    buildUrlForViewState(normalized)
  );
}

export function pushNavigationState(viewState)
{
  const normalized = normalizeViewState(viewState);

  if (navigationState.appNavigationIndex >= 0 && viewStatesEqual(navigationState.appNavigationStack[navigationState.appNavigationIndex], normalized))
  {
    return;
  }

  if (navigationState.appNavigationIndex < navigationState.appNavigationStack.length - 1)
  {
    navigationState.appNavigationStack = navigationState.appNavigationStack.slice(0, navigationState.appNavigationIndex + 1);
  }

  navigationState.appNavigationStack.push(normalized);
  navigationState.appNavigationIndex = navigationState.appNavigationStack.length - 1;

  window.history.pushState(
    buildHistoryPayload(normalized, navigationState.appNavigationIndex),
    "",
    buildUrlForViewState(normalized)
  );
}

export function syncCurrentViewState(mode = "push")
{
  if (navigationState.isRestoringNavigation) return;

  let f = mode === "replace" ? replaceNavigationState : pushNavigationState;
  f(getCurrentViewState());
}

export async function stepBackInApp(fallbackViewState = createViewState({ page: NAV_PAGES.MENU }))
{
  if (navigationState.appNavigationIndex > 0)
  {
    window.history.back();
    return;
  }

  await restoreViewState(fallbackViewState);
  replaceNavigationState(fallbackViewState);
}

// Invokes `listener` after every history change: popstate, and every
// pushState / replaceState made by any code on the page.
export function observeHistoryChanges(listener)
{
  window.addEventListener("popstate", listener);

  for (const method of ["pushState", "replaceState"])
  {
    const original = window.history[method];
    window.history[method] = function (...args)
    {
      const result = original.apply(this, args);
      listener();
      return result;
    };
  }
}

// The court of the current history entry, if any.
export function getCourtIdFromHistoryState()
{
  return window.history.state?.viewState?.courtId || window.history.state?.courtId || null;
}
