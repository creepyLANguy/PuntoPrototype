const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const { defaultScore, applyEvent, normalizeScoringOptions, replayEvents, getCurrentServerLabel } = require("./scoringEngine");
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

function buildScoringOptions(source = {})
{
    const normalizedInput = { ...(source || {}) };
    const explicitScoringMode = typeof normalizedInput.scoringMode === "string" ? normalizedInput.scoringMode : undefined;
    const explicitDeuceMode = typeof normalizedInput.deuceMode === "string" ? normalizedInput.deuceMode : undefined;
    const explicitTiebreakMode = typeof normalizedInput.tiebreakMode === "string" ? normalizedInput.tiebreakMode : undefined;

    const options = normalizeScoringOptions({
        ...(normalizedInput.scoringOptions || {}),
        scoringMode: explicitScoringMode,
        deuceMode: explicitDeuceMode,
        tiebreakMode: explicitTiebreakMode
    });

    if (explicitScoringMode)
    {
        options.scoringMode = explicitScoringMode;
    }

    if (explicitDeuceMode)
    {
        options.deuceMode = explicitDeuceMode;
    }

    if (explicitTiebreakMode)
    {
        options.tiebreakMode = explicitTiebreakMode;
    }

    return normalizeScoringOptions(options);
}

function createTeamStatsBucket()
{
    return {
        pointsWon: 0,
        pointWinPct: 0,
        longestScoringStreak: 0,
        breakPointsFaced: 0,
        breakPointsWon: 0,
        breakPointWinPct: 0,
        breakPointConversionOpportunities: 0,
        breakPointConversions: 0,
        breakPointConversionPct: 0,
        gamesWonAfterDeuce: 0,
        gamesLostAfterDeuce: 0,
        goldenPointsWon: 0,
        goldenPointWinPct: 0,
        silverPointsWon: 0,
        silverPointWinPct: 0,
        gamePointGames: 0,
        gamePointConversions: 0,
        closingEfficiencyPct: 0
    };
}

function createSetComebackState(setNumber)
{
    return {
        setNumber,
        minDiffForA: 0,
        minScoreForA: { A: 0, B: 0 },
        minDiffForB: 0,
        minScoreForB: { A: 0, B: 0 }
    };
}

function updateSetComebackState(setState, gamesA, gamesB)
{
    const diffForA = gamesA - gamesB;
    const diffForB = gamesB - gamesA;

    if (diffForA < setState.minDiffForA)
    {
        setState.minDiffForA = diffForA;
        setState.minScoreForA = { A: gamesA, B: gamesB };
    }

    if (diffForB < setState.minDiffForB)
    {
        setState.minDiffForB = diffForB;
        setState.minScoreForB = { A: gamesA, B: gamesB };
    }
}

function maybeRecordLargestComeback(insights, setState, winner, finalSetScore)
{
    if (winner !== "A" && winner !== "B") return;

    const deficit = winner === "A"
        ? Math.max(0, -setState.minDiffForA)
        : Math.max(0, -setState.minDiffForB);

    if (deficit < 1) return;

    if (!insights.largestComeback || deficit > insights.largestComeback.deficit)
    {
        insights.largestComeback = {
            team: winner,
            deficit,
            fromScore: winner === "A" ? setState.minScoreForA : setState.minScoreForB,
            finalScore: finalSetScore,
            setNumber: setState.setNumber
        };
    }
}

function isTeamOnGamePoint(state, team, options, isTiebreakGame)
{
    if (options.scoringMode !== "standard" || isTiebreakGame)
    {
        return false;
    }

    const opponent = team === "A" ? "B" : "A";
    const ownPoints = Number(state[team]?.points) || 0;
    const oppPoints = Number(state[opponent]?.points) || 0;

    if (options.deuceMode === "golden")
    {
        if (ownPoints === 3 && oppPoints === 3) return true;
        if (ownPoints === 3 && oppPoints < 3) return true;
        return ownPoints >= 4;
    }

    if (ownPoints === 3 && oppPoints < 3) return true;
    if (ownPoints >= 4) return true;
    return false;
}

