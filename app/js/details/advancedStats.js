// Match Details advanced statistics table (#dmStatsTeam): rendering the per-team
// stats and fitting its columns to the available width.
import { DEFAULT_PLAYER_NAMES } from "../config/constants.js";
import { syncDetailsPanelAvailability } from "./matchDetails.js";
import { normalizeScoringOptions } from "../scoring/options.js";
import { getPlayerDisplayName } from "../teams/playerNames.js";
import { elements } from "../ui/dom.js";
import { formatPct } from "../utils/formatting.js";

export function registerAdvancedStatsResize()
{
  window.addEventListener("resize", fitAdvancedStatsColumns);
}

// Long team-value strings (especially the final player-stat rows) can be
// wider than their fixed table column on narrow mobile screens. Keep the
// value columns at their normal width unless they actually overflow, then
// take only the required space from the label column.
export function fitAdvancedStatsColumns()
{
  const table = elements.dmStatsTeam?.querySelector(".dm-stats-table");
  if (!table) return;

  table.style.setProperty("--dm-st-label-width", "28%");
  table.style.setProperty("--dm-st-primary-width", "36%");
  table.style.setProperty("--dm-st-secondary-width", "36%");

  const tableWidth = table.getBoundingClientRect().width;
  if (!tableWidth) return;

  const primaryCells = Array.from(
    table.querySelectorAll("tbody .dm-st-val:nth-child(2) .dm-st-value-content")
  );
  const secondaryCells = Array.from(
    table.querySelectorAll("tbody .dm-st-val:nth-child(3) .dm-st-value-content")
  );

  const getRequiredWidth = (contents, baseWidth) =>
  {
    return contents.reduce((required, content) =>
    {
      return Math.max(required, content.getBoundingClientRect().width, baseWidth);
    }, baseWidth);
  };

  const baseLabelWidth = tableWidth * 0.28;
  const baseTeamWidth = tableWidth * 0.36;
  const requiredPrimaryWidth = getRequiredWidth(primaryCells, baseTeamWidth);
  const requiredSecondaryWidth = getRequiredWidth(secondaryCells, baseTeamWidth);

  const extraPrimary = Math.max(0, requiredPrimaryWidth - baseTeamWidth);
  const extraSecondary = Math.max(0, requiredSecondaryWidth - baseTeamWidth);
  const totalExtra = extraPrimary + extraSecondary;
  if (!totalExtra) return;

  // Preserve enough room for the label column to remain readable. When the
  // requested adjustment is within that budget, allocate exactly the space
  // needed by each overflowing team column.
  const minimumLabelWidth = Math.max(44, tableWidth * 0.14);
  const availableLabelReduction = Math.max(0, baseLabelWidth - minimumLabelWidth);
  if (!availableLabelReduction) return;

  const adjustmentScale = Math.min(1, availableLabelReduction / totalExtra);
  const labelWidth = baseLabelWidth - totalExtra * adjustmentScale;
  const primaryWidth = baseTeamWidth + extraPrimary * adjustmentScale;
  const secondaryWidth = baseTeamWidth + extraSecondary * adjustmentScale;

  table.style.setProperty("--dm-st-label-width", ((labelWidth / tableWidth) * 100) + "%");
  table.style.setProperty("--dm-st-primary-width", ((primaryWidth / tableWidth) * 100) + "%");
  table.style.setProperty("--dm-st-secondary-width", ((secondaryWidth / tableWidth) * 100) + "%");
}

