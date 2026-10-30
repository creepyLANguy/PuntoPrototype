// Host control room (spec sections 25, 49 and Appendix D): status and KPIs,
// the primary controls, the live court board, what is next, exceptions and
// the operational panels. Routine court operations happen inline on the
// match cards; nothing needs a chain of modal screens.
import { fixtureCard } from "./fixtureCard.js";
import { emptyState, h, section, statusChip } from "./elements.js";
import { renderRosterPanel } from "./rosterPanel.js";
import { renderSettingsPanel } from "./settingsPanel.js";
import {
  renderHeader,
  renderRules,
  renderStandingsSection,
  renderTournamentResults,
  tournamentUrl,
} from "./publicView.js";
import { renderBracket, renderRounds } from "./standingsView.js";

function kpi(value, label, tone = "") {
  return h(
    "div",
    { className: `kpi ${tone}` },
    h("strong", {}, String(value)),
    h("span", {}, label),
  );
}

function renderKpis(view) {
  const stats = view.stats || {};
  return h(
    "div",
    { className: "kpi-strip" },
    kpi(view.currentRound?.label || "-", "Current round"),
    kpi(stats.live || 0, "Live", "is-live"),
    kpi(stats.ready || 0, "Ready"),
    kpi(stats.courtsAvailable || 0, "Courts free"),
    kpi(stats.waiting || 0, "Waiting"),
    kpi(stats.sittingOut || 0, "Sitting out"),
    kpi(stats.delayed || 0, "Delayed", stats.delayed ? "is-warning" : ""),
    kpi(`${stats.completionPct || 0}%`, "Complete"),
  );
}

function courtSelect(ctx, selectedCourtId) {
  const courts = ctx.courtOptions.length ? ctx.courtOptions : ctx.view.courts;
  return h(
    "select",
    { className: "ev-select ev-select-sm", "aria-label": "Court" },
    courts.map((court) =>
      h(
        "option",
        {
          value: court.courtId,
          selected: court.courtId === selectedCourtId ? true : null,
        },
        `${court.name || court.courtId}${court.status === "closed" ? " (closed)" : ""}`,
      ),
    ),
  );
}

function actionButton(label, onClick, className = "ev-btn ev-btn-sm") {
  return h("button", { className, type: "button", onClick }, label);
}

function correctionForm(ctx, fixture) {
  const input = (name, value) =>
    h("input", {
      type: "number",
      min: 0,
      max: 999,
      className: "ev-input ev-input-num",
      name,
      value: value ?? 0,
    });
  const result = fixture.result || {};
  const pointsA = input("pointsA", result.points?.A);
  const pointsB = input("pointsB", result.points?.B);
  const gamesA = input("gamesA", result.games?.A);
  const gamesB = input("gamesB", result.games?.B);
  const reason = h("input", {
    type: "text",
    className: "ev-input",
    placeholder: "Reason (required)",
    maxlength: 200,
  });
  const form = h(
    "form",
    { className: "correction-form" },
    h(
      "div",
      { className: "correction-row" },
      h("span", {}, fixture.sides.A.label),
      pointsA,
      h("span", {}, "points"),
      gamesA,
      h("span", {}, "games"),
    ),
    h(
      "div",
      { className: "correction-row" },
      h("span", {}, fixture.sides.B.label),
      pointsB,
      h("span", {}, "points"),
      gamesB,
      h("span", {}, "games"),
    ),
    reason,
    h(
      "button",
      { className: "ev-btn ev-btn-sm", type: "submit" },
      "Save correction",
    ),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void ctx.run(
      "correctTournamentResult",
      {
        fixtureId: fixture.fixtureId,
        points: { A: Number(pointsA.value), B: Number(pointsB.value) },
        games: { A: Number(gamesA.value), B: Number(gamesB.value) },
        reason: reason.value,
      },
      "Result corrected.",
    );
  });
  return h(
    "details",
    { className: "fx-correct" },
    h("summary", {}, "Correct result"),
    form,
  );
}

