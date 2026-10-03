// View-state model: normalisation, construction and comparison of the view states
// stored in browser history. Pure functions.
import { NAV_PAGES } from "../config/routes.js";
import { normalizeCourtId } from "../utils/formatting.js";

export function normalizeViewState(viewState = {})
{
  const page = typeof viewState.page === "string" ? viewState.page : NAV_PAGES.MENU;
  const normalized = {
    page,
    courtId: normalizeCourtId(viewState.courtId),
    selectedCourtId: normalizeCourtId(viewState.selectedCourtId),
    spectate: Boolean(viewState.spectate),
    modal: typeof viewState.modal === "string" ? viewState.modal : null,
    returnToScoreboard: Boolean(viewState.returnToScoreboard),
    entityId: typeof viewState.entityId === "string" ? viewState.entityId : null
  };

  if (normalized.page !== NAV_PAGES.SCOREBOARD)
  {
    normalized.modal = null;
  }

  if (normalized.page !== NAV_PAGES.SCOREBOARD && !(normalized.page === NAV_PAGES.PLAY && normalized.returnToScoreboard))
  {
    normalized.courtId = null;
    normalized.spectate = false;
  }

  return normalized;
}

export function createViewState(overrides = {})
{
  return normalizeViewState({ page: NAV_PAGES.MENU, ...overrides });
}

export function isAdminProtectedPage(page)
{
  return [
    NAV_PAGES.ADMIN_DASHBOARD,
    NAV_PAGES.CREATE_COURT,
    NAV_PAGES.EDIT_COURT,
    NAV_PAGES.ADD_DEVICE,
    NAV_PAGES.EDIT_DEVICE
  ].includes(page);
}

export function viewStatesEqual(left, right)
{
  const a = normalizeViewState(left);
  const b = normalizeViewState(right);

  return a.page === b.page &&
    a.courtId === b.courtId &&
    a.selectedCourtId === b.selectedCourtId &&
    a.spectate === b.spectate &&
    a.modal === b.modal &&
    a.returnToScoreboard === b.returnToScoreboard &&
    a.entityId === b.entityId;
}