const MOMENTUM_CONFIG = Object.freeze({
    decayPerPoint: 0.94,
    clampMin: -100,
    clampMax: 100,
    recentWindowSize: 10,
    recentWeights: [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1],
    recentScale: 12,
    streakGrowthDivisor: 2,
    streakScale: 0.6,
    streakCap: 18,
    pressureScale: 1.2,
    gameWinBonus: 10,
    setWinBonus: 20,
    setCarryDecayPerPoint: 0.9
});

function clamp(value, min, max)
{
    return Math.min(max, Math.max(min, value));
}

function extractServingTeam(serverLabel)
{
    if (typeof serverLabel !== "string" || serverLabel.length === 0)
    {
        return null;
    }

    const team = serverLabel[0];
    return team === "A" || team === "B" ? team : null;
}

function buildRecentComponent(recentWinners)
{
    if (!Array.isArray(recentWinners) || recentWinners.length === 0)
    {
        return 0;
    }

    const maxLen = Math.min(MOMENTUM_CONFIG.recentWindowSize, recentWinners.length);
    const windowStart = recentWinners.length - maxLen;
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < maxLen; i++)
    {
        const winner = recentWinners[windowStart + i];
        const sign = winner === "A" ? 1 : winner === "B" ? -1 : 0;
        const ageIndex = maxLen - i - 1;
        const weight = MOMENTUM_CONFIG.recentWeights[ageIndex] ?? 0;
        weightedSum += sign * weight;
        totalWeight += weight;
    }

    if (totalWeight <= 0)
    {
        return 0;
    }

    return (weightedSum / totalWeight) * MOMENTUM_CONFIG.recentScale;
}

function buildStreakComponent(streakLength)
{
    if (!Number.isFinite(streakLength) || streakLength <= 1)
    {
        return 0;
    }

    // Non-linear growth makes short streaks noticeable and long streaks feel decisive.
    // Dividing by streakGrowthDivisor keeps the curve responsive without overwhelming other components too early.
    const rawBonus = (streakLength * streakLength) / MOMENTUM_CONFIG.streakGrowthDivisor;
    return Math.min(MOMENTUM_CONFIG.streakCap, rawBonus) * MOMENTUM_CONFIG.streakScale;
}

function classifyPressureBonus(beforeScore, scoringTeam, options)
{
    if (!beforeScore || options.scoringMode !== "standard")
    {
        return 1;
    }

    const isTiebreakGame = beforeScore.inTiebreak ||
        (options.tiebreakMode !== "off" && beforeScore.A.games === 6 && beforeScore.B.games === 6);
    if (isTiebreakGame)
    {
        return 1;
    }

    const pointsA = Number(beforeScore.A?.points) || 0;
    const pointsB = Number(beforeScore.B?.points) || 0;

    const isAdvantage = (pointsA === 4 && pointsB === 3) || (pointsB === 4 && pointsA === 3);
    const isDeuce = pointsA >= 3 && pointsB >= 3 && pointsA === pointsB;
    const isThirtyAll = pointsA === 2 && pointsB === 2;
    const gamePointA = isTeamOnGamePoint(beforeScore, "A", options, false);
    const gamePointB = isTeamOnGamePoint(beforeScore, "B", options, false);

    const serverLabel = getCurrentServerLabel(beforeScore);
    const serverTeam = extractServingTeam(serverLabel);
    const returnerTeam = serverTeam === "A" ? "B" : serverTeam === "B" ? "A" : null;
    const isBreakPoint = (returnerTeam === "A" && gamePointA) || (returnerTeam === "B" && gamePointB);
    const scoringTeamOnGamePoint = scoringTeam === "A" ? gamePointA : gamePointB;

    if (isBreakPoint || scoringTeamOnGamePoint || gamePointA || gamePointB)
    {
        return 3;
    }

    if (isAdvantage)
    {
        return 2.5;
    }

    if (isDeuce)
    {
        return 2;
    }

    if (isThirtyAll)
    {
        return 1.5;
    }

    return 1;
}

