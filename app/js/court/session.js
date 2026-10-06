// Court session lifecycle: entering and leaving a court, blanking the scoreboard,
// and switching between player and spectator mode. Owns the scoreboard page's
// visibility and the spectator badge.
import { playJoinSound } from "../audio/audio.js";
import { DEFAULT_SCORING_OPTIONS } from "../config/constants.js";
import {
  cancelCourtListenerReconnect,
  courtSubscription,
  listenToCourt,
  scheduleCourtListenerReconnect,
} from "./courtSync.js";
import { setPlayPageVisible } from "./playJoin.js";
import BRAND from "../brand.mjs";
import { getCourt } from "../firebase/courtRepository.js";
import {
  addMatchEvent,
  getMatch,
  getMatchScore,
} from "../firebase/matchRepository.js";
import { manageMatch } from "../firebase/callables.js";
import {
  applyMatchData,
  refreshScoreboardTitle,
  stopFollowingMatch,
} from "./matchSync.js";
import { releaseWakeLock, requestWakeLock } from "../lifecycle/wakeLock.js";
import { clearCourtQr, renderCourtQr } from "../qr/courtQr.js";
import { syncCurrentViewState } from "../routing/history.js";
import {
  fitTextToContainer,
  showCourtTitle,
  updatePageTitle,
  updateUI,
} from "../scoring/scoreboard.js";
import { syncScoringControls } from "../scoring/settings.js";
import { appState } from "../state/appState.js";
import { bumpCourtHistorySessionId } from "../state/navigationState.js";
import {
  clearMatchContext,
  defaultScore,
  invalidateMatchDetailsCache,
  session,
} from "../state/sessionState.js";
import { themeState } from "../state/themeState.js";
import { closeAppearanceMenu } from "../ui/appearance.js";
import { $, elements } from "../ui/dom.js";
import {
  beginScoreboardLoading,
  finishScoreboardLoading,
} from "../ui/loading.js";
import { syncSettingsTiles } from "../ui/settingsTiles.js";

