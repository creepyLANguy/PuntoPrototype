const { db } = require("../infrastructure/firebase");
const {
  requireDevice,
  appendMatchEvent,
  appendCourtDeviceEvent,
} = require("../services/eventService");
const { ensureCourtMatch, resetMatch } = require("../services/matchService");
const { paths } = require("../services/firestorePaths");
const { validateId } = require("../services/ids");
const { mapBeaconEventType, normalizeDeviceSku } = require("../services/beaconService");
const {
  SCORING_EVENTS,
  OPERATIONAL_EVENTS,
  SUPPORTED_EVENTS,
  normalizeScoreVersion,
} = require("../domain/events/validation");
const { staleGeneration } = require("../services/errors");
const {
  pinRootGeneration,
  pinDeviceAssignment,
  runInOperationScope,
} = require("../infrastructure/dataGuard");

const ALLOWED_BROWSER_ORIGINS = new Set([
  "https://qa.padelpush.co.za",
  "https://www.padelpush.co.za",
  "https://padelpush.co.za",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
]);

function applyCors(req, res) {
  const origin =
    typeof req.get === "function" ? req.get("Origin") : req.headers?.origin || req.headers?.Origin;

  if (typeof res.set !== "function") {
    return;
  }

  if (origin && ALLOWED_BROWSER_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function postEvent(req, res) {
  applyCors(req, res);

  try {
    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    if (req.method !== "POST") {
      return sendJson(res, 405, { success: false, error: "Method not allowed" });
    }

    const {
      deviceId,
      eventType,
      courtId: targetCourtId,
      registeringDeviceId,
      deviceSKU: requestedDeviceSku,
    } = req.body || {};
    if (targetCourtId !== undefined && targetCourtId !== null) {
      try {
        validateId("court", targetCourtId);
      } catch {
        return sendJson(res, 400, { success: false, error: "Invalid courtId." });
      }
    }

    if (!deviceId || !eventType) {
      return sendJson(res, 400, {
        success: false,
        error: "Missing fields: both a deviceId and an eventType are required.",
      });
    }

    if (!SUPPORTED_EVENTS.has(eventType)) {
      return sendJson(res, 400, {
        success: false,
        error: "Invalid eventType: " + eventType,
      });
    }

    const actingDevice = await requireDevice(deviceId);
    if (!actingDevice) {
      return sendJson(res, 400, {
        success: false,
        error: "Device not found for deviceId: " + deviceId,
      });
    }

    const actingCourtId = actingDevice.data.courtId || null;
    const actingCourtAllocationId = actingDevice.data.courtAllocationId;
    pinDeviceAssignment(actingDevice.ref.path, actingDevice.data);
    let spectateSourceCourtId = actingCourtId;
    let actingCourtData = null;
    if (actingCourtId) {
      const courtPath = paths.court(actingCourtId);
      if (typeof actingCourtAllocationId !== "string" || !actingCourtAllocationId) {
        throw staleGeneration(courtPath);
      }
      if (eventType !== "SPECTATE") pinRootGeneration(courtPath, actingCourtAllocationId);
      const actingCourtSnap = await db.doc(courtPath).get();
      actingCourtData = actingCourtSnap.exists ? actingCourtSnap.data() : null;
      if (!actingCourtData || actingCourtData.allocationId !== actingCourtAllocationId) {
        if (eventType !== "SPECTATE") throw staleGeneration(courtPath);
        // Relocation leaves an invalid source behind without retaining its reference.
        spectateSourceCourtId = null;
      } else {
        pinRootGeneration(courtPath, actingCourtAllocationId);
      }
    }
    const requestDeviceSku = normalizeDeviceSku(requestedDeviceSku);
    const deviceSku = requestDeviceSku || normalizeDeviceSku(actingDevice.data.deviceSKU);
    const updateDeviceSku = requestDeviceSku && requestDeviceSku !== actingDevice.data.deviceSKU;

    if (updateDeviceSku && eventType !== "SPECTATE") {
      await actingDevice.ref.set({ deviceSKU: requestDeviceSku }, { merge: true });
    }

    if (eventType === "SPECTATE") {
      if (!targetCourtId) {
        return sendJson(res, 400, {
          success: false,
          error: "Missing field: courtId is required for SPECTATE.",
        });
      }

      const targetCourtRef = db.doc(paths.court(targetCourtId));
      const targetCourtSnap = await targetCourtRef.get();
      if (!targetCourtSnap.exists) {
        return sendJson(res, 400, {
          success: false,
          error: "Court not found for courtId: " + targetCourtId,
        });
      }
      const targetCourtAllocationId = targetCourtSnap.data()?.allocationId;
      pinRootGeneration(paths.court(targetCourtId), targetCourtAllocationId);
      if (updateDeviceSku) {
        await actingDevice.ref.set({ deviceSKU: requestDeviceSku }, { merge: true });
      }

      await actingDevice.ref.set(
        { courtId: targetCourtId, courtAllocationId: targetCourtAllocationId },
        { merge: true },
      );

      const eventId = await appendCourtDeviceEvent(targetCourtId, {
        eventType,
        createdBy: deviceId,
        sourceCourtId: spectateSourceCourtId,
        sourceCourtAllocationId: spectateSourceCourtId ? actingCourtAllocationId : null,
        targetCourtId,
        targetCourtAllocationId,
        actorDeviceId: deviceId,
      });

      return sendJson(res, 200, {
        success: true,
        eventId,
        courtId: targetCourtId,
        deviceId,
      });
    }

    if (eventType === "REGISTER") {
      if (!registeringDeviceId) {
        return sendJson(res, 400, {
          success: false,
          error: "Missing field: registeringDeviceId is required for REGISTER.",
        });
      }

      if (!actingCourtId) {
        return sendJson(res, 400, {
          success: false,
          error: "Associated court not found for deviceId: " + deviceId,
        });
      }

      await db
        .doc(`devices/${registeringDeviceId}`)
        .set(
          { courtId: actingCourtId, courtAllocationId: actingCourtAllocationId },
          { merge: true },
        );

      const eventId = await appendCourtDeviceEvent(actingCourtId, {
        eventType,
        createdBy: deviceId,
        actorDeviceId: deviceId,
        registeringDeviceId,
        targetCourtId: actingCourtId,
        targetCourtAllocationId: actingCourtAllocationId,
      });

      return sendJson(res, 200, {
        success: true,
        eventId,
        courtId: actingCourtId,
        deviceId,
        registeringDeviceId,
      });
    }

    if (!actingCourtId) {
      return sendJson(res, 400, {
        success: false,
        error: "Associated court not found for deviceId: " + deviceId,
      });
    }

    // Scoring events go to the match currently on the device's court; a
    // court without one gets a casual match. The match's active scoreVersion
    // is stamped on the event: without it onEventCreate normalizes the
    // missing field to 0 and silently skips every device-posted point/undo
    // as "stale" once the match has been reset at least once.
    let matchId = actingCourtData.activeMatchId || null;
    let matchData = null;
    if (matchId) {
      pinRootGeneration(paths.match(matchId), actingCourtData.activeMatchAllocationId);
      const matchSnap = await db.doc(paths.match(matchId)).get();
      matchData = matchSnap.exists ? matchSnap.data() : null;
      if (!matchData || matchData.allocationId !== actingCourtData.activeMatchAllocationId) {
        throw staleGeneration(paths.match(matchId));
      }
      if (!matchData || matchData.status !== "live" || matchData.currentCourtId !== actingCourtId) {
        matchId = null;
      }
    }
    if (!matchId) {
      ({ matchId } = await ensureCourtMatch({
        courtId: actingCourtId,
        actor: { type: "device", uid: null },
      }));
      const [matchSnap, refreshedCourtSnap] = await Promise.all([
        db.doc(paths.match(matchId)).get(),
        db.doc(paths.court(actingCourtId)).get(),
      ]);
      matchData = matchSnap.exists ? matchSnap.data() : {};
      actingCourtData.beaconSidesSwapped = refreshedCourtSnap.data()?.beaconSidesSwapped === true;
    }

    if (eventType === "RESET" && matchData?.tournamentId) {
      return sendJson(res, 403, {
        success: false,
        error: "Tournament matches must be reset through the authorized reset flow.",
      });
    }

    if (eventType === "RESET") {
      await resetMatch({
        matchId,
        actor: { type: "device", uid: deviceId },
        reason: "Device reset",
      });
      return sendJson(res, 200, { success: true, matchId, courtId: actingCourtId });
    }

    const effectiveEventType = mapBeaconEventType(
      eventType,
      deviceSku,
      actingCourtData.beaconSidesSwapped === true,
    );

    const eventId = await appendMatchEvent(matchId, {
      eventType: effectiveEventType,
      createdBy: deviceId,
      actorDeviceId: deviceId,
      courtId: actingCourtId,
      courtAllocationId: actingCourtAllocationId,
      scoreVersion: normalizeScoreVersion(matchData?.scoreVersion),
      // Binds the event to this match generation (see processScoreEvent).
      allocationId: matchData?.allocationId ?? null,
      ...(effectiveEventType !== eventType
        ? { sourceEventType: eventType, beaconSidesSwapped: true }
        : {}),
    });

    return sendJson(res, 200, { success: true, eventId, matchId, courtId: actingCourtId });
  } catch (err) {
    if (err?.details?.code === "STALE_GENERATION") {
      return sendJson(res, 409, { success: false, error: err.message });
    }
    console.error(err);
    return sendJson(res, 500, { success: false, error: "Error" });
  }
}

module.exports = {
  postEvent: (...args) => runInOperationScope(() => postEvent(...args)),
};
