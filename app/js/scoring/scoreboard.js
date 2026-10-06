// Scoreboard rendering: points, games and sets, the score format badge, the
// set-win overlay, team names and the court / page titles.
import { playSound } from "../audio/audio.js";
import { SOUND_IDS } from "../config/constants.js";
import BRAND from "../brand.mjs";
import { resolveScoreDisplayOptions } from "./options.js";
import {
  getCriticalPointStatus,
  getFixedTotalDisplayResult,
  pointLabel,
} from "./presentation.js";
import { updateServerIndicator } from "./serverIndicator.js";
import { session } from "../state/sessionState.js";
import { $, elements } from "../ui/dom.js";

// The match identity is the primary title; the court is secondary physical
// location context (spec section 30).
export function showCourtTitle(name, location = null) {
  const existing = document.getElementById("courtTitle");
  if (existing) {
    existing.textContent = name;
  }
  const locationEl = document.getElementById("courtLocation");
  if (locationEl) {
    locationEl.textContent = location || "";
    locationEl.classList.toggle("hidden", !location);
  }
  const separator = document.getElementById("courtLocationSeparator");
  if (separator) {
    separator.classList.toggle("hidden", !location);
  }
  if (existing || locationEl) {
    updateMarqueeScrolling();
  }
}

export function updatePageTitle(
  courtName = null,
  courtId = null,
  matchTitle = null,
) {
  if (!courtName || !courtId) {
    document.title = BRAND.name + " - " + BRAND.app.title;
    return;
  }

  const location = `${courtName} (${courtId.toUpperCase()})`;
  document.title = matchTitle
    ? `${matchTitle} - ${location} | ${BRAND.name}`
    : `${location} | ${BRAND.name}`;
}

export function updateMarqueeScrolling() {
  const container = document.querySelector(".marquee-wrapper");
  const content = document.querySelector(".marquee-content");
  if (!container || !content) return;

  // Reset before measuring
  content.classList.remove("scrolling");
  content.style.removeProperty("--marquee-vertical-offset");

  const isLandscape =
    window.innerHeight < window.innerWidth &&
    window.matchMedia("(orientation: landscape)").matches;

  if (isLandscape) {
    const containerHeight = container.clientHeight;
    if (containerHeight > 0 && content.scrollHeight > containerHeight) {
      content.style.setProperty(
        "--marquee-vertical-offset",
        `${containerHeight}px`,
      );
      content.classList.add("scrolling");
    }
  } else {
    if (content.scrollWidth > container.clientWidth) {
      content.classList.add("scrolling");
    }
  }
}

export function updateScoreFormatBadge() {
  if (!elements.scoreFormatBadge) return;

  const options = resolveScoreDisplayOptions(session.score);
  const total =
    (session.score.A.totalPoints || 0) + (session.score.B.totalPoints || 0);
  let label = "";

  if (options.scoringMode === "straight") {
    label = `Straight points - total ${total}`;
  } else if (options.scoringMode === "tiebreakTen") {
    label = "Tiebreak Tens - first to 10, win by 2";
  } else if (options.scoringMode === "fixedTotalPoints") {
    const played =
      (session.score.A.points || 0) + (session.score.B.points || 0);
    const target = Number(options.pointsTarget) || played;
    label = session.score.matchComplete
      ? `${target} points - match complete`
      : `${played} of ${target} points - ${Math.max(0, target - played)} left`;
    if (session.score.fixedTotal?.sidesSwapped) label += " - sides swapped";
  } else if (session.score.inTiebreak) {
    label =
      options.tiebreakMode === "sixAllTen"
        ? "10-point tiebreak"
        : "7-point tiebreak";
  }

  elements.scoreFormatBadge.textContent = label;
  elements.scoreFormatBadge.classList.toggle("hidden", !label);
}

export function updateUI() {
  updateScoreFormatBadge();

  const options = resolveScoreDisplayOptions(session.score);
  const standardFormat = options.scoringMode === "standard";

  // Hide sets/games if not applicable
  document
    .querySelectorAll(".sets-row")
    .forEach((el) => el.classList.toggle("hidden", !standardFormat));
  document
    .querySelectorAll(".games-row")
    .forEach((el) => el.classList.toggle("hidden", !standardFormat));

  // Update straight-points total display
  const isStraight =
    options.scoringMode === "straight" ||
    options.scoringMode === "fixedTotalPoints";
  if (elements.straightPointsTotal) {
    elements.straightPointsTotal.classList.toggle("hidden", !isStraight);
    if (isStraight && elements.straightTotalValue) {
      const total =
        (session.score.A.totalPoints || 0) + (session.score.B.totalPoints || 0);
      elements.straightTotalValue.textContent =
        options.scoringMode === "fixedTotalPoints"
          ? `${total}/${options.pointsTarget}`
          : total;
    }
  }

  // Update critical point indicators
  const criticalStatus = getCriticalPointStatus(session.score);

  ["A", "B"].forEach((team) => {
    renderSets(team);
    renderGames(team);

    const pointText = pointLabel(session.score[team].points);
    elements.points[team].textContent = pointText;

    const criticalGlow =
      elements.points[team].parentElement.querySelector(".critical-glow");
    if (criticalGlow) {
      criticalGlow.textContent = pointText;
    }

    document.querySelector(`#team${team} .indicator`).style.opacity =
      session.score.lastPointTeam === team ? 1 : 0;

    // Keep the semantic critical state on the score and animate only its separate glow layer.
    const statusVal = criticalStatus[team];
    elements.points[team].classList.toggle("is-critical", !!statusVal);
    if (criticalGlow) {
      criticalGlow.classList.toggle("is-critical", !!statusVal);
    }

    // Keep the badge element hidden (replaced by the separate glow layer)
    const badge = elements.critical[team];
    if (badge) badge.classList.add("hidden");
  });

  // Detect Set Win - Only check if session is baseline-synced
  if (session.sessionInitialized) {
    const fixedResult = getFixedTotalDisplayResult(session.score);
    if (options.scoringMode === "fixedTotalPoints") {
      if (fixedResult && fixedResult !== session.lastKnownFixedResult) {
        triggerSetWinAnimation(fixedResult);
      }
    } else if (session.score.A.sets > session.lastKnownSets.A) {
      triggerSetWinAnimation("A");
    } else if (session.score.B.sets > session.lastKnownSets.B) {
      triggerSetWinAnimation("B");
    }

    // Update baseline after detecting increments
    session.lastKnownSets.A = session.score.A.sets;
    session.lastKnownSets.B = session.score.B.sets;
    session.lastKnownFixedResult = fixedResult;
  }

  updateServerIndicator();
}

