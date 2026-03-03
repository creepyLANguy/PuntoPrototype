const admin = require("firebase-admin");

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");

const { defaultScore, computeScoreFromEvents } = require("./scoringEngine");

admin.initializeApp();
const db = admin.firestore();

exports.onEventWrite = onDocumentCreated(
  "courts/{courtId}/events/{eventId}",
  async (event) =>
  {
    const newEvent = event.data.data();
    if (newEvent.processed) return;

    const { courtId } = event.params;
    const scoreRef = db.doc(`courts/${courtId}/score/current`);

    await db.runTransaction(async (tx) =>
    {
      const scoreSnap = await tx.get(scoreRef);

      let currentScore = scoreSnap.exists
        ? scoreSnap.data()
        : defaultScore();

      const updatedScore = applyEvent(currentScore, newEvent);

      tx.set(scoreRef, {
        ...updatedScore,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.update(event.ref, { processed: true });
    });
  }
);

exports.resetCourt = onCall(async (request) =>
{

  const { courtId, deepReset, newPassword } = request.data;

  if (!courtId)
  {
    throw new Error("Missing courtId");
  }

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
      resetBy: request.auth?.uid || "system"
    });
  });

  await archiveBatch.commit();

  // 2️⃣ Delete events
  const deleteBatch = db.batch();
  eventsSnap.forEach(doc => deleteBatch.delete(doc.ref));
  await deleteBatch.commit();

  // 3️⃣ Reset score
  await db.doc(`courts/${courtId}/score`).set(defaultScore());

  // 4️⃣ Deep reset password
  if (deepReset && newPassword)
  {
    await db.doc(`courts/${courtId}`).update({
      password: newPassword
    });
  }

  return { success: true, archivedId: archiveId };
});