function computeMomentumTimeline(pointHistory, scoringOptions)
{
    const options = normalizeScoringOptions(scoringOptions);
    const timeline = [];
    const breakdown = [];
    let score = defaultScore(options);
    let momentum = 0;
    let streakTeam = null;
    let streakLength = 0;
    let setCarry = 0;
    const recentWinners = [];

    for (const pointWinner of pointHistory)
    {
        if (pointWinner !== "A" && pointWinner !== "B")
        {
            continue;
        }

        const oldGamesA = score.A.games;
        const oldGamesB = score.B.games;
        const oldSetsA = score.A.sets;
        const oldSetsB = score.B.sets;
        const beforeScore = JSON.parse(JSON.stringify(score));

        score = applyEvent(score, {
            eventType: pointWinner === "A" ? "POINT_TEAM_A" : "POINT_TEAM_B"
        }, options);

        // Decay first so this point is applied as fresh "current control" on top of prior state.
        momentum *= MOMENTUM_CONFIG.decayPerPoint;

        recentWinners.push(pointWinner);
        if (recentWinners.length > MOMENTUM_CONFIG.recentWindowSize)
        {
            recentWinners.shift();
        }

        if (pointWinner === streakTeam)
        {
            streakLength++;
        }
        else
        {
            streakTeam = pointWinner;
            streakLength = 1;
        }

        const pointSign = pointWinner === "A" ? 1 : -1;
        const recentComponent = buildRecentComponent(recentWinners);
        const streakComponent = buildStreakComponent(streakLength) * pointSign;
        const pressureMultiplier = classifyPressureBonus(beforeScore, pointWinner, options);
        // pressureMultiplier is in [1..3], and pressureScale controls the final pressure contribution size.
        const pressureComponent = pressureMultiplier * MOMENTUM_CONFIG.pressureScale * pointSign;
        const setCarryComponent = setCarry;

        const gameCompleted = score.A.games !== oldGamesA ||
            score.B.games !== oldGamesB ||
            score.A.sets !== oldSetsA ||
            score.B.sets !== oldSetsB;
        const gameWinner = gameCompleted ? (score.lastGameTeam || pointWinner) : null;
        const gameResultComponent = gameWinner ? (gameWinner === "A" ? 1 : -1) * MOMENTUM_CONFIG.gameWinBonus : 0;

        const setCompleted = score.A.sets !== oldSetsA || score.B.sets !== oldSetsB;
        const setWinner = setCompleted ? (score.lastSetTeam || pointWinner) : null;
        const setResultComponent = setWinner ? (setWinner === "A" ? 1 : -1) * MOMENTUM_CONFIG.setWinBonus : 0;
        if (setResultComponent !== 0)
        {
            setCarry += setResultComponent;
        }

        momentum += recentComponent;
        momentum += streakComponent;
        momentum += pressureComponent;
        momentum += gameResultComponent;
        momentum += setResultComponent;
        momentum += setCarryComponent;
        momentum = clamp(momentum, MOMENTUM_CONFIG.clampMin, MOMENTUM_CONFIG.clampMax);

        timeline.push(momentum);
        breakdown.push({
            recentPoints: recentComponent,
            currentStreak: streakComponent,
            pressurePerformance: pressureComponent,
            gameResultBonus: gameResultComponent,
            setResultBonus: setResultComponent,
            setCarryBonus: setCarryComponent,
            total: momentum
        });

        if (!setCompleted)
        {
            setCarry *= MOMENTUM_CONFIG.setCarryDecayPerPoint;
        }
        // setCarry intentionally starts decaying from the next point after a set win for an immediate post-set carryover.
    }

    return {
        timeline,
        breakdown,
        config: MOMENTUM_CONFIG
    };
}

