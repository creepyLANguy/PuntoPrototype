// Standings, rounds and bracket renderers for the tournament pages (spec
// sections 26.4, 27 and 28). Columns that carry no information for the format
// are left out instead of showing rows of zeros.
import { fixtureCard } from "./fixtureCard.js";
import { emptyState, formatDateTime, h, statusChip } from "./elements.js";

const SOCIAL_KINDS = new Set(["rotating"]);

function hasValues(rows, key) {
  return rows.some(
    (row) =>
      Number(row[key]) !== 0 && row[key] !== undefined && row[key] !== null,
  );
}

function standingsColumns(standings, formatKind) {
  const rows = standings.rows || [];
  if (SOCIAL_KINDS.has(formatKind)) {
    return [
      { key: "rank", label: "#" },
      {
        key: "name",
        label: standings.entryType === "team" ? "Team" : "Player",
      },
      { key: "played", label: "Rounds" },
      { key: "totalPoints", label: "Points", strong: true },
      hasValues(rows, "played")
        ? {
            key: "avgPerRound",
            label: "Avg",
            format: (value) => (Number(value) || 0).toFixed(1),
          }
        : null,
      hasValues(rows, "lastRoundPoints")
        ? { key: "lastRoundPoints", label: "Last" }
        : null,
      hasValues(rows, "sittingOut")
        ? { key: "sittingOut", label: "Sat out" }
        : null,
    ].filter(Boolean);
  }
  return [
    { key: "rank", label: "#" },
    { key: "name", label: standings.entryType === "team" ? "Team" : "Player" },
    { key: "played", label: "P" },
    { key: "wins", label: "W" },
    hasValues(rows, "draws") ? { key: "draws", label: "D" } : null,
    { key: "losses", label: "L" },
    hasValues(rows, "competitionPoints")
      ? { key: "competitionPoints", label: "Pts", strong: true }
      : null,
    hasValues(rows, "setDiff")
      ? { key: "setDiff", label: "Sets +/-", signed: true }
      : null,
    hasValues(rows, "gameDiff")
      ? { key: "gameDiff", label: "Games +/-", signed: true }
      : null,
    hasValues(rows, "pointDiff")
      ? { key: "pointDiff", label: "Diff", signed: true }
      : null,
    { key: "form", label: "Form", format: (form) => (form || []).join(" ") },
  ].filter(Boolean);
}

function cellValue(row, column) {
  const value = row[column.key];
  if (column.format) return column.format(value, row);
  if (column.signed && Number(value) > 0) return `+${value}`;
  return value ?? "";
}

