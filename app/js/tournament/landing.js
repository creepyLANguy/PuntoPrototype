// Tournament landing (/t): tournaments hosted on this device, public
// tournaments and the way into the setup wizard.
import { getTournamentDirectory } from "../firebase/tournamentRepository.js";
import { getTournamentPath } from "../match/matchIdentity.js";
import {
  emptyState,
  h,
  replaceContent,
  section,
  statusChip,
} from "./elements.js";

const STATUS_ORDER = {
  live: 0,
  published: 1,
  draft: 2,
  completed: 3,
  cancelled: 4,
};

function tournamentRow(entry) {
  return h(
    "a",
    { className: "t-row", href: getTournamentPath(entry.tournamentId) },
    h(
      "div",
      { className: "t-row-main" },
      h("strong", {}, entry.name || entry.tournamentId),
      h(
        "span",
        {},
        [entry.clubName, entry.formatLabel].filter(Boolean).join(" - "),
      ),
    ),
    entry.status ? statusChip(entry.status) : null,
  );
}

export async function renderLanding(container, { hostedIds }) {
  replaceContent(
    container,
    h("p", { className: "ev-hint" }, "Loading tournaments..."),
  );
  let directory = [];
  try {
    const snapshot = await getTournamentDirectory();
    directory = snapshot.docs.map((entry) => ({
      tournamentId: entry.id,
      ...entry.data(),
    }));
  } catch (error) {
    console.warn("Could not load the tournament directory:", error);
  }
  const byId = new Map(directory.map((entry) => [entry.tournamentId, entry]));
  const hosted = hostedIds.map(
    (id) =>
      byId.get(id) || {
        tournamentId: id,
        name: `Tournament ${id.toUpperCase()}`,
      },
  );
  const others = directory
    .filter(
      (entry) =>
        !hostedIds.includes(entry.tournamentId) && entry.status !== "cancelled",
    )
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
        String(a.name).localeCompare(String(b.name)),
    );

  replaceContent(
    container,
    h(
      "div",
      { className: "ev-dashboard landing" },
      h(
        "header",
        { className: "ev-header" },
        h(
          "div",
          { className: "ev-header-main" },
          h("div", { className: "ev-eyebrow" }, "Padel Push™"),
          h("h1", { className: "ev-title" }, "Tournaments"),
          h(
            "p",
            { className: "ev-description" },
            "Americano, Mexicano, leagues, Swiss, brackets and King of the Court, played on normal Padel Push™ courts.",
          ),
          h(
            "div",
            { className: "ev-header-actions" },
            h(
              "a",
              { className: "ev-btn ev-btn-primary ev-btn-lg", href: "/t/new" },
              "Host a tournament",
            ),
            h("a", { className: "ev-btn", href: "/app/" }, "Scoreboard app"),
          ),
        ),
      ),
      hosted.length
        ? section(
            "Hosted on this device",
            h("div", { className: "t-list" }, hosted.map(tournamentRow)),
          )
        : null,
      section(
        "Tournaments",
        others.length
          ? h("div", { className: "t-list" }, others.map(tournamentRow))
          : emptyState("No public tournaments yet."),
      ),
    ),
  );
}
