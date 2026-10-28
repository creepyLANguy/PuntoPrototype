// Public tournament dashboard (spec sections 26, 29, 50, 51 and Appendix C):
// event identity, rules, live matches, the current round, standings,
// bracket, round history, a player's own schedule and the participants.
import { getMatchPath, getTournamentPath } from "../match/matchIdentity.js";
import { fixtureCard } from "./fixtureCard.js";
import {
  emptyState,
  formatDateTime,
  h,
  section,
  statusChip,
} from "./elements.js";
import {
  renderBracket,
  renderGroupStandings,
  renderRound,
  renderRounds,
  renderStandings,
  renderTiebreakers,
} from "./standingsView.js";

export function tournamentUrl(tournamentId) {
  return `${window.location.origin}${getTournamentPath(tournamentId)}`;
}

export function renderQr(container, url, size = 132) {
  if (!container || !window.QRCode) return;
  container.innerHTML = "";
  new window.QRCode(container, {
    text: url,
    width: size,
    height: size,
    correctLevel: window.QRCode.CorrectLevel.M,
  });
}

async function shareTournament(view) {
  const url = tournamentUrl(view.tournamentId);
  try {
    if (navigator.share) {
      await navigator.share({
        title: view.name,
        text: `${view.name} - live on Padel Push™`,
        url,
      });
      return "Shared.";
    }
    await navigator.clipboard.writeText(url);
    return "Link copied.";
  } catch {
    return "";
  }
}

export function renderHeader(view, { onShare } = {}) {
  const qr = h("div", {
    className: "ev-qr",
    "aria-label": "Tournament QR code",
  });
  setTimeout(() => renderQr(qr, tournamentUrl(view.tournamentId)), 0);
  const shareStatus = h("span", { className: "ev-hint", role: "status" });
  return h(
    "header",
    { className: "ev-header" },
    h(
      "div",
      { className: "ev-header-main" },
      h(
        "div",
        { className: "ev-eyebrow" },
        [view.club?.name, view.format?.label].filter(Boolean).join(" - "),
      ),
      h("h1", { className: "ev-title" }, view.name),
      h(
        "div",
        { className: "ev-header-meta" },
        statusChip(view.status),
        view.currentRound ? h("span", {}, view.currentRound.label) : null,
        view.scheduling?.startAt
          ? h(
              "span",
              {},
              formatDateTime(view.scheduling.startAt, view.scheduling.timezone),
            )
          : null,
      ),
      view.description
        ? h("p", { className: "ev-description" }, view.description)
        : null,
      h(
        "div",
        { className: "ev-header-actions" },
        h(
          "button",
          {
            className: "ev-btn",
            type: "button",
            onClick: async () => {
              shareStatus.textContent = await shareTournament(view);
              onShare?.();
            },
          },
          "Share",
        ),
        shareStatus,
      ),
    ),
    qr,
  );
}

export function renderRules(view) {
  return section(
    "Rules",
    h(
      "div",
      { className: "rules-card" },
      h(
        "div",
        { className: "rules-title" },
        view.rulesSummary?.title || view.format?.label,
      ),
      h(
        "ul",
        { className: "rules-lines" },
        (view.rulesSummary?.lines || []).map((line) => h("li", {}, line)),
      ),
    ),
  );
}

export function renderLiveNow(view, liveMatches) {
  const live = view.fixtures.filter(
    (fixture) =>
      fixture.displayStatus === "LIVE" || liveMatches.has(fixture.matchId),
  );
  if (!live.length) return null;
  return section(
    "Live now",
    h(
      "div",
      { className: "fx-grid fx-grid-live" },
      live.map((fixture) =>
        fixtureCard(
          { ...fixture, displayStatus: "LIVE" },
          { liveMatches, timezone: view.scheduling?.timezone },
        ),
      ),
    ),
  );
}

