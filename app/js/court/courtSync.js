// Live court synchronisation: the Firestore listeners for the open court's score
// and metadata, how the session reacts to them (renames, closure, privacy,
// password changes, scoring-option changes) and listener recovery after
// disconnects or the app resuming.
import { STATUS, TOAST_TYPES } from "../config/constants.js";
import { enableSpectateMode, enterCourt, leaveCourt } from "./session.js";
import { showMatchDetails } from "../details/matchDetails.js";
import { getCourt, getCourtScore, listenToCourtDocument, listenToCourtScore } from "../firebase/courtRepository.js";
import { applyActiveScoreSnapshot } from "../scoreSync.mjs";
import { areScoringOptionsEqual, normalizeScoringOptions } from "../scoring/options.js";
import { applyTeamNamesToScoreboard, showCourtTitle, updatePageTitle, updateScoreFormatBadge, updateUI } from "../scoring/scoreboard.js";
import { updateServerIndicator } from "../scoring/serverIndicator.js";
import { syncScoringControls } from "../scoring/settings.js";
import { appState } from "../state/appState.js";
import { hasCourtAdminPrivileges, invalidateMatchDetailsCache, session } from "../state/sessionState.js";
import { normalizePlayerNames } from "../teams/playerNames.js";
import { normalizeTeamNames, resolveTeamNames } from "../teams/teamNames.js";
import { elements } from "../ui/dom.js";
import { finishScoreboardLoading, finishStartupLoading } from "../ui/loading.js";
import { syncSettingsTiles } from "../ui/settingsTiles.js";
import { showToast } from "../ui/toast.js";

let courtListenerReconnectTimeoutId = null;

const COURT_LISTENER_RECONNECT_DELAY_MS = 2000;

export function cancelCourtListenerReconnect()
{
  if (courtListenerReconnectTimeoutId !== null)
  {
    window.clearTimeout(courtListenerReconnectTimeoutId);
    courtListenerReconnectTimeoutId = null;
  }
}

// Firestore listeners can terminate permanently (e.g. after the underlying
// WebSocket is dropped while the app is backgrounded). Schedule a fresh
// listenToCourt() so the scoreboard recovers instead of silently freezing.
export function scheduleCourtListenerReconnect(courtId, listenerToken)
{
  if (listenerToken !== session.activeCourtListenerToken) return;
  if (session.currentCourtId !== courtId) return;
  if (courtListenerReconnectTimeoutId !== null) return;

  courtListenerReconnectTimeoutId = window.setTimeout(() =>
  {
    courtListenerReconnectTimeoutId = null;
    if (listenerToken !== session.activeCourtListenerToken) return;
    if (session.currentCourtId !== courtId) return;
    listenToCourt(courtId).catch((err) =>
    {
      console.error("Court listener reconnect failed:", err);
      scheduleCourtListenerReconnect(courtId, session.activeCourtListenerToken);
    });
  }, COURT_LISTENER_RECONNECT_DELAY_MS);
}

// Force-refresh the Firestore listeners when the app resumes so updates
// missed while backgrounded (or lost to a stale WebSocket) are re-delivered.
function refreshCourtListenersOnResume()
{
  if (!session.currentCourtId) return;
  const courtId = session.currentCourtId;
  listenToCourt(courtId).catch((err) =>
  {
    console.error("Court listener refresh failed:", err);
    scheduleCourtListenerReconnect(courtId, session.activeCourtListenerToken);
  });
}

export function registerCourtListenerResume()
{
  document.addEventListener("visibilitychange", () =>
  {
    if (document.visibilityState === "visible")
    {
      refreshCourtListenersOnResume();
    }
  });

  // iOS Safari back-forward cache restores the page without reloading it.
  window.addEventListener("pageshow", (event) =>
  {
    if (event.persisted)
    {
      refreshCourtListenersOnResume();
    }
  });
}