export function renderStandings(
  standings,
  { formatKind, groupId = null, title = null } = {},
) {
  if (!standings || !(standings.rows || []).length)
    return emptyState("Standings appear once results are in.");
  const rows = (standings.rows || []).filter(
    (row) => !groupId || row.groupId === groupId,
  );
  const columns = standingsColumns({ ...standings, rows }, formatKind);
  return h(
    "div",
    { className: "standings" },
    title ? h("h3", { className: "standings-title" }, title) : null,
    h(
      "table",
      { className: "standings-table" },
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          columns.map((column) =>
            h("th", { className: `col-${column.key}` }, column.label),
          ),
        ),
      ),
      h(
        "tbody",
        {},
        rows.map((row, index) =>
          h(
            "tr",
            {
              className:
                row.status && row.status !== "active"
                  ? `is-${row.status}`
                  : null,
            },
            columns.map((column) =>
              h(
                "td",
                {
                  className: `col-${column.key}${column.strong ? " is-strong" : ""}`,
                },
                column.key === "rank"
                  ? groupId
                    ? row.rank
                    : ["bracket", "groupBracket"].includes(formatKind)
                      ? row.placementLabel || row.rank || "—"
                      : row.rank
                  : cellValue(row, column),
                column.key === "name" && row.status === "withdrawn"
                  ? h("span", { className: "row-flag" }, " withdrawn")
                  : null,
                column.key === "name" && row.eliminated
                  ? h("span", { className: "row-flag" }, " out")
                  : null,
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

export function renderGroupStandings(view) {
  const groups = [
    ...new Set(
      (view.standings?.rows || []).map((row) => row.groupId).filter(Boolean),
    ),
  ].sort();
  if (!groups.length)
    return renderStandings(view.standings, { formatKind: view.format.kind });
  return h(
    "div",
    { className: "group-standings" },
    groups.map((groupId) =>
      renderStandings(view.standings, {
        formatKind: "league",
        groupId,
        title: `Group ${groupId}`,
      }),
    ),
  );
}

export function renderTiebreakers(standings) {
  if (!standings?.tiebreakerLabels?.length) return null;
  return h(
    "p",
    { className: "ev-hint" },
    `Ranking order: ${standings.tiebreakerLabels.join(", ")}`,
  );
}

export function renderRound(
  round,
  view,
  { liveMatches, actionsFor = null } = {},
) {
  const fixtures = round.fixtureIds
    .map((fixtureId) =>
      view.fixtures.find((fixture) => fixture.fixtureId === fixtureId),
    )
    .filter(Boolean);
  return h(
    "div",
    { className: "round", dataset: { roundId: round.roundId } },
    h(
      "header",
      { className: "round-head" },
      h("h3", {}, round.label),
      statusChip(
        round.status === "completed"
          ? "completed"
          : round.status === "live"
            ? "live"
            : "scheduled",
      ),
    ),
    h(
      "div",
      { className: "fx-grid" },
      fixtures.map((fixture) =>
        fixtureCard(fixture, {
          liveMatches,
          timezone: view.scheduling?.timezone,
          actions: actionsFor ? actionsFor(fixture) : null,
        }),
      ),
    ),
    round.sittingOut?.length
      ? h(
          "div",
          { className: "sitting-out" },
          statusChip("sitting out"),
          h("span", {}, round.sittingOut.map((entry) => entry.name).join(", ")),
        )
      : null,
  );
}

export function renderRounds(view, options = {}) {
  if (!view.rounds?.length)
    return emptyState("No rounds have been generated yet.");
  const ordered = [...view.rounds].sort(
    (a, b) => b.roundNumber - a.roundNumber,
  );
  return h(
    "div",
    { className: "rounds" },
    (view.roundForecast || []).map((round) =>
      h(
        "details",
        { className: "round-details" },
        h("summary", {}, `${round.label} - forecast (pairings pending)`),
        h(
          "p",
          { className: "ev-hint" },
          `Estimated start: ${formatDateTime(round.scheduledStartAt, view.scheduling?.timezone)}. Pairings are calculated after the previous round's results; this is not a playable match.`,
        ),
      ),
    ),
    ordered.map((round) =>
      h(
        "details",
        {
          className: "round-details",
          open: round.roundId === view.currentRound?.roundId ? true : null,
        },
        h("summary", {}, `${round.label} - ${round.status}`),
        renderRound(round, view, options),
      ),
    ),
  );
}

const STAGE_LABELS = {
  knockout: "Knockout",
  winners: "Winners bracket",
  losers: "Losers bracket",
  grandFinal: "Grand final",
  grandFinalReset: "Grand final reset",
  thirdPlace: "Third-place match",
};

// Columns per bracket round, horizontally scrollable on phones rather than
// squeezed (spec section 28).
export function renderBracket(view, { liveMatches } = {}) {
  if (!view.bracket?.stages?.length)
    return emptyState("The bracket appears once it is drawn.");
  const fixtureById = new Map(
    view.fixtures.map((fixture) => [fixture.fixtureId, fixture]),
  );
  return h(
    "div",
    { className: "bracket" },
    view.bracket.stages.map((stage) =>
      h(
        "div",
        { className: "bracket-stage" },
        h("h3", {}, STAGE_LABELS[stage.stage] || stage.stage),
        h(
          "div",
          { className: "bracket-columns" },
          [...stage.rounds]
            .sort((a, b) => a.roundNumber - b.roundNumber)
            .map((round) =>
              h(
                "div",
                { className: "bracket-column" },
                h(
                  "div",
                  { className: "bracket-column-title" },
                  view.rounds.find((r) => r.roundNumber === round.roundNumber)
                    ?.label || `Round ${round.roundNumber}`,
                ),
                round.fixtureIds
                  .map((fixtureId) => fixtureById.get(fixtureId))
                  .filter(Boolean)
                  .map((fixture) =>
                    fixtureCard(fixture, {
                      liveMatches,
                      timezone: view.scheduling?.timezone,
                      compact: true,
                    }),
                  ),
              ),
            ),
        ),
      ),
    ),
  );
}