function renderMySchedule(view, liveMatches) {
  const entries =
    view.format.entryMode === "team"
      ? view.teams
          .filter((team) => team.status !== "removed")
          .map((team) => ({ id: team.teamId, name: team.name, kind: "team" }))
      : view.participants
          .filter((p) => p.status !== "removed")
          .map((p) => ({
            id: p.participantId,
            name: p.displayName,
            kind: "player",
          }));
  if (!entries.length || !view.fixtures.length) return null;

  const output = h("div", { className: "my-schedule-output" });
  const select = h(
    "select",
    { className: "ev-select", "aria-label": "Choose your name" },
    h("option", { value: "" }, "Find your matches..."),
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => h("option", { value: entry.id }, entry.name)),
  );

  select.addEventListener("change", () => {
    const id = select.value;
    output.innerHTML = "";
    if (!id) return;
    const mine = view.fixtures.filter((fixture) =>
      ["A", "B"].some(
        (key) =>
          fixture.sides?.[key]?.teamId === id ||
          (fixture.sides?.[key]?.participantIds || []).includes(id),
      ),
    );
    const sitting = view.rounds
      .filter((round) => round.sittingOut.some((entry) => entry.id === id))
      .map((round) => round.label);
    const upcoming = mine.filter(
      (fixture) =>
        !["COMPLETED", "CANCELLED", "BYE"].includes(fixture.displayStatus),
    );
    output.append(
      upcoming.length
        ? h(
            "div",
            { className: "fx-grid" },
            upcoming.map((fixture) =>
              fixtureCard(fixture, {
                liveMatches,
                timezone: view.scheduling?.timezone,
              }),
            ),
          )
        : emptyState("No upcoming matches."),
      sitting.length
        ? h("p", { className: "ev-hint" }, `Sitting out: ${sitting.join(", ")}`)
        : null,
      mine.length > upcoming.length
        ? h(
            "details",
            { className: "round-details" },
            h("summary", {}, "Previous matches"),
            h(
              "div",
              { className: "fx-grid" },
              mine
                .filter((fixture) => !upcoming.includes(fixture))
                .map((fixture) =>
                  fixtureCard(fixture, {
                    liveMatches,
                    timezone: view.scheduling?.timezone,
                    compact: true,
                  }),
                ),
            ),
          )
        : null,
    );
  });

  return section("My matches", select, output);
}

function renderParticipants(view) {
  if (view.format.entryMode === "team") {
    const nameOf = (id) =>
      view.participants.find((p) => p.participantId === id)?.displayName || "";
    return section(
      "Teams",
      h(
        "ul",
        { className: "entry-list" },
        view.teams
          .filter((team) => team.status !== "removed")
          .map((team) =>
            h(
              "li",
              { className: `entry is-${team.status}` },
              h("strong", {}, team.name),
              h(
                "span",
                {},
                team.participantIds.map(nameOf).filter(Boolean).join(" & "),
              ),
              team.status === "withdrawn" ? statusChip("withdrawn") : null,
            ),
          ),
      ),
    );
  }
  return section(
    "Players",
    h(
      "ul",
      { className: "entry-list" },
      view.participants
        .filter((p) => p.status !== "removed")
        .map((participant) =>
          h(
            "li",
            { className: `entry is-${participant.status}` },
            h("strong", {}, participant.displayName),
            participant.status === "withdrawn" ? statusChip("withdrawn") : null,
          ),
        ),
    ),
  );
}

export function renderStandingsSection(view) {
  const hasGroups = (view.standings?.rows || []).some((row) => row.groupId);
  return section(
    ["bracket", "groupBracket"].includes(view.format.kind) ? "Placings" : "Standings",
    hasGroups
      ? renderGroupStandings(view)
      : renderStandings(view.standings, { formatKind: view.format.kind }),
    renderTiebreakers(view.standings),
  );
}

const SOCIAL_FORMATS = new Set(["americano", "mexicano", "teamAmericano", "teamMexicano"]);

