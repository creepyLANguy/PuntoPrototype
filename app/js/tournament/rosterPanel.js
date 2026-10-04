// Host roster management (spec section 37): add players or teams (bulk
// paste), rename and seed, withdraw and restore, remove before scheduling and
// audited team member replacement.
import { parsePlayerLines, parseTeamLines } from "./formatCatalog.js";
import { h, section, statusChip } from "./elements.js";

function scheduledIds(view) {
  const ids = new Set();
  view.fixtures.forEach((fixture) =>
    ["A", "B"].forEach((key) => {
      const side = fixture.sides?.[key];
      (side?.participantIds || []).forEach((id) => ids.add(id));
      if (side?.teamId) ids.add(side.teamId);
    }),
  );
  return ids;
}

function entryActions(ctx, entry, kind, inSchedule) {
  const idKey = kind === "team" ? "teamId" : "participantId";
  const op = (name) => `${name}${kind === "team" ? "Team" : "Participant"}`;
  const nameInput = h("input", {
    className: "ev-input ev-input-sm",
    value: entry.name,
    maxlength: 40,
    "aria-label": "Name",
  });
  const seedInput = h("input", {
    className: "ev-input ev-input-num",
    type: "number",
    min: 1,
    value: entry.seed ?? "",
    "aria-label": "Seed",
  });
  const save = () =>
    ctx.run(
      op("update"),
      {
        [idKey]: entry.id,
        patch:
          kind === "team"
            ? { name: nameInput.value, seed: seedInput.value }
            : { displayName: nameInput.value, seed: seedInput.value },
      },
      "Saved.",
    );

  return h(
    "details",
    { className: "entry-edit" },
    h("summary", {}, "Edit"),
    h(
      "div",
      { className: "entry-edit-row" },
      nameInput,
      seedInput,
      h(
        "button",
        { className: "ev-btn ev-btn-sm", type: "button", onClick: save },
        "Save",
      ),
    ),
    h(
      "div",
      { className: "entry-edit-row" },
      entry.status === "active"
        ? h(
            "button",
            {
              className: "ev-btn ev-btn-sm",
              type: "button",
              onClick: () =>
                ctx.confirmRun(
                  `Withdraw ${entry.name}? Unplayed matches are cancelled or given as walkovers.`,
                  op("withdraw"),
                  { [idKey]: entry.id, reason: "Withdrawn by host" },
                  `${entry.name} withdrawn.`,
                ),
            },
            "Withdraw",
          )
        : null,
      entry.status === "withdrawn"
        ? h(
            "button",
            {
              className: "ev-btn ev-btn-sm",
              type: "button",
              onClick: () =>
                ctx.run(
                  op("restore"),
                  { [idKey]: entry.id },
                  `${entry.name} restored.`,
                ),
            },
            "Restore",
          )
        : null,
      !inSchedule
        ? h(
            "button",
            {
              className: "ev-btn ev-btn-sm ev-btn-danger",
              type: "button",
              onClick: () =>
                ctx.confirmRun(
                  `Remove ${entry.name}?`,
                  op("remove"),
                  { [idKey]: entry.id },
                  `${entry.name} removed.`,
                ),
            },
            "Remove",
          )
        : null,
    ),
    kind === "team" ? replaceMemberForm(ctx, entry) : null,
  );
}

function replaceMemberForm(ctx, team) {
  const member = h(
    "select",
    { className: "ev-select ev-select-sm", "aria-label": "Player to replace" },
    team.members.map((m) =>
      h("option", { value: m.participantId }, m.displayName),
    ),
  );
  const newName = h("input", {
    className: "ev-input ev-input-sm",
    placeholder: "Replacement name",
    maxlength: 40,
  });
  const reason = h("input", {
    className: "ev-input ev-input-sm",
    placeholder: "Reason",
    maxlength: 200,
  });
  return h(
    "div",
    { className: "entry-edit-row" },
    member,
    newName,
    reason,
    h(
      "button",
      {
        className: "ev-btn ev-btn-sm",
        type: "button",
        onClick: () =>
          ctx.run(
            "replaceTeamMember",
            {
              teamId: team.id,
              participantId: member.value,
              newParticipant: { displayName: newName.value },
              reason: reason.value,
            },
            "Player replaced.",
          ),
      },
      "Replace player",
    ),
  );
}

function addEntriesForm(ctx, isTeamMode, open) {
  const textarea = h("textarea", {
    className: "ev-textarea",
    rows: 5,
    placeholder: isTeamMode
      ? "One team per line:\nAlice & Ben\nTigers: Chris & Dan"
      : "One player per line:\nAlice\nBen (f)",
  });
  const submit = () => {
    if (isTeamMode) {
      const teams = parseTeamLines(textarea.value).map((team) => ({
        name: team.name,
        players: team.players,
      }));
      return ctx.run(
        "addParticipants",
        { teams },
        `${teams.length} team(s) added.`,
      );
    }
    return ctx.run(
      "addParticipants",
      { text: textarea.value },
      `${parsePlayerLines(textarea.value).length} player(s) added.`,
    );
  };
  return h(
    "details",
    { className: "entry-add", open: open ? true : null },
    h("summary", {}, isTeamMode ? "Add teams" : "Add players"),
    textarea,
    h(
      "button",
      { className: "ev-btn ev-btn-sm", type: "button", onClick: submit },
      "Add",
    ),
  );
}

export function renderRosterPanel(ctx) {
  const { view } = ctx;
  const isTeamMode = view.format.entryMode === "team";
  const inSchedule = scheduledIds(view);
  const canAdd =
    !["completed", "cancelled"].includes(view.status) &&
    (view.rounds.length === 0 ||
      ["rotating", "courtRotation"].includes(view.format.kind));
  const participantsById = new Map(
    view.participants.map((p) => [p.participantId, p]),
  );

  const entries = isTeamMode
    ? view.teams.map((team) => ({
        id: team.teamId,
        name: team.name,
        seed: team.seed,
        status: team.status,
        members: team.participantIds
          .map((id) => participantsById.get(id))
          .filter(Boolean),
        detail: team.participantIds
          .map((id) => participantsById.get(id)?.displayName)
          .filter(Boolean)
          .join(" & "),
      }))
    : view.participants.map((p) => ({
        id: p.participantId,
        name: p.displayName,
        seed: p.seed,
        status: p.status,
        detail: p.gender ? p.gender.toUpperCase() : "",
      }));

  return section(
    isTeamMode ? `Teams (${entries.length})` : `Players (${entries.length})`,
    canAdd ? addEntriesForm(ctx, isTeamMode, entries.length === 0) : null,
    h(
      "ul",
      { className: "entry-list is-host" },
      entries
        .sort(
          (a, b) =>
            (a.seed ?? 999) - (b.seed ?? 999) || a.name.localeCompare(b.name),
        )
        .map((entry) =>
          h(
            "li",
            { className: `entry is-${entry.status}` },
            h(
              "div",
              { className: "entry-main" },
              entry.seed
                ? h("span", { className: "entry-seed" }, `#${entry.seed}`)
                : null,
              h("strong", {}, entry.name),
              entry.detail ? h("span", {}, entry.detail) : null,
              entry.status !== "active" ? statusChip(entry.status) : null,
            ),
            ["completed", "cancelled"].includes(view.status)
              ? null
              : entryActions(
                  ctx,
                  entry,
                  isTeamMode ? "team" : "participant",
                  inSchedule.has(entry.id),
                ),
          ),
        ),
    ),
  );
}
