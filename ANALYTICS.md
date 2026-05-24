# Padel Push Analytics & Logging System

Complete metrics, analytics, and logging system for tracking user behavior, game events, system performance, and more across the Padel Push application and website.

## Overview

This analytics system provides:

- **User Behavior Tracking**: Page views, clicks, navigation, scroll depth, time on page
- **Game Event Logging**: Points, games, sets, undos, resets, match completions
- **Device Events**: NFC scans, device registrations, spectating mode
- **System Monitoring**: Error logging, performance metrics, API call tracking
- **Session Management**: Unique session IDs, device identification, activity tracking
- **Firebase Integration**: Google Analytics + Firestore custom events
- **Batch Processing**: Efficient event queueing and flushing
- **Real-time Querying**: Methods to retrieve and analyze collected data

## Architecture

### Client-Side

#### 1. **App Analytics** (`app/js/analytics.js`)
Main analytics module for the game app with comprehensive tracking:
- Game events (points, games, sets, resets, undos)
- Device events (NFC, registrations, spectating)
- User activity and sessions
- Performance monitoring
- Error tracking

```javascript
import { initializeAnalytics, getAnalyticsManager } from "./analytics.js";

// Initialize on app startup
await initializeAnalytics(app);

// Get reference to analytics manager
const analytics = getAnalyticsManager();

// Track events
analytics.trackPoint("A", scoreState);
analytics.trackGameEvent("RESET", null, null, { is_deep_reset: true });
analytics.trackError(message, stack);
```

#### 2. **Website Analytics** (`js/website-analytics.js`)
Lightweight analytics for the landing page:
- Page views and navigation
- Button and link clicks
- Scroll depth
- Form interactions
- CTAs (Call-to-Actions)
- Time on page
- Session tracking

```javascript
// Automatically initialized on page load
websiteAnalytics.trackPageView();
websiteAnalytics.trackClickEvent(elementId, elementText);
websiteAnalytics.trackScroll(scrollPercentage);
websiteAnalytics.trackCTA(ctaName, ctaText, ctaUrl);
```

### Server-Side

#### 3. **Cloud Functions Analytics** (`functions/index.js`)
Server-side event logging and error tracking:
- Game event processing logs
- API call tracking
- Error logging
- Device activity logging

```javascript
// Automatically logs:
- Game events processed by onEventCreate trigger
- API call success/failures in postEvent endpoint
- Transaction errors and exceptions
```

## Firestore Collections

### Client-Side Analytics Collections

#### `analytics_events`
Main collection for all app events:
```javascript
{
  session_id: "session_1234567890_abc123",
  device_id: "device_1234567890_def456",
  user_id: "optional_user_identifier",
  page: "app",  // 'app', 'website', 'nfc'
  category: "game_event",  // event category
  action: "point",  // action type
  label: "POINT_TEAM_A - Team A",  // descriptive label
  data: {
    event_type: "POINT_TEAM_A",
    team: "A",
    court_id: "court123",
    current_score: { A: {...}, B: {...} },
    timestamp: "2024-05-24T10:30:00.000Z",
    ...additional_context
  },
  timestamp: "2024-05-24T10:30:00.000Z",
  url: "http://127.0.0.1:5500/app/",
  created_at: FieldValue.serverTimestamp()
}
```

#### `website_analytics_events`
Landing page analytics:
```javascript
{
  type: "page_view",  // event type
  session_id: "session_1234567890_abc123",
  device_id: "device_1234567890_def456",
  page_title: "Padel Push | Smart Scoring...",
  page_location: "http://127.0.0.1:5500/",
  referrer: "...",
  timestamp: "2024-05-24T10:30:00.000Z",
  created_at: FieldValue.serverTimestamp()
}
```

### Server-Side Analytics Collections

#### `server_analytics_events`
Backend event logging:
```javascript
{
  type: "game_event_processed",  // event type
  court_id: "court123",
  event_id: "evt_abc123",
  event_type: "POINT_TEAM_A",
  created_by: "device_id",
  new_score: { A: {...}, B: {...} },
  timestamp: "2024-05-24T10:30:00.000Z",
  created_at: FieldValue.serverTimestamp()
}
```

## Event Categories & Types

