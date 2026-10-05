// Admin tournament list (spec section 34): every tournament with its format,
// club and status, opening the tournament control room. Owns
// #adminTournamentList.
import { getAllTournaments } from "../firebase/tournamentRepository.js";
import { getTournamentPath } from "../match/matchIdentity.js";
import { anyValueMatches, normalizeSearchTerm } from "../clubs/clubIndex.js";
import { elements } from "../ui/dom.js";

const STATUS_ORDER = {
  live: 0,
  published: 1,
  draft: 2,
  completed: 3,
  cancelled: 4,
};

let allTournaments = [];
let filtersBound = false;

function bindFilters() {
  if (filtersBound) return;
  filtersBound = true;
  elements.adminTournamentSearch?.addEventListener("input", renderAdminTournaments);
}

export async function loadAdminTournaments() {
  bindFilters();
  const list = elements.adminTournamentList;
  if (!list) return;
  list.innerHTML = '<div class="loading">Loading tournaments...</div>';
  try {
    const snapshot = await getAllTournaments();
    const tournaments = snapshot.docs
      .map((tournamentDoc) => ({
        tournamentId: tournamentDoc.id,
        ...tournamentDoc.data(),
      }))
      .sort(
        (a, b) =>
          (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
          String(a.name || "").localeCompare(String(b.name || "")),
      );
    allTournaments = tournaments;
    renderAdminTournaments();
  } catch (error) {
    console.error("Error loading tournaments:", error);
    list.innerHTML = '<div class="error">Error loading tournaments.</div>';
  }
}

function renderAdminTournaments() {
  const list = elements.adminTournamentList;
  if (!list) return;

  const term = normalizeSearchTerm(elements.adminTournamentSearch?.value || "");
  const tournaments = allTournaments.filter((tournament) =>
    anyValueMatches(
      term,
      tournament.name,
      tournament.tournamentId,
      tournament.clubId,
      tournament.format?.id,
    ),
  );

  list.innerHTML = "";
  if (tournaments.length === 0) {
    list.innerHTML = allTournaments.length === 0
      ? '<div class="no-courts">No tournaments yet.</div>'
      : '<div class="no-courts">No matching tournaments found.</div>';
    return;
  }

  tournaments.forEach((tournament) =>
    list.appendChild(buildTournamentRow(tournament)),
  );
}

function buildTournamentRow(tournament) {
  const item = document.createElement("div");
  item.className = "admin-court-item admin-tournament-item";

  const name = document.createElement("div");
  name.className = "aci-name";
  const title = document.createElement("strong");
  title.textContent = tournament.name || tournament.tournamentId;
  const id = document.createElement("div");
  id.className = "aci-id";
  id.textContent = `ID: ${tournament.tournamentId}`;
  name.append(title, id);

  const meta = document.createElement("div");
  meta.className = "aci-field";
  meta.textContent = [
    tournament.format?.id,
    tournament.clubId ? `Club ${tournament.clubId}` : null,
    tournament.visibility,
  ]
    .filter(Boolean)
    .join(" - ");

  const status = document.createElement("span");
  status.className = `status-badge status-${tournament.status}`;
  status.textContent = String(tournament.status || "").toUpperCase();

  const open = document.createElement("a");
  open.className = "edit-btn";
  open.href = getTournamentPath(tournament.tournamentId);
  open.textContent = "Control room";

  const actions = document.createElement("div");
  actions.className = "aci-actions";
  actions.appendChild(open);

  item.append(name, meta, status, actions);
  return item;
}
