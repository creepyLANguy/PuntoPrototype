const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");

const { defaultScore, applyEvent } = require("./scoringEngine");

admin.initializeApp();
const db = admin.firestore();

// -----------------------------
// Event processor
// -----------------------------
exports.onEventCreate = onDocumentCreated(
    {
        document: "courts/{courtId}/events/{eventId}",
        region: "africa-south1"
    },
    async (event) =>
    {
        const { courtId, eventId } = event.params;
        const newEvent = event.data?.data();

        if (!newEvent) return;

        const scoreRef = db.doc(`courts/${courtId}/score/current`);

        await db.runTransaction(async (tx) =>
        {
            const scoreSnap = await tx.get(scoreRef);
            let score = scoreSnap.exists ? scoreSnap.data() : defaultScore();

            if (score.lastEventId === eventId) return;

            // -----------------------------
            // Handle RESET event
            // -----------------------------
            if (newEvent.eventType === "RESET")
            {
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

                // Delete all events
                const deleteBatch = db.batch();
                eventsSnap.forEach(doc => deleteBatch.delete(doc.ref));
                await deleteBatch.commit();

                // Reset score
                tx.set(scoreRef, {
                    ...defaultScore(),
                    lastEventId: eventId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                return;
            }

            // Normal point/undo event
            const updatedScore = applyEvent(score, newEvent);
            tx.set(scoreRef, {
                ...updatedScore,
                lastEventId: eventId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
    }
);

// -----------------------------
// Callable reset (shallow/deep)
// -----------------------------
exports.resetCourt = onCall(
    { region: "africa-south1" },
    async (request) =>
    {
        const { courtId } = request.data;
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
