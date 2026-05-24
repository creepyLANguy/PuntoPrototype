# Analytics Architecture Overview

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PADEL PUSH ANALYTICS SYSTEM                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┐
│   CLIENT APPLICATIONS        │
├──────────────────────────────┤
│                              │
│  ┌──────────────────┐        │
│  │  Game App        │        │
│  │ (app/index.html) │        │
│  └────────┬─────────┘        │
│           │                  │
│           ▼                  │
│  ┌──────────────────────┐    │
│  │ analytics.js         │    │
│  │ ┌────────────────┐   │    │
│  │ │ Track Events   │   │    │
│  │ │ - Game events  │   │    │
│  │ │ - Device ev.   │   │    │
│  │ │ - Sessions     │   │    │
│  │ │ - Errors       │   │    │
│  │ └────────────────┘   │    │
│  │ ┌────────────────┐   │    │
│  │ │ Batch Process  │   │    │
│  │ │ - Collect events   │    │
│  │ │ - Flush every 60s  │    │
│  │ └────────────────┘   │    │
│  └────────┬─────────────┘    │
│           │                  │
│  ┌────────▼──────────┐       │
│  │ Landing Page     │       │
│  │ (index.html)     │       │
│  └────────┬──────────┘       │
│           │                  │
│           ▼                  │
│  ┌──────────────────────┐    │
│  │website-analytics.js  │    │
│  │ ┌────────────────┐   │    │
│  │ │ Track Events   │   │    │
│  │ │ - Page views   │   │    │
│  │ │ - Clicks       │   │    │
│  │ │ - Scroll depth │   │    │
│  │ │ - Forms        │   │    │
│  │ └────────────────┘   │    │
│  └────────┬─────────────┘    │
│           │                  │
│  ┌────────▼──────────┐       │
│  │ Cloud Functions  │       │
│  │ (functions/)     │       │
│  └────────┬──────────┘       │
│           │                  │
│           ▼                  │
│  ┌──────────────────────┐    │
│  │ logAnalyticsEvent()  │    │
│  │ ┌────────────────┐   │    │
│  │ │ Game processing│   │    │
│  │ │ API tracking   │   │    │
│  │ │ Error logging  │   │    │
│  │ └────────────────┘   │    │
└──────────┬───────────────────┘
           │
           │ Events Data
           │ JSON Objects
           │
           ▼
┌──────────────────────────────┐
│    FIREBASE INTEGRATION      │
├──────────────────────────────┤
│                              │
│  ┌──────────────────────┐    │
│  │ Google Analytics API │    │
│  │ (logEvent)           │    │
│  │ - Real-time tracking │    │
│  │ - Custom events      │    │
│  │ - User properties    │    │
│  └──────────┬───────────┘    │
│             │                │
│             ▼                │
│    ┌──────────────────────┐  │
│    │ Google Analytics     │  │
│    │ Dashboard (cloud.    │  │
│    │ google.com)          │  │
│    └──────────────────────┘  │
│                              │
│  ┌──────────────────────┐    │
│  │ Firestore Database   │    │
│  │ (punto-8888)         │    │
│  │                      │    │
│  │ Collections:         │    │
│  │ ┌──────────────┐     │    │
│  │ │analytics_    │     │    │
│  │ │events        │◄────┼──┐ │
│  │ │ (app)        │     │  │ │
│  │ └──────────────┘     │  │ │
│  │ ┌──────────────┐     │  │ │
│  │ │website_      │     │  │ │
│  │ │analytics_    │◄────┼──┤ │
│  │ │events        │     │  │ │
│  │ └──────────────┘     │  │ │
│  │ ┌──────────────┐     │  │ │
│  │ │server_       │     │  │ │
│  │ │analytics_    │◄────┼──┤ │
│  │ │events        │     │  │ │
│  │ └──────────────┘     │  │ │
│  │                      │  │ │
│  │ Document Schema:     │  │ │
│  │ {                    │  │ │
│  │   session_id,        │  │ │
│  │   device_id,         │  │ │
│  │   category,          │  │ │
│  │   action,            │  │ │
│  │   timestamp,         │  │ │
│  │   data: {...}        │  │ │
│  │ }                    │  │ │
│  └──────────────────────┘  │ │
│                            │ │
└────────────────────────────┼─┘
                             │
                             │ API Calls
                             │
                    ┌────────┴──────────┐
                    │                   │
                    ▼                   ▼
            ┌──────────────┐   ┌──────────────┐
            │  Console API │   │  Reporting   │
            │              │   │  Dashboards  │
            │ Query data:  │   │              │
            │ - Session    │   │ - Performance│
            │   events     │   │ - Errors     │
            │ - Court      │   │ - Usage      │
            │   events     │   │ - Trends     │
            │ - Device     │   │              │
            │   stats      │   │ (Custom or   │
            │              │   │  3rd party)  │
            └──────────────┘   └──────────────┘