// Inline actions for a fixture card, by state.
export function fixtureActions(ctx, fixture) {
  if (!ctx.isHost || ["completed", "cancelled"].includes(ctx.view.status))
    return null;
  const status = fixture.displayStatus;

  if (status === "LIVE") {
    const select = courtSelect(ctx, fixture.courtId);
    return h(
      "div",
      { className: "fx-actions" },
      fixture.courtId
        ? h(
            "a",
            {
              className: "ev-btn ev-btn-sm",
              href: `/c/${encodeURIComponent(fixture.courtId)}`,
            },
            "Scoreboard",
          )
        : null,
      select,
      actionButton("Move", () =>
        ctx.run(
          "moveFixtureCourt",
          { fixtureId: fixture.fixtureId, courtId: select.value },
          "Match moved.",
        ),
      ),
      actionButton("Complete", () =>
        ctx.confirmRun(
          `Complete ${fixture.label} with the current score?`,
          "completeFixture",
          { fixtureId: fixture.fixtureId },
          "Match completed.",
        ),
      ),
      actionButton("Requeue", () =>
        ctx.confirmRun(
          `Take ${fixture.label} off its court and back into the queue?`,
          "detachFixtureMatch",
          { fixtureId: fixture.fixtureId, requeue: true },
          "Match requeued.",
        ),
      ),
    );
  }

  if (["READY", "SCHEDULED", "DELAYED"].includes(status) && fixture.matchId) {
    const select = courtSelect(ctx, fixture.courtId);
    const rename = h("input", {
      className: "ev-input ev-input-sm",
      placeholder: "Rename match",
      maxlength: 80,
    });
    return h(
      "div",
      { className: "fx-actions" },
      select,
      h(
        "button",
        {
          className: "ev-btn",
          type: "button",
          disabled: fixture.canStart === false ? true : null,
          title:
            fixture.canStart === false
              ? "Previous rounds must finish first."
              : null,
          onClick: () =>
            ctx.run(
              "startFixture",
              { fixtureId: fixture.fixtureId, courtId: select.value },
              "Match started.",
            ),
        },
        "Start",
      ),
      actionButton("Set court", () =>
        ctx.run(
          "assignFixtureCourt",
          { fixtureId: fixture.fixtureId, courtId: select.value },
          "Court assigned.",
        ),
      ),
      h(
        "details",
        { className: "fx-more" },
        h("summary", {}, "More"),
        rename,
        actionButton("Rename", () =>
          ctx.run(
            "renameFixture",
            { fixtureId: fixture.fixtureId, name: rename.value },
            "Match renamed.",
          ),
        ),
      ),
    );
  }

  if (status === "COMPLETED") return correctionForm(ctx, fixture);
  return null;
}

function renderPrimaryControls(ctx) {
  const { view } = ctx;
  const buttons = [];
  const nextRoundNumber =
    Math.max(0, ...view.rounds.map((round) => round.roundNumber)) + 1;

  if (
    view.canGenerateInitialRound &&
    ["draft", "published", "live"].includes(view.status)
  ) {
    buttons.push(
      actionButton(
        "Generate schedule",
        () =>
          ctx.run(
            "generateRound",
            { expectedRoundNumber: 1 },
            "Schedule generated.",
          ),
        "ev-btn ev-btn-primary",
      ),
    );
  }
  if (view.status === "draft") {
    buttons.push(
      actionButton(
        "Publish",
        () => ctx.run("publishTournament", {}, "Tournament published."),
        "ev-btn",
      ),
    );
  }
  if (view.status === "draft" || view.status === "published") {
    buttons.push(
      actionButton(
        "Start tournament",
        () => ctx.run("startTournament", {}, "Tournament started."),
        "ev-btn ev-btn-primary",
      ),
    );
  }
  if (view.status === "live" || view.status === "published") {
    if (
      view.stats?.ready ||
      view.fixtures.some(
        (f) =>
          f.displayStatus === "SCHEDULED" && f.matchId && f.canStart !== false,
      )
    ) {
      buttons.push(
        actionButton(
          "Start ready matches",
          () => ctx.run("startRound", {}, "Ready matches started."),
          "ev-btn",
        ),
      );
    }
    if (view.format.supportsNextRound && !view.canGenerateInitialRound) {
      const allowed = view.nextRound?.allowed;
      buttons.push(
        h(
          "button",
          {
            className: "ev-btn ev-btn-primary",
            type: "button",
            disabled: allowed ? null : true,
            title: allowed ? null : view.nextRound?.reason,
            onClick: () =>
              ctx.run(
                "generateNextRound",
                { expectedRoundNumber: nextRoundNumber },
                `Round ${nextRoundNumber} generated.`,
              ),
          },
          `Generate Round ${nextRoundNumber}`,
        ),
      );
    }
  }
  if (view.status === "live" || view.status === "published") {
    buttons.push(
      actionButton("Finish", () => ctx.finishTournament(), "ev-btn"),
    );
  }
  if (!["completed", "cancelled"].includes(view.status)) {
    buttons.push(
      actionButton(
        "Cancel tournament",
        () => ctx.cancelTournament(),
        "ev-btn ev-btn-danger",
      ),
    );
  }
  buttons.push(
    actionButton(
      view.format.supportsFullSchedule
        ? "Recalculate remaining schedule"
        : "Recalculate",
      () => ctx.run("recalculateTournament", {}, "Tournament recalculated."),
      "ev-btn ev-btn-ghost",
    ),
  );

  return h(
    "div",
    { className: "primary-controls" },
    buttons,
    view.format.supportsNextRound &&
      view.nextRound &&
      !view.nextRound.allowed &&
      !view.canGenerateInitialRound
      ? h("span", { className: "ev-hint" }, view.nextRound.reason)
      : null,
  );
}