function computeAdvancedStats(pointHistory, scoringOptions)
{
    const options = normalizeScoringOptions(scoringOptions);
    const teamStats = {
        A: createTeamStatsBucket(),
        B: createTeamStatsBucket()
    };
    const matchStats = {
        totalPoints: pointHistory.length,
        deuceGames: 0,
        goldenPointsPlayed: 0,
        silverPointsPlayed: 0,
        leadChanges: 0,
        largestComeback: null
    };

    const standardMode = options.scoringMode === "standard";
    let score = defaultScore(options);

    let streakTeam = null;
    let streakLength = 0;
    let momentum = 0;
    let previousLeader = 0;
    let currentServerTeam = "A";
    let gameContext = {
        reachedDeuce: false,
        hadGamePoint: { A: false, B: false }
    };

    let setState = createSetComebackState(1);
    updateSetComebackState(setState, 0, 0);

    for (const pointWinner of pointHistory)
    {
        if (pointWinner !== "A" && pointWinner !== "B") continue;

        const oldGamesA = score.A.games;
        const oldGamesB = score.B.games;
        const oldSetsA = score.A.sets;
        const oldSetsB = score.B.sets;
        const oldIsTiebreak = score.inTiebreak ||
            (standardMode && options.tiebreakMode !== "off" && score.A.games === 6 && score.B.games === 6);

        let isBreakPoint = false;
        let breakPointServer = null;
        let breakPointReturner = null;
        let isGoldenPoint = false;
        let isSilverPoint = false;

        if (standardMode && !oldIsTiebreak)
        {
            const pointsA = Number(score.A.points) || 0;
            const pointsB = Number(score.B.points) || 0;

            if (pointsA >= 3 && pointsB >= 3)
            {
                gameContext.reachedDeuce = true;
            }

            if (options.deuceMode === "golden" && pointsA === 3 && pointsB === 3)
            {
                isGoldenPoint = true;
                matchStats.goldenPointsPlayed++;
            }

            if (options.deuceMode === "silver" && pointsA === 3 && pointsB === 3 && (Number(score.deuceCycles) || 0) > 0)
            {
                isSilverPoint = true;
                matchStats.silverPointsPlayed++;
            }

            const gamePointA = isTeamOnGamePoint(score, "A", options, false);
            const gamePointB = isTeamOnGamePoint(score, "B", options, false);
            if (gamePointA) gameContext.hadGamePoint.A = true;
            if (gamePointB) gameContext.hadGamePoint.B = true;

            breakPointServer = currentServerTeam;
            breakPointReturner = breakPointServer === "A" ? "B" : "A";
            isBreakPoint = isTeamOnGamePoint(score, breakPointReturner, options, false);

            if (isBreakPoint)
            {
                teamStats[breakPointServer].breakPointsFaced++;
                teamStats[breakPointReturner].breakPointConversionOpportunities++;
            }
        }

        score = applyEvent(score, {
            eventType: pointWinner === "A" ? "POINT_TEAM_A" : "POINT_TEAM_B"
        }, options);

        teamStats[pointWinner].pointsWon++;

        if (isGoldenPoint)
        {
            teamStats[pointWinner].goldenPointsWon++;
        }

        if (isSilverPoint)
        {
            teamStats[pointWinner].silverPointsWon++;
        }

        if (isBreakPoint)
        {
            if (pointWinner === breakPointServer)
            {
                teamStats[breakPointServer].breakPointsWon++;
            }
            else
            {
                teamStats[breakPointReturner].breakPointConversions++;
            }
        }

        if (pointWinner === streakTeam)
        {
            streakLength++;
        }
        else
        {
            streakTeam = pointWinner;
            streakLength = 1;
        }

        teamStats[pointWinner].longestScoringStreak = Math.max(
            teamStats[pointWinner].longestScoringStreak,
            streakLength
        );

        momentum += pointWinner === "A" ? 1 : -1;
        const currentLeader = momentum > 0 ? 1 : momentum < 0 ? -1 : 0;
        if (currentLeader !== 0)
        {
            if (previousLeader !== 0 && currentLeader !== previousLeader)
            {
                matchStats.leadChanges++;
            }
            previousLeader = currentLeader;
        }

        const gameCompleted = standardMode && (
            score.A.games !== oldGamesA ||
            score.B.games !== oldGamesB ||
            score.A.sets !== oldSetsA ||
            score.B.sets !== oldSetsB
        );

        if (gameCompleted)
        {
            const gameWinner = score.lastGameTeam || pointWinner;
            const gameLoser = gameWinner === "A" ? "B" : "A";

            if (gameContext.hadGamePoint.A)
            {
                teamStats.A.gamePointGames++;
                if (gameWinner === "A") teamStats.A.gamePointConversions++;
            }

            if (gameContext.hadGamePoint.B)
            {
                teamStats.B.gamePointGames++;
                if (gameWinner === "B") teamStats.B.gamePointConversions++;
            }

            if (gameContext.reachedDeuce)
            {
                matchStats.deuceGames++;
                teamStats[gameWinner].gamesWonAfterDeuce++;
                teamStats[gameLoser].gamesLostAfterDeuce++;
            }

            const setCompleted = score.A.sets !== oldSetsA || score.B.sets !== oldSetsB;
            if (setCompleted)
            {
                const completedSet = Array.isArray(score.completedSets) && score.completedSets.length > 0
                    ? score.completedSets[score.completedSets.length - 1]
                    : null;
                const finalSetScore = completedSet
                    ? { A: Number(completedSet.A) || 0, B: Number(completedSet.B) || 0 }
                    : {
                        A: gameWinner === "A" ? oldGamesA + 1 : oldGamesA,
                        B: gameWinner === "B" ? oldGamesB + 1 : oldGamesB
                    };

                updateSetComebackState(setState, finalSetScore.A, finalSetScore.B);
                maybeRecordLargestComeback(matchStats, setState, gameWinner, finalSetScore);

                setState = createSetComebackState(setState.setNumber + 1);
                updateSetComebackState(setState, 0, 0);
            }
            else
            {
                updateSetComebackState(setState, score.A.games, score.B.games);
            }

            gameContext = {
                reachedDeuce: false,
                hadGamePoint: { A: false, B: false }
            };

            currentServerTeam = currentServerTeam === "A" ? "B" : "A";
        }
    }

    const totalPoints = Math.max(0, pointHistory.length);
    ["A", "B"].forEach((team) =>
    {
        const bucket = teamStats[team];
        bucket.pointWinPct = totalPoints > 0 ? (bucket.pointsWon / totalPoints) * 100 : 0;
        bucket.breakPointWinPct = bucket.breakPointsFaced > 0
            ? (bucket.breakPointsWon / bucket.breakPointsFaced) * 100
            : 0;
        bucket.breakPointConversionPct = bucket.breakPointConversionOpportunities > 0
            ? (bucket.breakPointConversions / bucket.breakPointConversionOpportunities) * 100
            : 0;
        bucket.goldenPointWinPct = matchStats.goldenPointsPlayed > 0
            ? (bucket.goldenPointsWon / matchStats.goldenPointsPlayed) * 100
            : 0;
        bucket.silverPointWinPct = matchStats.silverPointsPlayed > 0
            ? (bucket.silverPointsWon / matchStats.silverPointsPlayed) * 100
            : 0;
        bucket.closingEfficiencyPct = bucket.gamePointGames > 0
            ? (bucket.gamePointConversions / bucket.gamePointGames) * 100
            : 0;
    });

    return {
        teamStats,
        matchStats,
        scoringMode: options.scoringMode,
        deuceMode: options.deuceMode
    };
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
                const activeScoringOptions = buildScoringOptions({
                    ...(courtData.scoringOptions || {}),
                    scoringMode: courtData.scoringMode || courtData.scoringOptions?.scoringMode
                });
                let score = scoreSnap.exists ? scoreSnap.data() : defaultScore(activeScoringOptions);

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
                        ...defaultScore(activeScoringOptions),
                        lastEventId: eventId,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    return;
                }

                // Normal point/undo event
                const updatedScore = applyEvent(score, newEvent, activeScoringOptions);

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
        const { courtId, deepReset, newPassword, scoringMode, scoringOptions: incomingScoringOptions } = request.data;
        if (!courtId) throw new Error("Missing courtId");

        const courtRef = db.doc(`courts/${courtId}`);
        const courtDoc = await courtRef.get();
        const courtData = courtDoc.exists ? courtDoc.data() : {};
        const scoringOptions = buildScoringOptions({
            ...(courtData.scoringOptions || {}),
            ...(incomingScoringOptions || {}),
            scoringMode: scoringMode || courtData.scoringMode || courtData.scoringOptions?.scoringMode
        });

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

        const courtUpdates = {
            scoringOptions,
            scoringMode: scoringOptions.scoringMode
        };

        if (deepReset && newPassword)
        {
            courtUpdates.password = newPassword;
        }

        if (Object.keys(courtUpdates).length > 0)
        {
            await courtRef.set(courtUpdates, { merge: true });
        }

        return { success: true, archivedId: archiveId, scoringMode: scoringOptions.scoringMode, scoringOptions };
    }
);

