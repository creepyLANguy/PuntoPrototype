// View-state model: normalisation, construction and comparison of the view states
// stored in browser history. Pure functions.
import { NAV_MODALS, NAV_PAGES } from "../config/routes.js";
import { isValidId } from "../config/idContract.js";

function normalizeId(type, value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : null;
  return isValidId(type, id) ? id : null;
}

export function normalizeViewState(viewState = {}) {
  const page =
    typeof viewState.page === "string" ? viewState.page : NAV_PAGES.MENU;
  const normalized = {
    page,
    courtId: normalizeId("court", viewState.courtId),
    selectedCourtId: normalizeId("court", viewState.selectedCourtId),
    spectate: Boolean(viewState.spectate),
    modal: typeof viewState.modal === "string" ? viewState.modal : null,
    returnToScoreboard: Boolean(viewState.returnToScoreboard),
    playTargetId:
      typeof viewState.playTargetId === "string"
        ? viewState.playTargetId
        : null,
    playTargetType: ["court", "match", "unknown"].includes(
      viewState.playTargetType,
    )
      ? viewState.playTargetType
      : null,
    entityId:
      typeof viewState.entityId === "string" ? viewState.entityId : null,
  };

  normalized.playTargetId =
    normalized.playTargetType === "unknown"
      ? normalizeId("court", normalized.playTargetId) ||
        normalizeId("match", normalized.playTargetId)
      : normalizeId(normalized.playTargetType, normalized.playTargetId);
  if (!normalized.playTargetId) normalized.playTargetType = null;
  if (page === NAV_PAGES.EDIT_CLUB)
    normalized.entityId = normalizeId("club", normalized.entityId);
  if (page === NAV_PAGES.EDIT_COURT)
    normalized.entityId = normalizeId("court", normalized.entityId);

  if (normalized.page !== NAV_PAGES.SCOREBOARD) {
    normalized.modal = null;
  }

  if (
    normalized.page !== NAV_PAGES.SCOREBOARD &&
    !(normalized.page === NAV_PAGES.PLAY && normalized.returnToScoreboard)
  ) {
    normalized.courtId = null;
    normalized.spectate = false;
  }

  const keepsPlayTarget =
    (normalized.page === NAV_PAGES.PLAY && normalized.returnToScoreboard) ||
    (normalized.page === NAV_PAGES.SCOREBOARD && normalized.modal === NAV_MODALS.JOIN_COURT);
  if (!keepsPlayTarget) {
    normalized.playTargetId = null;
    normalized.playTargetType = null;
  }

  return normalized;
}

export function createViewState(overrides = {}) {
  return normalizeViewState({ page: NAV_PAGES.MENU, ...overrides });
}

export function isAdminProtectedPage(page) {
  return [
    NAV_PAGES.ADMIN_DASHBOARD,
    NAV_PAGES.CREATE_COURT,
    NAV_PAGES.EDIT_COURT,
    NAV_PAGES.ADD_DEVICE,
    NAV_PAGES.EDIT_DEVICE,
    NAV_PAGES.CREATE_CLUB,
    NAV_PAGES.EDIT_CLUB,
  ].includes(page);
}

export function viewStatesEqual(left, right) {
  const a = normalizeViewState(left);
  const b = normalizeViewState(right);

  return (
    a.page === b.page &&
    a.courtId === b.courtId &&
    a.selectedCourtId === b.selectedCourtId &&
    a.spectate === b.spectate &&
    a.modal === b.modal &&
    a.returnToScoreboard === b.returnToScoreboard &&
    a.playTargetId === b.playTargetId &&
    a.playTargetType === b.playTargetType &&
    a.entityId === b.entityId
  );
}
