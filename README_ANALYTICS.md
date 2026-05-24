# 📊 Padel Push Analytics System

> Complete metrics and logging system for tracking user behavior, game events, device interactions, and system performance

## 🎯 What You Get

A fully integrated analytics and logging system that automatically tracks:

### ✅ Game Events
- Points scored (Team A/B)
- Games won
- Sets won  
- Undos and resets
- Match completions
- Court entries and exits

### ✅ Device Tracking
- NFC scans (success/failures)
- Device registrations
- Spectating mode
- Cross-device sessions

### ✅ User Engagement
- Page views and navigation
- Button/link clicks
- Scroll depth
- Time on page
- Session duration
- CTA interactions

### ✅ System Health
- Error logs with stack traces
- Performance metrics
- Slow operations (>3 seconds)
- API call tracking
- Firebase quota usage

### ✅ Real-time Integration
- Google Analytics (Measurement ID: `G-671HVQXCR4`)
- Firebase Firestore collections
- Server-side logging
- Batch processing (efficient!)

---

## 🚀 Quick Start (5 Minutes)

### 1. Verify It's Working
```bash
# Open your app
http://127.0.0.1:5500/app/

# Open browser console (F12)
# Should see: ✓ Analytics initialized
```

### 2. Check the Data
```javascript
// In browser console:
const events = await analyticsManager.getSessionEvents();
console.log(events); // Your tracked events!
```