export async function listenToCourt(courtId)
{
  //console.log(`Setting up real-time sync for court: ${courtId}`);
  if (courtSubscription.unsubscribe) courtSubscription.unsubscribe();
  cancelCourtListenerReconnect();
  const listenerToken = ++session.activeCourtListenerToken;

  // Warm reads are best-effort only and must never block listener attachment.
  // If these reads stall during reconnect, score updates can appear frozen.
  Promise.allSettled([getCourtScore(courtId), getCourt(courtId)]).then((results) =>
  {
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0)
    {
      console.warn("Court warm reads failed, listeners remain active:", failures);
    }
  });

  if (listenerToken !== session.activeCourtListenerToken)
  {
    return;
  }

  // 🔥 Listen to score changes
  const unsubscribeScore = listenToCourtScore(courtId, (snap) =>
  {
    if (listenerToken !== session.activeCourtListenerToken) return;
    if (!snap.exists()) return;

    const newData = snap.data();

    // Establish baseline on first successful Firebase sync
    if (!session.sessionInitialized)
    {
      session.lastKnownSets = { A: newData.A.sets, B: newData.B.sets };
      session.sessionInitialized = true;

      finishScoreboardLoading();
      finishStartupLoading();
    }

    applyActiveScoreSnapshot(newData, listenerToken, session.activeCourtListenerToken, (nextScore) =>
    {
      session.score = nextScore;
      invalidateMatchDetailsCache();
      updateUI();

      if (!elements.detailsModal.classList.contains("hidden"))
      {
        showMatchDetails(false, elements.dmDetailsContent.hidden === false, true);
      }
    });
  },
  (error) =>
  {
    console.error("Score listener error:", error);
    scheduleCourtListenerReconnect(courtId, listenerToken);
  });

  // 🔥 Listen to court metadata changes (password + teamNames)
  const unsubscribeCourt = listenToCourtDocument(courtId, (snap) =>
  {
    if (listenerToken !== session.activeCourtListenerToken) return;
    if (!snap.exists())
    {
      // If we are already on a new court (redirected), ignore
      if (session.currentCourtId !== courtId) return;

      showToast("This court no longer exists.", TOAST_TYPES.ERROR);
      leaveCourt("replace");
      return;
    }

    const data = snap.data();

    // 🚨 Redirect handling (Rename propagation)
    if (data.redirect && data.redirect !== session.currentCourtId)
    {
      showToast(`Court has been renamed to "${data.redirect}". Redirecting...`, TOAST_TYPES.INFO);
      const wasSpectating = session.isSpectating;
      const wasAdminEntry = session.enteredCourtAsAdmin;
      // Clean up current listener
      if (unsubscribeScore) unsubscribeScore();
      if (unsubscribeCourt) unsubscribeCourt();
      courtSubscription.unsubscribe = null;
      if (listenerToken === session.activeCourtListenerToken)
      {
        session.activeCourtListenerToken++;
      }
      // Enter new court
      enterCourt(data.redirect, wasSpectating, { historyMode: "replace", adminEntry: wasAdminEntry });
      return;
    }

    //Court made private
    if (data.status === STATUS.PRIVATE && session.currentCourtStatus !== STATUS.PRIVATE)
    {
      showToast("This court has been made private by admin.", TOAST_TYPES.INFO);
      leaveCourt("replace");
      return;
    }

    // 🚨 Court Closure detection
    if (data.status === STATUS.CLOSED && !appState.isAdmin)
    {
      showToast("The court has been closed by admin.", TOAST_TYPES.ERROR);
      leaveCourt("replace");
      return;
    }

    // 🚨 Password change detection
    const expectedLocalPassword = session.pendingLocalPasswordUpdate;
    const isExpectedLocalPasswordChange = Boolean(
      expectedLocalPassword && data.password === expectedLocalPassword
    );

    if (
      session.currentCourtPassword !== data.password &&
      !session.isSpectating &&
      !isExpectedLocalPasswordChange &&
      // Admins entered with the admin password, so a court password change does
      // not invalidate their access.
      !hasCourtAdminPrivileges()
    )
    {
      showToast("Security notice: Court password changed. You are now a spectator.", TOAST_TYPES.ERROR);
      enableSpectateMode();
    }

    if (isExpectedLocalPasswordChange)
    {
      session.pendingLocalPasswordUpdate = null;
    }

    // Ensure local state tracks newest password
    session.currentCourtPassword = data.password;
    session.currentCourtStatus = data.status;

    const nextScoreVersion = Number(data.scoreVersion) || 0;
    if (nextScoreVersion !== session.currentScoreVersion)
    {
      // RESET is the separate backend operation that restores the default
      // Beacon mapping. A live changeover is handled by its event marker.
      session.beaconSidesSwapped = data.beaconSidesSwapped === true;
    }
    session.currentScoreVersion = nextScoreVersion;
    syncSettingsTiles();

    const nextScoringOptions = normalizeScoringOptions({
      ...(data.scoringOptions || {}),
      scoringMode: data.scoringMode || data.scoringOptions?.scoringMode
    });
    if (!areScoringOptionsEqual(nextScoringOptions, session.currentScoringOptions))
    {
      session.currentScoringOptions = nextScoringOptions;
      syncScoringControls();
      updateScoreFormatBadge();
    }

    // Update UI title (Rename propagation for the display name)
    showCourtTitle(data.name || snap.id);
    updatePageTitle(data.name || snap.id, snap.id);

    session.currentRawTeamNames = normalizeTeamNames(data.teamNames || {});
    session.currentPlayerNames = normalizePlayerNames(data.playerNames || {});
    const teamNames = resolveTeamNames(session.currentRawTeamNames, session.currentPlayerNames);
    applyTeamNamesToScoreboard(teamNames);
    updateServerIndicator();

    if (!elements.detailsModal.classList.contains("hidden"))
    {
      showMatchDetails(false, elements.dmDetailsContent.hidden === false, true);
    }
  },
  (error) =>
  {
    console.error("Court listener error:", error);
    scheduleCourtListenerReconnect(courtId, listenerToken);
  });

  // Combine both unsubscribes
  courtSubscription.unsubscribe = () =>
  {
    if (listenerToken === session.activeCourtListenerToken)
    {
      session.activeCourtListenerToken++;
    }
    unsubscribeScore();
    unsubscribeCourt();
  };
}

export const courtSubscription = {
  unsubscribe: null,
};
