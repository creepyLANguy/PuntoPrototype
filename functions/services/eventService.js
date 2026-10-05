const { db, FieldValue } = require("../infrastructure/firebase");
const { paths } = require("./firestorePaths");

async function requireDevice(deviceId) {
  const deviceRef = db.doc(`devices/${deviceId}`);
  const deviceSnap = await deviceRef.get();

  if (!deviceSnap.exists) {
    return null;
  }

  return {
    ref: deviceRef,
    snap: deviceSnap,
    data: deviceSnap.data() || {},
  };
}

// Scoring events belong to the match. The court on the event is audit
// context only; replay never depends on it.
async function appendMatchEvent(matchId, event) {
  const ref = db.collection(paths.matchEvents(matchId)).doc();
  await ref.set({
    ...event,
    matchId,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

// Operational device events (SPECTATE, REGISTER) are court-scoped audit
// records and never part of a score.
async function appendCourtDeviceEvent(courtId, event) {
  const ref = db.collection(paths.courtDeviceEvents(courtId)).doc();
  await ref.set({
    ...event,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

module.exports = { requireDevice, appendMatchEvent, appendCourtDeviceEvent };
