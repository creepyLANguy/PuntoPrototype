// Match Details modal (#detailsModal): loading the detailed score, rendering the
// set table and overall score, the expandable stats panel and preparing the
// shareable score card once the render is complete.
import { NAV_PAGES } from "../config/routes.js";
import { fitAdvancedStatsColumns, renderAdvancedStats } from "./advancedStats.js";
import { hideMomentumPanel, loadMomentumGraph } from "./momentum.js";
import { getDetailedScore } from "../firebase/callables.js";
import { stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { normalizeScoringOptions } from "../scoring/options.js";
import { isScoreboardSwapped } from "../scoring/scoreboard.js";
import { cacheShareableScoreCard } from "../sharing/imageCapture.js";
import { shareCardState } from "../sharing/shareCardState.js";
import { canShareFiles } from "../sharing/shareCardAssets.js";
import { session } from "../state/sessionState.js";
import { normalizePlayerNames } from "../teams/playerNames.js";
import { $, elements } from "../ui/dom.js";

export function registerMatchDetailsControls()
{
  // DETAILS MODAL logic
  elements.detailsBtn.addEventListener("click", () =>
  {
    void showMatchDetails();
  });

  if (elements.dmDetailsToggle)
  {
    elements.dmDetailsToggle.addEventListener("click", () =>
    {
      const expanded = elements.dmDetailsToggle.getAttribute("aria-expanded") === "true";
      setDetailsPanelExpanded(!expanded);
    });
  }

  elements.closeDetailsBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({
      page: NAV_PAGES.SCOREBOARD,
      courtId: session.currentCourtId,
      spectate: session.isSpectating
    }));
  });

  elements.detailsModal.addEventListener("click", (e) =>
  {
    if (e.target === elements.detailsModal)
      void stepBackInApp(createViewState({
        page: NAV_PAGES.SCOREBOARD,
        courtId: session.currentCourtId,
        spectate: session.isSpectating
      }));
  });
}

function setDetailsPanelExpanded(isExpanded)
{
  if (!elements.dmDetailsToggle || !elements.dmDetailsContent)
  {
    return;
  }

  elements.dmDetailsToggle.setAttribute("aria-expanded", isExpanded ? "true" : "false");
  elements.dmDetailsToggle.querySelector(".dm-details-toggle-hint").textContent = isExpanded ? "Tap to collapse" : "Tap to expand";
  elements.dmDetailsContent.hidden = !isExpanded;

  if (isExpanded)
  {
    window.requestAnimationFrame(() => fitAdvancedStatsColumns());
  }
}

export function syncDetailsPanelAvailability()
{
  if (!elements.dmDetailsPanel || !elements.dmDetailsToggle)
  {
    return;
  }

  // The panel reveals only once stats are available. Momentum alone is not
  // enough to show the panel: it must have data from the normal details
  // endpoint. This keeps an empty "Detailed Stats" toggle from sitting there
  // while everything's still loading.
  const hasStats = elements.dmStatsWrap && !elements.dmStatsWrap.classList.contains("hidden");

  elements.dmDetailsPanel.classList.toggle("hidden", !hasStats);

  if (!hasStats)
  {
    setDetailsPanelExpanded(false);
  }
}

