/**
 * Deep Linking Module
 * Handles URL-based court navigation for both spectate and play modes
 * Supports: /watch/:courtId, /view/:courtId, /spectate/:courtId
 *           /play/:courtId, /join/:courtId
 */

export function initDeepLinking(handlers) {
  /**
   * handlers = {
   *   onSpectateDeeplink: (courtId) => Promise,
   *   onPlayDeeplink: (courtId) => Promise,
   *   onMenuDeeplink: () => Promise
   * }
   */

  const SPECTATE_ROUTES = ['watch', 'view', 'spectate'];
  const PLAY_ROUTES = ['play', 'join'];

  function parseCurrentUrl() {
    const path = window.location.pathname;
    const segments = path.split('/').filter(s => s.length > 0);

    // Skip 'app' segment if present (e.g., /app/watch/court-123)
    let startIndex = segments[0] === 'app' ? 1 : 0;
    const route = segments[startIndex];
    const courtId = segments[startIndex + 1];

    return { route, courtId, segments };
  }

  function handleDeeplink() {
    const { route, courtId } = parseCurrentUrl();

    // No route specified, go to menu
    if (!route) {
      if (handlers.onMenuDeeplink) {
        handlers.onMenuDeeplink();
      }
      return;
    }

    // Spectate routes
    if (SPECTATE_ROUTES.includes(route)) {
      if (!courtId) {
        console.warn('[Deeplinking] Spectate route missing courtId');
        if (handlers.onMenuDeeplink) handlers.onMenuDeeplink();
        return;
      }

      if (handlers.onSpectateDeeplink) {
        handlers.onSpectateDeeplink(courtId);
      }
      return;
    }

    // Play routes
    if (PLAY_ROUTES.includes(route)) {
      if (!courtId) {
        console.warn('[Deeplinking] Play route missing courtId');
        if (handlers.onMenuDeeplink) handlers.onMenuDeeplink();
        return;
      }

      if (handlers.onPlayDeeplink) {
        handlers.onPlayDeeplink(courtId);
      }
      return;
    }

    // Unknown route, go to menu
    console.warn(`[Deeplinking] Unknown route: ${route}`);
    if (handlers.onMenuDeeplink) {
      handlers.onMenuDeeplink();
    }
  }

  function getCurrentCourtUrl(courtId, mode = 'spectate') {
    const baseUrl = window.location.origin;
    const route = mode === 'play' ? 'play' : 'spectate';
    return `${baseUrl}/app/${route}/${courtId}`;
  }

  function navigateToUrl(url) {
    window.history.pushState({}, '', url);
    handleDeeplink();
  }

  function navigateToSpectate(courtId) {
    const url = getCurrentCourtUrl(courtId, 'spectate');
    navigateToUrl(url);
  }

  function navigateToPlay(courtId) {
    const url = getCurrentCourtUrl(courtId, 'play');
    navigateToUrl(url);
  }

  function navigateToMenu() {
    const baseUrl = window.location.origin;
    const url = `${baseUrl}/app`;
    window.history.pushState({}, '', url);
    if (handlers.onMenuDeeplink) {
      handlers.onMenuDeeplink();
    }
  }

  // Handle back button navigation
  window.addEventListener('popstate', handleDeeplink);

  return {
    handleDeeplink,
    getCurrentCourtUrl,
    navigateToUrl,
    navigateToSpectate,
    navigateToPlay,
    navigateToMenu,
    parseCurrentUrl
  };
}

export default initDeepLinking;