Data Flow:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. USER ACTION (e.g., scores a point)
           │
           ▼
2. CLIENT-SIDE TRACKING (analytics.js)
   - Enriches event with context
   - Adds timestamps
   - Adds session/device IDs
           │
           ▼
3. BATCH QUEUE (in memory)
   - Collects events
   - Waits for batch size or timer
           │
           ▼
4. FLUSH TO FIREBASE
   - Sends batch to Firestore
   - Sends to Google Analytics API
   - Logs server-side event
           │
           ▼
5. FIRESTORE STORAGE
   - Stores in analytics_events
   - Server timestamp added
   - Available for queries
           │
           ▼
6. REPORTING & ANALYSIS
   - Query via console
   - View in Firebase UI
   - Google Analytics dashboard
   - Custom dashboards
```

---

## Data Model: Event Structure

```json
{
  "session_id": "session_1234567890_abc123",
  "device_id": "device_1234567890_def456",
  "user_id": "optional_user_id",
  "page": "app",
  "category": "game_event",
  "action": "point",
  "label": "POINT_TEAM_A - Team A",
  "data": {
    "event_type": "POINT_TEAM_A",
    "team": "A",
    "court_id": "court123",
    "current_score": {
      "A": { "points": 15, "games": 2, "sets": 1 },
      "B": { "points": 0, "games": 1, "sets": 0 }
    },
    "timestamp": "2024-05-24T10:30:00.000Z"
  },
  "timestamp": "2024-05-24T10:30:00.000Z",
  "url": "http://127.0.0.1:5500/app/",
  "created_at": "2024-05-24T10:30:15.123Z"  ← Firestore timestamp
}
```

---

## Module Responsibilities

```
┌─────────────────────────────────────────────────────────┐
│ app/js/firebase.js                                      │
│ ROLE: Firebase initialization & config                 │
├─────────────────────────────────────────────────────────┤
│ - Initializes Firebase app                             │
│ - Exports Firestore instance                           │
│ - Exports Google Analytics instance                    │
│ - Sets up Cloud Functions reference                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ app/js/analytics.js                                     │
│ ROLE: Main tracking & event management                 │
├─────────────────────────────────────────────────────────┤
│ - Tracks all events                                    │
│ - Manages sessions                                     │
│ - Batches and flushes events                           │
│ - Provides query methods                               │
│ - Integrates with Google Analytics                     │
│ - Monitors performance                                 │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ app/js/script.js                                        │
│ ROLE: Game logic integration                           │
├─────────────────────────────────────────────────────────┤
│ - Imports analytics module                             │
│ - Calls analytics on game events                       │
│ - Passes context to analytics                          │
│ - Initializes analytics on load                        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ js/website-analytics.js                                │
│ ROLE: Landing page tracking                            │
├─────────────────────────────────────────────────────────┤
│ - Standalone analytics module                          │
│ - Tracks website visitor behavior                      │
│ - Monitors CTAs and engagement                         │
│ - Independent from app analytics                       │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ functions/index.js                                     │
│ ROLE: Server-side logging & queries                    │
├─────────────────────────────────────────────────────────┤
│ - Logs game event processing                           │
│ - Tracks API calls                                     │
│ - Logs errors and exceptions                           │
│ - Provides analytics query endpoints                   │
└─────────────────────────────────────────────────────────┘
```

---

## Event Types Hierarchy

```
analytics_events (Collection)
├── category: "game_event"
│   ├── action: "point"
│   │   ├── label: "POINT_TEAM_A"
│   │   └── label: "POINT_TEAM_B"
│   ├── action: "game_won"
│   ├── action: "set_won"
│   ├── action: "undo"
│   ├── action: "reset"
│   └── action: "match_completed"
│
├── category: "device_event"
│   ├── action: "nfc_scan"
│   ├── action: "device_registration"
│   └── action: "spectating_started/ended"
│
├── category: "page_view"
│   ├── action: "page_view"
│   ├── action: "navigation"
│   └── action: "click"
│
├── category: "user_event"
│   ├── action: "session_end"
│   └── action: "feature_used"
│
├── category: "error"
│   └── action: "error_occurred"
│
└── category: "performance"
    ├── action: "slow_operation"
    └── action: "api_call"
```

---

## Configuration & Lifecycle

```
INITIALIZATION SEQUENCE
═════════════════════════════════════════

