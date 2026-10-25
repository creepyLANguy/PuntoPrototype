// The court session's match: the scoreboard follows the match currently on
// the open court (courts/{courtId}.activeMatchId, else its last match). Names,
// scoring options and the score version come from the match document; the
// score from matches/{matchId}/score/current. Spec sections 5.3, 30 and 46.
import { showMatchDetails } from "../details/matchDetails.js";
import { TOAST_TYPES } from "../config/constants.js";
import {
  discardPendingScoreEventsForMatch,
  reconcilePendingScoreEvents,
} from "../scoring/pendingSync.js";
import { showToast } from "../ui/toast.js";
import {
  listenToMatch,
  listenToMatchScore,
} from "../firebase/matchRepository.js";
import {
  assertCurrentAssignment,
  rememberAssignment,
} from "../firebase/assignmentContext.js";
import { resolveMatchTitle } from "../match/matchIdentity.js";
import { applyActiveScoreSnapshot } from "../scoreSync.mjs";
import {
  areScoringOptionsEqual,
  normalizeScoringOptions,
} from "../scoring/options.js";
import {
  applyTeamNamesToScoreboard,
  showCourtTitle,
  updatePageTitle,
  updateScoreFormatBadge,
  updateUI,
} from "../scoring/scoreboard.js";
import { updateServerIndicator } from "../scoring/serverIndicator.js";
import { syncScoringControls } from "../scoring/settings.js";
import { getFixedTotalDisplayResult } from "../scoring/presentation.js";
import {
  defaultScore,
  invalidateMatchDetailsCache,
  session,
} from "../state/sessionState.js";
import { normalizePlayerNames } from "../teams/playerNames.js";
import { normalizeTeamNames, resolveTeamNames } from "../teams/teamNames.js";
import { elements } from "../ui/dom.js";
import {
  finishScoreboardLoading,
  finishStartupLoading,
} from "../ui/loading.js";
import { syncSettingsTiles } from "../ui/settingsTiles.js";

export const matchSubscription = {
  matchId: null,
  unsubscribe: null,
};

export function stopFollowingMatch() {
  if (matchSubscription.unsubscribe) {
    matchSubscription.unsubscribe();
  }
  matchSubscription.unsubscribe = null;
  matchSubscription.matchId = null;
}

// Primary title is the match identity; the court name is the location.
export function refreshScoreboardTitle() {
  const title =
    session.currentMatchTitle ||
    session.currentCourtName ||
    session.currentCourtId ||
    "";
  showCourtTitle(title, session.currentMatchId ?? null);
  updatePageTitle(
    session.currentCourtName,
    session.currentCourtId,
    session.currentMatchTitle,
  );
}

// Applies a match document to the session. `initial` marks the first read
// on entering a court, when the Beacon mapping is taken from the court.
export function applyMatchData(
  matchId,
  data,
  { courtBeaconSidesSwapped = null } = {},
) {
  const sameMatch = session.currentMatchId === matchId;
  const previousScoreVersion = Number(session.currentScoreVersion);
  const previousMatchStatus = session.currentMatchStatus;
  rememberAssignment("match", matchId, data);
  if (
    sameMatch &&
    session.currentMatchAllocationId &&
    data.allocationId !== session.currentMatchAllocationId
  ) {
    session.currentMatchStatus = null;
    session.currentMatchCourtId = null;
    resetScoreBaseline();
    syncScoringControls();
    return false;
  }
  try {
    assertCurrentAssignment("match", matchId, data.allocationId);
  } catch {
    session.currentMatchStatus = null;
    session.currentMatchCourtId = null;
    syncScoringControls();
    return false;
  }
  const nextScoreVersion = Number(data.scoreVersion) || 0;
  if (
    nextScoreVersion !== session.currentScoreVersion &&
    courtBeaconSidesSwapped !== null
  ) {
    // RESET is the separate backend operation that restores the default
    // Beacon mapping. A live changeover is handled by its event marker.
    session.beaconSidesSwapped = courtBeaconSidesSwapped === true;
  }
  session.currentScoreVersion = nextScoreVersion;
  session.currentMatchId = matchId;

  if (
    sameMatch &&
    previousScoreVersion !== nextScoreVersion
  ) {
    const discarded = discardPendingScoreEventsForMatch(matchId);
    if (discarded > 0) {
      showToast(
        "A pending score update was cancelled because the match was reset.",
        TOAST_TYPES.ERROR,
      );
    }
  }
  session.currentMatchAllocationId = data.allocationId;
  session.currentMatchStatus = data.status || null;
  session.currentMatchCourtId = data.currentCourtId || null;

  if (
    sameMatch &&
    previousMatchStatus === "live" &&
    session.currentMatchStatus !== "live"
  ) {
    const discarded = discardPendingScoreEventsForMatch(matchId);
    if (discarded > 0) {
      showToast(
        "A pending score update was not processed because the match is no longer live.",
        TOAST_TYPES.ERROR,
      );
    }
  }
  session.currentMatchName = data.name || null;
  session.currentTournamentId = data.tournamentId || null;
  session.currentMatchTitle = resolveMatchTitle({ ...data, matchId }, matchId);

  const incomingScoringOptions = {
    ...(data.scoringOptions || {}),
    scoringMode: data.scoringMode || data.scoringOptions?.scoringMode,
  };
  const retainedScoringOptions = session.currentScoringOptions || {};
  if (incomingScoringOptions.scoringMode !== "fixedTotalPoints") {
    ["pointsTarget", "serving", "completion"].forEach((field) => {
      if (
        incomingScoringOptions[field] === undefined &&
        retainedScoringOptions[field] !== undefined
      ) {
        incomingScoringOptions[field] = retainedScoringOptions[field];
      }
    });
  }
  const nextScoringOptions = normalizeScoringOptions(incomingScoringOptions);
  if (
    !areScoringOptionsEqual(nextScoringOptions, session.currentScoringOptions)
  ) {
    session.currentScoringOptions = nextScoringOptions;
    updateScoreFormatBadge();
  }
  syncScoringControls();

  session.currentRawTeamNames = normalizeTeamNames(data.teamNames || {});
  session.currentPlayerNames = normalizePlayerNames(data.playerNames || {});
  applyTeamNamesToScoreboard(
    resolveTeamNames(session.currentRawTeamNames, session.currentPlayerNames),
  );
  updateServerIndicator();
  syncSettingsTiles();
  refreshScoreboardTitle();
  return true;
}

