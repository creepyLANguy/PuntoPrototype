/**
 * Comprehensive Analytics & Logging Module
 * Tracks user behavior, game events, system metrics, and performance
 * Integrates with Firebase Firestore and Google Analytics
 */

import { db, serverTimestamp } from "./firebase.js";
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";

// =====================================================
// ANALYTICS CONFIGURATION
// =====================================================

const ANALYTICS_CONFIG = {
  // Session tracking
  SESSION_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes
  SESSION_CHECK_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  
  // Batch logging
  BATCH_SIZE: 50,
  BATCH_FLUSH_INTERVAL_MS: 60 * 1000, // 1 minute
  
  // Performance tracking
  ENABLE_PERFORMANCE_TRACKING: true,
  PERFORMANCE_THRESHOLD_MS: 3000, // Log if operation takes > 3 seconds
  
  // Event categories
  EVENT_CATEGORIES: {
    PAGE_VIEW: "page_view",
    GAME_EVENT: "game_event",
    DEVICE_EVENT: "device_event",
    SYSTEM_EVENT: "system_event",
    USER_EVENT: "user_event",
    ERROR: "error",
    PERFORMANCE: "performance"
  }
};

// =====================================================
// STATE MANAGEMENT
// =====================================================

class AnalyticsManager {
  constructor() {
    this.sessionId = this.generateSessionId();
    this.deviceId = this.getDeviceId();
    this.userId = null;
    this.currentCourtId = null;
    this.currentPage = this.getCurrentPage();
    this.sessionStart = new Date();
    this.lastActivityTime = new Date();
    this.eventBatch = [];
    this.analytics = null;
    this.sessionActive = true;
    this.isInitialized = false;
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  async initialize(app) {
    if (this.isInitialized) return;
    
    try {
      this.analytics = getAnalytics(app);
      
      // Set up session tracking
      this.setupSessionTracking();
      
      // Set up batch logging
      this.setupBatchLogging();
      
      // Track initial page view
      await this.trackPageView();
      
      this.isInitialized = true;
      console.log("✓ Analytics initialized", { sessionId: this.sessionId, deviceId: this.deviceId });
    } catch (error) {
      console.error("Analytics initialization failed:", error);
    }
  }

  setupSessionTracking() {
    // Monitor user activity
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    activityEvents.forEach(event => {
      document.addEventListener(event, () => {
        this.lastActivityTime = new Date();
      }, { passive: true });
    });

    // Check session validity
    setInterval(() => {
      const now = new Date();
      const inactivityTime = now - this.lastActivityTime;
      
      if (inactivityTime > ANALYTICS_CONFIG.SESSION_TIMEOUT_MS && this.sessionActive) {
        this.endSession();
      }
    }, ANALYTICS_CONFIG.SESSION_CHECK_INTERVAL_MS);

    // Handle page unload
    window.addEventListener('beforeunload', () => {
      this.endSession();
      this.flushBatch();
    });
  }

  setupBatchLogging() {
    setInterval(() => {
      if (this.eventBatch.length > 0) {
        this.flushBatch();
      }
    }, ANALYTICS_CONFIG.BATCH_FLUSH_INTERVAL_MS);
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getDeviceId() {
    let deviceId = localStorage.getItem('punto_device_id');
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      localStorage.setItem('punto_device_id', deviceId);
    }
    return deviceId;
  }

  getCurrentPage() {
    const path = window.location.pathname;
    if (path.includes('/app/')) {
      return 'app';
    } else if (path.includes('/nfc')) {
      return 'nfc';
    } else {
      return 'website';
    }
  }

  setUserId(userId) {
    this.userId = userId;
    if (this.analytics) {
      logEvent(this.analytics, 'user_id_set', { user_id: userId });
    }
  }

  setCourtContext(courtId, courtStatus = null) {
    this.currentCourtId = courtId;
    if (this.analytics) {
      logEvent(this.analytics, 'court_context_set', { 
        court_id: courtId,
        court_status: courtStatus 
      });
    }
  }

  endSession() {
    this.sessionActive = false;
    const duration = new Date() - this.sessionStart;
    
    this.addEvent({
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.USER_EVENT,
      action: 'session_end',
      label: 'User session ended',
      data: {
        session_duration_ms: duration,
        events_logged: this.eventBatch.length
      }
    });

    if (this.analytics) {
      logEvent(this.analytics, 'session_end', {
        session_duration_seconds: Math.round(duration / 1000)
      });
    }
  }

  // =====================================================
  // EVENT TRACKING - PAGE EVENTS
  // =====================================================

  async trackPageView(page = null, metadata = {}) {
    const pageName = page || this.currentPage;
    
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.PAGE_VIEW,
      action: 'page_view',
      label: pageName,
      data: {
        page: pageName,
        referrer: document.referrer,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    };

    this.addEvent(event);
    
    if (this.analytics) {
      logEvent(this.analytics, 'page_view', {
        page_title: document.title,
        page_location: window.location.href
      });
    }
  }

  trackNavigation(from, to, metadata = {}) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.PAGE_VIEW,
      action: 'navigation',
      label: `${from} -> ${to}`,
      data: {
        from_page: from,
        to_page: to,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    };

    this.addEvent(event);
    
    if (this.analytics) {
      logEvent(this.analytics, 'navigation', {
        from: from,
        to: to
      });
    }
  }

