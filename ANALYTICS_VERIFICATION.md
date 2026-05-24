# Analytics Implementation Verification Checklist

## ✅ Pre-Flight Checks

### Files Created
- [x] `app/js/analytics.js` - Main analytics module
- [x] `js/website-analytics.js` - Website analytics
- [x] `ANALYTICS.md` - Full documentation
- [x] `ANALYTICS_QUICKSTART.md` - Quick start guide
- [x] `ANALYTICS_CLOUD_FUNCTIONS.js` - Cloud Function examples
- [x] `firestore.rules` - Security rules
- [x] `ANALYTICS_IMPLEMENTATION.md` - Implementation summary

### Code Integration
- [x] `app/js/firebase.js` - Updated with Google Analytics
- [x] `app/js/script.js` - Analytics tracking integrated
- [x] `index.html` - Website analytics script added
- [x] `functions/index.js` - Server-side logging added

---

## 🧪 Testing Steps

### Step 1: Verify Initialization
Open browser console (F12) while in the app:

```javascript
// Should see this message in console:
// ✓ Analytics initialized { sessionId: '...', deviceId: '...' }

// Verify analytics manager exists
console.log(analyticsManager);
console.log(analyticsManager.isInitialized); // Should be true
```

**Expected Result**: ✓ Analytics manager initialized successfully

---

### Step 2: Test App Analytics
While in the game (http://127.0.0.1:5500/app/):

1. Create or join a court
2. Score some points (click Team A or B buttons)
3. Check console for any errors
4. Run in console:
   ```javascript
   const events = await analyticsManager.getSessionEvents();
   console.log("Events logged:", events.length);
   console.log(events);
   ```

**Expected Result**: ✓ See events with action: "point", category: "game_event"

---

### Step 3: Test Website Analytics
On landing page (http://127.0.0.1:5500/):

1. Open console (F12)
2. Check for initialization message
3. Click some buttons
4. Run in console:
   ```javascript
   console.log("Website Analytics Session:", websiteAnalytics.sessionId);
   console.log("Page title:", document.title);
   ```

**Expected Result**: ✓ Website analytics initialized

---

### Step 4: Check Firebase Console
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select `punto-8888` project
3. Go to **Firestore Database**
4. Look for these collections:
   - `analytics_events` ← App events
   - `website_analytics_events` ← Website events
   - `server_analytics_events` ← Backend logs

5. Click on `analytics_events` collection
6. You should see documents with your game events

**Expected Result**: ✓ See documents with event data

---

### Step 5: Check Google Analytics (Optional)
1. Go to [Google Analytics](https://analytics.google.com/)
2. Look for property: `punto-8888`
3. Go to **Real-time** → **Events**
4. Score some points in app
5. Should see `game_event` and `point` appear in real-time

**Expected Result**: ✓ Events showing in Google Analytics

---

## 🔍 Debugging

### If analytics not working:

#### Check 1: Console Errors
```javascript
// Look for any red errors in console
// Common issues:
// - CORS errors (check Cloud Functions region)
// - Firebase not initialized
// - Missing collections in Firestore
```

#### Check 2: Verify Firebase Config
```javascript
// In browser console:
import { firebaseConfig } from "./app/js/firebase-config.js";
console.log(firebaseConfig);
// Should show your Firebase project details
```

#### Check 3: Check Firestore Permissions
```javascript
// Try to manually write an event:
import { db } from "./app/js/firebase.js";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

await addDoc(collection(db, 'analytics_events'), {
  test: true,
  timestamp: new Date().toISOString(),
  created_at: serverTimestamp()
});
```

#### Check 4: Verify Batch Flush
```javascript
// Force analytics batch to flush immediately:
await analyticsManager.flushBatch();
console.log("Batch flushed!");
```

---

## 📊 Verification Queries

### Count events by type
```javascript
// In Firebase Console Firestore
db.collection('analytics_events')
  .where('category', '==', 'game_event')
  .count()
  .get()
```

### Get recent events
```javascript
// List last 100 events
db.collection('analytics_events')
  .orderBy('timestamp', 'desc')
  .limit(100)
  .get()
```

### Filter by court
```javascript
// Get all events for a court
db.collection('analytics_events')
  .where('data.court_id', '==', 'your_court_id')
  .get()
```

---

## 🚨 Common Issues & Fixes

### Issue: "Analytics is not initialized"
**Cause**: initializeAnalytics() wasn't called
**Fix**: Check that import and initialization in script.js executed properly
```javascript
// Should see in console:
// ✓ Analytics initialized
```

### Issue: "No documents in analytics_events"
**Cause**: Events haven't been flushed to Firestore yet
**Fix**: Wait 60 seconds or call:
```javascript
await analyticsManager.flushBatch();
```

### Issue: "getSessionEvents returns empty"
**Cause**: Query might need indexes
**Fix**: Create Firestore index when prompted, or use simpler query

### Issue: "Firestore write permission denied"
**Cause**: Security rules blocking writes
**Fix**: Deploy the provided `firestore.rules` file
```bash
firebase deploy --only firestore:rules
```

### Issue: "Cannot read property of undefined"
**Cause**: analyticsManager not imported
**Fix**: Check imports in script.js:
```javascript
import { getAnalyticsManager } from "./analytics.js";
```

---

## 📈 Performance Checks

### Check batch size
```javascript
console.log("Current batch size:", analyticsManager.eventBatch.length);
```

### Monitor session duration
```javascript
const duration = new Date() - analyticsManager.sessionStart;
console.log("Session duration (ms):", duration);
```

### Check flush interval
```javascript
// Should flush every 60 seconds
// Monitor Firebase usage to confirm
```

---

## 🎯 Success Criteria

Your analytics system is working if:

1. ✓ Console shows `✓ Analytics initialized` message
2. ✓ Firebase Firestore has `analytics_events` collection
3. ✓ Events appear in Firestore within 60 seconds of action
4. ✓ No errors in browser console
5. ✓ `analyticsManager` is accessible in console
6. ✓ `getSessionEvents()` returns events

---

## 📝 Next Steps After Verification

1. **Read the full docs**: `ANALYTICS.md`
2. **Try examples**: `ANALYTICS_QUICKSTART.md`
3. **Deploy Cloud Functions**: See `ANALYTICS_CLOUD_FUNCTIONS.js`
4. **Build dashboard**: Query analytics for insights
5. **Set up alerts**: Monitor key metrics

---

## 🆘 Still Having Issues?

1. Check the [ANALYTICS.md](./ANALYTICS.md) troubleshooting section
2. Review console for specific error messages
3. Verify Firebase project permissions
4. Check that Firestore rules are deployed
5. Look at Cloud Functions logs for server errors

---

**Ready to go!** 🚀

Once verified, you have a fully functional analytics system tracking:
- Every point scored
- Every game event
- Every device interaction
- Every error
- Every user session
- Website visitor behavior

Happy tracking! 🎾📊