### Game Events (`ANALYTICS_CONFIG.EVENT_CATEGORIES.GAME_EVENT`)
```javascript
- POINT (Team A/B)
- GAME_WON
- SET_WON
- UNDO
- RESET (shallow/deep)
- MATCH_COMPLETED
```

### Device Events (`ANALYTICS_CONFIG.EVENT_CATEGORIES.DEVICE_EVENT`)
```javascript
- NFC_SCAN (success/failure)
- DEVICE_REGISTRATION
- SPECTATING_STARTED/ENDED
```

### Page View Events (`ANALYTICS_CONFIG.EVENT_CATEGORIES.PAGE_VIEW`)
```javascript
- PAGE_VIEW
- NAVIGATION
- CLICK
```

### System Events (`ANALYTICS_CONFIG.EVENT_CATEGORIES.SYSTEM_EVENT`)
```javascript
- SESSION_END
- FEATURE_USED
```

### Error Events (`ANALYTICS_CONFIG.EVENT_CATEGORIES.ERROR`)
```javascript
- ERROR_OCCURRED
```

### Performance Events (`ANALYTICS_CONFIG.EVENT_CATEGORIES.PERFORMANCE`)
```javascript
- SLOW_OPERATION
- API_CALL
```

## API Reference

### Analytics Manager Methods

#### Initialization
```javascript
await initializeAnalytics(app)
```
Initializes analytics with Firebase app instance.

#### Session Management
```javascript
analyticsManager.setUserId(userId)
analyticsManager.setCourtContext(courtId, courtStatus)
analyticsManager.endSession()
```

#### Game Event Tracking
```javascript
// Track individual game events
analyticsManager.trackPoint(team, scoreState)
analyticsManager.trackGame(winningTeam, gameNumber)
analyticsManager.trackSet(winningTeam, setNumber)
analyticsManager.trackUndo(previousEventType)
analyticsManager.trackReset(isDeepReset)
analyticsManager.trackMatch(resultData)

// Example:
analytics.trackPoint("A", {
  A: { points: 15, games: 2, sets: 1 },
  B: { points: 0, games: 1, sets: 0 }
});
```

#### Device Event Tracking
```javascript
analyticsManager.trackNfcScan(courtId, deviceId, success, metadata)
analyticsManager.trackDeviceRegistration(courtId, deviceRole)
analyticsManager.trackSpectating(courtId, isSpectating)
```

#### Generic Event Tracking
```javascript
analyticsManager.trackPageView(page, metadata)
analyticsManager.trackNavigation(from, to, metadata)
analyticsManager.trackClickEvent(elementId, elementClass, metadata)
analyticsManager.trackFeatureUsage(featureName, metadata)
analyticsManager.trackError(message, stack, context)
analyticsManager.trackPerformance(operationName, duration, metadata)
analyticsManager.trackApiCall(endpoint, method, statusCode, duration, metadata)
```

#### Performance Measurement
```javascript
// Synchronous operation
const measurement = analyticsManager.measureOperation("operation_name");
// ... do work ...
const durationMs = measurement.end();

// Asynchronous operation
const result = await analyticsManager.measureAsyncOperation(
  "async_operation_name",
  async () => {
    // ... async work ...
    return result;
  }
);
```

#### Data Querying
```javascript
// Get events from current session
const sessionEvents = await analyticsManager.getSessionEvents();

// Get events for a specific court
const courtEvents = await analyticsManager.getCourtEvents(courtId, limit);

// Get error logs
const errors = await analyticsManager.getErrorLogs(limit);

// Get performance metrics
const metrics = await analyticsManager.getPerformanceMetrics(operationName, limit);
```

## Configuration

Located in `app/js/analytics.js`:

```javascript
const ANALYTICS_CONFIG = {
  SESSION_TIMEOUT_MS: 30 * 60 * 1000,      // 30 minutes
  SESSION_CHECK_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  BATCH_SIZE: 50,                          // Events per batch
  BATCH_FLUSH_INTERVAL_MS: 60 * 1000,      // 1 minute
  ENABLE_PERFORMANCE_TRACKING: true,
  PERFORMANCE_THRESHOLD_MS: 3000           // Log if > 3 seconds
};
```

## Usage Examples