  trackClickEvent(elementId, elementClass = null, metadata = {}) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.USER_EVENT,
      action: 'click',
      label: elementId || elementClass,
      data: {
        element_id: elementId,
        element_class: elementClass,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    };

    this.addEvent(event);
  }

  // =====================================================
  // EVENT TRACKING - GAME EVENTS
  // =====================================================

  trackGameEvent(eventType, team, score = null, metadata = {}) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.GAME_EVENT,
      action: eventType.toLowerCase(),
      label: team ? `${eventType} - Team ${team}` : eventType,
      data: {
        event_type: eventType,
        team: team,
        current_score: score,
        court_id: this.currentCourtId,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    };

    this.addEvent(event);
    
    if (this.analytics) {
      logEvent(this.analytics, 'game_event', {
        event_type: eventType,
        team: team,
        court_id: this.currentCourtId
      });
    }
  }

  trackPoint(team, scoreState = null) {
    this.trackGameEvent('POINT', team, scoreState);
  }

  trackGame(winningTeam, gameNumber = null) {
    this.trackGameEvent('GAME_WON', winningTeam, null, { 
      game_number: gameNumber 
    });
  }

  trackSet(winningTeam, setNumber = null) {
    this.trackGameEvent('SET_WON', winningTeam, null, { 
      set_number: setNumber 
    });
  }

  trackUndo(previousEventType = null) {
    this.trackGameEvent('UNDO', null, null, { 
      undone_event: previousEventType 
    });
  }

  trackReset(isDeepReset = false) {
    this.trackGameEvent('RESET', null, null, { 
      is_deep_reset: isDeepReset 
    });
  }

  trackMatch(resultData = {}) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.GAME_EVENT,
      action: 'match_completed',
      label: 'Match completed',
      data: {
        ...resultData,
        court_id: this.currentCourtId,
        timestamp: new Date().toISOString()
      }
    };

    this.addEvent(event);
    
    if (this.analytics) {
      logEvent(this.analytics, 'match_completed', {
        court_id: this.currentCourtId,
        result: resultData.winner
      });
    }
  }

  // =====================================================
  // EVENT TRACKING - DEVICE EVENTS
  // =====================================================

  trackNfcScan(courtId, deviceId = null, success = true, metadata = {}) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.DEVICE_EVENT,
      action: 'nfc_scan',
      label: success ? 'NFC scan successful' : 'NFC scan failed',
      data: {
        court_id: courtId,
        scanned_device_id: deviceId,
        success: success,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    };

    this.addEvent(event);
    
    if (this.analytics) {
      logEvent(this.analytics, 'nfc_scan', {
        court_id: courtId,
        success: success
      });
    }
  }

  trackDeviceRegistration(courtId, deviceRole = null) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.DEVICE_EVENT,
      action: 'device_registration',
      label: 'Device registered to court',
      data: {
        court_id: courtId,
        device_role: deviceRole,
        device_id: this.deviceId,
        timestamp: new Date().toISOString()
      }
    };

    this.addEvent(event);
    
    if (this.analytics) {
      logEvent(this.analytics, 'device_registration', {
        court_id: courtId,
        device_id: this.deviceId
      });
    }
  }

  trackSpectating(courtId, isSpectating = true) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.DEVICE_EVENT,
      action: isSpectating ? 'spectating_started' : 'spectating_ended',
      label: `Spectating ${isSpectating ? 'started' : 'ended'}`,
      data: {
        court_id: courtId,
        is_spectating: isSpectating,
        device_id: this.deviceId,
        timestamp: new Date().toISOString()
      }
    };

    this.addEvent(event);
  }

  trackFeatureUsage(featureName, metadata = {}) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.USER_EVENT,
      action: 'feature_used',
      label: featureName,
      data: {
        feature: featureName,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    };

    this.addEvent(event);
    
    if (this.analytics) {
      logEvent(this.analytics, 'feature_used', {
        feature: featureName
      });
    }
  }

  // =====================================================
  // EVENT TRACKING - SYSTEM EVENTS
  // =====================================================

  trackError(errorMessage, errorStack = null, context = {}) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.ERROR,
      action: 'error_occurred',
      label: errorMessage,
      data: {
        error_message: errorMessage,
        error_stack: errorStack,
        page: this.currentPage,
        timestamp: new Date().toISOString(),
        ...context
      }
    };

    this.addEvent(event);
    
    if (this.analytics) {
      logEvent(this.analytics, 'error', {
        error_message: errorMessage,
        page: this.currentPage
      });
    }

    console.error("Analytics logged error:", errorMessage);
  }

  trackPerformance(operationName, duration, metadata = {}) {
    if (duration > ANALYTICS_CONFIG.PERFORMANCE_THRESHOLD_MS) {
      const event = {
        category: ANALYTICS_CONFIG.EVENT_CATEGORIES.PERFORMANCE,
        action: 'slow_operation',
        label: operationName,
        data: {
          operation: operationName,
          duration_ms: duration,
          threshold_ms: ANALYTICS_CONFIG.PERFORMANCE_THRESHOLD_MS,
          timestamp: new Date().toISOString(),
          ...metadata
        }
      };

      this.addEvent(event);
      
      if (this.analytics) {
        logEvent(this.analytics, 'slow_operation', {
          operation: operationName,
          duration_ms: duration
        });
      }
    }
  }

  trackApiCall(endpoint, method = 'GET', statusCode = null, duration = null, metadata = {}) {
    const event = {
      category: ANALYTICS_CONFIG.EVENT_CATEGORIES.PERFORMANCE,
      action: 'api_call',
      label: `${method} ${endpoint}`,
      data: {
        endpoint: endpoint,
        method: method,
        status_code: statusCode,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
        ...metadata
      }
    };

    this.addEvent(event);
  }

  // =====================================================
  // GENERIC EVENT LOGGING
  // =====================================================

  addEvent(eventData) {
    const enrichedEvent = {
      ...eventData,
      session_id: this.sessionId,
      device_id: this.deviceId,
      user_id: this.userId,
      page: this.currentPage,
      timestamp: new Date().toISOString(),
      url: window.location.href
    };

    this.eventBatch.push(enrichedEvent);

    // Auto-flush if batch reaches size limit
    if (this.eventBatch.length >= ANALYTICS_CONFIG.BATCH_SIZE) {
      this.flushBatch();
    }
  }

  // =====================================================
  // BATCH OPERATIONS
  // =====================================================

  async flushBatch() {
    if (this.eventBatch.length === 0) return;

    const eventsToLog = [...this.eventBatch];
    this.eventBatch = [];

    try {
      for (const event of eventsToLog) {
        await this.logEventToFirestore(event);
      }
      console.log(`✓ Flushed ${eventsToLog.length} analytics events`);
    } catch (error) {
      console.error("Failed to flush analytics batch:", error);
      // Re-add events to batch if flush failed (with limit to prevent memory issues)
      if (this.eventBatch.length < ANALYTICS_CONFIG.BATCH_SIZE * 2) {
        this.eventBatch.unshift(...eventsToLog);
      }
    }
  }

  async logEventToFirestore(event) {
    try {
      await addDoc(collection(db, 'analytics_events'), {
        ...event,
        created_at: serverTimestamp()
      });
    } catch (error) {
      console.error("Failed to log event to Firestore:", error);
      throw error;
    }
  }

  // =====================================================
  // PERFORMANCE MEASUREMENT
  // =====================================================

  measureOperation(operationName) {
    const startTime = performance.now();
    
    return {
      end: () => {
        const duration = performance.now() - startTime;
        this.trackPerformance(operationName, duration);
        return duration;
      }
    };
  }

  async measureAsyncOperation(operationName, asyncFn) {
    const startTime = performance.now();
    try {
      const result = await asyncFn();
      const duration = performance.now() - startTime;
      this.trackPerformance(operationName, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.trackPerformance(operationName, duration);
      throw error;
    }
  }

  // =====================================================
  // QUERYING & REPORTING
  // =====================================================

  async getSessionEvents() {
    try {
      const q = query(
        collection(db, 'analytics_events'),
        where('session_id', '==', this.sessionId),
        orderBy('timestamp', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error("Failed to retrieve session events:", error);
      return [];
    }
  }

  async getCourtEvents(courtId, limit_count = 100) {
    try {
      const q = query(
        collection(db, 'analytics_events'),
        where('data.court_id', '==', courtId),
        orderBy('timestamp', 'desc'),
        limit(limit_count)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error("Failed to retrieve court events:", error);
      return [];
    }
  }

  async getErrorLogs(limit_count = 50) {
    try {
      const q = query(
        collection(db, 'analytics_events'),
        where('category', '==', ANALYTICS_CONFIG.EVENT_CATEGORIES.ERROR),
        orderBy('timestamp', 'desc'),
        limit(limit_count)
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error("Failed to retrieve error logs:", error);
      return [];
    }
  }

  async getPerformanceMetrics(operationName = null, limit_count = 100) {
    try {
      let q;
      if (operationName) {
        q = query(
          collection(db, 'analytics_events'),
          where('category', '==', ANALYTICS_CONFIG.EVENT_CATEGORIES.PERFORMANCE),
          where('data.operation', '==', operationName),
          orderBy('timestamp', 'desc'),
          limit(limit_count)
        );
      } else {
        q = query(
          collection(db, 'analytics_events'),
          where('category', '==', ANALYTICS_CONFIG.EVENT_CATEGORIES.PERFORMANCE),
          orderBy('timestamp', 'desc'),
          limit(limit_count)
        );
      }
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => doc.data());
    } catch (error) {
      console.error("Failed to retrieve performance metrics:", error);
      return [];
    }
  }
}

// =====================================================
// GLOBAL ANALYTICS INSTANCE
// =====================================================

export const analyticsManager = new AnalyticsManager();

// =====================================================
// UTILITY EXPORTS
// =====================================================

export function initializeAnalytics(app) {
  return analyticsManager.initialize(app);
}

export function trackPageView(page = null, metadata = {}) {
  return analyticsManager.trackPageView(page, metadata);
}

export function trackGameEvent(eventType, team, score = null, metadata = {}) {
  return analyticsManager.trackGameEvent(eventType, team, score, metadata);
}

export function trackError(message, stack = null, context = {}) {
  return analyticsManager.trackError(message, stack, context);
}

export function getAnalyticsManager() {
  return analyticsManager;
}
