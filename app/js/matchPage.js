// Composition root of the match page (app/match.html, /m/{matchId}). The
// page follows the durable match, not a court: when the match moves courts
// or finishes, the same URL keeps showing it.
import { getCourt } from "./firebase/courtRepository.js";
import {
  listenToMatch,
  listenToMatchScore,
} from "./firebase/matchRepository.js";
import { getTournamentDirectoryEntry } from "./firebase/tournamentRepository.js";
import { renderMatchNotFound, renderMatchPage } from "./match/matchView.js";

export function parseMatchId(pathname) {
  const match = pathname.replace(/\/+$/, "").match(/^\/(?:app\/)?m\/([^/]+)$/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

function start() {
  const container = document.getElementById("matchApp");
  const matchId = parseMatchId(window.location.pathname);
  if (!matchId) {
    renderMatchNotFound(container, null);
    return;
  }

  const state = {
    match: null,
    score: null,
    court: null,
    tournament: null,
    courtId: null,
    tournamentLoaded: false,
  };
  const render = () => {
    if (state.match) renderMatchPage(container, { matchId, ...state });
  };

  listenToMatch(
    matchId,
    async (snap) => {
      if (!snap.exists()) {
        renderMatchNotFound(container, matchId);
        return;
      }
      state.match = snap.data();
      const courtId = state.match.currentCourtId || null;
      if (courtId !== state.courtId) {
        state.courtId = courtId;
        state.court = null;
        if (courtId) {
          const courtSnap = await getCourt(courtId).catch(() => null);
          if (state.courtId === courtId) {
            state.court = courtSnap?.exists() ? courtSnap.data() : null;
          }
        }
      }
      if (state.match.tournamentId && !state.tournamentLoaded) {
        state.tournamentLoaded = true;
        const entry = await getTournamentDirectoryEntry(
          state.match.tournamentId,
        ).catch(() => null);
        state.tournament = entry?.exists() ? entry.data() : null;
      }
      render();
    },
    () => renderMatchNotFound(container, matchId),
  );

  listenToMatchScore(
    matchId,
    (snap) => {
      state.score = snap.exists() ? snap.data() : null;
      render();
    },
    (error) => console.warn("Score listener error:", error),
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
