// URL <-> route mapping: parsing court ids and page roots from the pathname and
// building the URL for a view state. Behaviour for every supported path:
//   /c, /court            spectate court list
//   /c/{id}, /court/{id}  spectate that court
//   /p, /play             play court list
//   /p/{id}, /play/{id}   join modal over that court's spectator scoreboard
//   /admin, /app/admin    admin portal (via admin auth)
// The same paths are accepted under the /app prefix.
//
// Every function reads the current location by default; passing a pathname
// makes them pure (see functions/frontendRouteParsers.node-test.mjs).
import { NAV_MODALS, NAV_PAGES } from "../config/routes.js";
import { isValidId } from "../config/idContract.js";
import {
  createViewState,
  isAdminProtectedPage,
  normalizeViewState,
} from "./viewState.js";

function getAppBasePath(pathname = window.location.pathname) {
  return pathname === "/app" || pathname.startsWith("/app/") ? "/app" : "";
}

export function isAdminRootPathname(
  currentPathname = window.location.pathname,
) {
  const pathname = currentPathname.replace(/\/+$/, "") || "/";
  return pathname === "/admin" || pathname === "/app/admin";
}

export function buildUrlForViewState(
  viewState,
  pathname = window.location.pathname,
) {
  const state = normalizeViewState(viewState);
  const basePath = getAppBasePath(pathname);

  if (isAdminProtectedPage(state.page)) {
    return "/admin";
  }

  if (
    state.page === NAV_PAGES.SCOREBOARD &&
    state.courtId &&
    state.modal === NAV_MODALS.JOIN_COURT
  ) {
    const targetId = state.playTargetId || state.courtId;
    return `${basePath}/p/${encodeURIComponent(targetId)}`;
  }

  if (state.page === NAV_PAGES.SCOREBOARD && state.courtId) {
    return `${basePath}/c/${encodeURIComponent(state.courtId)}`;
  }

  if (state.page === NAV_PAGES.PLAY && state.returnToScoreboard) {
    const targetId = state.playTargetId || state.courtId;
    if (targetId) {
      return `${basePath}/p/${encodeURIComponent(targetId)}`;
    }
  }

  if (state.page === NAV_PAGES.PLAY) {
    return `${basePath}/p`;
  }

  if (state.page === NAV_PAGES.SPECTATE) {
    return `${basePath}/c`;
  }

  return basePath ? `${basePath}/` : "/";
}

function matchIdInPathname(
  pattern,
  types,
  pathname = window.location.pathname,
) {
  const match = pathname.match(pattern);
  if (!match) return null;

  try {
    const id = decodeURIComponent(match[1]).trim().toLowerCase();
    return types.some((type) => isValidId(type, id)) ? id : null;
  } catch {
    return null;
  }
}

export function getCourtIdFromPathname(pathname = window.location.pathname) {
  return matchIdInPathname(
    /^\/(?:app\/)?(?:court|c)\/([^/]+)\/?$/i,
    ["court"],
    pathname,
  );
}

export function getMatchIdFromPathname(pathname = window.location.pathname) {
  return matchIdInPathname(/^\/(?:app\/)?m\/([^/]+)\/*$/i, ["match"], pathname);
}

export function getTournamentIdFromPathname(
  pathname = window.location.pathname,
) {
  return matchIdInPathname(
    /^\/(?:app\/)?t\/([^/]+)\/*$/i,
    ["tournament"],
    pathname,
  );
}

export function getPlayTargetIdFromPathname(
  pathname = window.location.pathname,
) {
  return matchIdInPathname(
    /^\/(?:app\/)?(?:play|p)\/([^/]+)\/?$/i,
    ["court", "match"],
    pathname,
  );
}

// A court-only parser for callers that do not accept match targets.
export function getPlayCourtIdFromPathname(
  pathname = window.location.pathname,
) {
  return matchIdInPathname(
    /^\/(?:app\/)?(?:play|p)\/([^/]+)\/?$/i,
    ["court"],
    pathname,
  );
}

export function isPlayRootPathname(pathname = window.location.pathname) {
  return /^\/(?:app\/)?(?:play|p)\/?$/i.test(pathname);
}

export function isSpectateRootPathname(pathname = window.location.pathname) {
  return /^\/(?:app\/)?(?:court|c)\/?$/i.test(pathname);
}

// The view state a URL requests (deep links and history entries without app state).
export function getViewStateFromLocation(pathname = window.location.pathname) {
  const playTargetId = getPlayTargetIdFromPathname(pathname);

  if (playTargetId) {
    return createViewState({
      page: NAV_PAGES.PLAY,
      playTargetId,
      playTargetType: "unknown",
      spectate: true,
      returnToScoreboard: true,
    });
  }

  if (isPlayRootPathname(pathname)) {
    return createViewState({ page: NAV_PAGES.PLAY });
  }

  if (isSpectateRootPathname(pathname)) {
    return createViewState({ page: NAV_PAGES.SPECTATE });
  }

  if (isAdminRootPathname(pathname)) {
    return createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD });
  }

  const courtId = getCourtIdFromPathname(pathname);

  if (courtId) {
    return createViewState({
      page: NAV_PAGES.SCOREBOARD,
      courtId,
      spectate: true,
    });
  }

  return createViewState({ page: NAV_PAGES.MENU });
}
