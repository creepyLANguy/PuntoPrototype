const { db } = require("../infrastructure/firebase");
const { requireDevice, appendCourtEvent } = require("../services/eventService");
const { mapBeaconEventType, normalizeDeviceSku } = require("../services/beaconService");
const {
  SCORING_EVENTS,
  OPERATIONAL_EVENTS,
  SUPPORTED_EVENTS,
  normalizeScoreVersion,
} = require("../domain/events/validation");

function sendJson(res, status, body) {
  return res.status(status).json(body);
}

async function postEvent(req, res) {
  try {
    if (req.method !== "POST") {
      return sendJson(res, 405, { success: false, error: "Method not allowed" });
    }

    const { deviceId, eventType, courtId: targetCourtId, registeringDeviceId, deviceSKU: requestedDeviceSku } = req.body || {};

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
    const requestDeviceSku = normalizeDeviceSku(requestedDeviceSku);
    const deviceSku = requestDeviceSku || normalizeDeviceSku(actingDevice.data.deviceSKU);

    if (requestDeviceSku && requestDeviceSku !== actingDevice.data.deviceSKU) {
      await actingDevice.ref.set({ deviceSKU: requestDeviceSku }, { merge: true });
    }

    if (eventType === "SPECTATE") {
      if (!targetCourtId) {
        return sendJson(res, 400, {
          success: false,
          error: "Missing field: courtId is required for SPECTATE.",
        });
      }

      const targetCourtRef = db.doc(`courts/${targetCourtId}`);
      const targetCourtSnap = await targetCourtRef.get();
      if (!targetCourtSnap.exists) {
        return sendJson(res, 400, {
          success: false,
          error: "Court not found for courtId: " + targetCourtId,
        });
      }

      await actingDevice.ref.set({ courtId: targetCourtId }, { merge: true });

      const eventId = await appendCourtEvent(targetCourtId, {
        eventType,
        createdBy: deviceId,
        sourceCourtId: actingCourtId,
        targetCourtId,
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
        .set({ courtId: actingCourtId }, { merge: true });

      const eventId = await appendCourtEvent(actingCourtId, {
        eventType,
        createdBy: deviceId,
        actorDeviceId: deviceId,
        registeringDeviceId,
        targetCourtId: actingCourtId,
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

    // Stamp scoring events with the court's active scoreVersion. Without
    // it, onEventCreate normalizes the missing field to 0 and silently
    // skips every device-posted point/undo as "stale" once the court has
    // been reset at least once — the scoreboard then never updates.
    const actingCourtSnap = await db.doc(`courts/${actingCourtId}`).get();
    const actingCourtData = actingCourtSnap.exists ? actingCourtSnap.data() : {};

    const effectiveEventType = mapBeaconEventType(
      eventType,
      deviceSku,
      actingCourtData.beaconSidesSwapped === true,
    );

    const eventId = await appendCourtEvent(actingCourtId, {
      eventType: effectiveEventType,
      createdBy: deviceId,
      actorDeviceId: deviceId,
      scoreVersion: normalizeScoreVersion(actingCourtData.scoreVersion),
      ...(effectiveEventType !== eventType
        ? { sourceEventType: eventType, beaconSidesSwapped: true }
        : {}),
    });

    return sendJson(res, 200, { success: true, eventId });
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { success: false, error: "Error" });
  }
}

module.exports = { postEvent };
