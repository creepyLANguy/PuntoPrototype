# Analytics Quick Start Guide

## 🚀 Getting Started

The analytics system is already integrated into your Padel Push app and website. Here's what's happening automatically:

### App (127.0.0.1:5500/app/)
✅ Tracking:
- Every point scored (Team A/B)
- Games won
- Sets won  
- Undos and resets
- NFC scans and device registrations
- Spectating mode
- User sessions
- Errors and performance issues

### Website (127.0.0.1:5500/)
✅ Tracking:
- Page views
- Button clicks
- Link clicks  
- Scroll depth (every 25%)
- Form interactions
- Time spent on page
- CTA clicks
- User sessions

## 📊 Accessing Your Data

### Option 1: Firebase Console (Easiest)
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your `punto-8888` project
3. Click **Firestore Database** in the left menu
4. Look for these collections:
   - `analytics_events` - App game events
   - `website_analytics_events` - Website events
   - `server_analytics_events` - Backend logs

### Option 2: Query from JavaScript Console (In-App)

Open browser developer tools (F12) while in the app and run:

```javascript
// Get all events from current session
const events = await analyticsManager.getSessionEvents();
console.log(events);

// Get events for a specific court
const courtEvents = await analyticsManager.getCourtEvents("court123");
console.log(courtEvents);

// Get error logs
const errors = await analyticsManager.getErrorLogs();
console.log(errors);

// Get performance metrics
const perf = await analyticsManager.getPerformanceMetrics();
console.log(perf);
```

### Option 3: Website Analytics

```javascript
// In browser console on landing page:
console.log(websiteAnalytics.sessionId);
```

## 📈 Key Metrics to Track

### Game Performance
- Points per session
- Average game duration
- Undo frequency (indicates mistakes?)
- Reset frequency (match restarts)
- Most active courts
- Peak usage times

### User Engagement
- Average session duration
- Devices per court
- Return visitors (by device ID)
- Feature usage (NFC, spectating)
- Error rates

### Website Engagement  
- Time on landing page
- Scroll depth (how far users scroll)
- CTA click rates
- Referral sources
- Most clicked links

## 🔍 Example Analytics Queries

### Dashboard Query Example
```javascript
// Get all events from today
const today = new Date();
today.setHours(0, 0, 0, 0);

const q = query(
  collection(db, 'analytics_events'),
  where('timestamp', '>=', today.toISOString()),
  orderBy('timestamp', 'desc'),
  limit(1000)
);

const snapshot = await getDocs(q);
const todayEvents = snapshot.docs.map(doc => doc.data());
```

### Court Performance Query
```javascript
// Get statistics for a specific court
async function getCourtStats(courtId) {
  const q = query(
    collection(db, 'analytics_events'),
    where('data.court_id', '==', courtId)
  );
  
  const snapshot = await getDocs(q);
  const events = snapshot.docs.map(doc => doc.data());
  
  return {
    totalEvents: events.length,
    points: events.filter(e => e.action === 'point').length,
    games: events.filter(e => e.action === 'game_won').length,
    sets: events.filter(e => e.action === 'set_won').length,
    devices: [...new Set(events.map(e => e.device_id))].length
  };
}
```

## 🎯 Custom Tracking

### Track Custom Events in App
```javascript
import { getAnalyticsManager } from "./app/js/analytics.js";

const analytics = getAnalyticsManager();

// Track feature usage
analytics.trackFeatureUsage("custom_feature", { 
  detail: "user_action" 
});

// Track errors
analytics.trackError("Something went wrong", error.stack, {
  context: "feature_name"
});

// Measure operation performance
const timer = analytics.measureOperation("custom_operation");
// ... do work ...
timer.end();
```

### Track Custom Events on Website
```javascript
// On landing page
websiteAnalytics.trackCTA("book-demo", "Book Demo Button", "/booking");
websiteAnalytics.trackFormInteraction("contact-form", "email", "focus");
```

## 🔧 Configuration

To adjust analytics behavior, edit the config in `app/js/analytics.js`:

```javascript
const ANALYTICS_CONFIG = {
  SESSION_TIMEOUT_MS: 30 * 60 * 1000,      // When session expires
  BATCH_FLUSH_INTERVAL_MS: 60 * 1000,      // How often to save to database
  BATCH_SIZE: 50,                          // Events per batch before flush
  PERFORMANCE_THRESHOLD_MS: 3000           // Only log slow operations
};
```

## 📱 Device Identification

Each device gets a unique ID stored in browser localStorage:
- **App**: `punto_device_id`
- **Website**: `punto_website_device_id`

This allows you to track:
- Return visitors
- Device behavior patterns
- Cross-session consistency

Clear localStorage to reset device ID:
```javascript
localStorage.removeItem('punto_device_id');
```

## 🚨 Troubleshooting

### Data not appearing?
1. Check browser console for errors (F12)
2. Verify Firebase config is loaded
3. Check Firestore has write permissions
4. Look for `✓ Analytics initialized` message

### Too much data?
1. Increase `BATCH_FLUSH_INTERVAL_MS` to 5 minutes
2. Increase `SESSION_TIMEOUT_MS` to 60 minutes
3. Archive old data to separate collection

### Need to clear data?
```javascript
// Via Firebase Console:
// - Select collection
// - Select all documents
// - Delete

// Via Cloud Function (create custom delete endpoint)
```

## 📚 Full Documentation

See [ANALYTICS.md](./ANALYTICS.md) for complete API reference, all event types, and advanced usage.

## 🎓 Common Use Cases

### Track Match Duration
```javascript
// At match start
const matchStart = new Date();

// At match end
const duration = new Date() - matchStart;
analytics.trackMatch({
  duration_ms: duration,
  winner: "Team A",
  final_score: "6-4, 5-7, 6-3"
});
```

### Monitor NFC Performance
```javascript
// Track all NFC scans
const nfcScans = await analyticsManager.getCourtEvents(courtId);
const nfcEvents = nfcScans.filter(e => e.data?.action === 'spectate');
console.log(`NFC Success Rate: ${(nfcEvents.length / nfcScans.length * 100).toFixed(2)}%`);
```

### Device Utilization
```javascript
// See which devices are most active
const allEvents = await analyticsManager.getSessionEvents();
const deviceUsage = {};
allEvents.forEach(e => {
  deviceUsage[e.device_id] = (deviceUsage[e.device_id] || 0) + 1;
});
console.log(deviceUsage);
```

---

**Next Steps:**
1. Open your app at http://127.0.0.1:5500/app/
2. Play a game (score some points!)
3. Open Firebase Console and look in `analytics_events` collection
4. See your events being tracked in real-time!

Happy tracking! 🎾
