// Scoreboard rendering: points, games and sets, the score format badge, the
// set-win overlay, team names and the court / page titles.
import { playSound } from "../audio/audio.js";
import { SOUND_IDS } from "../config/constants.js";
import BRAND from "../brand.mjs";
import { resolveScoreDisplayOptions } from "./options.js";
import { getCriticalPointStatus, pointLabel } from "./presentation.js";
import { updateServerIndicator } from "./serverIndicator.js";
import { session } from "../state/sessionState.js";
import { $, elements } from "../ui/dom.js";

export function showCourtTitle(name)
{
  const existing = document.getElementById("courtTitle");
  if (existing)
  {
    existing.textContent = name;
    updateMarqueeScrolling();
  }
}

export function updatePageTitle(courtName = null, courtId = null)
{
  if (!courtName || !courtId)
  {
    document.title = BRAND.name + " - " + BRAND.app.title;
    return;
  }

  document.title = `${courtName} (${courtId.toUpperCase()}) | ${BRAND.name}`;
}

export function updateMarqueeScrolling()
{
  const container = document.querySelector(".marquee-wrapper");
  const content = document.querySelector(".marquee-content");
  if (!container || !content) return;

  // Reset before measuring
  content.classList.remove("scrolling");
  content.style.removeProperty("--marquee-vertical-offset");

  const isLandscape = window.innerHeight < window.innerWidth && window.matchMedia("(orientation: landscape)").matches;

  if (isLandscape)
  {
    const containerHeight = container.clientHeight;
    if (containerHeight > 0 && content.scrollHeight > containerHeight)
    {
      content.style.setProperty("--marquee-vertical-offset", `${containerHeight}px`);
      content.classList.add("scrolling");
    }
  }
  else
  {
    if (content.scrollWidth > container.clientWidth)
    {
      content.classList.add("scrolling");
    }
  }
}

export function updateScoreFormatBadge()
{
  if (!elements.scoreFormatBadge) return;

  const options = resolveScoreDisplayOptions(session.score);
  const total = (session.score.A.totalPoints || 0) + (session.score.B.totalPoints || 0);
  let label = "";

  if (options.scoringMode === "straight")
  {
    label = `Straight points - total ${total}`;
  }
  else if (options.scoringMode === "tiebreakTen")
  {
    label = "Tiebreak Tens - first to 10, win by 2";
  }
  else if (session.score.inTiebreak)
  {
    label = options.tiebreakMode === "sixAllTen" ? "10-point tiebreak" : "7-point tiebreak";
  }

  elements.scoreFormatBadge.textContent = label;
  elements.scoreFormatBadge.classList.toggle("hidden", !label);
}

export function updateUI()
{
  updateScoreFormatBadge();

  const options = resolveScoreDisplayOptions(session.score);
  const standardFormat = options.scoringMode === "standard";

  // Hide sets/games if not applicable
  document.querySelectorAll(".sets-row").forEach(el => el.classList.toggle("hidden", !standardFormat));
  document.querySelectorAll(".games-row").forEach(el => el.classList.toggle("hidden", !standardFormat));

  // Update straight-points total display
  const isStraight = options.scoringMode === "straight";
  if (elements.straightPointsTotal)
  {
    elements.straightPointsTotal.classList.toggle("hidden", !isStraight);
    if (isStraight && elements.straightTotalValue)
    {
      const total = (session.score.A.totalPoints || 0) + (session.score.B.totalPoints || 0);
      elements.straightTotalValue.textContent = total;
    }
  }

  // Update critical point indicators
  const criticalStatus = getCriticalPointStatus(session.score);

  ["A", "B"].forEach(team =>
  {
    renderSets(team);
    renderGames(team);
    elements.points[team].textContent = pointLabel(session.score[team].points);

    document.querySelector(`#team${team} .indicator`).style.opacity =
      session.score.lastPointTeam === team ? 1 : 0;

    // Toggle critical pulsate on the score display
    const statusVal = criticalStatus[team];
    elements.points[team].classList.toggle("is-critical", !!statusVal);

    // Keep the badge element hidden (replaced by pulsate effect)
    const badge = elements.critical[team];
    if (badge) badge.classList.add("hidden");
  });

  // Detect Set Win - Only check if session is baseline-synced
  if (session.sessionInitialized)
  {
    if (session.score.A.sets > session.lastKnownSets.A)
    {
      triggerSetWinAnimation("A");
    }
    else if (session.score.B.sets > session.lastKnownSets.B)
    {
      triggerSetWinAnimation("B");
    }

    // Update baseline after detecting increments
    session.lastKnownSets.A = session.score.A.sets;
    session.lastKnownSets.B = session.score.B.sets;
  }

  updateServerIndicator();
}

