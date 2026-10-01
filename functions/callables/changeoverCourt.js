const { db, FieldValue } = require("../infrastructure/firebase");

async function changeoverCourt(request) {
  const { courtId } = request.data || {};

  if (!courtId) throw new Error("Missing courtId");

  const courtRef = db.doc(`courts/${courtId}`);
  const changeoverEventId = db.collection("_changeoverEvents").doc().id;
  let nextValue;

  await db.runTransaction(async (tx) => {
    const courtSnap = await tx.get(courtRef);

    if (!courtSnap.exists) {
      throw new Error("Court not found");
    }

    const currentValue = courtSnap.data()?.beaconSidesSwapped === true;
    nextValue = !currentValue;

    tx.set(
      courtRef,
      {
        beaconSidesSwapped: nextValue,
        changeoverEvent: {
          id: changeoverEventId,
          createdAt: FieldValue.serverTimestamp(),
        },
      },
      { merge: true },
    );
  });

  return {
    success: true,
    courtId,
    beaconSidesSwapped: nextValue,
    changeoverEventId,
  };
}

module.exports = { changeoverCourt };
