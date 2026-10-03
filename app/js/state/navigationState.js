// Navigation state: the app's own mirror of the browser history stack and the
// court-session counter that lets history entries for modals expire when the
// court they belong to is left. Owned by routing/history.js.
export const navigationState = {
  appNavigationStack: [],
  appNavigationIndex: -1,
  isRestoringNavigation: false,
  currentCourtHistorySessionId: 0,
};

export function bumpCourtHistorySessionId()
{
  navigationState.currentCourtHistorySessionId += 1;
}