function ordinal(place) {
  const value = Number(place);
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return value + "th";
  return value + (value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th");
}

function podiumScore(row, view) {
  if (SOCIAL_FORMATS.has(view.format.id)) return String(row.totalPoints || 0) + " points";
  if (view.format.id === "kingCourt") {
    const config = view.format.config || {};
    if (config.finalRanking === "courtPosition") {
      return Number.isFinite(Number(row.finalCourtPosition)) &&
        Number(row.finalCourtPosition) < Number.MAX_SAFE_INTEGER
        ? "Court " + row.finalCourtPosition
        : "No final court recorded";
    }
    return config.scoringMethod === "rallyPoints"
      ? String(row.rallyPoints || 0) + " rally points"
      : String(row.courtPoints || 0) + " court points";
  }
  if (row.competitionPoints != null) return String(row.competitionPoints) + " competition points";
  return "";
}

function renderPodiumTier(place, entries, view) {
  return h(
    "div",
    { className: "podium-tier podium-rank-" + place },
    h("div", { className: "podium-medal", "aria-hidden": "true" }, place === 1 ? "★" : place === 2 ? "◆" : "●"),
    h("div", { className: "podium-place" }, ordinal(place)),
    h(
      "div",
      { className: "podium-entries" },
      entries.map((row) =>
        h(
          "div",
          { className: "podium-entry", "data-entry-id": row.entryId },
          h("strong", {}, row.name),
          podiumScore(row, view) ? h("span", { className: "podium-score" }, podiumScore(row, view)) : null,
          row.placementTied || entries.length > 1
            ? h("span", { className: "podium-tied" }, "Tied position")
            : null,
        ),
      ),
    ),
    h("div", { className: "podium-base", "aria-hidden": "true" }, ordinal(place)),
  );
}

export function renderTournamentResults(view) {
  const standings = view.finalStandings || view.standings;
  const isBracket = ["bracket", "groupBracket"].includes(view.format?.kind);
  const rows = standings?.rows || [];
  const hasRecordedResults = rows.some((row) => Number(row.played || 0) > 0);
  const early = Boolean(view.finishedEarly || view.completionReason);
  const finalDecided = !isBracket || Boolean(standings?.finalDecided);
  const eligibleRows = isBracket
    ? rows.filter((row) => row.placement != null)
    : rows.filter((row) => row.rank != null);
  // Early completion can leave a partial league/social table. Keep it
  // explicitly provisional rather than awarding a visually definitive podium.
  const hasPodium = !early && hasRecordedResults && eligibleRows.length > 0 && (!isBracket || finalDecided);
  const tiers = [2, 1, 3]
    .map((place) => ({
      place,
      rows: eligibleRows.filter((row) => (isBracket ? row.placement : row.rank) === place),
    }))
    .filter((tier) => tier.rows.length > 0);
  const winners = eligibleRows.filter((row) => (isBracket ? row.placement : row.rank) === 1);
  const heading = early
    ? "Tournament ended early"
    : isBracket && !standings?.finalDecided
      ? "Final result not decided"
      : "Tournament complete";
  const intro = early
    ? "These standings reflect recorded results only. Unplayed or cancelled matches are not treated as losses."
    : isBracket && !standings?.finalDecided
      ? "The recorded bracket does not establish a champion. No winner is shown until the required final (including any reset final) has a result."
      : winners.length > 1
        ? "The configured sporting tie-breakers leave these entries tied for first place."
        : winners.length === 1
          ? isBracket
            ? "The champion and finishing positions are based on completed bracket results."
            : "The podium is based on the tournament's configured ranking rules."
          : "No final positions can be shown because no results have been recorded.";
  return section(
    "Tournament results",
    h(
      "div",
      { className: "podium-results" },
      h("div", { className: "podium-heading" }, h("h3", {}, heading), h("p", {}, intro)),
      hasPodium
        ? h(
            "div",
            { className: "tournament-podium", "aria-label": "Tournament podium" },
            ...tiers.map((tier) => renderPodiumTier(tier.place, tier.rows, view)),
          )
        : h(
            "p",
            { className: "ev-empty podium-empty" },
            early
              ? "A podium is not awarded for a tournament finished early. The table below reflects recorded results only."
              : isBracket && !standings?.finalDecided
                ? "No champion or final podium can be declared from the results currently recorded."
                : "There are not enough recorded results to establish a podium.",
          ),
      winners.length && !early && finalDecided
        ? h(
            "p",
            { className: "podium-winner-summary" },
            winners.length > 1
              ? "Joint winners: " + winners.map((row) => row.name).join(", ")
              : "Winner: " + winners[0].name,
          )
        : null,
      isBracket && view.format.id === "groupKnockout"
        ? h("p", { className: "ev-hint" }, "Only teams that qualified for the knockout stage receive overall knockout placements. Group standings remain available separately.")
        : null,
    ),
    standings
      ? renderStandings(standings, { formatKind: view.format.kind })
      : h("p", { className: "ev-empty" }, "Final standings are not available."),
    renderTiebreakers(standings),
  );
}

function renderCompletedDashboard(view, liveMatches) {
  return h(
    "div",
    { className: "ev-dashboard is-completed" },
    renderHeader(view),
    renderTournamentResults(view),
    view.bracket ? section("Final bracket", renderBracket(view, { liveMatches })) : null,
    view.format.id === "groupKnockout" ? renderStandingsSection(view) : null,
    view.rounds?.length
      ? h(
          "details",
          { className: "round-details ev-match-history" },
          h("summary", {}, "Review rounds and match results"),
          renderRounds({ ...view, roundForecast: [] }, { liveMatches }),
        )
      : null,
    renderRules(view),
    renderParticipants(view),
  );
}

export function renderPublicDashboard(view, liveMatches) {
  if (view.status === "completed") return renderCompletedDashboard(view, liveMatches);
  const currentRound =
    view.rounds.find((round) => round.roundId === view.currentRound?.roundId) ||
    null;
  return h(
    "div",
    { className: "ev-dashboard" },
    renderHeader(view),
    view.status === "cancelled"
      ? h("div", { className: "ev-banner" }, "This tournament was cancelled.")
      : null,
    h(
      "div",
      { className: "ev-columns" },
      h(
        "div",
        { className: "ev-col-main" },
        renderLiveNow(view, liveMatches),
        currentRound
          ? section(
              "Current round",
              renderRound(currentRound, view, { liveMatches }),
            )
          : null,
        renderMySchedule(view, liveMatches),
        view.bracket
          ? section("Bracket", renderBracket(view, { liveMatches }))
          : null,
        section("Rounds", renderRounds(view, { liveMatches })),
      ),
      h(
        "aside",
        { className: "ev-col-side" },
        renderStandingsSection(view),
        renderRules(view),
        renderParticipants(view),
      ),
    ),
  );
}

export function renderMatchLink(matchId, label) {
  return h("a", { href: getMatchPath(matchId) }, label);
}
