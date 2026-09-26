const { db } = require("../infrastructure/firebase");

async function changeoverCourt(request) {
  const { courtId, beaconSidesSwapped } = request.data || {};

  if (!courtId) throw new Error("Missing courtId");
  if (typeof beaconSidesSwapped !== "boolean") {
    throw new Error("beaconSidesSwapped must be a boolean");
  }

  const courtRef = db.doc(`courts/${courtId}`);
  let nextValue;

  await db.runTransaction(async (tx) => {
    const courtSnap = await tx.get(courtRef);

    if (!courtSnap.exists) {
      throw new Error("Court not found");
    }

    nextValue = beaconSidesSwapped;
    tx.set(
      courtRef,
      { beaconSidesSwapped: nextValue },
      { merge: true },
    );
  });

  return {
    success: true,
    courtId,
    beaconSidesSwapped: nextValue,
  };
}

module.exports = { changeoverCourt };