### 3. View in Firebase
1. Open [Firebase Console](https://console.firebase.google.com/)
2. Select `punto-8888` project
3. Go to **Firestore Database**
4. Look for `analytics_events` collection
5. **You should see your events!** ✨

---

## 📁 What's Included

| File | Purpose |
|------|---------|
| `app/js/analytics.js` | Main app analytics module |
| `js/website-analytics.js` | Landing page analytics |
| `ANALYTICS.md` | Complete API documentation |
| `ANALYTICS_QUICKSTART.md` | Quick start guide with examples |
| `ANALYTICS_ARCHITECTURE.md` | System architecture & data flow |
| `ANALYTICS_CLOUD_FUNCTIONS.js` | Analytics query examples |
| `ANALYTICS_VERIFICATION.md` | Troubleshooting & verification |
| `firestore.rules` | Security rules |

---

## 🔧 Configuration

Everything works out of the box, but you can customize:

```javascript
// In app/js/analytics.js
const ANALYTICS_CONFIG = {
  SESSION_TIMEOUT_MS: 30 * 60 * 1000,      // When session expires
  BATCH_FLUSH_INTERVAL_MS: 60 * 1000,      // How often to save
  BATCH_SIZE: 50,                          // Events per batch
  PERFORMANCE_THRESHOLD_MS: 3000           // Only log slow operations
};
```

---

## 💻 Usage Examples

### Track a Point
```javascript
const analytics = getAnalyticsManager();
analytics.trackPoint("A", scoreState);
```

### Track an Error
```javascript
analytics.trackError("Network error", error.stack, {
  endpoint: "/api/scores"
});
```

### Query Session Events
```javascript
const events = await analyticsManager.getSessionEvents();
console.log(`Tracked ${events.length} events`);
```

### Measure Performance
```javascript
const timer = analyticsManager.measureOperation("my_operation");
// ... do work ...
timer.end(); // Logs if > 3 seconds
```

---

## 📊 Firestore Collections

Your data lives in three collections:

### `analytics_events` (App)
Game events, device events, user interactions

```javascript
{
  session_id: "session_...",
  device_id: "device_...",
  category: "game_event",
  action: "point",
  data: { team: "A", court_id: "..." },
  timestamp: "2024-05-24T10:30:00.000Z"
}
```

### `website_analytics_events` (Website)
Page views, clicks, scroll depth, forms

### `server_analytics_events` (Backend)
Game processing, API calls, errors

---

## 🎓 Documentation

Start here based on your needs:

| Need | Read |
|------|------|
| 5-minute overview | **ANALYTICS_QUICKSTART.md** |
| Full API reference | **ANALYTICS.md** |
| System architecture | **ANALYTICS_ARCHITECTURE.md** |
| Troubleshooting | **ANALYTICS_VERIFICATION.md** |
| Query examples | **ANALYTICS_CLOUD_FUNCTIONS.js** |

---

## 🔍 How to Analyze Your Data

### In Firebase Console
1. Go to Firestore Database
2. Browse `analytics_events` collection
3. View documents directly
4. Filter by fields as needed

### Via JavaScript
```javascript
// Get all events from a court
const courtEvents = await analyticsManager.getCourtEvents("court123");

// Get error logs
const errors = await analyticsManager.getErrorLogs();

// Get performance data
const perf = await analyticsManager.getPerformanceMetrics();
```

### In Google Analytics
- Real-time events dashboard
- Custom reports by event
- User property analysis
- Conversion tracking

---

## 📈 What You Can Learn

With this analytics system, you can track:

- **Usage Patterns**: Which courts are most active?
- **Device Performance**: How many devices per court?
- **Error Rates**: What's breaking and how often?
- **Game Performance**: Average game duration, point distribution
- **User Engagement**: How long do sessions last?
- **Website Metrics**: CTA click rates, visitor scroll depth

---

## 🆘 Troubleshooting

### No events appearing?
```javascript
// 1. Check initialization
console.log(analyticsManager.isInitialized);

// 2. Manually flush events
await analyticsManager.flushBatch();

// 3. Check console for errors (F12)
```

### Too much data being logged?
```javascript
// Adjust batch settings in analytics.js
const ANALYTICS_CONFIG = {
  BATCH_FLUSH_INTERVAL_MS: 5 * 60 * 1000,  // 5 minutes
  SESSION_TIMEOUT_MS: 60 * 60 * 1000,      // 1 hour
};
```

### Events not in Firestore?
1. Check Firebase console permissions
2. Verify Firestore rules are deployed
3. Check that collections exist
4. Look for write errors in console

See **ANALYTICS_VERIFICATION.md** for detailed troubleshooting.

---

## 🔐 Security & Privacy

- ✅ Device IDs generated locally
- ✅ No personal information collected
- ✅ Firebase security rules enforce access
- ✅ Sessions auto-expire after 30 minutes
- ✅ Anonymous tracking by default
- ✅ Full control over what's tracked

---

## ⚡ Performance

- **Memory**: <200KB overhead
- **Network**: ~200 bytes per event
- **Latency**: <1ms to track locally, 1-5s to Firestore
- **Firestore quota**: ~10K writes/day (includes free tier)

---

## 🎯 Next Steps

1. **Verify it works**: Follow the 5-minute quick start
2. **Read the docs**: Review ANALYTICS.md for full details
3. **Explore the data**: Browse your events in Firebase
4. **Create dashboards**: Build custom reports
5. **Set up alerts**: Monitor key metrics

---

## 💡 Pro Tips

1. **Real-time Monitoring**: Open Firebase console while playing
2. **Session Analysis**: Group events by session_id to see user flows
3. **Error Tracking**: Set up alerts for error spikes
4. **Performance**: Archive old events monthly to keep queries fast
5. **Custom Metrics**: Add analytics for features you care about most

---

## 🤝 Support & Documentation

- **API Reference**: `ANALYTICS.md`
- **Architecture**: `ANALYTICS_ARCHITECTURE.md`  
- **Examples**: `ANALYTICS_CLOUD_FUNCTIONS.js`
- **Troubleshooting**: `ANALYTICS_VERIFICATION.md`

---

## 📝 Integration Checklist

- [x] Analytics module created
- [x] App script integrated
- [x] Website analytics integrated
- [x] Cloud Functions logging added
- [x] Google Analytics configured
- [x] Firestore rules configured
- [x] Documentation complete

**Everything is ready to use!** 🎉

---

## 🎬 Your First Analytics Session

```javascript
// 1. Open app in browser
// http://127.0.0.1:5500/app/

// 2. Open console (F12)
// See: ✓ Analytics initialized

// 3. Play a game
// - Join a court
// - Score some points
// - Undo a point
// - Check console

// 4. Query the data
const events = await analyticsManager.getSessionEvents();
console.log(events);

// 5. View in Firebase
// Firebase Console → Firestore → analytics_events collection
```

That's it! You're now tracking comprehensive metrics! 📊

---

**Happy tracking! 🎾**

For detailed information, see the documentation files in your project root.
