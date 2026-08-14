const admin = require("firebase-admin");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall } = require("firebase-functions/v2/https");
const {
    defaultScore,
    applyEvent,
    normalizeScoringOptions,
    replayEvents,
    getCurrentServerLabel,
    toLiveScorePayload,
    getEventOrderingTuple,
    compareEventOrder,
    scoreEquivalent,
    didSetCountIncrease
} = require("./scoringEngine");
const { onRequest } = require("firebase-functions/v2/https");

const REGION = "africa-south1";
const DEFAULT_TEAM_NAMES = {
    A: "Team A",
    B: "Team B"
};
const DEFAULT_PLAYER_NAMES = {
    A1: "",
    A2: "",
    B1: "",
    B2: ""
};
const SCORING_EVENTS = new Set(["POINT_TEAM_A", "POINT_TEAM_B", "UNDO", "RESET"]);
const OPERATIONAL_EVENTS = new Set(["SPECTATE", "REGISTER"]);
const SUPPORTED_EVENTS = new Set([...SCORING_EVENTS, ...OPERATIONAL_EVENTS]);
const SCORE_CHECKPOINTS_COLLECTION = "scoreCheckpoints";
const RECONCILE_INTERVAL_POINTS = 25;

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

function buildScoringEventsQuery(courtId)
{
    return db
        .collection(`courts/${courtId}/events`)
        .orderBy("createdAt", "asc")
        .orderBy(admin.firestore.FieldPath.documentId(), "asc");
}

