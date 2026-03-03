// functions/index.js

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
 * 🔥 Incremental, transaction-safe scoring
 * Triggered whenever a new event is created
 */
exports.onEventCreate = onDocumentCreated(
    {
        document: "courts/{courtId}/events/{eventId}",
        region: "africa-south1"
    },
    async (event) =>
    {

        const { courtId } = event.params;
        const newEvent = event.data?.data();

        if (!newEvent) return;

        // Prevent duplicate processing
        if (newEvent.processed) return;

        const scoreRef = db.doc(`courts/${courtId}/score/current`);
        const eventRef = event.data.ref;

        await db.runTransaction(async (tx) =>
        {

            const scoreSnap = await tx.get(scoreRef);

            let currentScore = scoreSnap.exists
                ? scoreSnap.data()
                : defaultScore();

            const updatedScore = applyEvent(currentScore, newEvent);

            tx.set(scoreRef, {
                ...updatedScore,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Mark event as processed (idempotency)
            tx.update(eventRef, { processed: true });
        });
    }
);

/**
 * 🔄 Reset court (shallow or deep)
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

        // 1️⃣ Archive events
        const archiveBatch = db.batch();

        eventsSnap.forEach(doc =>
        {
            const archiveRef = db.doc(
                `courts/${courtId}/archive/${archiveId}/events/${doc.id}`
            );

            archiveBatch.set(archiveRef, {
                ...doc.data(),
                resetType: deepReset ? "deep" : "shallow",
                resetAt: new Date().toISOString(),
                resetBy: request.auth?.uid || "system"
            });
        });

        await archiveBatch.commit();

        // 2️⃣ Delete live events
        const deleteBatch = db.batch();
        eventsSnap.forEach(doc => deleteBatch.delete(doc.ref));
        await deleteBatch.commit();

        // 3️⃣ Reset score
        await db.doc(`courts/${courtId}/score/current`)
            .set(defaultScore());

        // 4️⃣ Deep reset password
        if (deepReset && newPassword)
        {
            await db.doc(`courts/${courtId}`).update({
                password: newPassword
            });
        }

        return { success: true, archivedId: archiveId };
    }
);