export function renderAdvancedStats(advancedStats, teamNames, isSwapped = false, playerNames = DEFAULT_PLAYER_NAMES)
{
  if (!elements.dmStatsWrap || !elements.dmStatsTeam)
  {
    return;
  }

  if (!advancedStats || !advancedStats.teamStats || !advancedStats.matchStats)
  {
    elements.dmStatsWrap.classList.add("hidden");
    syncDetailsPanelAvailability();
    return;
  }

  const { teamStats, matchStats } = advancedStats;
  const sA = teamStats.A;
  const sB = teamStats.B;
  if (!sA || !sB)
  {
    elements.dmStatsWrap.classList.add("hidden");
    syncDetailsPanelAvailability();
    return;
  }

  const resolvedScoringMode = normalizeScoringOptions({ scoringMode: advancedStats.scoringMode }).scoringMode;
  const isGamesAndSetsMode = resolvedScoringMode === "standard";
  const isGoldenMode = isGamesAndSetsMode && advancedStats.deuceMode === "golden";
  const isSilverMode = isGamesAndSetsMode && advancedStats.deuceMode === "silver";
  const isStarMode = isGamesAndSetsMode && advancedStats.deuceMode === "star";
  const primaryTeamKey = isSwapped ? "B" : "A";
  const secondaryTeamKey = isSwapped ? "A" : "B";
  const primaryTeamName = teamNames[primaryTeamKey];
  const secondaryTeamName = teamNames[secondaryTeamKey];
  const primaryTeamStats = primaryTeamKey === "A" ? sA : sB;
  const secondaryTeamStats = secondaryTeamKey === "A" ? sA : sB;
  const primaryClassSuffix = primaryTeamKey.toLowerCase();
  const secondaryClassSuffix = secondaryTeamKey.toLowerCase();
  const primaryColour = primaryTeamKey === "A" ? "var(--teamAcolour)" : "var(--teamBcolour)";
  const secondaryColour = secondaryTeamKey === "A" ? "var(--teamAcolour)" : "var(--teamBcolour)";

  const totalPoints = Number(matchStats.totalPoints) || 0;
  const deuceGames = Number(matchStats.deuceGames) || 0;
  const goldenPointsPlayed = Number(matchStats.goldenPointsPlayed) || 0;
  const silverPointsPlayed = Number(matchStats.silverPointsPlayed) || 0;
  const starPointsPlayed = Number(matchStats.starPointsPlayed) || 0;

  function row(label, valPrimary, valSecondary, primaryLeader = false, secondaryLeader = false)
  {
    return `<tr class="dm-st-row">
        <td class="dm-st-label">${label}</td>
        <td class="dm-st-val dm-st-${primaryClassSuffix} ${primaryLeader ? "is-leader" : ""} ${secondaryLeader ? "is-loser" : ""}"><span class="dm-st-value-content">${valPrimary}</span></td>
        <td class="dm-st-val dm-st-${secondaryClassSuffix} ${secondaryLeader ? "is-leader" : ""} ${primaryLeader ? "is-loser" : ""}"><span class="dm-st-value-content">${valSecondary}</span></td>
      </tr>`;
  }

  function sharedRow(label, val)
  {
    return `<tr class="dm-st-row">
        <td class="dm-st-label">${label}</td>
        <td class="dm-st-shared" colspan="2">${val}</td>
      </tr>`;
  }

  function sectionRow(label)
  {
    return `<tr class="dm-st-section-hdr"><td colspan="3">${label}</td></tr>`;
  }

  function barRow(label, pctPrimary, pctSecondary, lblPrimary, lblSecondary, primaryLeader = false, secondaryLeader = false)
  {
    const safePrimary = Math.max(0, Math.min(100, Number(pctPrimary) || 0));
    const safeSecondary = Math.max(0, Math.min(100, Number(pctSecondary) || 0));
    return `<tr class="dm-st-row dm-st-bar-row">
        <td class="dm-st-label">${label}</td>
        <td class="dm-st-bar-cell" colspan="2">
          <div class="dm-split-bar">
            <span class="dm-split-lbl-a ${primaryLeader ? "is-leader" : ""} ${secondaryLeader ? "is-loser" : ""}" style="color:${primaryColour};">${lblPrimary}</span>
            <div class="dm-split-track">
              <div class="dm-split-fill-a" style="width:${safePrimary}%; background:${primaryColour};"></div>
              <div class="dm-split-fill-b" style="flex:0 0 ${safeSecondary}%; background:${secondaryColour};"></div>
            </div>
            <span class="dm-split-lbl-b ${secondaryLeader ? "is-leader" : ""} ${primaryLeader ? "is-loser" : ""}" style="color:${secondaryColour};">${lblSecondary}</span>
          </div>
        </td>
      </tr>`;
  }

  const primaryDeuceWon = Number(primaryTeamStats.gamesWonAfterDeuce) || 0;
  const secondaryDeuceWon = Number(secondaryTeamStats.gamesWonAfterDeuce) || 0;
  const primaryDeucePctRaw = Number(primaryTeamStats.gamesWonAfterDeucePct);
  const secondaryDeucePctRaw = Number(secondaryTeamStats.gamesWonAfterDeucePct);
  const primaryDeucePct = Number.isFinite(primaryDeucePctRaw)
    ? primaryDeucePctRaw
    : (deuceGames > 0 ? (primaryDeuceWon / deuceGames) * 100 : 0);
  const secondaryDeucePct = Number.isFinite(secondaryDeucePctRaw)
    ? secondaryDeucePctRaw
    : (deuceGames > 0 ? (secondaryDeuceWon / deuceGames) * 100 : 0);
  const primarySilverWon = Number(primaryTeamStats.silverPointsWon) || 0;
  const secondarySilverWon = Number(secondaryTeamStats.silverPointsWon) || 0;
  const primarySilverPctRaw = Number(primaryTeamStats.silverPointWinPct);
  const secondarySilverPctRaw = Number(secondaryTeamStats.silverPointWinPct);
  const primarySilverPct = Number.isFinite(primarySilverPctRaw)
    ? primarySilverPctRaw
    : (silverPointsPlayed > 0 ? (primarySilverWon / silverPointsPlayed) * 100 : 0);
  const secondarySilverPct = Number.isFinite(secondarySilverPctRaw)
    ? secondarySilverPctRaw
    : (silverPointsPlayed > 0 ? (secondarySilverWon / silverPointsPlayed) * 100 : 0);
  const primaryStarWon = Number(primaryTeamStats.starPointsWon) || 0;
  const secondaryStarWon = Number(secondaryTeamStats.starPointsWon) || 0;
  const primaryStarPctRaw = Number(primaryTeamStats.starPointWinPct);
  const secondaryStarPctRaw = Number(secondaryTeamStats.starPointWinPct);
  const primaryStarPct = Number.isFinite(primaryStarPctRaw)
    ? primaryStarPctRaw
    : (starPointsPlayed > 0 ? (primaryStarWon / starPointsPlayed) * 100 : 0);
  const secondaryStarPct = Number.isFinite(secondaryStarPctRaw)
    ? secondaryStarPctRaw
    : (starPointsPlayed > 0 ? (secondaryStarWon / starPointsPlayed) * 100 : 0);
  const deuceGamesLabel = isGoldenMode ? "Golden Pts" : "Games";

  const rows = [
    barRow(
      "Points Won",
      primaryTeamStats.pointWinPct,
      secondaryTeamStats.pointWinPct,
      `${primaryTeamStats.pointsWon}/${totalPoints} (${formatPct(primaryTeamStats.pointWinPct)})`,
      `${secondaryTeamStats.pointsWon}/${totalPoints} (${formatPct(secondaryTeamStats.pointWinPct)})`,
      (Number(primaryTeamStats.pointsWon) || 0) > (Number(secondaryTeamStats.pointsWon) || 0),
      (Number(secondaryTeamStats.pointsWon) || 0) > (Number(primaryTeamStats.pointsWon) || 0)
    ),
    row("Longest Streak", primaryTeamStats.longestScoringStreak, secondaryTeamStats.longestScoringStreak,
      (Number(primaryTeamStats.longestScoringStreak) || 0) > (Number(secondaryTeamStats.longestScoringStreak) || 0),
      (Number(secondaryTeamStats.longestScoringStreak) || 0) > (Number(primaryTeamStats.longestScoringStreak) || 0))
  ];

  if (isGamesAndSetsMode)
  {
    rows.push(
      row("Breaks Faced", primaryTeamStats.breakPointsFaced, secondaryTeamStats.breakPointsFaced,
        (Number(primaryTeamStats.breakPointsFaced) || 0) > (Number(secondaryTeamStats.breakPointsFaced) || 0),
        (Number(secondaryTeamStats.breakPointsFaced) || 0) > (Number(primaryTeamStats.breakPointsFaced) || 0)),
      row("Breaks Held", `${primaryTeamStats.breakPointsWon}/${primaryTeamStats.breakPointsFaced} (${formatPct(primaryTeamStats.breakPointWinPct)})`,
        `${secondaryTeamStats.breakPointsWon}/${secondaryTeamStats.breakPointsFaced} (${formatPct(secondaryTeamStats.breakPointWinPct)})`,
        (Number(primaryTeamStats.breakPointWinPct) || 0) > (Number(secondaryTeamStats.breakPointWinPct) || 0),
        (Number(secondaryTeamStats.breakPointWinPct) || 0) > (Number(primaryTeamStats.breakPointWinPct) || 0)),
      row("Break Chances", primaryTeamStats.breakPointConversionOpportunities, secondaryTeamStats.breakPointConversionOpportunities,
        (Number(primaryTeamStats.breakPointConversionOpportunities) || 0) > (Number(secondaryTeamStats.breakPointConversionOpportunities) || 0),
        (Number(secondaryTeamStats.breakPointConversionOpportunities) || 0) > (Number(primaryTeamStats.breakPointConversionOpportunities) || 0)),
      row("Breaks Won", `${primaryTeamStats.breakPointConversions}/${primaryTeamStats.breakPointConversionOpportunities} (${formatPct(primaryTeamStats.breakPointConversionPct)})`,
        `${secondaryTeamStats.breakPointConversions}/${secondaryTeamStats.breakPointConversionOpportunities} (${formatPct(secondaryTeamStats.breakPointConversionPct)})`,
        (Number(primaryTeamStats.breakPointConversionPct) || 0) > (Number(secondaryTeamStats.breakPointConversionPct) || 0),
        (Number(secondaryTeamStats.breakPointConversionPct) || 0) > (Number(primaryTeamStats.breakPointConversionPct) || 0)),
      row("Closing Pts Won",
        `${primaryTeamStats.gamePointConversions}/${primaryTeamStats.gamePointGames} (${formatPct(primaryTeamStats.closingEfficiencyPct)})`,
        `${secondaryTeamStats.gamePointConversions}/${secondaryTeamStats.gamePointGames} (${formatPct(secondaryTeamStats.closingEfficiencyPct)})`,
        (Number(primaryTeamStats.closingEfficiencyPct) || 0) > (Number(secondaryTeamStats.closingEfficiencyPct) || 0),
        (Number(secondaryTeamStats.closingEfficiencyPct) || 0) > (Number(primaryTeamStats.closingEfficiencyPct) || 0)),
      sectionRow("Deuce"),
      sharedRow(deuceGamesLabel, isGoldenMode ? goldenPointsPlayed : deuceGames),
      barRow(
        "Won",
        primaryDeucePct,
        secondaryDeucePct,
        `${primaryDeuceWon}/${deuceGames} (${formatPct(primaryDeucePct)})`,
        `${secondaryDeuceWon}/${deuceGames} (${formatPct(secondaryDeucePct)})`,
        primaryDeucePct > secondaryDeucePct,
        secondaryDeucePct > primaryDeucePct)
    );
  }

  if (isSilverMode)
  {
    rows.push(sharedRow("Silver Pts", silverPointsPlayed));
    rows.push(barRow(
      "Won",
      primarySilverPct,
      secondarySilverPct,
      `${primarySilverWon}/${silverPointsPlayed} (${formatPct(primarySilverPct)})`,
      `${secondarySilverWon}/${silverPointsPlayed} (${formatPct(secondarySilverPct)})`,
      primarySilverPct > secondarySilverPct,
      secondarySilverPct > primarySilverPct
    ));
  }

  if (isStarMode)
  {
    rows.push(sharedRow("Star Pts", starPointsPlayed));
    rows.push(barRow(
      "Won",
      primaryStarPct,
      secondaryStarPct,
      `${primaryStarWon}/${starPointsPlayed} (${formatPct(primaryStarPct)})`,
      `${secondaryStarWon}/${starPointsPlayed} (${formatPct(secondaryStarPct)})`,
      primaryStarPct > secondaryStarPct,
      secondaryStarPct > primaryStarPct
    ));
  }

  const servePlayerStats = advancedStats?.servePlayerStats || {};
  rows.push(sectionRow("On Serve"));
  [1, 2].forEach(serverIndex =>
  {
    const primarySlot = `${primaryTeamKey}${serverIndex}`;
    const secondarySlot = `${secondaryTeamKey}${serverIndex}`;
    var primaryServerName = getPlayerDisplayName(primarySlot, playerNames);
    var secondaryServerName = getPlayerDisplayName(secondarySlot, playerNames);
    primaryServerName = primaryServerName + (primaryServerName == "" ? "" : " - ");
    secondaryServerName = secondaryServerName + (secondaryServerName == "" ? "" : " - ");

    const primaryServeStat = servePlayerStats[primarySlot] || { pointsWonOnServe: 0, pointsServed: 0, serveWinPct: 0 };
    const secondaryServeStat = servePlayerStats[secondarySlot] || { pointsWonOnServe: 0, pointsServed: 0, serveWinPct: 0 };

    rows.push(row(
      `Player ${serverIndex}`,
      `${primaryServerName}${primaryServeStat.pointsWonOnServe}/${primaryServeStat.pointsServed} (${formatPct(primaryServeStat.serveWinPct)})`,
      `${secondaryServerName}${secondaryServeStat.pointsWonOnServe}/${secondaryServeStat.pointsServed} (${formatPct(secondaryServeStat.serveWinPct)})`
    ));
  });

  elements.dmStatsTeam.innerHTML = `
      <table class="dm-stats-table">
        <thead>
          <tr>
            <th class="dm-st-col-label"></th>
            <th class="dm-st-col-team dm-st-col-${primaryClassSuffix}">${primaryTeamName}</th>
            <th class="dm-st-col-team dm-st-col-${secondaryClassSuffix}">${secondaryTeamName}</th>
          </tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    `;

  elements.dmStatsWrap.classList.remove("hidden");
  fitAdvancedStatsColumns();
  syncDetailsPanelAvailability();
}
