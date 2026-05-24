/**
 * Example Cloud Functions for Analytics Queries & Reporting
 * 
 * These functions demonstrate how to query and aggregate analytics data
 * Add these to functions/index.js and deploy with:
 * firebase deploy --only functions
 */

// =====================================================
// ANALYTICS QUERY FUNCTIONS (Add to functions/index.js)
// =====================================================

/**
 * Get analytics summary for a specific court
 * Usage: getCourtAnalyticsSummary({ courtId: "court123" })
 */
exports.getCourtAnalyticsSummary = onCall(
    { region: REGION },
    async (request) => {
        const { courtId } = request.data;
        if (!courtId) throw new Error("Missing courtId");

        try {
            // Get all game events for this court
            const q = query(
                collection(db, 'analytics_events'),
                where('data.court_id', '==', courtId),
                where('category', '==', 'game_event'),
                orderBy('timestamp', 'desc'),
                limit(1000)
            );

            const snapshot = await getDocs(q);
            const events = snapshot.docs.map(doc => doc.data());

            // Calculate statistics
            const stats = {
                court_id: courtId,
                total_events: events.length,
                points_scored: events.filter(e => e.action === 'point').length,
                games_completed: events.filter(e => e.action === 'game_won').length,
                sets_completed: events.filter(e => e.action === 'set_won').length,
                undos: events.filter(e => e.action === 'undo').length,
                resets: events.filter(e => e.action === 'reset').length,
                unique_devices: [...new Set(events.map(e => e.device_id))].length,
                unique_sessions: [...new Set(events.map(e => e.session_id))].length,
                points_by_team: {
                    A: events.filter(e => e.action === 'point' && e.data?.team === 'A').length,
                    B: events.filter(e => e.action === 'point' && e.data?.team === 'B').length
                },
                timestamp_range: {
                    first_event: events[events.length - 1]?.timestamp,
                    last_event: events[0]?.timestamp
                }
            };

            return stats;
        } catch (error) {
            console.error('Failed to get court analytics:', error);
            throw error;
        }
    }
);

/**
 * Get device statistics
 * Usage: getDeviceAnalytics({ deviceId: "device123" })
 */
exports.getDeviceAnalytics = onCall(
    { region: REGION },
    async (request) => {
        const { deviceId } = request.data;
        if (!deviceId) throw new Error("Missing deviceId");

        try {
            const q = query(
                collection(db, 'analytics_events'),
                where('device_id', '==', deviceId),
                orderBy('timestamp', 'desc'),
                limit(500)
            );

            const snapshot = await getDocs(q);
            const events = snapshot.docs.map(doc => doc.data());

            // Group by event type
            const eventCounts = {};
            const courtUsage = {};
            const sessionDates = new Set();

            events.forEach(event => {
                // Count event types
                const action = event.action || 'unknown';
                eventCounts[action] = (eventCounts[action] || 0) + 1;

                // Track court usage
                if (event.data?.court_id) {
                    courtUsage[event.data.court_id] = (courtUsage[event.data.court_id] || 0) + 1;
                }

                // Track unique session dates
                if (event.timestamp) {
                    const date = new Date(event.timestamp).toLocaleDateString();
                    sessionDates.add(date);
                }
            });

            return {
                device_id: deviceId,
                total_events: events.length,
                event_breakdown: eventCounts,
                courts_used: Object.keys(courtUsage).length,
                court_usage_detail: courtUsage,
                unique_session_dates: sessionDates.size,
                last_activity: events[0]?.timestamp,
                first_activity: events[events.length - 1]?.timestamp
            };
        } catch (error) {
            console.error('Failed to get device analytics:', error);
            throw error;
        }
    }
);

/**
 * Get overall platform analytics
 * Usage: getPlatformAnalytics({ days: 7 })
 */
