const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const { defaultScore, applyEvent, normalizeScoringOptions, replayEvents } = require("./scoringEngine");
const { onRequest } = require("firebase-functions/v2/https");

const REGION = "africa-south1";
const SCORING_EVENTS = new Set(["POINT_TEAM_A", "POINT_TEAM_B", "UNDO", "RESET"]);
const OPERATIONAL_EVENTS = new Set(["SPECTATE", "REGISTER"]);
const SUPPORTED_EVENTS = new Set([...SCORING_EVENTS, ...OPERATIONAL_EVENTS]);

admin.initializeApp();
const db = admin.firestore();

function sendJson(res, status, body)
{
    return res.status(status).json(body);
}

async function requireDevice(deviceId)
{
    const deviceRef = db.doc(`devices/${deviceId}`);
    const deviceSnap = await deviceRef.get();

    if (!deviceSnap.exists)
    {
        return null;
    }

    return {
        ref: deviceRef,
        snap: deviceSnap,
        data: deviceSnap.data() || {}
    };
}

async function appendCourtEvent(courtId, event)
{
    const ref = db.collection(`courts/${courtId}/events`).doc();
    await ref.set({
        ...event,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return ref.id;
}

// -----------------------------
// Event processor
// -----------------------------
exports.onEventCreate = onDocumentCreated(
    {
        document: "courts/{courtId}/events/{eventId}",
        region: REGION
    },
    async (event) =>
    {
        const { courtId, eventId } = event.params;
        const newEvent = event.data?.data();

        console.log(`Processing event ${eventId} for court ${courtId}:`, newEvent?.eventType);

        if (!newEvent) return;

        if (!SCORING_EVENTS.has(newEvent.eventType))
        {
            console.log(`Ignoring non-scoring event ${eventId} (${newEvent.eventType}) for score processing.`);
            return;
        }

        const scoreRef = db.doc(`courts/${courtId}/score/current`);

        try
        {
            await db.runTransaction(async (tx) =>
            {
                const courtRef = db.doc(`courts/${courtId}`);
                const courtSnap = await tx.get(courtRef);
                const courtData = courtSnap.exists ? courtSnap.data() : {};
                const scoreSnap = await tx.get(scoreRef);
                let score = scoreSnap.exists ? scoreSnap.data() : defaultScore(courtData.scoringOptions);

                if (score.lastEventId === eventId)
                {
                    console.log(`Event ${eventId} already processed, skipping.`);
                    return;
                }

                // -----------------------------
                // Handle RESET event
                // -----------------------------
                if (newEvent.eventType === "RESET")
                {
                    console.log(`Resetting court ${courtId}`);
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
                            archivedAt: admin.firestore.FieldValue.serverTimestamp(),
                            resetBy: newEvent.createdBy || "system"
                        });
                    });
                    await archiveBatch.commit();

                    const deleteBatch = db.batch();
                    eventsSnap.forEach(doc => deleteBatch.delete(doc.ref));
                    await deleteBatch.commit();

                    tx.set(scoreRef, {
                        ...defaultScore(score.scoringOptions || courtData.scoringOptions),
                        lastEventId: eventId,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    return;
                }

                // Normal point/undo event
                const updatedScore = applyEvent(score, newEvent, score.scoringOptions || courtData.scoringOptions);

                console.log(`Updating score for ${courtId}. New points: A:${updatedScore.A.points}, B:${updatedScore.B.points}`);

                tx.set(scoreRef, {
                    ...updatedScore,
                    lastEventId: eventId,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            });
        } catch (err)
        {
            console.error(`Transaction failed for event ${eventId}:`, err);
        }
    }
);

// -----------------------------
// Callable reset (shallow/deep)
// -----------------------------
exports.resetCourt = onCall(
    { region: REGION },
    async (request) =>
    {
        const { courtId, deepReset, newPassword } = request.data;
        if (!courtId) throw new Error("Missing courtId");

        const courtDoc = await db.doc(`courts/${courtId}`).get();
        const courtData = courtDoc.exists ? courtDoc.data() : {};
        const scoringOptions = courtData.scoringOptions || undefined;

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
                archivedAt: admin.firestore.FieldValue.serverTimestamp(),
                resetBy: request.auth?.uid || "system"
            });
        });
        await archiveBatch.commit();

        // Delete events
        const deleteBatch = db.batch();
        eventsSnap.forEach(doc => deleteBatch.delete(doc.ref));
        await deleteBatch.commit();

        // Reset score
        await db.doc(`courts/${courtId}/score/current`).set(defaultScore(scoringOptions));

        // Optional password reset for deep reset
        if (deepReset && newPassword)
        {
            await db.doc(`courts/${courtId}`).update({ password: newPassword });
        }

        return { success: true, archivedId: archiveId };
    }
);

