// Tournament setup wizard (spec section 35): basics with the optional club,
// format, format settings, players or teams, club-first courts, schedule,
// a server-generated review, then create (and optionally publish).
import { renderCourtPicker, reconcileSelection } from "./courtPicker.js";
import { h, replaceContent, section } from "./elements.js";
import {
  buildFormatConfig,
  defaultFieldValues,
  FORMATS,
  getFormatEntry,
  isFieldVisible,
  parsePlayerLines,
  parseTeamLines,
} from "./formatCatalog.js";
import {
  friendlyError,
  newRequestId,
  publicTournamentOperation,
  tournamentOperation,
} from "./tournamentApi.js";

function field(label, control, hint = null) {
  return h(
    "label",
    { className: "ev-field" },
    h("span", { className: "ev-field-label" }, label),
    control,
    hint ? h("span", { className: "ev-hint" }, hint) : null,
  );
}

function step(number, title, ...children) {
  return h(
    "section",
    { className: "wizard-step", dataset: { step: number } },
    h(
      "h2",
      { className: "wizard-step-title" },
      h("span", { className: "wizard-step-number" }, String(number)),
      title,
    ),
    ...children,
  );
}

export function renderWizard(
  container,
  { courts, clubs, onCreated, adminCredentials },
) {
  const state = {
    formatId: "americano",
    fieldValues: defaultFieldValues("americano"),
    entryMode: "individual",
    clubId: "",
    courtIds: [],
    requestId: newRequestId(),
  };

  const name = h("input", {
    className: "ev-input",
    maxlength: 80,
    placeholder: "Friday Night Padel Social",
    required: true,
  });
  const description = h("textarea", {
    className: "ev-textarea",
    rows: 2,
    maxlength: 500,
    placeholder: "Optional",
  });
  const startAt = h("input", { className: "ev-input", type: "datetime-local" });
  const visibility = h(
    "select",
    { className: "ev-select" },
    h(
      "option",
      { value: "public" },
      "Public - anyone with the link can follow",
    ),
    h("option", { value: "private" }, "Private - needs an access code"),
  );
  const club = h(
    "select",
    { className: "ev-select" },
    h("option", { value: "" }, "No club"),
    clubs.map((entry) => h("option", { value: entry.id }, entry.name)),
  );

  const formatChoices = h("div", {
    className: "format-choices",
    role: "radiogroup",
  });
  const formatFields = h("div", { className: "format-fields" });
  const entryModeField = h("div");
  const roster = h("textarea", { className: "ev-textarea", rows: 8 });
  const rosterHint = h("p", { className: "ev-hint" });
  const picker = h("div", { className: "court-picker" });
  const duration = h("input", {
    className: "ev-input ev-input-num",
    type: "number",
    min: 1,
    value: 20,
  });
  const changeover = h("input", {
    className: "ev-input ev-input-num",
    type: "number",
    min: 0,
    value: 3,
  });
  const targetRounds = h("input", {
    className: "ev-input ev-input-num",
    type: "number",
    min: 1,
    placeholder: "Open",
  });
  const generation = h(
    "select",
    { className: "ev-select" },
    h("option", { value: "now" }, "Generate the schedule now"),
    h("option", { value: "later" }, "Generate later from the control room"),
  );
  const publish = h("input", { type: "checkbox", checked: true });
  const review = h("div", { className: "wizard-review" });
  const status = h("div", { className: "ev-status", role: "status" });
  const createButton = h(
    "button",
    { className: "ev-btn ev-btn-primary ev-btn-lg", type: "button" },
    "Create tournament",
  );

  const entryMode = () => {
    const entry = getFormatEntry(state.formatId).entry;
    return entry === "either" ? state.entryMode : entry;
  };

  const drawFormatChoices = () =>
    replaceContent(
      formatChoices,
      FORMATS.map((format) =>
        h(
          "label",
          {
            className: `format-choice${format.id === state.formatId ? " is-selected" : ""}`,
          },
          h("input", {
            type: "radio",
            name: "format",
            value: format.id,
            checked: format.id === state.formatId ? true : null,
            onChange: () => {
              state.formatId = format.id;
              state.fieldValues = defaultFieldValues(format.id);
              drawAll();
            },
          }),
          h("strong", {}, format.label),
          h("span", {}, format.summary),
        ),
      ),
    );

  const drawFormatFields = () => {
    const format = getFormatEntry(state.formatId);
    replaceContent(
      formatFields,
      format.fields
        .filter((f) => isFieldVisible(f, state.fieldValues))
        .map((f) => {
          const value = state.fieldValues[f.key];
          let control;
          if (f.type === "select") {
            control = h(
              "select",
              { className: "ev-select" },
              f.options.map(([optionValue, label]) =>
                h(
                  "option",
                  {
                    value: optionValue,
                    selected: optionValue === value ? true : null,
                  },
                  label,
                ),
              ),
            );
          } else if (f.type === "checkbox") {
            control = h("input", {
              type: "checkbox",
              checked: value ? true : null,
            });
          } else {
            control = h("input", {
              className: "ev-input ev-input-num",
              type: "number",
              min: f.min,
              max: f.max,
              value: value ?? "",
            });
          }
          control.addEventListener("change", () => {
            state.fieldValues[f.key] =
              f.type === "checkbox" ? control.checked : control.value;
            if (format.fields.some((other) => other.showIf?.[0] === f.key))
              drawFormatFields();
          });
          return field(f.label, control);
        }),
    );
    replaceContent(
      entryModeField,
      format.entry === "either"
        ? field(
            "Entries",
            (() => {
              const select = h(
                "select",
                { className: "ev-select" },
                h(
                  "option",
                  {
                    value: "individual",
                    selected: state.entryMode === "individual" ? true : null,
                  },
                  "Individual players",
                ),
                h(
                  "option",
                  {
                    value: "team",
                    selected: state.entryMode === "team" ? true : null,
                  },
                  "Fixed pairs",
                ),
              );
              select.addEventListener("change", () => {
                state.entryMode = select.value;
                drawRosterHint();
              });
              return select;
            })(),
          )
        : null,
    );
  };

  const drawRosterHint = () => {
    const teams = entryMode() === "team";
    roster.placeholder = teams
      ? "One pair per line:\nAlice & Ben\nTigers: Chris & Dan"
      : "One player per line:\nAlice\nBen\nChris (f)\n#1 Dan  (seed 1)";
    rosterHint.textContent = teams
      ? 'Paste pairs as "Player & Player", optionally "Team name: Player & Player".'
      : "Paste one name per line. Add (m) or (f) for mixed formats and #N to seed.";
  };

  const drawPicker = () => {
    state.courtIds = reconcileSelection(state.courtIds, courts);
    renderCourtPicker(picker, {
      courts,
      clubId: state.clubId || null,
      clubName: clubs.find((entry) => entry.id === state.clubId)?.name || null,
      selectedCourtIds: state.courtIds,
      onChange: (next) => {
        state.courtIds = next;
        drawPicker();
      },
    });
  };

  const drawAll = () => {
    drawFormatChoices();
    drawFormatFields();
    drawRosterHint();
  };

  club.addEventListener("change", () => {
    // Changing the club re-ranks the courts; explicit selections stay.
    state.clubId = club.value;
    drawPicker();
  });

  const buildPayload = () => {
    const teams = entryMode() === "team";
    const payload = {
      name: name.value,
      description: description.value,
      clubId: state.clubId || null,
      visibility: visibility.value,
      format: {
        id: state.formatId,
        config: buildFormatConfig(state.formatId, state.fieldValues),
      },
      participantMode: entryMode(),
      courtPool: state.courtIds,
      scheduling: {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        startAt: startAt.value ? new Date(startAt.value).getTime() : null,
        defaultMatchDurationMinutes: Number(duration.value) || 20,
        defaultChangeoverMinutes: Number(changeover.value) || 0,
        targetRoundCount: targetRounds.value
          ? Number(targetRounds.value)
          : null,
      },
    };
    if (teams)
      payload.teams = parseTeamLines(roster.value).map((team) => ({
        name: team.name,
        players: team.players,
      }));
    else payload.participantText = roster.value;
    return payload;
  };

  const previewPayload = (payload) => ({
    ...payload,
    name: payload.name || "Preview",
    participants: payload.participantText
      ? parsePlayerLines(payload.participantText).map((line) => ({
          displayName: line,
        }))
      : [],
    teams: (payload.teams || []).map((team, index) => ({
      teamId: `preview-t${index}`,
      name: team.name || team.players.join(" & "),
    })),
  });

  const runReview = async () => {
    replaceContent(
      review,
      h("p", { className: "ev-hint" }, "Checking the setup..."),
    );
    try {
      const result = await publicTournamentOperation(
        "previewTournament",
        previewPayload(buildPayload()),
      );
      const preview = result.preview;
      replaceContent(
        review,
        result.errors?.length
          ? h(
              "ul",
              { className: "review-errors" },
              result.errors.map((error) => h("li", {}, error.message)),
            )
          : null,
        result.warnings?.length
          ? h(
              "ul",
              { className: "review-warnings" },
              result.warnings.map((warning) => h("li", {}, warning.message)),
            )
          : null,
        preview
          ? h(
              "dl",
              { className: "review-facts" },
              h("dt", {}, "Entries"),
              h(
                "dd",
                {},
                String(
                  entryMode() === "team"
                    ? (buildPayload().teams || []).length
                    : parsePlayerLines(roster.value).length,
                ),
              ),
              h("dt", {}, "First schedule"),
              h(
                "dd",
                {},
                `${preview.rounds} round(s), ${preview.matches} match(es)`,
              ),
              h("dt", {}, "Courts needed"),
              h(
                "dd",
                {},
                `${preview.courtsNeeded} (selected ${state.courtIds.length})`,
              ),
              h("dt", {}, "Byes / sitting out"),
              h(
                "dd",
                {},
                `${preview.byes} bye(s), ${preview.sittingOut} sitting out`,
              ),
              h("dt", {}, "Estimated duration"),
              h("dd", {}, `${preview.estimatedMinutes} min`),
            )
          : null,
        h(
          "div",
          { className: "rules-card" },
          h(
            "div",
            { className: "rules-title" },
            result.rulesSummary?.title || "",
          ),
          h(
            "ul",
            { className: "rules-lines" },
            (result.rulesSummary?.lines || []).map((line) => h("li", {}, line)),
          ),
        ),
      );
      return !result.errors?.length;
    } catch (error) {
      replaceContent(
        review,
        h("p", { className: "review-errors" }, friendlyError(error)),
      );
      return false;
    }
  };

  createButton.addEventListener("click", async () => {
    if (!name.value.trim()) {
      status.textContent = "Give the tournament a name.";
      name.focus();
      return;
    }
    createButton.disabled = true;
    status.textContent = "Creating...";
    try {
      const ok = await runReview();
      if (!ok) {
        status.textContent = "Fix the issues above first.";
        return;
      }
      const created = await publicTournamentOperation(
        "createTournament",
        { ...buildPayload(), requestId: state.requestId },
        adminCredentials,
      );
      if (created.duplicate) {
        state.requestId = newRequestId();
        status.textContent =
          "This request already created a tournament, but its credentials cannot be recovered. Create again to start a new tournament.";
        return;
      }
      onCreated(created);
      const tournamentId = created.tournamentId;
      if (generation.value === "now" && state.courtIds.length) {
        status.textContent = "Generating the schedule...";
        await tournamentOperation("generateRound", tournamentId, {
          expectedRoundNumber: 1,
        });
      }
      if (publish.checked) {
        await tournamentOperation("publishTournament", tournamentId);
      }
      window.location.assign(`/t/${encodeURIComponent(tournamentId)}`);
    } catch (error) {
      status.textContent = friendlyError(error);
    } finally {
      createButton.disabled = false;
    }
  });

  drawAll();
  drawPicker();

  replaceContent(
    container,
    h(
      "div",
      { className: "wizard" },
      h(
        "header",
        { className: "ev-header" },
        h(
          "div",
          { className: "ev-header-main" },
          h("div", { className: "ev-eyebrow" }, "Padel Push"),
          h("h1", { className: "ev-title" }, "New tournament"),
        ),
      ),
      step(
        1,
        "Basics",
        field("Name", name),
        field("Description", description),
        field("Date and time", startAt),
        field(
          "Club",
          club,
          "Optional. The club's courts are listed first in step 5.",
        ),
        field("Visibility", visibility),
      ),
      step(2, "Format", formatChoices),
      step(3, "Format settings", entryModeField, formatFields),
      step(4, "Players or teams", roster, rosterHint),
      step(5, "Courts", picker),
      step(
        6,
        "Schedule",
        h(
          "div",
          { className: "ev-field-row" },
          field("Match minutes", duration),
          field("Changeover minutes", changeover),
          field(
            "Planned rounds",
            targetRounds,
            "Americano formats generate every round upfront. Leave blank for a time-window estimate or one social cycle. Result-dependent formats forecast times; pairings wait for results.",
          ),
        ),
        field("Schedule", generation),
      ),
      step(
        7,
        "Review",
        h(
          "button",
          {
            className: "ev-btn",
            type: "button",
            onClick: () => void runReview(),
          },
          "Check setup",
        ),
        review,
      ),
      section(
        null,
        h(
          "label",
          { className: "ev-check" },
          publish,
          h("span", {}, "Publish the public page straight away"),
        ),
        createButton,
        status,
      ),
    ),
  );
}
