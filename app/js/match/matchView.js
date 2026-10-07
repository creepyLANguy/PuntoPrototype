// Match page renderer (/m/{matchId}, spec sections 30, 32.1 and 53): the
// match name is the title, the court is location context, and the page works
// for live, scheduled and historical matches alike.
import { POINTS } from "../config/constants.js";
import {
  getSideLabel,
  getTournamentPath,
  MATCH_STATUS_LABELS,
  resolveMatchTitle,
} from "./matchIdentity.js";

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

const DEUCE_LABELS = {
  standard: "Advantage at deuce",
  golden: "Golden point at deuce",
  silver: "Silver point",
  star: "Star point",
};

export function describeScoringOptions(options = {}) {
  switch (options.scoringMode) {
    case "fixedTotalPoints": {
      const serving = options.serving || {};
      return [
        `${options.pointsTarget} total points`,
        serving.enabled === false
          ? null
          : `Serve rotation: ${(serving.order || []).join(", ")}`,
        serving.enabled === false
          ? null
          : `${serving.serveBlockLength} consecutive serves`,
        [
          "after_each_player_serves_once",
          "after_all_players_serve_once",
        ].includes(serving.sideSwapRule)
          ? serving.sideSwapRule === "after_all_players_serve_once"
            ? "Swap sides after all players serve once"
            : "Swap sides after each player serves once"
          : null,
        options.completion?.tieResolution === "golden_point"
          ? "A tie is decided by a golden point"
          : "Draws are allowed",
      ].filter(Boolean);
    }
    case "straight":
      return ["Straight rally points"];
    case "tiebreakTen":
      return ["Single match tie-break to 10, win by 2"];
    default:
      return [
        "Games and sets",
        DEUCE_LABELS[options.deuceMode] || DEUCE_LABELS.standard,
        options.tiebreakMode === "off"
          ? "No tie-break"
          : `Tie-break at 6-6 to ${options.tiebreakMode === "sixAllTen" ? 10 : 7}`,
      ];
  }
}

function pointLabel(score, team, mode) {
  const points = Number(score?.[team]?.points) || 0;
  if (mode !== "standard" || score?.inTiebreak) return String(points);
  return points === 4 ? "Ad" : String(POINTS[points] ?? points);
}

function scoreBlock(match, score) {
  const mode =
    match.scoringOptions?.scoringMode || match.scoringMode || "standard";
  const block = el("div", "mp-score");
  ["A", "B"].forEach((team) => {
    const row = el("div", `mp-team mp-team-${team.toLowerCase()}`);
    const names = el("div", "mp-team-names");
    names.appendChild(
      el("strong", "", getSideLabel(match, team) || `Team ${team}`),
    );
    const players = [
      match.playerNames?.[`${team}1`],
      match.playerNames?.[`${team}2`],
    ]
      .filter(Boolean)
      .join(" & ");
    if (players && players !== getSideLabel(match, team))
      names.appendChild(el("span", "", players));
    row.appendChild(names);

    const numbers = el("div", "mp-numbers");
    if (mode === "standard") {
      numbers.appendChild(
        el("span", "mp-num mp-sets", score?.[team]?.sets ?? 0),
      );
      numbers.appendChild(
        el("span", "mp-num mp-games", score?.[team]?.games ?? 0),
      );
    }
    numbers.appendChild(
      el("span", "mp-num mp-points", pointLabel(score, team, mode)),
    );
    row.appendChild(numbers);
    block.appendChild(row);
  });
  const sets = Array.isArray(score?.completedSets) ? score.completedSets : [];
  if (mode === "standard" && sets.length) {
    block.appendChild(
      el(
        "div",
        "mp-sets-line",
        `Sets: ${sets.map((set) => `${set.A}-${set.B}`).join(", ")}`,
      ),
    );
  }
  if (mode === "fixedTotalPoints" && score?.fixedTotal) {
    block.appendChild(
      el(
        "div",
        "mp-sets-line",
        `${score.fixedTotal.rallyPoints} of ${score.fixedTotal.pointsTarget} points played` +
          (score.fixedTotal.currentServer && !score.matchComplete
            ? ` - ${match.playerNames?.[score.fixedTotal.currentServer] || score.fixedTotal.currentServer} to serve`
            : ""),
      ),
    );
  }
  return block;
}