// -----------------------------
// Update scoring options and replay events
// -----------------------------
exports.updateScoringOptions = onCall(
    { region: REGION },
    async (request) =>
    {
        const { courtId, scoringOptions: incomingScoringOptions, scoringMode } = request.data;
        if (!courtId) throw new Error("Missing courtId");

        const courtRef = db.doc(`courts/${courtId}`);
        const scoreRef = db.doc(`courts/${courtId}/score/current`);
        const eventsRef = db.collection(`courts/${courtId}/events`).orderBy("createdAt", "asc");

        const courtSnap = await courtRef.get();
        if (!courtSnap.exists)
        {
            throw new Error("Court not found");
        }

        const courtData = courtSnap.data() || {};
        const normalizedOptions = buildScoringOptions({
            ...(courtData.scoringOptions || {}),
            ...(incomingScoringOptions || {}),
            scoringMode: scoringMode || courtData.scoringMode || courtData.scoringOptions?.scoringMode
        });
        await courtRef.set({ scoringOptions: normalizedOptions, scoringMode: normalizedOptions.scoringMode }, { merge: true });

        const eventsSnap = await eventsRef.get();
        const events = eventsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        const replayedScore = replayEvents(events, normalizedOptions);

        const lastEventId = events.length > 0 ? events[events.length - 1].id : null;
        await scoreRef.set({
            ...replayedScore,
            lastEventId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
            success: true,
            scoringOptions: normalizedOptions,
            scoringMode: normalizedOptions.scoringMode,
            mode: normalizedOptions.scoringMode,
            score: replayedScore
        };
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
        const scoringOptions = buildScoringOptions({
            ...(courtData.scoringOptions || {}),
            scoringMode: courtData.scoringMode || courtData.scoringOptions?.scoringMode
        });
        const normalizedOptions = normalizeScoringOptions(scoringOptions);

        const eventsRef = db.collection(`courts/${courtId}/events`).orderBy("createdAt", "asc");
        const eventsSnap = await eventsRef.get();

        let score = defaultScore(normalizedOptions);
        let setScores = [];
        let currentSetGames = { A: 0, B: 0 };
        let pointHistory = []; // "A" or "B" for each point scored, in order
        let setPointMarkers = []; // 1-based point index where a set is won

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

                    // Remove the last recorded point from history
                    pointHistory.pop();

                    while (setPointMarkers.length > 0 && setPointMarkers[setPointMarkers.length - 1] > pointHistory.length)
                    {
                        setPointMarkers.pop();
                    }
                }
            }
            else if (event.eventType === "RESET")
            {
                score = defaultScore(normalizedOptions);
                setScores = [];
                pointHistory = [];
                setPointMarkers = [];
            }
            else
            {
                const previousTotalPoints = (Number(score.A.totalPoints) || 0) + (Number(score.B.totalPoints) || 0);
                // Normal point awarding
                score = applyEvent(score, event, normalizedOptions);
                const nextTotalPoints = (Number(score.A.totalPoints) || 0) + (Number(score.B.totalPoints) || 0);
                const pointApplied = nextTotalPoints > previousTotalPoints;

                // Track who scored this point (only POINT_TEAM_A/B contribute to momentum)
                if (event.eventType === "POINT_TEAM_A" && pointApplied)
                    pointHistory.push("A");
                else if (event.eventType === "POINT_TEAM_B" && pointApplied)
                    pointHistory.push("B");
                // Other non-reset scoring events (e.g. WARMUP) are intentionally ignored

                if (pointApplied && (event.eventType === "POINT_TEAM_A" || event.eventType === "POINT_TEAM_B") &&
                    (score.A.sets > oldSetsA || score.B.sets > oldSetsB))
                {
                    setPointMarkers.push(pointHistory.length);
                }

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

        const momentumData = computeMomentumTimeline(pointHistory, normalizedOptions);

        return {
            sets: setScores,
            currentGames: currentSetGames,
            points: { A: score.A.points, B: score.B.points },
            setsA: score.A.sets,
            setsB: score.B.sets,
            mode: normalizedOptions.scoringMode,
            scoringMode: normalizedOptions.scoringMode,
            scoringOptions: normalizedOptions,
            matchComplete: score.matchComplete,
            pointHistory,
            setPointMarkers,
            momentumTimeline: momentumData.timeline,
            momentumBreakdown: momentumData.breakdown,
            advancedStats: computeAdvancedStats(pointHistory, normalizedOptions)
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