exports.getPlatformAnalytics = onCall(
    { region: REGION },
    async (request) => {
        const { days = 7 } = request.data;

        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // App events
            const appQ = query(
                collection(db, 'analytics_events'),
                where('timestamp', '>=', startDate.toISOString()),
                limit(5000)
            );

            const appSnapshot = await getDocs(appQ);
            const appEvents = appSnapshot.docs.map(doc => doc.data());

            // Website events
            const webQ = query(
                collection(db, 'website_analytics_events'),
                where('timestamp', '>=', startDate.toISOString()),
                limit(5000)
            );

            const webSnapshot = await getDocs(webQ);
            const webEvents = webSnapshot.docs.map(doc => doc.data());

            // Server events
            const serverQ = query(
                collection(db, 'server_analytics_events'),
                where('timestamp', '>=', startDate.toISOString()),
                limit(5000)
            );

            const serverSnapshot = await getDocs(serverQ);
            const serverEvents = serverSnapshot.docs.map(doc => doc.data());

            // Calculate summary
            return {
                period_days: days,
                app_events: appEvents.length,
                website_events: webEvents.length,
                server_events: serverEvents.length,
                total_events: appEvents.length + webEvents.length + serverEvents.length,
                unique_devices: [...new Set([...appEvents, ...webEvents].map(e => e.device_id))].length,
                unique_sessions: [...new Set([...appEvents, ...webEvents].map(e => e.session_id))].length,
                top_event_types: getTopEventTypes(appEvents, 10),
                top_courts: getTopCourts(appEvents, 10),
                error_count: serverEvents.filter(e => e.type === 'game_event_error').length,
                api_calls: serverEvents.filter(e => e.type === 'api_call_success').length
            };
        } catch (error) {
            console.error('Failed to get platform analytics:', error);
            throw error;
        }
    }
);

/**
 * Get session details
 * Usage: getSessionDetails({ sessionId: "session_123..." })
 */
exports.getSessionDetails = onCall(
    { region: REGION },
    async (request) => {
        const { sessionId } = request.data;
        if (!sessionId) throw new Error("Missing sessionId");

        try {
            const q = query(
                collection(db, 'analytics_events'),
                where('session_id', '==', sessionId),
                orderBy('timestamp', 'asc')
            );

            const snapshot = await getDocs(q);
            const events = snapshot.docs.map(doc => doc.data());

            if (events.length === 0) {
                throw new Error("Session not found");
            }

            // Calculate session metrics
            const firstEvent = events[0];
            const lastEvent = events[events.length - 1];
            const startTime = new Date(firstEvent.timestamp);
            const endTime = new Date(lastEvent.timestamp);
            const duration = (endTime - startTime) / 1000 / 60; // in minutes

            return {
                session_id: sessionId,
                device_id: firstEvent.device_id,
                page: firstEvent.page,
                start_time: firstEvent.timestamp,
                end_time: lastEvent.timestamp,
                duration_minutes: duration.toFixed(2),
                total_events: events.length,
                event_timeline: events.map(e => ({
                    action: e.action,
                    category: e.category,
                    timestamp: e.timestamp,
                    data: e.data
                })),
                game_stats: calculateGameStats(events),
                device_events: events.filter(e => e.category === 'device_event').length
            };
        } catch (error) {
            console.error('Failed to get session details:', error);
            throw error;
        }
    }
);

/**
 * Get error report
 * Usage: getErrorReport({ days: 7 })
 */