function resetScoreBaseline() {
  session.score = defaultScore();
  session.lastKnownSets = { A: 0, B: 0 };
  session.lastKnownFixedResult = null;
  session.sessionInitialized = false;
  invalidateMatchDetailsCache();
  updateUI();
}

// Subscribes the scoreboard to a match. Listener callbacks are ignored once
// the court listener token moves on (court switch, leave, reconnect).
export function followMatch(
  matchId,
  listenerToken,
  { onError, getCourtBeaconSidesSwapped } = {},
) {
  if (matchSubscription.matchId === matchId && matchSubscription.unsubscribe)
    return;
  const switching =
    matchSubscription.matchId !== null && matchSubscription.matchId !== matchId;
  stopFollowingMatch();
  matchSubscription.matchId = matchId;

  if (switching) {
    resetScoreBaseline();
  }

  if (!matchId) {
    session.currentMatchId = null;
    session.currentMatchAllocationId = null;
    session.currentMatchTitle = null;
    session.currentTournamentId = null;
    refreshScoreboardTitle();
    finishScoreboardLoading();
    finishStartupLoading();
    return;
  }

  const isCurrent = () =>
    listenerToken === session.activeCourtListenerToken &&
    matchSubscription.matchId === matchId;
  let assignmentInvalidated = false;

  const unsubscribeScore = listenToMatchScore(
    matchId,
    (snap) => {
      if (!isCurrent() || assignmentInvalidated) return;
      if (!snap.exists()) return;

      const newData = snap.data();
      if (
        newData.allocationId !== undefined &&
        session.currentMatchId === matchId &&
        session.currentMatchAllocationId &&
        newData.allocationId !== session.currentMatchAllocationId
      ) {
        assignmentInvalidated = true;
        rememberAssignment("match", matchId, newData);
        session.currentMatchStatus = null;
        session.currentMatchCourtId = null;
        resetScoreBaseline();
        syncScoringControls();
        return;
      }

      // Only a processed score snapshot can confirm pending local inputs.
      // A successful event write alone means queued, not yet scored.
      reconcilePendingScoreEvents(matchId, newData);

      // Establish baseline on first successful sync of this match
      if (!session.sessionInitialized) {
        session.lastKnownSets = { A: newData.A.sets, B: newData.B.sets };
        session.lastKnownFixedResult = getFixedTotalDisplayResult(newData);
        session.sessionInitialized = true;

        finishScoreboardLoading();
        finishStartupLoading();
      }

      applyActiveScoreSnapshot(
        newData,
        listenerToken,
        session.activeCourtListenerToken,
        (nextScore) => {
          session.score = nextScore;
          invalidateMatchDetailsCache();
          updateUI();

          if (!elements.detailsModal.classList.contains("hidden")) {
            showMatchDetails(
              false,
              elements.dmDetailsContent.hidden === false,
              true,
            );
          }
        },
      );
    },
    (error) => {
      console.error("Score listener error:", error);
      onError?.(error);
    },
  );

  const unsubscribeMatch = listenToMatch(
    matchId,
    (snap) => {
      if (!isCurrent()) return;
      if (!snap.exists()) {
        assignmentInvalidated = true;
        session.currentMatchStatus = null;
        session.currentMatchCourtId = null;
        resetScoreBaseline();
        syncScoringControls();
        return;
      }
      if (
        !applyMatchData(matchId, snap.data(), {
          courtBeaconSidesSwapped: getCourtBeaconSidesSwapped
            ? getCourtBeaconSidesSwapped()
            : null,
        })
      ) {
        assignmentInvalidated = true;
        return;
      }

      if (!elements.detailsModal.classList.contains("hidden")) {
        showMatchDetails(
          false,
          elements.dmDetailsContent.hidden === false,
          true,
        );
      }
    },
    (error) => {
      console.error("Match listener error:", error);
      onError?.(error);
    },
  );

  matchSubscription.unsubscribe = () => {
    unsubscribeScore();
    unsubscribeMatch();
  };
}

// The match the scoreboard can score: the live match on this court.
export function isCurrentMatchScorable() {
  if (session.currentMatchId && session.currentCourtId) {
    try {
      assertCurrentAssignment(
        "match",
        session.currentMatchId,
        session.currentMatchAllocationId,
      );
      assertCurrentAssignment(
        "court",
        session.currentCourtId,
        session.currentCourtAllocationId,
      );
    } catch {
      return false;
    }
  }
  return Boolean(
    session.currentMatchId &&
    session.currentMatchStatus === "live" &&
    session.currentMatchCourtId === session.currentCourtId,
  );
}