function triggerSetWinAnimation(team)
{
  const isMenuVisible = elements.settingsModal && window.getComputedStyle(elements.settingsModal).display !== "none";
  if (isMenuVisible)
  {
    return;
  }

  const overlay = elements.setWinOverlay;
  if (!overlay) return;

  const teamNameEl = overlay.querySelector(".set-win-team-name");
  const nameA = $("teamA").querySelector(".name-text").textContent;
  const nameB = $("teamB").querySelector(".name-text").textContent;

  teamNameEl.textContent = team === "A" ? nameA : nameB;
  overlay.dataset.winner = team;

  const isTiebreakTen = resolveScoreDisplayOptions(session.score).scoringMode === "tiebreakTen";
  overlay.querySelector(".set-win-label").textContent = isTiebreakTen ? "WINS THE MATCH!" : "WINS THE SET!";

  overlay.querySelector(".sw-score-a").textContent = isTiebreakTen ? session.score.A.points : session.score.A.sets;
  overlay.querySelector(".sw-score-b").textContent = isTiebreakTen ? session.score.B.points : session.score.B.sets;

  // Remove hidden immediately to start transition
  overlay.classList.remove("hidden");

  playSound(SOUND_IDS.SET); // Respect mute setting

  // Clear any previous timeout to avoid multiple hide calls
  if (overlay.hideTimeout) clearTimeout(overlay.hideTimeout);

  overlay.hideTimeout = setTimeout(() =>
  {
    overlay.classList.add("hidden");
  }, 4500);

  // Initialise click-to-dismiss only once
  if (!overlay.onclick)
  {
    overlay.onclick = () =>
    {
      overlay.classList.add("hidden");
      if (overlay.hideTimeout) clearTimeout(overlay.hideTimeout);
    };
  }
}

function renderSets(team)
{
  const el = elements.sets[team];
  const opp = team === "A" ? "B" : "A";

  const teamSets = session.score[team].sets;
  const oppSets = session.score[opp].sets;
  const maxSets = Math.max(teamSets, oppSets, 3);

  el.innerHTML = "";

  for (let i = 0; i < maxSets; i++)
  {
    const dot = document.createElement("span");
    dot.className = "set-dot";
    dot.setAttribute("data-team", team);

    if (i < teamSets)
    {
      dot.classList.add("filled");
    }

    if (i === teamSets - 1 && session.score.lastSetTeam === team)
    {
      dot.classList.add("recent");
    }

    el.appendChild(dot);
  }
}

function renderGames(team)
{
  const el = elements.games[team];
  const opp = team === "A" ? "B" : "A";

  const teamGames = session.score[team].games;
  const oppGames = session.score[opp].games;
  const maxGames = Math.max(teamGames, oppGames, 6);

  el.innerHTML = "";

  for (let i = 0; i < maxGames; i++)
  {
    const dot = document.createElement("span");
    dot.className = "game-dot";
    if (i < teamGames) dot.classList.add("filled");
    el.appendChild(dot);
  }
}

export function isScoreboardSwapped()
{
  return document.querySelector(".scoreboard")?.classList.contains("swapped") || false;
}

export function applyTeamNamesToScoreboard(teamNames)
{
  const nameA = $("teamA")?.querySelector(".name-text");
  const nameB = $("teamB")?.querySelector(".name-text");

  if (nameA)
  {
    nameA.textContent = teamNames.A || "Team A";
    fitTextToContainer(nameA);
  }

  if (nameB)
  {
    nameB.textContent = teamNames.B || "Team B";
    fitTextToContainer(nameB);
  }
}

export function fitTextToContainer(textEl)
{
  const container = textEl.parentElement;

  textEl.style.transform = "scale(1)";

  const containerWidth = container.clientWidth;
  const textWidth = textEl.scrollWidth;

  if (textWidth > containerWidth)
  {
    const scale = containerWidth / textWidth;
    textEl.style.transform = `scale(${scale})`;
  }
}
