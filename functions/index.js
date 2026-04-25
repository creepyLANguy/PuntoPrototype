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
        let currentSetGames = { A: 0, B: 0 };

        eventsSnap.forEach(docSnap =>
        {
            const event = docSnap.data();
            const oldSetsA = score.A.sets;
            const oldSetsB = score.B.sets;

            if (event.eventType === "UNDO")
            {
                if (score.history && score.history.length > 0)
                {
                    // Restore state BEFORE the point was added
                    score = { ...score.history.pop(), history: score.history };

                    // If we just undid a point that had finished a set, remove that set result
                    if (score.A.sets < oldSetsA || score.B.sets < oldSetsB)
                    {
                        setScores.pop();
                    }
                }
            }
            else if (event.eventType === "RESET")
            {
                score = defaultScore();
                setScores = [];
            }
            else
            {
                // Normal point awarding
                score = applyEvent(score, event);

                // Did this point finish a set?
                if (score.A.sets > oldSetsA || score.B.sets > oldSetsB)
                {
                    // The set-winning game score is in the state BEFORE the reset (which happened in applyEvent)
                    // We can find it in the history item we just pushed
                    const lastHistory = score.history[score.history.length - 1];
                    if (lastHistory)
                    {
                        setScores.push({
                            A: lastHistory.A.games + (score.A.sets > oldSetsA ? 1 : 0),
                            B: lastHistory.B.games + (score.B.sets > oldSetsB ? 1 : 0)
                        });
                    }
                }
            }

            // Always keep currentSetGames in sync with the current (replayed) score
            currentSetGames.A = score.A.games;
            currentSetGames.B = score.B.games;
        });

        return {
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

            if (!["POINT_TEAM_A", "POINT_TEAM_B", "UNDO", "RESET", "SPECTATE", "REGISTER"].includes(eventType))
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