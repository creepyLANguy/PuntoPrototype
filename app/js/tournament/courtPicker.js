// Club-aware court picker (spec section 24.1): courts of the selected club
// first, then other eligible courts, then unavailable courts, clearly
// grouped. Choosing a club never selects courts by itself, and re-ranking
// keeps every explicit selection that is still a known court. Mirrors
// functions/domain/tournaments/setup.js orderCourtCandidates.
import { h, replaceContent } from "./elements.js";

export const COURT_GROUP_LABELS = {
  club: "Club courts",
  other: "Other courts",
  unavailable: "Unavailable",
};

function rank(court, clubId) {
  const available = court.status !== "closed";
  if (available && clubId && court.clubId === clubId) return 0;
  if (available) return 1;
  return 2;
}

export function orderCourtCandidates(
  courts,
  { clubId = null, selectedCourtIds = [] } = {},
) {
  const selected = new Set(selectedCourtIds);
  return [...courts]
    .map((court) => ({
      courtId: court.courtId,
      name: court.name || court.courtId,
      clubId: court.clubId || null,
      status: court.status || "open",
      inSelectedClub: Boolean(clubId) && court.clubId === clubId,
      available: court.status !== "closed",
      selected: selected.has(court.courtId),
      group: ["club", "other", "unavailable"][rank(court, clubId)],
    }))
    .sort(
      (left, right) =>
        rank(left, clubId) - rank(right, clubId) ||
        left.name.localeCompare(right.name, undefined, { numeric: true }) ||
        left.courtId.localeCompare(right.courtId),
    );
}

// Selections survive a club change as long as the court still exists.
export function reconcileSelection(selectedCourtIds, courts) {
  const known = new Set(courts.map((court) => court.courtId));
  return selectedCourtIds.filter((courtId) => known.has(courtId));
}

export function renderCourtPicker(
  container,
  { courts, clubId, clubName, selectedCourtIds, onChange },
) {
  const ordered = orderCourtCandidates(courts, { clubId, selectedCourtIds });
  const groups = ["club", "other", "unavailable"]
    .map((group) => ({
      group,
      courts: ordered.filter((court) => court.group === group),
    }))
    .filter((entry) => entry.courts.length > 0);

  const toggle = (courtId, checked) => {
    const next = checked
      ? [...selectedCourtIds.filter((id) => id !== courtId), courtId]
      : selectedCourtIds.filter((id) => id !== courtId);
    onChange(next);
  };

  replaceContent(
    container,
    groups.map(({ group, courts: groupCourts }) =>
      h(
        "fieldset",
        { className: `court-group court-group-${group}` },
        h(
          "legend",
          {},
          group === "club" && clubName
            ? `${clubName} courts`
            : COURT_GROUP_LABELS[group],
        ),
        group === "club"
          ? h(
              "p",
              { className: "ev-hint" },
              "Shown first because they belong to the selected club.",
            )
          : null,
        groupCourts.map((court) =>
          h(
            "label",
            {
              className: `court-option${court.available ? "" : " is-unavailable"}`,
            },
            h("input", {
              type: "checkbox",
              value: court.courtId,
              checked: court.selected,
              dataset: { courtId: court.courtId },
              onChange: (event) => toggle(court.courtId, event.target.checked),
            }),
            h("span", { className: "court-option-name" }, court.name),
            h(
              "span",
              { className: "court-option-meta" },
              court.courtId.toUpperCase(),
              court.available ? "" : " - closed",
            ),
          ),
        ),
      ),
    ),
  );
}
