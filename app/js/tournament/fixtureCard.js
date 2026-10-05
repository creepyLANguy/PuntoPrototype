// Fixture / match cards shared by the public dashboard and the host control
// room: match name, court, sides, score and status (spec sections 25.4, 26.2
// and 27). Live scores come from the live match listener when available.
import { formatScoreLine, getMatchPath } from "../match/matchIdentity.js";
import { formatTime, h, statusChip } from "./elements.js";

export function liveSummaryFor(fixture, liveMatches) {
  const live = fixture.matchId ? liveMatches.get(fixture.matchId) : null;
  return live?.scoreSummary || fixture.score || null;
}

function sideScore(summary, team) {
  if (!summary?.[team]) return "";
  if (summary.scoringMode && summary.scoringMode !== "standard")
    return String(summary[team].points ?? 0);
  const sets = summary[team].sets ?? 0;
  const games = summary[team].games ?? 0;
  return sets > 0 || (summary.completedSets || []).length
    ? `${sets} | ${games}`
    : String(games);
}

function resultScore(result, team) {
  if (!result || result.walkover)
    return result?.walkover && result.winner === team ? "W/O" : "";
  if (result.scoringMode && result.scoringMode !== "standard")
    return String(result.points?.[team] ?? 0);
  const setsPlayed = (result.sets?.A ?? 0) + (result.sets?.B ?? 0);
  return String(
    setsPlayed > 0 ? result.sets[team] : (result.games?.[team] ?? 0),
  );
}

function sideRow(fixture, team, summary) {
  const side = fixture.sides?.[team] || {};
  const label = side.label || side.placeholder || "TBD";
  const winner = fixture.result?.winner === team;
  const score =
    fixture.displayStatus === "COMPLETED"
      ? resultScore(fixture.result, team)
      : fixture.displayStatus === "LIVE"
        ? sideScore(summary, team)
        : "";
  return h(
    "div",
    {
      className: `fx-side${winner ? " is-winner" : ""}${side.label ? "" : " is-tbd"}`,
    },
    h("span", { className: "fx-side-name" }, label),
    h("span", { className: "fx-side-score" }, score),
  );
}

export function fixtureCard(
  fixture,
  { liveMatches = new Map(), timezone, actions = null, compact = false } = {},
) {
  const summary = liveSummaryFor(fixture, liveMatches);
  const status =
    fixture.displayStatus || String(fixture.status || "").toUpperCase();
  const meta = [
    fixture.courtName
      ? `Court ${fixture.courtName}`.replace(/^Court Court/i, "Court")
      : null,
    fixture.scheduledStartAt && !["COMPLETED", "LIVE", "BYE"].includes(status)
      ? formatTime(fixture.scheduledStartAt, timezone)
      : null,
    fixture.result?.walkover ? "Walkover" : null,
    fixture.result?.corrected ? "Corrected" : null,
  ].filter(Boolean);

  const body =
    status === "BYE"
      ? h(
          "div",
          { className: "fx-sides" },
          h(
            "div",
            { className: "fx-side" },
            h(
              "span",
              { className: "fx-side-name" },
              fixture.sides?.A?.label || fixture.sides?.B?.label || "TBD",
            ),
          ),
          h("p", { className: "ev-hint" }, "Bye - advances without playing"),
        )
      : h(
          "div",
          { className: "fx-sides" },
          sideRow(fixture, "A", summary),
          sideRow(fixture, "B", summary),
        );

  return h(
    "article",
    {
      className: `fx-card fx-${status.toLowerCase()}${compact ? " is-compact" : ""}`,
      dataset: { fixtureId: fixture.fixtureId },
    },
    h(
      "header",
      { className: "fx-head" },
      h("span", { className: "fx-name" }, fixture.label || "Match"),
      statusChip(status),
    ),
    meta.length ? h("div", { className: "fx-meta" }, meta.join(" - ")) : null,
    body,
    status === "LIVE" && summary && summary.scoringMode === "standard"
      ? h(
          "div",
          { className: "fx-detail" },
          formatScoreLine(summary, "standard"),
        )
      : null,
    h(
      "footer",
      { className: "fx-foot" },
      fixture.matchId && status !== "BYE"
        ? h(
            "a",
            { className: "fx-link", href: getMatchPath(fixture.matchId) },
            status === "LIVE" ? "View match" : "Match page",
          )
        : null,
      actions,
    ),
  );
}