function renderExceptions(view) {
  const exceptions = view.exceptions || [];
  return section(
    "Exceptions",
    exceptions.length
      ? h(
          "ul",
          { className: "exceptions" },
          exceptions.map((exception) =>
            h(
              "li",
              {
                className: `exception exception-${exception.code.toLowerCase()}`,
              },
              exception.message,
            ),
          ),
        )
      : h("p", { className: "ev-hint" }, "No blocking issues."),
  );
}

function renderCourtBoard(ctx) {
  const { view, liveMatches } = ctx;
  const live = view.fixtures.filter(
    (fixture) => fixture.displayStatus === "LIVE",
  );
  return section(
    "Live courts",
    live.length
      ? h(
          "div",
          { className: "fx-grid fx-grid-live" },
          live.map((fixture) =>
            fixtureCard(fixture, {
              liveMatches,
              timezone: view.scheduling?.timezone,
              actions: fixtureActions(ctx, fixture),
            }),
          ),
        )
      : emptyState("No matches are being played right now."),
  );
}

function renderNext(ctx) {
  const { view, liveMatches } = ctx;
  const upcoming = view.fixtures
    .filter((fixture) =>
      ["READY", "SCHEDULED", "DELAYED", "TBD"].includes(fixture.displayStatus),
    )
    .sort(
      (a, b) =>
        a.roundNumber - b.roundNumber ||
        (a.scheduledStartAt || 0) - (b.scheduledStartAt || 0),
    )
    .slice(0, 12);
  const currentRound = view.rounds.find(
    (round) => round.roundId === view.currentRound?.roundId,
  );
  return section(
    "Next up",
    upcoming.length
      ? h(
          "div",
          { className: "fx-grid" },
          upcoming.map((fixture) =>
            fixtureCard(fixture, {
              liveMatches,
              timezone: view.scheduling?.timezone,
              actions: fixtureActions(ctx, fixture),
              compact: true,
            }),
          ),
        )
      : emptyState(
          view.rounds.length
            ? "Nothing is waiting."
            : "Generate the schedule to see matches here.",
        ),
    currentRound?.sittingOut?.length
      ? h(
          "div",
          { className: "sitting-out" },
          statusChip("sitting out"),
          h(
            "span",
            {},
            currentRound.sittingOut.map((entry) => entry.name).join(", "),
          ),
        )
      : null,
  );
}

function renderHostAccess(view, hostKey, accessCode) {
  if (!hostKey && !accessCode) return null;
  if (!hostKey) {
    return h("span", { className: "ev-hint" }, `Access code: ${accessCode}`);
  }
  const link = `${tournamentUrl(view.tournamentId)}?host=${encodeURIComponent(hostKey)}`;
  const status = h("span", { className: "ev-hint", role: "status" });
  return h(
    "details",
    { className: "host-access" },
    h("summary", {}, "Co-host link"),
    h(
      "p",
      { className: "ev-hint" },
      "Anyone with this link can run the tournament. Keep it private.",
    ),
    h("code", { className: "host-link" }, link),
    view.visibility === "private" && accessCode
      ? h("p", { className: "ev-hint" }, `Spectator access code: ${accessCode}`)
      : null,
    actionButton("Copy co-host link", async () => {
      try {
        await navigator.clipboard.writeText(link);
        status.textContent = "Copied.";
      } catch {
        status.textContent = "Copy failed - select the link instead.";
      }
    }),
    status,
  );
}

export function renderHostDashboard(ctx) {
  const { view, liveMatches } = ctx;
  return h(
    "div",
    { className: "ev-dashboard is-host" },
    renderHeader(view),
    view.status === "completed" ? renderTournamentResults(view) : null,
    h(
      "div",
      { className: "host-bar" },
      statusChip("host"),
      h("span", {}, "Control room"),
      renderHostAccess(view, ctx.hostKey, ctx.accessCode),
    ),
    ctx.statusArea,
    renderKpis(view),
    renderPrimaryControls(ctx),
    h(
      "div",
      { className: "ev-columns" },
      h(
        "div",
        { className: "ev-col-main" },
        renderCourtBoard(ctx),
        renderNext(ctx),
        view.bracket
          ? section("Bracket", renderBracket(view, { liveMatches }))
          : null,
        section(
          "Rounds and results",
          renderRounds(view, {
            liveMatches,
            actionsFor: (fixture) => fixtureActions(ctx, fixture),
          }),
        ),
      ),
      h(
        "aside",
        { className: "ev-col-side" },
        renderExceptions(view),
        view.status === "completed" && view.format.id !== "groupKnockout"
          ? null
          : renderStandingsSection(view),
        renderRosterPanel(ctx),
        renderSettingsPanel(ctx),
        h(
          "div",
          { className: "rules-preview" },
          h("p", { className: "ev-hint" }, "Spectators see these rules:"),
          renderRules(view),
        ),
      ),
    ),
  );
}
