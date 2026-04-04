const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const { defaultScore, applyEvent } = require("./scoringEngine");
const { onRequest } = require("firebase-functions/v2/https");

const REGION = "africa-south1";

admin.initializeApp();
const db = admin.firestore();

// -----------------------------
// Event processor
// -----------------------------
exports.onEventCreate = onDocumentCreated(
    {
        document: "courts/{courtId}/events/{eventId}",
        region: REGION
    },
    async (event) =>
    {
        const { courtId, eventId } = event.params;
        const newEvent = event.data?.data();

        console.log(`Processing event ${eventId} for court ${courtId}:`, newEvent?.eventType);

        if (!newEvent) return;

        const scoreRef = db.doc(`courts/${courtId}/score/current`);

        try
        {
            await db.runTransaction(async (tx) =>
            {
                const scoreSnap = await tx.get(scoreRef);
                let score = scoreSnap.exists ? scoreSnap.data() : defaultScore();

                if (score.lastEventId === eventId) 
                {
                    console.log(`Event ${eventId} already processed, skipping.`);
                    return;
                }

                // -----------------------------
                // Handle RESET event
                // -----------------------------
                if (newEvent.eventType === "RESET")
                {
                    console.log(`Resetting court ${courtId}`);
                    // ... (rest of reset logic remains same)
                    const eventsRef = db.collection(`courts/${courtId}/events`);
                    const eventsSnap = await eventsRef.get();
                    const archiveId = new Date().toISOString();

                    const archiveBatch = db.batch();
                    eventsSnap.forEach(doc =>
                    {
                        const archiveRef = db.doc(
                            `courts/${courtId}/archive/${archiveId}/events/${doc.id}`
                        );
                        archiveBatch.set(archiveRef, {
                            ...doc.data(),
                            archivedAt: admin.firestore.FieldValue.serverTimestamp(),
                            resetBy: newEvent.createdBy || "system"
                        });
                    });
                    await archiveBatch.commit();

                    const deleteBatch = db.batch();
                    eventsSnap.forEach(doc => deleteBatch.delete(doc.ref));
                    await deleteBatch.commit();

                    tx.set(scoreRef, {
                        ...defaultScore(),
                        lastEventId: eventId,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    return;
                }

                // Normal point/undo event
                const updatedScore = applyEvent(score, newEvent);

                console.log(`Updating score for ${courtId}. New points: A:${updatedScore.A.points}, B:${updatedScore.B.points}`);

                tx.set(scoreRef, {
                    ...updatedScore,
                    lastEventId: eventId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
        } catch (err)
        {
            console.error(`Transaction failed for event ${eventId}:`, err);
        }
    }
);

// -----------------------------
// Callable reset (shallow/deep)
// -----------------------------
exports.resetCourt = onCall(
    { region: REGION },
    async (request) =>
    {
        const { courtId, deepReset, newPassword } = request.data;
        if (!courtId) throw new Error("Missing courtId");

        const eventsRef = db.collection(`courts/${courtId}/events`);
        const eventsSnap = await eventsRef.get();
        const archiveId = new Date().toISOString();

        const archiveBatch = db.batch();
        eventsSnap.forEach(doc =>
        {
            const archiveRef = db.doc(
                `courts/${courtId}/archive/${archiveId}/events/${doc.id}`
            );
            archiveBatch.set(archiveRef, {
                ...doc.data(),
                archivedAt: admin.firestore.FieldValue.serverTimestamp(),
                resetBy: request.auth?.uid || "system"
            });
        });
        await archiveBatch.commit();

        // Delete events
        const deleteBatch = db.batch();
        eventsSnap.forEach(doc => deleteBatch.delete(doc.ref));
        await deleteBatch.commit();

        // Reset score
        await db.doc(`courts/${courtId}/score/current`).set(defaultScore());

        // Optional password reset for deep reset
        if (deepReset && newPassword)
        {
            await db.doc(`courts/${courtId}`).update({ password: newPassword });
        }

        return { success: true, archivedId: archiveId };
    }
);

// -----------------------------
// Get detailed score (replay)
// -----------------------------
exports.getDetailedScore = onCall(
    { region: REGION },
    async (request) =>
    {
        const { courtId } = request.data;
        if (!courtId) throw new Error("Missing courtId");

        const eventsRef = db.collection(`courts/${courtId}/events`).orderBy("createdAt", "asc");
        const eventsSnap = await eventsRef.get();

        let score = defaultScore();
        let setScores = [];
        // Tracks the game outcome within the CURRENT (unfinished) set
        let currentSetGames = { A: 0, B: 0 };

        eventsSnap.forEach(docSnap =>
        {
            const event = docSnap.data();
            if (event.eventType === "UNDO")
            {
                // Simple replay undo: just drop the last point if we have history
                if (score.history && score.history.length > 0)
                {
                    const prev = score.history.pop();
                    const oldSetsA = score.A.sets;
                    const oldSetsB = score.B.sets;

                    score = { ...prev, history: score.history };

                    // If a set was just undone, we need to pop the last setScore
                    if (score.A.sets < oldSetsA || score.B.sets < oldSetsB)
                    {
                        const lastResult = setScores.pop();
                        if (lastResult)
                        {
                            currentSetGames.A = lastResult.A;
                            currentSetGames.B = lastResult.B;
                        }
                    }
                    else
                    {
                        currentSetGames.A = score.A.games;
                        currentSetGames.B = score.B.games;
                    }
                }
                return;
            }

            if (event.eventType === "RESET")
            {
                score = defaultScore();
                setScores = [];
                currentSetGames = { A: 0, B: 0 };
                return;
            }

            const oldSetsA = score.A.sets;
            const oldSetsB = score.B.sets;

            score = applyEvent(score, event);

            // Did a set just finish?
            if (score.A.sets > oldSetsA || score.B.sets > oldSetsB)
            {
                // We need to know what the game score was AT THE MOMENT the set was won
                // For Padel/Tennis, it's usually 6-x or 7-x etc.
                // Since applyEvent resets games to 0, we look at the state just before reset
                const lastHistory = score.history[score.history.length - 1];
                if (lastHistory)
                {
                    // But wait, the history is the state BEFORE the winning point.
                    // If it was 5-4 40-15, history.games is 5-4.
                    // We need to know the games at the time winGame() was called.
                    // Let's rely on currentSetGames which we've been tracking?
                    // Actually, let's just use a simple logic: if a set is won, 
                    // the winning team's games in that set is usually 6 or 7.
                    // Let's improve the tracking:
                    setScores.push({ A: currentSetGames.A + (score.A.sets > oldSetsA ? 1 : 0), B: currentSetGames.B + (score.B.sets > oldSetsB ? 1 : 0) });
                    currentSetGames = { A: 0, B: 0 };
                }
            }
            else
            {
                currentSetGames.A = score.A.games;
                currentSetGames.B = score.B.games;
            }
        });

        const formattedSets = setScores.map(s => `${s.A}-${s.B}`).join(" ");
        let fullResult = formattedSets;
        if (currentSetGames.A > 0 || currentSetGames.B > 0 || (score.A.points > 0 || score.B.points > 0))
        {
            if (fullResult) fullResult += " ";
            fullResult += `${currentSetGames.A}-${currentSetGames.B}`;
        }

        // Add current points if game is in progress
        const POINTS_LABELS = [0, 15, 30, 40, "Ad"];
        if (score.A.points > 0 || score.B.points > 0)
        {
            const pA = POINTS_LABELS[score.A.points] ?? score.A.points;
            const pB = POINTS_LABELS[score.B.points] ?? score.B.points;
            fullResult += ` (${pA}-${pB})`;
        }

        return {
            scoreString: fullResult || "0-0",
            sets: setScores,
            currentGames: currentSetGames,
            points: { A: score.A.points, B: score.B.points }
        };
    }
);

// -----------------------------
// POST an event from ESP32 etc
// -----------------------------
exports.postEvent = onRequest(
    { region: "africa-south1" },
    async (req, res) =>
    {
        try
        {
            const { deviceId, eventType } = req.body;

            if (!deviceId || !eventType)
            {
                return res.status(400).send("Missing fields: both a deviceId and an eventType are required.");
            }

            if (!["POINT_TEAM_A", "POINT_TEAM_B", "UNDO"].includes(eventType))
            {
                return res.status(400).send("Invalid eventType: " + eventType);
            }

            const deviceSnap = await db.doc(`devices/${deviceId}`).get();
            if (!deviceSnap.exists)
            {
                return res.status(400).send("Device not found for deviceId: " + deviceId);
            }

            const courtId = deviceSnap.data().courtId;
            if (!courtId)
            {
                return res.status(400).send("Associated court not found for deviceId: " + deviceId);
            }

            const ref = db.collection(`courts/${courtId}/events`).doc();

            await ref.set({
                eventType,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                createdBy: deviceId
            });

            res.send({ success: true });

        } catch (err)
        {
            console.error(err);
            res.status(500).send("Error");
        }
    }
);