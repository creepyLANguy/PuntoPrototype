// Host tournament settings (spec sections 4, 5.8 and 24.1): details,
// visibility, the optional club, the explicit court pool and timing. Fields
// that the lifecycle locks are shown read-only with the reason.
import { renderCourtPicker, reconcileSelection } from "./courtPicker.js";
import { h, section } from "./elements.js";

function toLocalInput(ms) {
  if (!ms) return "";
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function field(label, control, hint = null) {
  return h(
    "label",
    { className: "ev-field" },
    h("span", { className: "ev-field-label" }, label),
    control,
    hint ? h("span", { className: "ev-hint" }, hint) : null,
  );
}

export function renderSettingsPanel(ctx) {
  const { view } = ctx;
  if (["completed", "cancelled"].includes(view.status)) return null;
  const clubLocked = view.status === "live";
  const scheduling = view.scheduling || {};

  const name = h("input", {
    className: "ev-input",
    value: view.name,
    maxlength: 80,
  });
  const description = h(
    "textarea",
    { className: "ev-textarea", rows: 3, maxlength: 500 },
    view.description || "",
  );
  const visibility = h(
    "select",
    { className: "ev-select" },
    h(
      "option",
      { value: "public", selected: view.visibility === "public" ? true : null },
      "Public",
    ),
    h(
      "option",
      {
        value: "private",
        selected: view.visibility === "private" ? true : null,
      },
      "Private",
    ),
  );
  const club = h(
    "select",
    { className: "ev-select", disabled: clubLocked ? true : null },
    h("option", { value: "" }, "No club"),
    ctx.clubs.map((entry) =>
      h(
        "option",
        {
          value: entry.id,
          selected: entry.id === view.club?.clubId ? true : null,
        },
        entry.name,
      ),
    ),
  );
  const startAt = h("input", {
    className: "ev-input",
    type: "datetime-local",
    value: toLocalInput(scheduling.startAt),
  });
  const duration = h("input", {
    className: "ev-input ev-input-num",
    type: "number",
    min: 1,
    value: scheduling.defaultMatchDurationMinutes ?? 20,
  });
  const changeover = h("input", {
    className: "ev-input ev-input-num",
    type: "number",
    min: 0,
    value: scheduling.defaultChangeoverMinutes ?? 3,
  });
  const targetRounds = h("input", {
    className: "ev-input ev-input-num",
    type: "number",
    min: 1,
    value: scheduling.targetRoundCount ?? "",
  });

  let selectedCourtIds = [...(view.courtPool || [])];
  const picker = h("div", { className: "court-picker" });
  const clubName = () =>
    ctx.clubs.find((entry) => entry.id === club.value)?.name || null;
  const drawPicker = () =>
    renderCourtPicker(picker, {
      courts: ctx.courtOptions,
      clubId: club.value || null,
      clubName: clubName(),
      selectedCourtIds,
      onChange: (next) => {
        selectedCourtIds = next;
        drawPicker();
      },
    });
  club.addEventListener("change", () => {
    selectedCourtIds = reconcileSelection(selectedCourtIds, ctx.courtOptions);
    drawPicker();
  });
  drawPicker();

  const save = () =>
    ctx.run(
      "updateTournament",
      {
        expectedRevision: view.revision,
        patch: {
          name: name.value,
          description: description.value,
          visibility: visibility.value,
          ...(clubLocked ? {} : { clubId: club.value || null }),
          courtPool: selectedCourtIds,
          scheduling: {
            timezone: scheduling.timezone,
            startAt: startAt.value ? new Date(startAt.value).getTime() : null,
            defaultMatchDurationMinutes: Number(duration.value),
            defaultChangeoverMinutes: Number(changeover.value),
            targetRoundCount: targetRounds.value
              ? Number(targetRounds.value)
              : null,
          },
        },
      },
      "Settings saved.",
    );

  return section(
    "Settings",
    h(
      "details",
      { className: "settings-panel" },
      h("summary", {}, "Edit event details, courts and timing"),
      field("Name", name),
      field("Description", description),
      field("Visibility", visibility),
      field(
        "Club",
        club,
        clubLocked
          ? "The club is locked once the tournament is live."
          : "Optional. Its courts are listed first.",
      ),
      h(
        "div",
        { className: "ev-field" },
        h("span", { className: "ev-field-label" }, "Courts"),
        picker,
      ),
      field("Start", startAt),
      h(
        "div",
        { className: "ev-field-row" },
        field("Match minutes", duration),
        field("Changeover minutes", changeover),
        field("Planned rounds", targetRounds),
      ),
      h(
        "button",
        { className: "ev-btn ev-btn-primary", type: "button", onClick: save },
        "Save settings",
      ),
    ),
  );
}
