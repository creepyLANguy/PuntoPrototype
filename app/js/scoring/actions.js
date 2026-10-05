// Scoring actions: sending point and undo events for the backend scoring engine,
// with the immediate local animation and sound feedback.
import { playSound } from "../audio/audio.js";
import { EVENT_TYPES, SOUND_IDS, TOAST_TYPES } from "../config/constants.js";
import { manageMatch } from "../firebase/callables.js";
import { addMatchEvent } from "../firebase/matchRepository.js";
import { appState } from "../state/appState.js";
import { session } from "../state/sessionState.js";
import { animate, animateUndo } from "../ui/animations.js";
import { showToast } from "../ui/toast.js";

// Points go to the live match on this court. When the match shown has
// finished (for example a tournament match that completed and freed the
// court), the next point starts a new casual match on the court.
async function resolveScorableMatch() {
  const matchIsOnCourt =
    session.currentMatchId &&
    session.currentMatchStatus === "live" &&
    session.currentMatchCourtId === session.currentCourtId;
  if (matchIsOnCourt) {
    return {
      matchId: session.currentMatchId,
      scoreVersion: Number(session.currentScoreVersion) || 0,
    };
  }

  const courtId = session.currentCourtId;
  const listenerToken = session.activeCourtListenerToken;
  const result = await manageMatch("ensureCourtMatch", { courtId });
  if (
    session.currentCourtId !== courtId ||
    session.activeCourtListenerToken !== listenerToken
  ) {
    throw new Error("The open court changed before the point could be saved.");
  }
  if (!result?.matchId) throw new Error("No match is available on this court.");
  const scoreVersion = Number(result.scoreVersion) || 0;
  session.currentMatchId = result.matchId;
  session.currentMatchStatus = "live";
  session.currentMatchCourtId = courtId;
  session.currentScoreVersion = scoreVersion;
  return { matchId: result.matchId, scoreVersion };
}

export async function addPoint(addpointevent) {
  // Fire-and-forget animation/sound immediately so the UI stays snappy even
  // while the write is in flight; only surface an error if it actually fails.
  animate(addpointevent === EVENT_TYPES.POINT_TEAM_A ? "A" : "B");
  playSound(SOUND_IDS.POINT);

  try {
    const { matchId, scoreVersion } = await resolveScorableMatch();
    await addMatchEvent(matchId, {
      eventType: addpointevent,
      createdBy: appState.thisDeviceId,
      courtId: session.currentCourtId,
      scoreVersion,
    });
  } catch (err) {
    console.error("Add point failed:", err);
    showToast(
      "Point failed to save: " + (err.message || "Unknown error"),
      TOAST_TYPES.ERROR,
    );
  }
}

export async function undoLastPoint() {
  if (session.isSpectating) return;

  // Snapshot before the write: the score listener can deliver the undone
  // score while the addDoc await is still settling.
  const undoTarget = session.score?.lastPointTeam || null;
  const hasPointsToUndo =
    (session.score?.A?.totalPoints || 0) +
      (session.score?.B?.totalPoints || 0) >
    0;

  try {
    await addMatchEvent(session.currentMatchId, {
      eventType: EVENT_TYPES.UNDO,
      createdBy: appState.thisDeviceId,
      courtId: session.currentCourtId,
      scoreVersion: Number(session.currentScoreVersion) || 0,
    });

    // Only give undo feedback when there is actually something to undo;
    // the backend treats an UNDO on a fresh score as a no-op.
    if (hasPointsToUndo) {
      if (undoTarget) {
        animateUndo(undoTarget);
      }

      playSound(SOUND_IDS.UNDO);
    }
  } catch (err) {
    console.error("Undo failed:", err);
    showToast(
      "Undo failed to save: " + (err.message || "Unknown error"),
      TOAST_TYPES.ERROR,
    );
  }
}