export async function enterCourt(
  courtId,
  spectate,
  { historyMode = "push", adminEntry = false, matchId = null } = {},
) {
  //console.log(`Entering court: ${courtId}, spectate: ${spectate}`);
  session.enteredCourtAsAdmin = Boolean(adminEntry) || appState.isAdmin;
  session.pendingLocalPasswordUpdate = null;
  bumpCourtHistorySessionId();
  invalidateMatchDetailsCache();

  const snap = await getCourt(courtId);
  if (!snap.exists()) {
    const errorEl = spectate
      ? elements.spectateCourtNameError
      : elements.playCourtNameError;
    errorEl.textContent = "Court not found.";
    errorEl.style.display = "block";
    const listContainer = spectate
      ? elements.spectateCourtList
      : elements.playCourtList;
    const selectedItem = listContainer.querySelector(
      `[data-court-name="${courtId}"]`,
    );
    if (selectedItem) {
      selectedItem.remove();
    }
    return;
  }

  session.currentCourtId = courtId;
  const data = snap.data();
  session.currentCourtName = data.name || courtId;
  session.currentCourtPassword = data.password;
  session.currentCourtStatus = data.status;
  session.beaconSidesSwapped = data.beaconSidesSwapped === true;

  // The scoreboard follows a specific match when supplied (used by /p/<matchId>
  // and browser-history restoration); otherwise resolve/create the court's
  // current casual match as before.
  let resolvedMatchId = matchId;
  if (resolvedMatchId) {
    const requestedMatchSnap = await getMatch(resolvedMatchId);
    const requestedMatch = requestedMatchSnap.exists()
      ? requestedMatchSnap.data()
      : null;
    const belongsToCourt =
      Boolean(requestedMatch) &&
      (requestedMatch.currentCourtId === courtId ||
        data.activeMatchId === resolvedMatchId ||
        data.lastMatchId === resolvedMatchId);

    if (!belongsToCourt) {
      throw new Error(
        "The requested match is not currently assigned to this court.",
      );
    }
  } else {
    resolvedMatchId = await resolveCourtMatchId(courtId, data);
  }

  clearMatchContext();
  session.requestedMatchId = matchId;
  session.currentScoreVersion = -1;
  if (resolvedMatchId) {
    // Warm the Firestore connection and the scoring Cloud Function.
    await getMatchScore(resolvedMatchId);
    await addMatchEvent(resolvedMatchId, {
      eventType: "WARMUP",
      createdBy: appState.thisDeviceId,
      courtId,
    });
    const matchSnap = await getMatch(resolvedMatchId);
    if (matchSnap.exists()) {
      applyMatchData(resolvedMatchId, matchSnap.data(), {
        courtBeaconSidesSwapped: data.beaconSidesSwapped === true,
      });
    }
  }
  if (session.currentScoreVersion < 0) session.currentScoreVersion = 0;
  syncScoringControls();
  syncSettingsTiles();
  if (appState.muted) {
    elements.muteBtn.textContent = "♫⃠";
  }

  if (themeState.isWavesEnabled == false) {
    elements.waveToggleScoreboardBtn.textContent = "═";
  }

  elements.menuPage.style.display = "none";
  elements.createPage.style.display = "none";
  setPlayPageVisible(false);
  elements.spectatePage.style.display = "none";

  // Hide top-right buttons in court view
  if (elements.appearanceMenuBtn) {
    closeAppearanceMenu();
    elements.appearanceMenuBtn.style.display = "none";
  }
  if (elements.adminLoginBtn) {
    elements.adminLoginBtn.style.display = "none";
  }
  if (elements.activateNfcBtn) {
    elements.activateNfcBtn.classList.add("hidden");
  }

  elements.scoreboardPage.style.display = "flex";
  document.body.classList.add("scoreboard-active");

  // The QR panel geometry must be measured only after the scoreboard page
  // is rendered. Measuring it while the parent is display:none produces a
  // zero-sized cached rectangle and prevents initial proximity updates.
  renderCourtQr(courtId);

  beginScoreboardLoading();

  BlankOutScoreboard();

  if (spectate) enableSpectateMode();
  else disableSpectateMode();

  listenToCourt(courtId).catch((err) => {
    console.error("Court listener setup failed:", err);
    scheduleCourtListenerReconnect(courtId, session.activeCourtListenerToken);
  });

  requestWakeLock();

  if (historyMode !== "skip") {
    syncCurrentViewState(historyMode);
  }

  await playJoinSound();

  refreshScoreboardTitle();
}

async function resolveCourtMatchId(courtId, court) {
  try {
    const result = await manageMatch("ensureCourtMatch", { courtId });
    if (result?.matchId) return result.matchId;
  } catch (err) {
    console.warn("Could not prepare a match for this court:", err);
  }
  return court.activeMatchId || court.lastMatchId || null;
}

export function leaveCourt(historyMode = "push") {
  //console.log("Leaving court: " + currentCourtId);
  session.activeCourtListenerToken++;
  cancelCourtListenerReconnect();
  session.enteredCourtAsAdmin = false;
  session.pendingLocalPasswordUpdate = null;
  bumpCourtHistorySessionId();
  invalidateMatchDetailsCache();

  disableSpectateMode();
  releaseWakeLock();

  if (courtSubscription.unsubscribe) {
    courtSubscription.unsubscribe();
    courtSubscription.unsubscribe = null;
  }
  stopFollowingMatch();
  clearMatchContext();

  session.currentCourtId = null;
  session.currentCourtName = null;
  session.currentCourtPassword = null;
  session.currentCourtStatus = null;
  session.currentScoreVersion = 0;
  session.currentScoringOptions = { ...DEFAULT_SCORING_OPTIONS };
  syncScoringControls();
  clearCourtQr();
  finishScoreboardLoading();
  updatePageTitle();

  document.body.classList.remove("scoreboard-active");
  if (elements.appearanceMenuBtn) elements.appearanceMenuBtn.style.display = "";
  if (elements.adminLoginBtn) elements.adminLoginBtn.style.display = "";

  if (appState.nfcDenied && elements.activateNfcBtn) {
    elements.activateNfcBtn.classList.remove("hidden");
  }

  elements.scoreboardPage.style.display = "none";
  elements.menuPage.style.display = "flex";

  if (historyMode !== "skip") {
    syncCurrentViewState(historyMode);
  }
}