export async function showMatchDetails(syncHistory = true, expanded = false, refreshing = false)
{
  const shareCaptureGeneration = ++shareCardState.shareableScoreCardGeneration;
  shareCardState.shareableScoreCardImage = null;

  let resolveShareableScoreCardReady;
  let rejectShareableScoreCardReady;

  shareCardState.shareableScoreCardPromise = new Promise((resolve, reject) =>
  {
    resolveShareableScoreCardReady = resolve;
    rejectShareableScoreCardReady = reject;
  });

  const hideShareButtonUntilReady = !refreshing;

  if (hideShareButtonUntilReady && elements.shareDetailsBtn)
  {
    elements.shareDetailsBtn.classList.add("hidden");
  }

  const detailsWasHidden = elements.detailsModal.classList.contains("hidden");

  if (detailsWasHidden)
  {
    elements.shareDetailsBtn?.classList.remove("engagement-animation-disabled");
  }

  elements.detailsModal.classList.remove("hidden");

  if (syncHistory)
  {
    syncCurrentViewState();
  }

  const dmOverall = document.querySelector(".dm-overall");
  const dmTableWrap = document.querySelector(".dm-table-wrap");
  const dmMidSection = document.querySelector(".dm-mid-section");

  const isSwapped = isScoreboardSwapped();

  if (!refreshing)
  {
    if (dmOverall)
    {
      dmOverall.classList.toggle("swapped", isSwapped);
      dmOverall.classList.add("hidden");
      dmTableWrap.classList.add("hidden");
    }
  }

  elements.matchDetailsCourtName.textContent = session.currentCourtName || session.currentCourtId || "Match Details";

  // Populate team names immediately
  const nameA = $("teamA").querySelector(".name-text").textContent;
  const nameB = $("teamB").querySelector(".name-text").textContent;
  const teamAColour = getComputedStyle(document.body).getPropertyValue("--teamAcolour").trim();
  const teamBColour = getComputedStyle(document.body).getPropertyValue("--teamBcolour").trim();
  elements.detailsTeamAName.textContent = isSwapped ? nameB : nameA;
  elements.detailsTeamBName.textContent = isSwapped ? nameA : nameB;
  elements.detailsTeamAName.style.color = isSwapped ? teamBColour : teamAColour;
  elements.detailsTeamBName.style.color = isSwapped ? teamAColour : teamBColour;
  elements.detailsSetsA.style.color = isSwapped ? teamBColour : teamAColour;
  elements.detailsSetsB.style.color = isSwapped ? teamAColour : teamBColour;

  const headRow = elements.dmHead.querySelector("tr");

  if (!refreshing) {
    elements.detailsLoading.classList.remove("hidden");
    elements.shareDetailsBtn.classList.add("hidden");

    // Clear table rows, columns, and momentum graph safely
    headRow.innerHTML = "";
    elements.dmBody.innerHTML = "";
    elements.dmMomentumWrap.classList.add("hidden");
    elements.dmStatsWrap.classList.add("hidden");
    elements.dmStatsTeam.innerHTML = "";
    if (elements.dmEmptyState)
    {
      elements.dmEmptyState.classList.add("hidden");
    }
    if (elements.dmErrorState)
    {
      elements.dmErrorState.classList.add("hidden");
    }
  }

  syncDetailsPanelAvailability();
  setDetailsPanelExpanded(expanded);

  // Deliberately not awaited: the momentum graph reveals itself when its
  // endpoint answers, so nothing below is held up by the heavier replay.
  void loadMomentumGraph(session.currentCourtId);

  // The share card is captured from the rendered modal, so it can only be
  // taken once every branch below has finished populating #dmBox.
  let renderedShareCard = false;

  try
  {
    let result = session.matchDetailsCache;

    const canUseDetailsCache =
      session.isMatchDetailsCacheValid &&
      session.matchDetailsCache &&
      session.matchDetailsCacheCourtId === session.currentCourtId;

    if (canUseDetailsCache == false)
    {
      result = await getDetailedScore({ courtId: session.currentCourtId });

      session.matchDetailsCache = result;
      session.isMatchDetailsCacheValid = true;
      session.matchDetailsCacheCourtId = session.currentCourtId;
    }

    const { sets, currentGames, points, mode, scoringMode, matchComplete } = result.data;
    const resolvedMode = normalizeScoringOptions({ scoringMode: scoringMode || mode }).scoringMode;
    const isStraight = resolvedMode === "straight";
    const isTiebreakTen = resolvedMode === "tiebreakTen";
    const isGamesAndSetsMode = !isStraight && !isTiebreakTen;
    const hasCompletedSets = Array.isArray(sets) && sets.length > 0;
    const hasCurrentSetGames = (Number(currentGames?.A) || 0) > 0 || (Number(currentGames?.B) || 0) > 0;
    const hasAnyPoints = (Number(points?.A) || 0) > 0 || (Number(points?.B) || 0) > 0;
    const hasAnyMatchDetails = isGamesAndSetsMode
      ? (hasCompletedSets || hasCurrentSetGames)
      : (hasCompletedSets || hasCurrentSetGames || hasAnyPoints);

    if (elements.dmEmptyState)
    {
      elements.dmEmptyState.classList.toggle("hidden", hasAnyMatchDetails);
    }

    if (!hasAnyMatchDetails)
    {
      // Nothing to chart either: cancel the in-flight momentum request so it
      // cannot re-open the panel this branch is about to hide.
      session.momentumRequestToken++;
      hideMomentumPanel();

      if (dmOverall)
      {
        dmOverall.classList.add("hidden");
      }
      if (dmTableWrap)
      {
        dmTableWrap.classList.add("hidden");
      }
      if (elements.dmDetailsPanel)
      {
        elements.dmDetailsPanel.classList.add("hidden");
      }
      return;
    }

    // Unpack sets safely or calculate fallbacks from historical sets tracking if missing
    let setsA = result.data.setsA;
    let setsB = result.data.setsB;
    if (setsA === undefined || setsB === undefined)
    {
      setsA = 0;
      setsB = 0;
      if (sets && Array.isArray(sets))
      {
        sets.forEach(s =>
        {
          if (s.A > s.B) setsA++;
          if (s.B > s.A) setsB++;
        });
      }
    }

    if (dmOverall)
    {
      dmOverall.classList.remove("hidden");
    }

    if (isStraight || isTiebreakTen)
    {
      // 1) Hide the breakdown table completely since individual sets are not tracked
      if (dmTableWrap) dmTableWrap.classList.add("hidden");

      // 2) Populate the main sets labels with the cumulative match points
      elements.detailsSetsA.textContent = (points && points.A !== undefined) ? points.A : 0;
      elements.detailsSetsB.textContent = (points && points.B !== undefined) ? points.B : 0;

      const detailsPlayerNames = normalizePlayerNames(result?.data?.playerNames || session.currentPlayerNames || {});
      renderAdvancedStats(result.data.advancedStats, { A: nameA, B: nameB }, isSwapped, detailsPlayerNames);
      syncDetailsPanelAvailability();
      return;
    }

    // Normal Scoring Mode remains perfectly untouched
    if (dmTableWrap) dmTableWrap.classList.remove("hidden");

    // Populate overall set scores normally (e.g. 0 and 2)
    elements.detailsSetsA.textContent = setsA;
    elements.detailsSetsB.textContent = setsB;

    const hasCurrentSet = !matchComplete && hasCurrentSetGames;
    const allSets = hasCurrentSet ? [...sets, currentGames] : [...sets];

    // Build table header columns: [marker] S1 S2 S3 ...
    const mkTh = (text, extraClass) =>
    {
      const th = document.createElement("th");
      th.textContent = text;
      if (extraClass) th.className = extraClass;
      return th;
    };

    headRow.innerHTML = "";
    headRow.appendChild(mkTh(""));
    allSets.forEach((_, i) =>
    {
      const isCurrentSet = hasCurrentSet && i === allSets.length - 1;
      headRow.appendChild(mkTh(`S${i + 1}`, isCurrentSet ? "dm-current-set" : ""));
    });

    // Helper to construct team score table rows
    const mkRow = (team, setsData) =>
    {
      const tr = document.createElement("tr");
      tr.className = `dm-row-${team}`;

      const markerTd = document.createElement("td");
      markerTd.className = "dm-marker-cell";
      markerTd.appendChild(document.createElement("span"));
      tr.appendChild(markerTd);

      setsData.forEach((s, i) =>
      {
        if (s)
        {
          const td = document.createElement("td");
          const teamScore = team === "a" ? s.A : s.B;
          const opponentScore = team === "a" ? s.B : s.A;
          td.textContent = teamScore !== undefined ? teamScore : 0;

          const isCurrentSet = hasCurrentSet && i === setsData.length - 1;
          if (!isCurrentSet && teamScore > opponentScore) td.classList.add("dm-won");
          if (isCurrentSet) td.classList.add("dm-current-set");

          tr.appendChild(td);
        }
      });

      return tr;
    };

    elements.dmBody.innerHTML = "";
    isSwapped ? elements.dmBody.appendChild(mkRow("b", allSets)) : elements.dmBody.appendChild(mkRow("a", allSets));
    isSwapped ? elements.dmBody.appendChild(mkRow("a", allSets)) : elements.dmBody.appendChild(mkRow("b", allSets));

    const detailsPlayerNames = normalizePlayerNames(result?.data?.playerNames || session.currentPlayerNames || {});
    renderAdvancedStats(result.data.advancedStats, { A: nameA, B: nameB }, isSwapped, detailsPlayerNames);
    syncDetailsPanelAvailability();

    renderedShareCard = true;
  }
  catch (err)
  {
    elements.dmErrorState.classList.remove("hidden");
    console.error("Match details initialization error:", err);
  }
  finally
  {
    elements.detailsLoading.classList.add("hidden");

    // Old share files are invalidated when a new details render starts, and
    // the current share waits for its capture to finish before using a file.
    if (renderedShareCard && canShareFiles())
    {
      const capturePromise = cacheShareableScoreCard(shareCaptureGeneration);

      capturePromise
        .then(() =>
        {
          resolveShareableScoreCardReady();
        })
        .catch(err =>
        {
          console.error("Share card capture failed:", err);

          if (shareCaptureGeneration === shareCardState.shareableScoreCardGeneration)
          {
            shareCardState.shareableScoreCardImage = null;
          }

          rejectShareableScoreCardReady(err);
        })
        .finally(() =>
        {
          if (hideShareButtonUntilReady &&
              shareCaptureGeneration === shareCardState.shareableScoreCardGeneration &&
              elements.shareDetailsBtn)
          {
            elements.shareDetailsBtn.classList.remove("hidden");
          }
        });
    }
    else
    {
      resolveShareableScoreCardReady();

      if (hideShareButtonUntilReady &&
          shareCaptureGeneration === shareCardState.shareableScoreCardGeneration &&
          elements.shareDetailsBtn)
      {
        elements.shareDetailsBtn.classList.remove("hidden");
      }
    }
  }
}