async function getLatestCheckpoint(tx, courtId, options)
{
    const checkpointsQuery = db
        .collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`)
        .orderBy("lastCreatedAt", "desc")
        .orderBy("lastEventId", "desc")
        .limit(10);

    const checkpointsSnap = await tx.get(checkpointsQuery);
    const targetOptions = normalizeScoringOptions(options);

    for (const docSnap of checkpointsSnap.docs)
    {
        const data = docSnap.data() || {};
        const checkpointOptions = normalizeScoringOptions(data.scoringOptions || {});
        const sameOptions =
            checkpointOptions.scoringMode === targetOptions.scoringMode &&
            checkpointOptions.deuceMode === targetOptions.deuceMode &&
            checkpointOptions.tiebreakMode === targetOptions.tiebreakMode;

        if (!sameOptions) continue;
        if (!data.score || !data.lastEventId || !data.lastCreatedAt) continue;

        return {
            ref: docSnap.ref,
            data
        };
    }

    return null;
}

async function replayScoreFromEvents(tx, courtId, options, useCheckpoint)
{
    const activeOptions = normalizeScoringOptions(options);
    let replayedScore = defaultScore(activeOptions);
    let query = buildScoringEventsQuery(courtId);

    if (useCheckpoint)
    {
        const checkpoint = await getLatestCheckpoint(tx, courtId, activeOptions);
        if (checkpoint)
        {
            replayedScore = {
                ...defaultScore(activeOptions),
                ...(checkpoint.data.score || {}),
                A: { ...defaultScore(activeOptions).A, ...(checkpoint.data.score?.A || {}) },
                B: { ...defaultScore(activeOptions).B, ...(checkpoint.data.score?.B || {}) },
                completedSets: Array.isArray(checkpoint.data.score?.completedSets)
                    ? checkpoint.data.score.completedSets.map((set) => ({ ...set }))
                    : [],
                history: [],
                scoringOptions: activeOptions
            };

            query = query.startAfter(checkpoint.data.lastCreatedAt, checkpoint.data.lastEventId);
        }
    }

    const eventsSnap = await tx.get(query);
    let lastEventId = null;
    let lastCreatedAt = null;

    eventsSnap.forEach((docSnap) =>
    {
        const data = docSnap.data() || {};
        if (!SCORING_EVENTS.has(data.eventType))
        {
            return;
        }

        const event = { id: docSnap.id, ...data };
        replayedScore = applyEvent(replayedScore, event, activeOptions);
        lastEventId = docSnap.id;
        lastCreatedAt = data.createdAt || lastCreatedAt;
    });

    return {
        score: replayedScore,
        lastEventId,
        lastCreatedAt
    };
}

async function replayScoreFromEventsExcluding(tx, courtId, options, excludedEventId)
{
    // Rebuild without excluded event so caller can apply it in a deterministic position.
    // Always replays from the very first event (no checkpoint shortcut here): a checkpoint
    // snapshot has its history stripped, so resuming from one leaves the undo stack empty
    // right at the checkpoint boundary and silently breaks "undo" for the point that just
    // completed a set. Undo is infrequent enough that a full replay is an acceptable cost
    // for guaranteeing the history stack is always correct.
    const activeOptions = normalizeScoringOptions(options);
    let replayedScore = defaultScore(activeOptions);
    const query = buildScoringEventsQuery(courtId);

    const eventsSnap = await tx.get(query);
    let lastEventId = null;
    let lastCreatedAt = null;

    eventsSnap.forEach((docSnap) =>
    {
        const data = docSnap.data() || {};
        if (!SCORING_EVENTS.has(data.eventType))
        {
            return;
        }

        if (docSnap.id === excludedEventId)
        {
            return;
        }

        const event = { id: docSnap.id, ...data };
        replayedScore = applyEvent(replayedScore, event, activeOptions);
        lastEventId = docSnap.id;
        lastCreatedAt = data.createdAt || lastCreatedAt;
    });

    return {
        score: replayedScore,
        lastEventId,
        lastCreatedAt
    };
}

function buildCheckpointPayload(score, options, lastEventId, lastCreatedAt)
{
    return {
        score: toLiveScorePayload(score),
        scoringOptions: normalizeScoringOptions(options),
        totalPoints: (Number(score?.A?.totalPoints) || 0) + (Number(score?.B?.totalPoints) || 0),
        setsCompleted: (Number(score?.A?.sets) || 0) + (Number(score?.B?.sets) || 0),
        lastEventId,
        lastCreatedAt,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
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

function createServePlayerStatsBucket()
{
    return {
        pointsServed: 0,
        pointsWonOnServe: 0,
        serveWinPct: 0
    };
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
    };
    const servePlayerStats = {
        A1: createServePlayerStatsBucket(),
        A2: createServePlayerStatsBucket(),
        B1: createServePlayerStatsBucket(),
        B2: createServePlayerStatsBucket()
    };

    const standardMode = options.scoringMode === "standard";
    let score = defaultScore(options);

    let streakTeam = null;
    let streakLength = 0;
    let currentServerTeam = "A";
    const gameMarkers = [];
    let gameContext = {
        reachedDeuce: false,
        hadGamePoint: { A: false, B: false }
    };

    let pointIndex = 0;
    for (const pointWinner of pointHistory)
    {
        if (pointWinner !== "A" && pointWinner !== "B") continue;
        pointIndex++;

        const serverLabel = getCurrentServerLabel(score);
        if (serverLabel && servePlayerStats[serverLabel])
        {
            servePlayerStats[serverLabel].pointsServed++;
            if (pointWinner === serverLabel[0])
            {
                servePlayerStats[serverLabel].pointsWonOnServe++;
            }
        }

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

            gameMarkers.push(pointIndex);

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

    ["A1", "A2", "B1", "B2"].forEach((slot) =>
    {
        const bucket = servePlayerStats[slot];
        bucket.serveWinPct = bucket.pointsServed > 0
            ? (bucket.pointsWonOnServe / bucket.pointsServed) * 100
            : 0;
    });

    return {
        teamStats,
        servePlayerStats,
        matchStats,
        scoringMode: options.scoringMode,
        deuceMode: options.deuceMode,
        gameMarkers
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
function shouldApplyIncomingEventAfterReplay(eventId, replayResult)
{
    return replayResult.lastEventId !== eventId;
}

exports.onEventCreate = onDocumentCreated(
{
    document: "courts/{courtId}/events/{eventId}",
    region: REGION,
    // Rapid clicks fire many concurrent invocations that all contend for the same
    // score/current document. Retry lets Cloud Functions redeliver this event if the
    // transaction below ever exhausts its attempts, so a point/undo is never dropped.
    retry: true
},
async (event) =>
{
    const { courtId, eventId } = event.params;
    const newEvent = event.data?.data();
    const incomingEvent = { id: eventId, ...(newEvent || {}) };

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
            // Guard against reset races: if the event document was deleted by a
            // concurrent reset before this CF ran its transaction, skip processing
            // so a pre-reset point cannot corrupt the newly-zeroed score.
            const eventRef = db.doc(`courts/${courtId}/events/${eventId}`);
            const eventSnap = await tx.get(eventRef);
            if (!eventSnap.exists)
            {
                return;
            }

            const courtRef = db.doc(`courts/${courtId}`);
            const courtSnap = await tx.get(courtRef);
            const courtData = courtSnap.exists ? courtSnap.data() : {};
            const scoreSnap = await tx.get(scoreRef);
            const activeScoringOptions = buildScoringOptions({
                ...(courtData.scoringOptions || {}),
                scoringMode: courtData.scoringMode || courtData.scoringOptions?.scoringMode
            });
            let score = scoreSnap.exists ? scoreSnap.data() : defaultScore(activeScoringOptions);
            const incomingOrder = getEventOrderingTuple(incomingEvent);

            if (score.lastEventId === eventId)
            {
                console.log(`Event ${eventId} already processed, skipping.`);
                return;
            }

            const lastProcessedCreatedAt = score.lastProcessedCreatedAt || null;
            const lastProcessedEventId = typeof score.lastProcessedEventId === "string"
                ? score.lastProcessedEventId
                : null;
            const orderComparison = compareEventOrder(
                incomingOrder.createdAt,
                incomingOrder.id,
                lastProcessedCreatedAt,
                lastProcessedEventId
            );

            if (orderComparison !== null && orderComparison <= 0)
            {
                // The incoming event arrived out-of-order relative to what the score
                // document has already processed.  Rebuild from the full event log so
                // the event is applied in its correct chronological position.
                //
                // For UNDO: useCheckpoint must be false to preserve the in-memory
                // history stack that undo() depends on (checkpoints strip history).
                // replayScoreFromEvents processes every event in (createdAt, docId)
                // order, including this UNDO, so it lands in the right slot.
                //
                // For POINT: the event already sits in the collection in its correct
                // slot, so the replay score is the authoritative result — no second
                // applyEvent call is needed.
                const useCheckpoint = newEvent.eventType !== "UNDO";
                const replayResult = await replayScoreFromEvents(
                    tx,
                    courtId,
                    activeScoringOptions,
                    useCheckpoint
                );

                tx.set(scoreRef, {
                    ...toLiveScorePayload(replayResult.score),
                    lastEventId: replayResult.lastEventId ?? eventId,
                    lastProcessedEventId: replayResult.lastEventId ?? eventId,
                    lastProcessedCreatedAt: replayResult.lastCreatedAt ?? incomingOrder.createdAt,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

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
                const checkpointsRef = db.collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`);
                const checkpointsSnap = await checkpointsRef.get();
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

                checkpointsSnap.forEach((docSnap) =>
                {
                    tx.delete(docSnap.ref);
                });

                tx.set(scoreRef, {
                    ...toLiveScorePayload(defaultScore(activeScoringOptions)),
                    lastEventId: eventId,
                    lastProcessedEventId: eventId,
                    lastProcessedCreatedAt: incomingOrder.createdAt,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                return;
            }

            // Rebuild state for undo from latest checkpoint, then replay tail events.
            if (newEvent.eventType === "UNDO")
            {
                const replayResult = await replayScoreFromEventsExcluding(
                    tx,
                    courtId,
                    activeScoringOptions,
                    eventId
                );
                const replayedScore = applyEvent(replayResult.score, incomingEvent, activeScoringOptions);

                tx.set(scoreRef, {
                    ...toLiveScorePayload(replayedScore),
                    lastEventId: eventId,
                    lastProcessedEventId: eventId,
                    lastProcessedCreatedAt: incomingOrder.createdAt,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                });

                return;
            }

            // Normal point event stays incremental.
            const previousScore = {
                ...defaultScore(activeScoringOptions),
                ...(score || {}),
                A: { ...defaultScore(activeScoringOptions).A, ...(score?.A || {}) },
                B: { ...defaultScore(activeScoringOptions).B, ...(score?.B || {}) },
                completedSets: Array.isArray(score?.completedSets)
                    ? score.completedSets.map((set) => ({ ...set }))
                    : []
            };
            const updatedScore = applyEvent(score, newEvent, activeScoringOptions);

            console.log(`Updating score for ${courtId}. New points: A:${updatedScore.A.points}, B:${updatedScore.B.points}`);

            let nextScore = updatedScore;
            let nextLastEventId = eventId;
            let nextLastProcessedCreatedAt = incomingOrder.createdAt;

            // Reconcile every N points using full replay, then auto-heal if drift appears.
            const totalPoints = (Number(updatedScore.A?.totalPoints) || 0) + (Number(updatedScore.B?.totalPoints) || 0);
            const shouldReconcile = RECONCILE_INTERVAL_POINTS  > 0 && totalPoints > 0 && totalPoints % RECONCILE_INTERVAL_POINTS === 0;

            if (shouldReconcile)
            {
                const fullReplay = await replayScoreFromEvents(tx, courtId, activeScoringOptions, false);
                if (!scoreEquivalent(updatedScore, fullReplay.score))
                {
                    console.warn(`Drift detected at ${totalPoints} points on ${courtId}. Auto-healing from full replay.`);
                    nextScore = fullReplay.score;
                    nextLastEventId = fullReplay.lastEventId || eventId;
                    nextLastProcessedCreatedAt = fullReplay.lastCreatedAt || incomingOrder.createdAt;
                }
            }

            tx.set(scoreRef, {
                ...toLiveScorePayload(nextScore),
                lastEventId: nextLastEventId,
                lastProcessedEventId: nextLastEventId,
                lastProcessedCreatedAt: nextLastProcessedCreatedAt,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Persist checkpoint whenever set total increases under active scoring mode.
            if (didSetCountIncrease(previousScore, nextScore))
            {
                const checkpointRef = db.collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`).doc();
                tx.set(
                    checkpointRef,
                    buildCheckpointPayload(nextScore, activeScoringOptions, nextLastEventId, nextLastProcessedCreatedAt)
                );
            }
        }, { maxAttempts: 20 });
    } catch (err)
    {
        console.error(`Transaction failed for event ${eventId}:`, err);
        // Rethrow so Cloud Functions retries delivery (see retry:true above) instead of
        // silently dropping this point/undo when the score doc is under heavy contention.
        throw err;
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
        const {
            courtId,
            deepReset,
            newPassword,
            requirePassword,
            scoringMode,
            scoringOptions: incomingScoringOptions
        } = request.data;
        if (!courtId) throw new Error("Missing courtId");

        const courtRef = db.doc(`courts/${courtId}`);
        const courtDoc = await courtRef.get();
        const courtData = courtDoc.exists ? courtDoc.data() : {};
        const trimmedPassword = typeof newPassword === "string" ? newPassword.trim() : "";

        if (requirePassword)
        {
            if (trimmedPassword.length < 4)
            {
                throw new Error("Password must be at least 4 characters.");
            }

            if (trimmedPassword === courtId)
            {
                throw new Error("Password must be different from court name.");
            }

            if (trimmedPassword === (courtData?.password || ""))
            {
                throw new Error("New password must be different from the current one.");
            }
        }

        const scoringOptions = buildScoringOptions({
            ...(courtData.scoringOptions || {}),
            ...(incomingScoringOptions || {}),
            scoringMode: scoringMode || courtData.scoringMode || courtData.scoringOptions?.scoringMode
        });

        const eventsRef = db.collection(`courts/${courtId}/events`);
        const eventsSnap = await eventsRef.get();
        const checkpointsRef = db.collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`);
        const checkpointsSnap = await checkpointsRef.get();
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
        checkpointsSnap.forEach(doc => deleteBatch.delete(doc.ref));
        await deleteBatch.commit();

        // Reset score. Include explicit null sentinels for the ordering fields so
        // that any in-flight Cloud Function invocation for a pre-reset event — whose
        // event document has already been deleted — cannot corrupt the fresh score
        // (the tx.get(eventRef) existence check in onEventCreate will bail early,
        // but writing nulls here also clears any stale baseline timestamp that would
        // make a late CF fall through the orderComparison guard).
        await db.doc(`courts/${courtId}/score/current`).set({
            ...toLiveScorePayload(defaultScore(scoringOptions)),
            lastProcessedEventId: null,
            lastProcessedCreatedAt: null
        });

        const courtUpdates = {
            scoringOptions,
            scoringMode: scoringOptions.scoringMode
        };

        if (trimmedPassword)
        {
            courtUpdates.password = trimmedPassword;
        }

        if (deepReset)
        {
            courtUpdates.teamNames = { ...DEFAULT_TEAM_NAMES };
            courtUpdates.playerNames = { ...DEFAULT_PLAYER_NAMES };
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
        const eventsRef = db
            .collection(`courts/${courtId}/events`)
            .orderBy("createdAt", "asc")
            .orderBy(admin.firestore.FieldPath.documentId(), "asc");

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
        const lastEventCreatedAt = events.length > 0
            ? (events[events.length - 1].createdAt || null)
            : null;
        await scoreRef.set({
            ...toLiveScorePayload(replayedScore),
            lastEventId,
            lastProcessedEventId: lastEventId,
            lastProcessedCreatedAt: lastEventCreatedAt,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const checkpointsRef = db.collection(`courts/${courtId}/${SCORE_CHECKPOINTS_COLLECTION}`);
        const checkpointsSnap = await checkpointsRef.get();
        const checkpointDeleteBatch = db.batch();
        checkpointsSnap.forEach((docSnap) => checkpointDeleteBatch.delete(docSnap.ref));
        await checkpointDeleteBatch.commit();

        if (lastEventId && lastEventCreatedAt)
        {
            await checkpointsRef.doc().set(
                buildCheckpointPayload(replayedScore, normalizedOptions, lastEventId, lastEventCreatedAt)
            );
        }

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

        const playerNames = {
            A1: typeof courtData?.playerNames?.A1 === "string" ? courtData.playerNames.A1 : "",
            A2: typeof courtData?.playerNames?.A2 === "string" ? courtData.playerNames.A2 : "",
            B1: typeof courtData?.playerNames?.B1 === "string" ? courtData.playerNames.B1 : "",
            B2: typeof courtData?.playerNames?.B2 === "string" ? courtData.playerNames.B2 : ""
        };

        const eventsSnap = await db
            .collection(`courts/${courtId}/events`)
            .orderBy("createdAt", "asc")
            .orderBy(admin.firestore.FieldPath.documentId(), "asc")
            .get();

        // Use only scoring events so details replay mirrors score/current logic.
        const events = eventsSnap.docs
            .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            .filter((event) => SCORING_EVENTS.has(event.eventType));

        let score = defaultScore(normalizedOptions);

        // Derived analytics streams (for momentum/stats UI)
        let pointHistory = [];     // ["A", "B", ...]
        let setPointMarkers = [];  // 1-based point index where a set is completed

        for (const event of events)
        {
            const oldSetsA = score.A.sets;
            const oldSetsB = score.B.sets;
            const oldTotalPoints = (Number(score.A.totalPoints) || 0) + (Number(score.B.totalPoints) || 0);

            score = applyEvent(score, event, normalizedOptions);

            const newTotalPoints = (Number(score.A.totalPoints) || 0) + (Number(score.B.totalPoints) || 0);
            const pointApplied = newTotalPoints > oldTotalPoints;

            if (event.eventType === "RESET")
            {
                pointHistory = [];
                setPointMarkers = [];
                continue;
            }

            if (event.eventType === "UNDO")
            {
                // Only pop pointHistory if the undo actually reversed a point.
                // If history was empty, the engine returns the score unchanged
                // (totalPoints stays the same), so we must not pop a real entry.
                const pointActuallyUndone = newTotalPoints < oldTotalPoints;
                if (pointActuallyUndone && pointHistory.length > 0)
                {
                    pointHistory.pop();
                }
                while (
                    setPointMarkers.length > 0 &&
                    setPointMarkers[setPointMarkers.length - 1] > pointHistory.length
                )
                {
                    setPointMarkers.pop();
                }
                continue;
            }

            if (pointApplied && event.eventType === "POINT_TEAM_A")
            {
                pointHistory.push("A");
            }
            else if (pointApplied && event.eventType === "POINT_TEAM_B")
            {
                pointHistory.push("B");
            }

            const setCompleted = score.A.sets > oldSetsA || score.B.sets > oldSetsB;
            if (pointApplied && setCompleted)
            {
                setPointMarkers.push(pointHistory.length);
            }
        }

        // Canonical source for per-set rows: completedSets from scorer state.
        // This guarantees details table aligns with score/current.
        const setScores = Array.isArray(score.completedSets)
            ? score.completedSets.map((set) => ({
                A: Number(set?.A) || 0,
                B: Number(set?.B) || 0,
                tiebreakPoints: set?.tiebreakPoints || null
            }))
            : [];

        const currentSetGames = {
            A: Number(score.A.games) || 0,
            B: Number(score.B.games) || 0
        };

        const momentumData = computeMomentumTimeline(pointHistory, normalizedOptions);

        return {
            sets: setScores,
            currentGames: currentSetGames,
            points: {
                A: Number(score.A.points) || 0,
                B: Number(score.B.points) || 0
            },
            setsA: Number(score.A.sets) || 0,
            setsB: Number(score.B.sets) || 0,
            scoringMode: normalizedOptions.scoringMode,
            matchComplete: Boolean(score.matchComplete),
            playerNames,
            pointHistory,
            setPointMarkers,
            momentumTimeline: momentumData.timeline,
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