function formatTimestamp(value) {
  const ms =
    typeof value?.toMillis === "function"
      ? value.toMillis()
      : typeof value?.seconds === "number"
        ? value.seconds * 1000
        : value;
  return ms ? new Date(ms).toLocaleString() : "";
}

export function renderMatchPage(
  container,
  { matchId, match, score, court, tournament },
) {
  container.innerHTML = "";
  const page = el("main", "mp-page");

  const status = String(match.status || "");
  const chip = el(
    "span",
    `chip chip-${status}`,
    MATCH_STATUS_LABELS[status] || status.toUpperCase(),
  );
  const header = el("header", "mp-header");
  header.appendChild(el("div", "ev-eyebrow", "Padel Push™"));
  header.appendChild(el("h1", "mp-title", resolveMatchTitle(match, matchId)));

  const meta = el("div", "mp-meta");
  meta.appendChild(chip);
  const courtName =
    court?.name ||
    match.currentCourtId ||
    match.lastCourtName ||
    match.lastCourtId;
  if (courtName) {
    meta.appendChild(
      el(
        "span",
        "mp-court",
        match.currentCourtId
          ? `Court ${courtName}`.replace(/^Court Court/i, "Court")
          : `Played on ${courtName}`,
      ),
    );
  }
  header.appendChild(meta);

  if (match.tournamentId) {
    const link = el(
      "a",
      "mp-tournament",
      tournament?.name ? `${tournament.name}` : "Tournament",
    );
    link.href = getTournamentPath(match.tournamentId);
    if (match.roundId)
      link.textContent += ` - Round ${String(match.roundId).replace(/^r/, "")}`;
    header.appendChild(link);
  }
  page.appendChild(header);
  page.appendChild(scoreBlock(match, score));

  if (match.result) {
    const winner =
      match.result.winner === "draw"
        ? "Draw"
        : `${getSideLabel(match, match.result.winner) || `Team ${match.result.winner}`} won`;
    page.appendChild(el("p", "mp-result", winner));
  }
  if (match.resultCorrection) {
    page.appendChild(
      el(
        "p",
        "ev-hint",
        `Result corrected by the host: ${match.resultCorrection.reason || ""}`,
      ),
    );
  }
  if (match.completedAt) {
    page.appendChild(
      el("p", "ev-hint", `Completed ${formatTimestamp(match.completedAt)}`),
    );
  }

  const rules = el("section", "rules-card");
  rules.appendChild(el("div", "rules-title", "Scoring rules"));
  const list = el("ul", "rules-lines");
  describeScoringOptions(
    match.scoringOptions || { scoringMode: match.scoringMode },
  ).forEach((line) => list.appendChild(el("li", "", line)));
  rules.appendChild(list);
  page.appendChild(rules);

  const actions = el("div", "ev-header-actions");
  if (status === "live" && match.currentCourtId) {
    const live = el("a", "ev-btn ev-btn-primary", "Open live scoreboard");
    live.href = `/c/${encodeURIComponent(match.currentCourtId)}`;
    actions.appendChild(live);
  }
  const share = el("button", "ev-btn", "Share match");
  share.type = "button";
  const shareStatus = el("span", "ev-hint");
  share.addEventListener("click", async () => {
    const url = window.location.href.split("?")[0];
    try {
      if (navigator.share)
        await navigator.share({
          title: resolveMatchTitle(match, matchId),
          url,
        });
      else {
        await navigator.clipboard.writeText(url);
        shareStatus.textContent = "Link copied.";
      }
    } catch {
      shareStatus.textContent = "";
    }
  });
  actions.append(share, shareStatus);
  page.appendChild(actions);
  page.appendChild(el("p", "mp-id", `Match ${matchId}`));

  container.appendChild(page);
  document.title = `${resolveMatchTitle(match, matchId)} | Padel Push™`;
}

export function renderMatchNotFound(container, matchId) {
  container.innerHTML = "";
  const page = el("main", "mp-page not-found");
  page.appendChild(el("h1", "mp-title", "Match not found"));
  page.appendChild(
    el(
      "p",
      "ev-hint",
      matchId
        ? `There is no match with id ${matchId}.`
        : "This link does not point to a match.",
    ),
  );
  const back = el("a", "ev-btn", "Find a match");
  back.href = "/app/";
  page.appendChild(back);
  container.appendChild(page);
  document.title = "Match not found | Padel Push™";
}
