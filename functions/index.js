const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");

const {
    defaultScore,
    applyEvent
} = require("./scoringEngine");

admin.initializeApp();
const db = admin.firestore();

/**
 * Event processor
 *
 * Each event updates the score exactly once.
 * Idempotency is guaranteed by tracking lastEventId in the score document.
 */
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

            let score = scoreSnap.exists
                ? scoreSnap.data()
                : defaultScore();

            // Prevent double-processing
            if (score.lastEventId === eventId)
            {
                return;
            }

            const updatedScore = applyEvent(score, newEvent);

            tx.set(scoreRef, {
                ...updatedScore,
                lastEventId: eventId,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
    }
);


/**
 * Reset court
 *
 * Shallow reset:
 *   - archive events
 *   - clear events
 *   - reset score
 *
 * Deep reset:
 *   - same as shallow
 *   - optionally update password
 */
exports.resetCourt = onCall(
    {
        region: "africa-south1"
    },
    async (request) =>
    {
        const { courtId, deepReset, newPassword } = request.data;

        if (!courtId)
        {
            throw new Error("Missing courtId");
        }

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
                resetType: deepReset ? "deep" : "shallow",
                resetBy: request.auth?.uid || "system"
            });
        });

        await archiveBatch.commit();

        // Delete events
        const deleteBatch = db.batch();

        eventsSnap.forEach(doc =>
        {
            deleteBatch.delete(doc.ref);
        });

        await deleteBatch.commit();

        // Reset score
        await db.doc(`courts/${courtId}/score/current`).set(defaultScore());

        // Optional password reset
        if (deepReset && newPassword)
        {
            await db.doc(`courts/${courtId}`).update({
                password: newPassword
            });
        }

        return {
            success: true,
            archivedId: archiveId
        };
    }
);


/**
 * Optional utility
 *
 * Rebuilds the score from all events.
 * Useful if you ever change scoring rules.
 */
exports.rebuildScore = onCall(
    {
        region: "africa-south1"
    },
    async (request) =>
    {

        const { courtId } = request.data;

        if (!courtId)
        {
            throw new Error("Missing courtId");
        }

        const eventsRef = db.collection(`courts/${courtId}/events`)
            .orderBy("timestamp");

        const eventsSnap = await eventsRef.get();

        let score = defaultScore();
        let lastEventId = null;

        eventsSnap.forEach(doc =>
        {
            score = applyEvent(score, doc.data());
            lastEventId = doc.id;
        });

        await db.doc(`courts/${courtId}/score/current`).set({
            ...score,
            lastEventId,
            rebuiltAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
            success: true,
            processedEvents: eventsSnap.size
        };
    }
);