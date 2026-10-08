const { db, FieldValue } = require("../infrastructure/firebase");
const { buildScoringOptions } = require("../domain/scoring/modes");
const { paths } = require("../services/firestorePaths");

async function changeoverCourt(request) {
  const { courtId } = request.data || {};

  if (!courtId) throw new Error("Missing courtId");

  const courtRef = db.doc(paths.court(courtId));
  const changeoverEventId = db.collection("_changeoverEvents").doc().id;
  let nextValue;

  await db.runTransaction(async (tx) => {
    const courtSnap = await tx.get(courtRef);

    if (!courtSnap.exists) {
      throw new Error("Court not found");
    }

    const courtData = courtSnap.data() || {};
    const matchId = courtData.activeMatchId || courtData.lastMatchId;
    if (matchId) {
      const matchSnap = await tx.get(db.doc(paths.match(matchId)));
      const scoreSnap = await tx.get(db.doc(paths.matchScore(matchId)));
      const match = matchSnap.data() || {};
      const score = scoreSnap.data() || {};
      const options = buildScoringOptions({
        ...(match.scoringOptions || {}),
        scoringMode: match.scoringMode || match.scoringOptions?.scoringMode,
      });
      if (
        ["completed", "cancelled"].includes(match.status) ||
        (["fixedTotalPoints", "tiebreakTen"].includes(options.scoringMode) &&
          score.matchComplete) ||
        (options.scoringMode === "fixedTotalPoints" &&
          (Number(score.A?.points) || 0) + (Number(score.B?.points) || 0) >= options.pointsTarget)
      ) {
        throw new Error("Match has concluded; changeover is not available");
      }
    }

    const currentValue = courtData.beaconSidesSwapped === true;
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