function triggerSetWinAnimation(team) {
  const isMenuVisible =
    elements.settingsModal &&
    window.getComputedStyle(elements.settingsModal).display !== "none";
  if (isMenuVisible) {
    return;
  }

  const overlay = elements.setWinOverlay;
  if (!overlay) return;

  const teamNameEl = overlay.querySelector(".set-win-team-name");
  const nameA = $("teamA").querySelector(".name-text").textContent;
  const nameB = $("teamB").querySelector(".name-text").textContent;

  const isDraw = team === "draw";
  teamNameEl.textContent = isDraw
    ? `${nameA} & ${nameB}`
    : team === "A" ? nameA : nameB;
  overlay.dataset.winner = team;

  const displayMode = resolveScoreDisplayOptions(session.score).scoringMode;
  const endsMatch =
    displayMode === "tiebreakTen" || displayMode === "fixedTotalPoints";
  overlay.querySelector(".set-win-label").textContent = isDraw
    ? "MATCH DRAW!"
    : endsMatch ? "WINS THE MATCH!" : "WINS THE SET!";

  overlay.querySelector(".sw-score-a").textContent = endsMatch
    ? session.score.A.points
    : session.score.A.sets;
  overlay.querySelector(".sw-score-b").textContent = endsMatch
    ? session.score.B.points
    : session.score.B.sets;

  // Remove hidden immediately to start transition
  overlay.classList.remove("hidden");

  playSound(SOUND_IDS.SET); // Respect mute setting

  // Clear any previous timeout to avoid multiple hide calls
  if (overlay.hideTimeout) clearTimeout(overlay.hideTimeout);

  overlay.hideTimeout = setTimeout(() => {
    overlay.classList.add("hidden");
  }, 4500);

  // Initialise click-to-dismiss only once
  if (!overlay.onclick) {
    overlay.onclick = () => {
      overlay.classList.add("hidden");
      if (overlay.hideTimeout) clearTimeout(overlay.hideTimeout);
    };
  }
}

function renderSets(team) {
  const el = elements.sets[team];
  const opp = team === "A" ? "B" : "A";

  const teamSets = session.score[team].sets;
  const oppSets = session.score[opp].sets;
  const maxSets = Math.max(teamSets, oppSets, 3);

  el.innerHTML = "";

  for (let i = 0; i < maxSets; i++) {
    const dot = document.createElement("span");
    dot.className = "set-dot";
    dot.setAttribute("data-team", team);

    if (i < teamSets) {
      dot.classList.add("filled");
    }

    if (i === teamSets - 1 && session.score.lastSetTeam === team) {
      dot.classList.add("recent");
    }

    el.appendChild(dot);
  }
}

function renderGames(team) {
  const el = elements.games[team];
  const opp = team === "A" ? "B" : "A";

  const teamGames = session.score[team].games;
  const oppGames = session.score[opp].games;
  const maxGames = Math.max(teamGames, oppGames, 6);

  el.innerHTML = "";

  for (let i = 0; i < maxGames; i++) {
    const dot = document.createElement("span");
    dot.className = "game-dot";
    if (i < teamGames) dot.classList.add("filled");
    el.appendChild(dot);
  }
}

export function isScoreboardSwapped() {
  return (
    document.querySelector(".scoreboard")?.classList.contains("swapped") ||
    false
  );
}

export function applyTeamNamesToScoreboard(teamNames) {
  const nameA = $("teamA")?.querySelector(".name-text");
  const nameB = $("teamB")?.querySelector(".name-text");

  if (nameA) {
    nameA.textContent = teamNames.A || "Team A";
    fitTextToContainer(nameA);
  }

  if (nameB) {
    nameB.textContent = teamNames.B || "Team B";
    fitTextToContainer(nameB);
  }
}

export function fitTextToContainer(textEl) {
  const container = textEl.parentElement;

  textEl.style.transform = "scale(1)";

  const containerWidth = container.clientWidth;
  const textWidth = textEl.scrollWidth;

  if (textWidth > containerWidth) {
    const scale = containerWidth / textWidth;
    textEl.style.transform = `scale(${scale})`;
  }
}
