const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");

const {
    defaultScore,
    applyEvent
} = require("./scoringEngine");

admin.initializeApp();
const db = admin.firestore();

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

            tx.update(eventRef, { processed: true });
        });
    }
);

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
                resetType: deepReset ? "deep" : "shallow",
                resetAt: new Date().toISOString(),
                resetBy: request.auth?.uid || "system"
            });
        });

        await archiveBatch.commit();

        const deleteBatch = db.batch();
        eventsSnap.forEach(doc => deleteBatch.delete(doc.ref));
        await deleteBatch.commit();
        await db.doc(`courts/${courtId}/score/current`)
            .set(defaultScore());

        if (deepReset && newPassword)
        {
            await db.doc(`courts/${courtId}`).update({
                password: newPassword
            });
        }

        return { success: true, archivedId: archiveId };
    }
);