exports.getErrorReport = onCall(
    { region: REGION },
    async (request) => {
        const { days = 7 } = request.data;

        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // Get app errors
            const appErrorQ = query(
                collection(db, 'analytics_events'),
                where('category', '==', 'error'),
                where('timestamp', '>=', startDate.toISOString()),
                orderBy('timestamp', 'desc'),
                limit(500)
            );

            const appErrors = await getDocs(appErrorQ);

            // Get server errors
            const serverErrorQ = query(
                collection(db, 'server_analytics_events'),
                where('type', '==', 'game_event_error'),
                where('timestamp', '>=', startDate.toISOString()),
                orderBy('timestamp', 'desc'),
                limit(500)
            );

            const serverErrors = await getDocs(serverErrorQ);

            // Group by error type
            const errorGroups = {};
            const allErrors = [
                ...appErrors.docs.map(d => ({ ...d.data(), source: 'app' })),
                ...serverErrors.docs.map(d => ({ ...d.data(), source: 'server' }))
            ];

            allErrors.forEach(error => {
                const key = error.error_message || error.label || 'unknown';
                if (!errorGroups[key]) {
                    errorGroups[key] = {
                        message: key,
                        count: 0,
                        first_occurrence: error.timestamp,
                        last_occurrence: error.timestamp,
                        sources: new Set()
                    };
                }
                errorGroups[key].count++;
                errorGroups[key].last_occurrence = error.timestamp;
                errorGroups[key].sources.add(error.source || 'unknown');
            });

            // Convert sets to arrays
            Object.keys(errorGroups).forEach(key => {
                errorGroups[key].sources = Array.from(errorGroups[key].sources);
            });

            return {
                period_days: days,
                total_errors: allErrors.length,
                unique_error_types: Object.keys(errorGroups).length,
                error_breakdown: errorGroups,
                most_common_errors: Object.entries(errorGroups)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 10)
                    .map(([msg, stats]) => ({ message: msg, ...stats }))
            };
        } catch (error) {
            console.error('Failed to get error report:', error);
            throw error;
        }
    }
);

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function getTopEventTypes(events, limit) {
    const counts = {};
    events.forEach(event => {
        const action = event.action || 'unknown';
        counts[action] = (counts[action] || 0) + 1;
    });

    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([action, count]) => ({ action, count }));
}

function getTopCourts(events, limit) {
    const courts = {};
    events.forEach(event => {
        if (event.data?.court_id) {
            courts[event.data.court_id] = (courts[event.data.court_id] || 0) + 1;
        }
    });

    return Object.entries(courts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([courtId, count]) => ({ court_id: courtId, event_count: count }));
}

function calculateGameStats(events) {
    const gameEvents = events.filter(e => e.category === 'game_event');

    return {
        total_game_events: gameEvents.length,
        points: gameEvents.filter(e => e.action === 'point').length,
        games: gameEvents.filter(e => e.action === 'game_won').length,
        sets: gameEvents.filter(e => e.action === 'set_won').length,
        undos: gameEvents.filter(e => e.action === 'undo').length,
        resets: gameEvents.filter(e => e.action === 'reset').length,
        points_a: gameEvents.filter(e => e.action === 'point' && e.data?.team === 'A').length,
        points_b: gameEvents.filter(e => e.action === 'point' && e.data?.team === 'B').length
    };
}

// =====================================================
// USAGE EXAMPLES
// =====================================================

/**
 * Call these from JavaScript console in your app:
 * 
 * const { httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
 * const functions = getFunctions(app, "africa-south1");
 * 
 * // Get court summary
 * const courtSummary = httpsCallable(functions, 'getCourtAnalyticsSummary');
 * const result = await courtSummary({ courtId: 'court123' });
 * console.log(result.data);
 * 
 * // Get device analytics
 * const deviceAnalytics = httpsCallable(functions, 'getDeviceAnalytics');
 * const result = await deviceAnalytics({ deviceId: 'device123' });
 * console.log(result.data);
 * 
 * // Get platform analytics (last 7 days)
 * const platformAnalytics = httpsCallable(functions, 'getPlatformAnalytics');
 * const result = await platformAnalytics({ days: 7 });
 * console.log(result.data);
 * 
 * // Get session details
 * const sessionDetails = httpsCallable(functions, 'getSessionDetails');
 * const result = await sessionDetails({ sessionId: 'session_...' });
 * console.log(result.data);
 * 
 * // Get error report
 * const errorReport = httpsCallable(functions, 'getErrorReport');
 * const result = await errorReport({ days: 7 });
 * console.log(result.data);
 */
