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