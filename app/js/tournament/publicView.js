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
    view.format.kind === "bracket" ? "Placings" : "Standings",
    hasGroups
      ? renderGroupStandings(view)
      : renderStandings(view.standings, { formatKind: view.format.kind }),
    renderTiebreakers(view.standings),
  );
}

export function renderPublicDashboard(view, liveMatches) {
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