### App Integration
```javascript
import { getAnalyticsManager } from "./analytics.js";

// When a point is scored
async function addPoint(eventType) {
  await addDoc(collection(db, "courts", courtId, "events"), {
    eventType: eventType,
    createdAt: serverTimestamp(),
    createdBy: deviceId
  });

  const analytics = getAnalyticsManager();
  analytics.trackPoint(
    eventType === "POINT_TEAM_A" ? "A" : "B",
    score
  );
}

// When court is entered
async function enterCourt(courtId, spectate) {
  // ... court setup ...
  
  const analytics = getAnalyticsManager();
  analytics.setCourtContext(courtId, currentCourtStatus);
  analytics.trackGameEvent(
    spectate ? "SPECTATE" : "REGISTER",
    null,
    null,
    { court_id: courtId, is_spectating: spectate }
  );
}

// When NFC is scanned
nfcReader.onreading = (event) => {
  const analytics = getAnalyticsManager();
  analytics.trackNfcScan(null, scannedDeviceId, true);
  handleNfc(scannedData);
};
```

### Website Integration
```javascript
// Already initialized automatically

// Track custom CTAs
document.querySelector(".cta-button").addEventListener("click", () => {
  websiteAnalytics.trackCTA("book-demo", "Book a free demo", "https://...");
});

// Track form submissions
document.querySelector("form").addEventListener("submit", () => {
  websiteAnalytics.trackFormInteraction("contact-form", "email", "submit");
});
```

### Cloud Functions Integration
```javascript
// Server-side event logging
await logAnalyticsEvent('game_event_processed', {
  court_id: courtId,
  event_id: eventId,
  event_type: eventType,
  created_by: deviceId
});

// Error logging
await logAnalyticsEvent('game_event_error', {
  court_id: courtId,
  error_message: err.message
});
```

## Querying Analytics Data

### Firebase Console
1. Go to Firestore Database
2. Navigate to `analytics_events` or `website_analytics_events`
3. View documents and filter by session_id, device_id, etc.

### Programmatically (Example Cloud Function)
```javascript
async function getCourtAnalytics(courtId) {
  const q = query(
    collection(db, 'analytics_events'),
    where('data.court_id', '==', courtId),
    orderBy('timestamp', 'desc'),
    limit(100)
  );
  
  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data());
}

async function getDeviceStats(deviceId) {
  const q = query(
    collection(db, 'analytics_events'),
    where('device_id', '==', deviceId),
    where('category', '==', 'game_event'),
    orderBy('timestamp', 'desc')
  );
  
  const snapshot = await getDocs(q);
  const events = snapshot.docs.map(doc => doc.data());
  
  return {
    totalEvents: events.length,
    pointsScored: events.filter(e => e.action === 'point').length,
    undoCount: events.filter(e => e.action === 'undo').length,
    resetCount: events.filter(e => e.action === 'reset').length
  };
}
```

## Performance Considerations

1. **Batch Flushing**: Events are automatically batched and flushed every 60 seconds or when batch reaches 50 events
2. **Session Timeout**: Sessions automatically end after 30 minutes of inactivity
3. **Firestore Limits**: Monitor read/write operations - consider archiving old events
4. **Client-Side**: Analytics runs independently from game logic to avoid performance impact

## Privacy & Data Retention

- Device IDs are generated locally and persisted in localStorage
- No personally identifiable information is collected
- Session IDs are unique per session
- Consider implementing data retention policies in Firestore

## Troubleshooting

### Events Not Appearing
1. Check browser console for initialization messages
2. Verify Firebase configuration is correct
3. Check Firestore read/write permissions
4. Ensure `analytics_events` collection exists (auto-created on first write)

### Performance Issues
1. Reduce `BATCH_SIZE` in config
2. Increase `BATCH_FLUSH_INTERVAL_MS`
3. Check Firestore quota usage
4. Consider disabling performance tracking for production

### Missing Data
1. Verify session hasn't timed out (30 min default)
2. Check network connectivity
3. Look for errors in browser console
4. Check Cloud Functions logs for server-side issues

## Future Enhancements

- [ ] Real-time analytics dashboard
- [ ] Aggregated metrics by court/device
- [ ] Anomaly detection for unusual patterns
- [ ] Custom event tagging
- [ ] Export to external analytics services
- [ ] Advanced querying and filtering UI
- [ ] Performance benchmarks and comparisons
- [ ] User retention and engagement metrics

## Support

For issues or feature requests, refer to the main project documentation or create an issue in the repository.