1. Page Load
   │
   ├─→ Firebase initialized (firebase.js)
   │
   ├─→ Analytics module loaded (analytics.js)
   │
   ├─→ analyticsManager instance created
   │   ├─→ Generate unique session ID
   │   ├─→ Generate/retrieve device ID
   │   └─→ Setup activity monitoring
   │
   ├─→ initializeAnalytics(app) called
   │   ├─→ Initialize Google Analytics
   │   ├─→ Setup session tracking
   │   ├─→ Setup batch flushing (every 60s)
   │   └─→ Track initial page view
   │
   └─→ Ready for tracking!


EVENT LIFECYCLE
═════════════════════════════════════════

ACTION OCCURS
    │
    ├─→ analyticsManager.track*() called
    │   ├─→ Create event object
    │   ├─→ Enrich with context:
    │   │   ├─→ session_id
    │   │   ├─→ device_id  
    │   │   ├─→ timestamp
    │   │   └─→ page context
    │   │
    │   ├─→ Add to event batch
    │   │
    │   └─→ Send to Google Analytics API
    │
    ├─→ Batch accumulation
    │   ├─→ Check batch size (50 events)
    │   ├─→ If reached: auto-flush
    │   └─→ Otherwise: wait for timer
    │
    ├─→ Every 60 seconds OR batch full:
    │   ├─→ flushBatch() called
    │   │
    │   ├─→ For each event in batch:
    │   │   ├─→ Write to Firestore
    │   │   │   ├─→ analytics_events (app)
    │   │   │   ├─→ website_analytics_events (web)
    │   │   │   └─→ server_analytics_events (backend)
    │   │   │
    │   │   └─→ Add Firestore timestamp
    │   │
    │   └─→ Clear batch from memory
    │
    └─→ EVENT PERSISTED & QUERYABLE


SESSION MANAGEMENT
═════════════════════════════════════════

SESSION START
    │
    ├─→ Session ID generated
    ├─→ Activity timer started
    ├─→ Monitor user interactions
    │
    └─→ Active Session (30 min max)

INACTIVITY DETECTION
    │
    ├─→ Check every 5 minutes
    ├─→ If inactive > 30 min:
    │   ├─→ Trigger endSession()
    │   ├─→ Log session metrics:
    │   │   ├─→ Duration
    │   │   ├─→ Event count
    │   │   └─→ Last activity
    │   │
    │   └─→ Flush remaining events
    │
    └─→ Session ended

USER CLOSES PAGE / APP
    │
    ├─→ beforeunload event
    ├─→ endSession() called
    ├─→ Final metrics logged
    ├─→ flushBatch() called
    │
    └─→ All data persisted
```

---

## Performance Characteristics

```
MEMORY USAGE
────────────────────────────
- Session ID: ~50 bytes
- Device ID: ~50 bytes
- Event batch (50 events): ~50KB max
- Analytics manager instance: ~100KB
- Total memory overhead: <200KB

NETWORK USAGE
────────────────────────────
- Per event to Google Analytics: ~200 bytes
- Per batch to Firestore: ~50KB
- Flush frequency: 1 per minute
- Daily traffic: ~100KB (varies with usage)

FIRESTORE QUOTA IMPACT
────────────────────────────
- Writes: 1 per event (batched)
- Reads: Query-based (on-demand)
- Estimated monthly quota:
  - 100 active devices × 100 events/day
  - = 10,000 writes/day
  - = 300,000 writes/month
  - Firestore free tier: 20,000/day = ADEQUATE for most uses

LATENCY
────────────────────────────
- Track event: <1ms (local)
- Flush to Firebase: 100-500ms
- Appear in Firestore: 1-5 seconds
- Visible in Google Analytics: 1-2 minutes
```

---

## Integration Points

```
WITH GAME APP (script.js)
─────────────────────────────
- addPoint()              → trackPoint()
- undoLastPoint()         → trackUndo()
- performShallowReset()   → trackReset()
- enterCourt()            → setCourtContext(), trackGameEvent()
- spectateCourtFromNfc()  → trackSpectating(), trackNfcScan()
- registerDevice()        → trackDeviceRegistration()
- NFC onreading          → trackNfcScan()
- Error handling         → trackError()

WITH WEBSITE (index.html)
─────────────────────────────
- Page load              → trackPageView()
- Button clicks          → trackButtonClick()
- Link clicks            → trackLinkClick()
- Scroll                 → trackScroll()
- Form input             → trackFormInteraction()
- Page unload            → trackTimeOnPage(), endSession()
- Errors                 → window error handler

WITH CLOUD FUNCTIONS (functions/index.js)
─────────────────────────────────────────
- onEventCreate          → logAnalyticsEvent()
- postEvent endpoint     → logAnalyticsEvent()
- Errors                 → logAnalyticsEvent() (error type)
```

---

This architecture ensures:
✅ Decoupled, maintainable code
✅ Efficient event batching
✅ Real-time Google Analytics
✅ Persistent Firestore records
✅ Minimal performance impact
✅ Flexible querying
✅ Scalable design