// -----------------------------
// Update scoring options and replay events
// -----------------------------
exports.updateScoringOptions = onCall(
    { region: REGION },
    async (request) =>
    {
        const { courtId, scoringOptions } = request.data;
        if (!courtId) throw new Error("Missing courtId");
        if (!scoringOptions) throw new Error("Missing scoringOptions");

        const courtRef = db.doc(`courts/${courtId}`);
        const scoreRef = db.doc(`courts/${courtId}/score/current`);
        const eventsRef = db.collection(`courts/${courtId}/events`).orderBy("createdAt", "asc");

        const courtSnap = await courtRef.get();
        if (!courtSnap.exists)
        {
            throw new Error("Court not found");
        }

        const normalizedOptions = normalizeScoringOptions(scoringOptions);
        await courtRef.update({ scoringOptions: normalizedOptions });

        const eventsSnap = await eventsRef.get();
        const events = eventsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const replayedScore = replayEvents(events, normalizedOptions);

        await scoreRef.set({
            ...replayedScore,
            lastEventId: replayedScore.lastEventId || null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, scoringOptions: normalizedOptions };
    }
);

// -----------------------------
// Get detailed score (replay)
// -----------------------------
exports.getDetailedScore = onCall(
    { region: REGION },
    async (request) =>
    {
        const { courtId } = request.data;
        if (!courtId) throw new Error("Missing courtId");

        const courtSnap = await db.doc(`courts/${courtId}`).get();
        const courtData = courtSnap.exists ? courtSnap.data() : {};
        const scoringOptions = courtData.scoringOptions || undefined;
        const normalizedOptions = normalizeScoringOptions(scoringOptions);

        const eventsRef = db.collection(`courts/${courtId}/events`).orderBy("createdAt", "asc");
        const eventsSnap = await eventsRef.get();

        let score = defaultScore(normalizedOptions);
        let setScores = [];
        let currentSetGames = { A: 0, B: 0 };

        eventsSnap.forEach(docSnap =>
        {
            const event = docSnap.data();
            const oldSetsA = score.A.sets;
            const oldSetsB = score.B.sets;

            if (event.eventType === "UNDO")
            {
                if (score.history && score.history.length > 0)
                {
                    // Restore state BEFORE the point was added
                    score = { ...score.history.pop(), history: score.history };

                    // If we just undid a point that had finished a set, remove that set result
                    if (score.A.sets < oldSetsA || score.B.sets < oldSetsB)
                    {
                        setScores.pop();
                    }
                }
            }
            else if (event.eventType === "RESET")
            {
                score = defaultScore(normalizedOptions);
                setScores = [];
            }
            else
            {
                // Normal point awarding
                score = applyEvent(score, event, normalizedOptions);

                // Did this point finish a set? (Only track this actively in standard format)
                if (normalizedOptions.scoringMode === "standard") {
                    if (score.A.sets > oldSetsA || score.B.sets > oldSetsB)
                    {
                        const lastHistory = score.history[score.history.length - 1];
                        if (lastHistory)
                        {
                            setScores.push({
                                A: lastHistory.A.games + (score.A.sets > oldSetsA ? 1 : 0),
                                B: lastHistory.B.games + (score.B.sets > oldSetsB ? 1 : 0)
                            });
                        }
                    }
                }
            }

            // Always keep currentSetGames in sync with the current (replayed) score
            currentSetGames.A = score.A.games;
            currentSetGames.B = score.B.games;
        });

        return {
            sets: setScores,
            currentGames: currentSetGames,
            points: { A: score.A.points, B: score.B.points },
            setsA: score.A.sets,
            setsB: score.B.sets,
            mode: normalizedOptions.scoringMode,
            matchComplete: score.matchComplete
        };
    }
);

// -----------------------------
// POST an event from ESP32 etc
// -----------------------------
exports.postEvent = onRequest(
    { region: "africa-south1" },
    async (req, res) =>
    {
        try
        {
            if (req.method !== "POST")
            {
                return sendJson(res, 405, { success: false, error: "Method not allowed" });
            }

            const { deviceId, eventType, courtId: targetCourtId, registeringDeviceId } = req.body || {};

            if (!deviceId || !eventType)
            {
                return sendJson(res, 400, {
                    success: false,
                    error: "Missing fields: both a deviceId and an eventType are required."
                });
            }

            if (!SUPPORTED_EVENTS.has(eventType))
            {
                return sendJson(res, 400, {
                    success: false,
                    error: "Invalid eventType: " + eventType
                });
            }

            const actingDevice = await requireDevice(deviceId);
            if (!actingDevice)
            {
                return sendJson(res, 400, {
                    success: false,
                    error: "Device not found for deviceId: " + deviceId
                });
            }

            const actingCourtId = actingDevice.data.courtId || null;

            if (eventType === "SPECTATE")
            {
                if (!targetCourtId)
                {
                    return sendJson(res, 400, {
                        success: false,
                        error: "Missing field: courtId is required for SPECTATE."
                    });
                }

                const targetCourtRef = db.doc(`courts/${targetCourtId}`);
                const targetCourtSnap = await targetCourtRef.get();
                if (!targetCourtSnap.exists)
                {
                    return sendJson(res, 400, {
                        success: false,
                        error: "Court not found for courtId: " + targetCourtId
                    });
                }

                await actingDevice.ref.set({ courtId: targetCourtId }, { merge: true });

                const eventId = await appendCourtEvent(targetCourtId, {
                    eventType,
                    createdBy: deviceId,
                    sourceCourtId: actingCourtId,
                    targetCourtId,
                    actorDeviceId: deviceId
                });

                return sendJson(res, 200, {
                    success: true,
                    eventId,
                    courtId: targetCourtId,
                    deviceId
                });
            }

            if (eventType === "REGISTER")
            {
                if (!registeringDeviceId)
                {
                    return sendJson(res, 400, {
                        success: false,
                        error: "Missing field: registeringDeviceId is required for REGISTER."
                    });
                }

                if (!actingCourtId)
                {
                    return sendJson(res, 400, {
                        success: false,
                        error: "Associated court not found for deviceId: " + deviceId
                    });
                }

                await db.doc(`devices/${registeringDeviceId}`).set(
                    { courtId: actingCourtId },
                    { merge: true }
                );

                const eventId = await appendCourtEvent(actingCourtId, {
                    eventType,
                    createdBy: deviceId,
                    actorDeviceId: deviceId,
                    registeringDeviceId,
                    targetCourtId: actingCourtId
                });

                return sendJson(res, 200, {
                    success: true,
                    eventId,
                    courtId: actingCourtId,
                    deviceId,
                    registeringDeviceId
                });
            }

            if (!actingCourtId)
            {
                return sendJson(res, 400, {
                    success: false,
                    error: "Associated court not found for deviceId: " + deviceId
                });
            }

            const eventId = await appendCourtEvent(actingCourtId, {
                eventType,
                createdBy: deviceId,
                actorDeviceId: deviceId
            });

            return sendJson(res, 200, { success: true, eventId });

        } catch (err)
        {
            console.error(err);
            return sendJson(res, 500, { success: false, error: "Error" });
        }
    }
);
