const { db, FieldValue } = require("../infrastructure/firebase");

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

async function appendCourtEvent(courtId, event) {
  const ref = db.collection(`courts/${courtId}/events`).doc();
  await ref.set({
    ...event,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

module.exports = { requireDevice, appendCourtEvent };
