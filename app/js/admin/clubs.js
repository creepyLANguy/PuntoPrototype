// Admin club list: the Clubs tab of the dashboard (search by club name or id,
// one row per club with its state and court/device counts). Owns #adminClubList;
// creating and editing a club is the club editor (clubEditor.js).
import { openClubEditor } from "./clubEditor.js";
import { anyValueMatches, normalizeSearchTerm } from "../clubs/clubIndex.js";
import { loadClubIndex } from "../clubs/clubLoader.js";
import { elements } from "../ui/dom.js";

let allClubs = [];

export function registerClubList()
{
  elements.adminClubSearch.addEventListener("input", renderFilteredClubs);
}

export async function loadClubList()
{
  elements.adminClubList.innerHTML = '<div class="loading">Loading clubs...</div>';
  const clubIndex = await loadClubIndex();
  allClubs = clubIndex.clubs;
  renderFilteredClubs();
}

function renderFilteredClubs()
{
  const term = normalizeSearchTerm(elements.adminClubSearch.value);
  renderClubList(allClubs.filter((club) => anyValueMatches(term, club.name, club.id)));
}

const countLabel = (count, noun) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function renderClubList(clubs)
{
  elements.adminClubList.innerHTML = "";

  if (clubs.length === 0)
  {
    elements.adminClubList.innerHTML = allClubs.length === 0
      ? '<div class="no-courts">No clubs yet. Use Add Club to add one.</div>'
      : '<div class="no-courts">No matching clubs found.</div>';
    return;
  }

  for (const club of clubs)
  {
    const item = document.createElement("div");
    item.className = "admin-court-item admin-club-item";
    item.dataset.clubId = club.id;
    item.innerHTML = `
      <div class="aci-name">
        <strong class="club-name"></strong>
        <div class="aci-id"></div>
      </div>
      <div class="aci-field club-courts-cell">
        <div class="aci-label">Courts</div>
        <div class="aci-value"></div>
      </div>
      <div class="aci-field club-devices-cell">
        <div class="aci-label">Devices</div>
        <div class="aci-value"></div>
      </div>
      <div class="aci-actions">
        <button class="edit-btn">Edit</button>
      </div>
    `;

    item.querySelector(".club-name").textContent = club.name;
    item.querySelector(".aci-id").textContent = `ID: ${club.id.toUpperCase()}`;
    const stateBadge = item.querySelector(".club-state-cell .status-badge");
    stateBadge.textContent = club.state.charAt(0).toUpperCase() + club.state.slice(1);
    stateBadge.classList.add(`status-${club.state}`);
    item.querySelector(".club-courts-cell .aci-value").textContent = countLabel(club.courtIds.length, "court");
    item.querySelector(".club-devices-cell .aci-value").textContent = countLabel(club.deviceIds.length, "device");
    item.querySelector(".edit-btn").addEventListener("click", () => void openClubEditor(club));

    elements.adminClubList.appendChild(item);
  }
}
