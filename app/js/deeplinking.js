/**
 * Deep Linking Module
 * Handles URL-based navigation for direct court access
 * 
 * Supported routes:
 * - /watch/[courtId] - Open court in spectate mode
 * - /view/[courtId] - Open court in spectate mode (alias)
 * - /spectate/[courtId] - Open court in spectate mode (alias)
 * - /play/[courtId] - Open join court screen (play mode)
 * - /join/[courtId] - Open join court screen (play mode alias)
 */

export class DeepLinkingManager {
  constructor() {
    this.supportedSpectateRoutes = ['watch', 'view', 'spectate'];
    this.supportedPlayRoutes = ['play', 'join'];
  }

  /**
   * Initialize deep linking by checking the current URL
   * @param {Function} enterCourtCallback - Callback function to enter a court
   * @param {Function} showPlayPageCallback - Callback function to show play page
   */
  init(enterCourtCallback, showPlayPageCallback) {
    this.enterCourtCallback = enterCourtCallback;
    this.showPlayPageCallback = showPlayPageCallback;

    // Check current URL on page load
    this.parseAndHandleCurrentUrl();

    // Listen for hash/state changes (for SPA navigation)
    window.addEventListener('hashchange', () => this.parseAndHandleCurrentUrl());
    window.addEventListener('popstate', () => this.parseAndHandleCurrentUrl());
  }

  /**
   * Parse the current URL and handle the route
   */
  parseAndHandleCurrentUrl() {
    const path = window.location.pathname;
    const route = this.parseRoute(path);

    if (route) {
      this.handleRoute(route);
    }
  }

  /**
   * Parse a pathname and extract route info
   * @param {String} pathname - The pathname to parse
   * @returns {Object|null} Route object with type and courtId, or null if not a valid deep link
   */
  parseRoute(pathname) {
    // Remove leading/trailing slashes and split
    const segments = pathname.split('/').filter(s => s.length > 0);

    // We need at least 2 segments: [app-path/] [route] [courtId]
    // Examples:
    // /app/watch/court123
    // /watch/court123
    // /play/court456

    if (segments.length < 2) return null;

    const firstSegment = segments[0];
    const secondSegment = segments[1];

    // Check if this is an /app/* route
    if (firstSegment === 'app' && segments.length >= 3) {
      const routeType = segments[1];
      const courtId = segments[2];

      return this.validateRoute(routeType, courtId);
    }

    // Check if this is a direct route (not under /app)
    if (segments.length >= 2) {
      const routeType = firstSegment;
      const courtId = secondSegment;

      return this.validateRoute(routeType, courtId);
    }

    return null;
  }

  /**
   * Validate and categorize a route
   * @param {String} routeType - The route type (watch, view, spectate, play, join)
   * @param {String} courtId - The court ID
   * @returns {Object|null} Validated route object, or null if invalid
   */
  validateRoute(routeType, courtId) {
    const normalizedRoute = routeType.toLowerCase();

    // Validate courtId is not empty
    if (!courtId || courtId.trim().length === 0) {
      console.warn('Invalid court ID in URL');
      return null;
    }

    if (this.supportedSpectateRoutes.includes(normalizedRoute)) {
      return {
        type: 'spectate',
        courtId: courtId.trim(),
        route: normalizedRoute
      };
    }

    if (this.supportedPlayRoutes.includes(normalizedRoute)) {
      return {
        type: 'play',
        courtId: courtId.trim(),
        route: normalizedRoute
      };
    }

    return null;
  }

  /**
   * Handle a parsed route
   * @param {Object} route - The route object with type and courtId
   */
  handleRoute(route) {
    console.log(`Deep Link: Handling ${route.type} route for court ${route.courtId}`);

    if (route.type === 'spectate') {
      // Auto-enter court in spectate mode
      if (this.enterCourtCallback) {
        this.enterCourtCallback(route.courtId, true);
      }
    } else if (route.type === 'play') {
      // Show play page with the court pre-selected
      if (this.showPlayPageCallback) {
        this.showPlayPageCallback(route.courtId);
      }
    }
  }

  /**
   * Generate a deep link URL for a court
   * @param {String} courtId - The court ID
   * @param {String} mode - The mode: 'spectate' or 'play'
   * @returns {String} The full deep link URL
   */
  generateDeepLink(courtId, mode = 'spectate') {
    const baseUrl = window.location.origin;
    const route = mode === 'play' ? 'play' : 'watch';
    return `${baseUrl}/${route}/${courtId}`;
  }

  /**
   * Navigate to a deep link
   * @param {String} courtId - The court ID
   * @param {String} mode - The mode: 'spectate' or 'play'
   */
  navigateToDeepLink(courtId, mode = 'spectate') {
    const url = this.generateDeepLink(courtId, mode);
    window.history.pushState({ courtId, mode }, '', url);
    this.parseAndHandleCurrentUrl();
  }
}

export default DeepLinkingManager;