function BlankOutScoreboard() {
  showCourtTitle(BRAND.name + " - " + BRAND.app.title);
  const nameA = $("teamA").querySelector(".name-text");
  const nameB = $("teamB").querySelector(".name-text");
  if (nameA) {
    nameA.textContent = ".";
    fitTextToContainer(nameA);
  }
  if (nameB) {
    nameB.textContent = ".";
    fitTextToContainer(nameB);
  }
  session.score = defaultScore();
  session.lastKnownSets = { A: 0, B: 0 };
  session.sessionInitialized = false;
  updateUI();
}

export function enableSpectateMode() {
  const wasPlaying = !session.isSpectating;
  session.isSpectating = true;

  document.body.classList.add("spectating-mode");

  if (
    wasPlaying &&
    elements.settingsModal &&
    !elements.settingsModal.classList.contains("hidden")
  ) {
    elements.settingsModal.classList.add("hidden");
  }

  $("addPointA").style.pointerEvents = "none";
  $("addPointB").style.pointerEvents = "none";

  elements.undoBtn.style.display = "none";
  if (elements.changeoverBtn) elements.changeoverBtn.style.display = "none";
  if (elements.sep1) elements.sep1.style.display = "none";
  if (elements.sep2) elements.sep2.style.display = "none";
  if (elements.sep3) elements.sep3.style.display = "none";

  // Hide player-only tiles in the settings modal
  if (elements.editPlayersTile) elements.editPlayersTile.style.display = "none";
  if (elements.resetSettingsTile)
    elements.resetSettingsTile.style.display = "none";
  if (elements.changeoverTile) elements.changeoverTile.style.display = "none";
  if (elements.switchToSpectateTile)
    elements.switchToSpectateTile.style.display = "none";

  if (elements.joinCourtTile) elements.joinCourtTile.style.display = "";

  syncScoringControls();
  showSpectatorBadges();
}

function disableSpectateMode() {
  session.isSpectating = false;

  document.body.classList.remove("spectating-mode");

  $("addPointA").style.pointerEvents = "auto";
  $("addPointB").style.pointerEvents = "auto";

  // Use "" to let CSS (flex) decide display, not "inline-block"
  elements.undoBtn.style.display = "";
  if (elements.changeoverBtn) elements.changeoverBtn.style.display = "";
  if (elements.sep1) elements.sep1.style.display = "";
  if (elements.sep2) elements.sep2.style.display = "";
  if (elements.sep3) elements.sep3.style.display = "";

  // Restore player-only tiles in the settings modal
  if (elements.editPlayersTile) elements.editPlayersTile.style.display = "";
  if (elements.resetSettingsTile) elements.resetSettingsTile.style.display = "";
  if (elements.changeoverTile) elements.changeoverTile.style.display = "";
  if (elements.switchToSpectateTile)
    elements.switchToSpectateTile.style.display = "";

  if (elements.joinCourtTile) elements.joinCourtTile.style.display = "none";

  syncScoringControls();
  removeSpectatorBadges();
}

function showSpectatorBadges() {
  const slot =
    document.querySelector(".header-spectator-badge-slot") || document.body;

  let badge = document.getElementById(`spectatorBadge`);

  if (!badge) {
    badge = document.createElement("div");
    badge.id = `spectatorBadge`;
    badge.className = "spectator-badge";
    badge.textContent = " LIVE";
    slot.appendChild(badge);
  }
}

function removeSpectatorBadges() {
  const badge = document.getElementById(`spectatorBadge`);
  if (badge) badge.remove();
}
