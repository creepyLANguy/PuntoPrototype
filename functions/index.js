const { computeScoreFromEvents, defaultScore } = require("./scoringEngine");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { computeScoreFromEvents, defaultScore } = require("./scoringEngine");

admin.initializeApp();
const db = admin.firestore();

exports.resetCourt = functions.https.onCall(async (data, context) =>
{
    const { courtId, deepReset, newPassword } = data;

    if (!courtId)
        throw new functions.https.HttpsError("invalid-argument", "Missing courtId");

    const eventsSnap = await db
        .collection(`courts/${courtId}/events`)
        .get();

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
            resetBy: context.auth?.uid || "system"
        });
    });

    await archiveBatch.commit();

    // 2️⃣ Delete live events
    const deleteBatch = db.batch();
    eventsSnap.forEach(doc => deleteBatch.delete(doc.ref));
    await deleteBatch.commit();

    // 3️⃣ Reset score explicitly
    await db.doc(`courts/${courtId}/score`).set(defaultScore());

    // 4️⃣ Update password if deep reset
    if (deepReset && newPassword)
    {
        await db.doc(`courts/${courtId}`).update({
            password: newPassword
        });
    }

    return { success: true, archivedId: archiveId };
});