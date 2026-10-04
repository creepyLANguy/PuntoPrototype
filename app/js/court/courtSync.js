// Live court synchronisation: the Firestore listener for the open court's
// metadata, how the session reacts to it (renames, closure, privacy, password
// changes, a new match on the court) and listener recovery after disconnects
// or the app resuming. The match on the court is followed by matchSync.js.
import { STATUS, TOAST_TYPES } from "../config/constants.js";
import { enableSpectateMode, enterCourt, leaveCourt } from "./session.js";
import {
  followMatch,
  refreshScoreboardTitle,
  stopFollowingMatch,
} from "./matchSync.js";
import {
  getCourt,
  listenToCourtDocument,
} from "../firebase/courtRepository.js";
import { appState } from "../state/appState.js";
import { hasCourtAdminPrivileges, session } from "../state/sessionState.js";
import { showToast } from "../ui/toast.js";

let courtListenerReconnectTimeoutId = null;

const COURT_LISTENER_RECONNECT_DELAY_MS = 2000;

export function cancelCourtListenerReconnect() {
  if (courtListenerReconnectTimeoutId !== null) {
    window.clearTimeout(courtListenerReconnectTimeoutId);
    courtListenerReconnectTimeoutId = null;
  }
}

// Firestore listeners can terminate permanently (e.g. after the underlying
// WebSocket is dropped while the app is backgrounded). Schedule a fresh
// listenToCourt() so the scoreboard recovers instead of silently freezing.
export function scheduleCourtListenerReconnect(courtId, listenerToken) {
  if (listenerToken !== session.activeCourtListenerToken) return;
  if (session.currentCourtId !== courtId) return;
  if (courtListenerReconnectTimeoutId !== null) return;

  courtListenerReconnectTimeoutId = window.setTimeout(() => {
    courtListenerReconnectTimeoutId = null;
    if (listenerToken !== session.activeCourtListenerToken) return;
    if (session.currentCourtId !== courtId) return;
    listenToCourt(courtId).catch((err) => {
      console.error("Court listener reconnect failed:", err);
      scheduleCourtListenerReconnect(courtId, session.activeCourtListenerToken);
    });
  }, COURT_LISTENER_RECONNECT_DELAY_MS);
}

// Force-refresh the Firestore listeners when the app resumes so updates
// missed while backgrounded (or lost to a stale WebSocket) are re-delivered.
function refreshCourtListenersOnResume() {
  if (!session.currentCourtId) return;
  const courtId = session.currentCourtId;
  listenToCourt(courtId).catch((err) => {
    console.error("Court listener refresh failed:", err);
    scheduleCourtListenerReconnect(courtId, session.activeCourtListenerToken);
  });
}

export function registerCourtListenerResume() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      refreshCourtListenersOnResume();
    }
  });

  // iOS Safari back-forward cache restores the page without reloading it.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      refreshCourtListenersOnResume();
    }
  });
}

export async function listenToCourt(courtId) {
  if (courtSubscription.unsubscribe) courtSubscription.unsubscribe();
  cancelCourtListenerReconnect();
  const listenerToken = ++session.activeCourtListenerToken;
  // A fresh court listener re-subscribes the match listeners too.
  stopFollowingMatch();

  // Warm reads are best-effort only and must never block listener attachment.
  // If these reads stall during reconnect, score updates can appear frozen.
  Promise.allSettled([getCourt(courtId)]).then((results) => {
    const failures = results.filter((result) => result.status === "rejected");
    if (failures.length > 0) {
      console.warn(
        "Court warm reads failed, listeners remain active:",
        failures,
      );
    }
  });

  if (listenerToken !== session.activeCourtListenerToken) {
    return;
  }

  let latestCourtBeaconSidesSwapped = session.beaconSidesSwapped;
  const onMatchListenerError = () =>
    scheduleCourtListenerReconnect(courtId, listenerToken);

  // Listen to court metadata changes (password, status, name, active match)
  const unsubscribeCourt = listenToCourtDocument(
    courtId,
    (snap) => {
      if (listenerToken !== session.activeCourtListenerToken) return;
      if (!snap.exists()) {
        // If we are already on a new court (redirected), ignore
        if (session.currentCourtId !== courtId) return;

        showToast("This court no longer exists.", TOAST_TYPES.ERROR);
        leaveCourt("replace");
        return;
      }

      const data = snap.data();

      // Redirect handling (Rename propagation)
      if (data.redirect && data.redirect !== session.currentCourtId) {
        showToast(
          `Court has been renamed to "${data.redirect}". Redirecting...`,
          TOAST_TYPES.INFO,
        );
        const wasSpectating = session.isSpectating;
        const wasAdminEntry = session.enteredCourtAsAdmin;
        // Clean up current listener
        if (courtSubscription.unsubscribe) courtSubscription.unsubscribe();
        courtSubscription.unsubscribe = null;
        // Enter new court
        enterCourt(data.redirect, wasSpectating, {
          historyMode: "replace",
          adminEntry: wasAdminEntry,
        });
        return;
      }

      //Court made private
      if (
        data.status === STATUS.PRIVATE &&
        session.currentCourtStatus !== STATUS.PRIVATE
      ) {
        showToast(
          "This court has been made private by admin.",
          TOAST_TYPES.INFO,
        );
        leaveCourt("replace");
        return;
      }

      // Court Closure detection
      if (data.status === STATUS.CLOSED && !appState.isAdmin) {
        showToast("The court has been closed by admin.", TOAST_TYPES.ERROR);
        leaveCourt("replace");
        return;
      }

      // Password change detection
      const expectedLocalPassword = session.pendingLocalPasswordUpdate;
      const isExpectedLocalPasswordChange = Boolean(
        expectedLocalPassword && data.password === expectedLocalPassword,
      );

      if (
        session.currentCourtPassword !== data.password &&
        !session.isSpectating &&
        !isExpectedLocalPasswordChange &&
        // Admins entered with the admin password, so a court password change does
        // not invalidate their access.
        !hasCourtAdminPrivileges()
      ) {
        showToast(
          "Security notice: Court password changed. You are now a spectator.",
          TOAST_TYPES.ERROR,
        );
        enableSpectateMode();
      }

      if (isExpectedLocalPasswordChange) {
        session.pendingLocalPasswordUpdate = null;
      }

      // Ensure local state tracks newest password
      session.currentCourtPassword = data.password;
      session.currentCourtStatus = data.status;
      latestCourtBeaconSidesSwapped = data.beaconSidesSwapped === true;

      // Rename propagation for the court (the secondary location label)
      session.currentCourtName = data.name || snap.id;
      refreshScoreboardTitle();

      // A different match on this court (a tournament match starting, a moved
      // match, or a new casual match) switches the scoreboard to that match.
      const courtMatchId = data.activeMatchId || data.lastMatchId || null;
      if (courtMatchId) {
        followMatch(courtMatchId, listenerToken, {
          onError: onMatchListenerError,
          getCourtBeaconSidesSwapped: () => latestCourtBeaconSidesSwapped,
        });
      } else if (!session.currentMatchId) {
        followMatch(null, listenerToken);
      }
    },
    (error) => {
      console.error("Court listener error:", error);
      scheduleCourtListenerReconnect(courtId, listenerToken);
    },
  );

  // Combine both unsubscribes
  courtSubscription.unsubscribe = () => {
    if (listenerToken === session.activeCourtListenerToken) {
      session.activeCourtListenerToken++;
    }
    unsubscribeCourt();
    stopFollowingMatch();
  };
}

export const courtSubscription = {
  unsubscribe: null,
};
