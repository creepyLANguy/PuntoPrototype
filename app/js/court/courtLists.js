// Court lists for the Play and Spectate pages: loading the visible courts (with
// their club), search filtering by court or club, the inline loader and the
// scroll-fade affordance. Owns #playCourtList and #spectateCourtList.
import { clubSummary, courtMatchesSearch } from "../clubs/clubIndex.js";
import { loadClubIndex } from "../clubs/clubLoader.js";
import { STATUS } from "../config/constants.js";
import { enterCourt } from "./session.js";
import { getAllCourts } from "../firebase/courtRepository.js";
import { appState } from "../state/appState.js";
import { normalizePlayerNames } from "../teams/playerNames.js";
import { normalizeTeamNames } from "../teams/teamNames.js";
import { elements } from "../ui/dom.js";
import { ensureMinimumLoadingDuration } from "../ui/loading.js";

async function loadAllActiveCourts(includePrivateCourts = true)
{
  try
  {
    const [snapshot, clubIndex] = await Promise.all([getAllCourts(), loadClubIndex()]);
    appState.allCourts = [];
    snapshot.forEach(doc =>
    {
      let data = doc.data();
      if (data.status === STATUS.OPEN || (includePrivateCourts && data.status === STATUS.PRIVATE))
      {
        appState.allCourts.push({
          id: doc.id,
          name: data.name || doc.id,
          password: data.password,
          createdAt: data.createdAt,
          status: data.status,
          teamNames: normalizeTeamNames(data.teamNames || {}),
          playerNames: normalizePlayerNames(data.playerNames || {}),
          club: clubSummary(clubIndex.clubByCourtId.get(doc.id))
        });
      }
    });

    appState.allCourts.sort((a, b) => a.name.localeCompare(b.name));
    appState.filteredCourts = [...appState.allCourts];
  }
  catch (error)
  {
    console.error("Error loading courts:", error);
    appState.allCourts = [];
    appState.filteredCourts = [];
  }
}

function filterCourts(searchTerm, courts)
{
  return courts.filter((court) => courtMatchesSearch(court, searchTerm));
}

// Name, club and id columns of a court row. The club column is always
// present so rows line up; it is hidden while no loaded court has a club.
function fillCourtItem(item, court)
{
  item.dataset.courtName = court.name;
  item.dataset.courtId = court.id;
  item.tabIndex = 0;
  item.role = "button";
  item.setAttribute(
    "aria-label",
    court.club ? `${court.name} - ${court.id} - ${court.club.name}` : `${court.name} - ${court.id}`
  );

  item.innerHTML = `
        <div class="court-item-name">${court.name}</div>
        <span class="court-item-club"></span>
        <span class="court-item-id">${court.id}</span>
    `;

  const clubCell = item.querySelector(".court-item-club");
  if (court.club)
  {
    clubCell.textContent = court.club.name;
    clubCell.title = court.club.name;
  }
}

// Decided from every loaded court rather than the filtered rows, so the
// column does not appear and disappear while the user types a search.
function syncClubColumn(listContainer)
{
  listContainer.classList.toggle("has-clubs", appState.allCourts.some((court) => court.club));
}

function showCourtListLoading(listContainer)
{
  if (!listContainer) return;

  listContainer.innerHTML = `
      <div class="loading"><span class="loader"></span></div>
    `;

  syncCourtListFadeState(listContainer);
}

export function syncCourtListFadeState(listContainer)
{
  if (!listContainer) return;

  const hasOverflow = listContainer.scrollHeight > listContainer.clientHeight + 1;
  const atTop = listContainer.scrollTop <= 1;
  const atBottom = listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 1;

  listContainer.classList.toggle("has-overflow", hasOverflow);
  listContainer.classList.toggle("fade-top", hasOverflow && !atTop);
  listContainer.classList.toggle("fade-bottom", hasOverflow && !atBottom);
}

function ensureCourtListFadeBinding(listContainer)
{
  if (!listContainer || listContainer.dataset.fadeBound === "true") return;

  listContainer.dataset.fadeBound = "true";
  listContainer.addEventListener("scroll", () =>
  {
    syncCourtListFadeState(listContainer);
  }, { passive: true });
}

export async function loadCourtsWithInlineLoader(listContainer, includePrivateCourts = true)
{
  showCourtListLoading(listContainer);
  const startedAt = Date.now();

  await loadAllActiveCourts(includePrivateCourts);
  await ensureMinimumLoadingDuration(startedAt);
}

export function displayPlayCourtList(courts)
{
  const listContainer = elements.playCourtList;
  ensureCourtListFadeBinding(listContainer);
  listContainer.innerHTML = "";
  syncClubColumn(listContainer);

  if (courts.length === 0)
  {
    listContainer.innerHTML = '<div class="no-courts">No courts found</div>';
    syncCourtListFadeState(listContainer);
    return;
  }

  courts.forEach((court, index) =>
  {
    const item = document.createElement("div");
    item.className = "court-item";
    fillCourtItem(item, court);

    const selectCourt = () =>
    {
      appState.selectedPlayCourt = court.id;
      elements.playCourtSearch.value = court.name;
      elements.playCourtList.querySelectorAll(".court-item").forEach(el =>
      {
        el.classList.remove("active");
      });
      item.classList.add("active");
      elements.playPasswordSection.style.display = "block";
      elements.playCourtPassword.focus();
      elements.playCourtNameError.style.display = "none";
      elements.playCourtNameError.textContent = "";
      elements.playCourtPasswordError.textContent = "";
    };

    item.addEventListener("click", selectCourt);

    item.addEventListener("keydown", (e) =>
    {
      if (e.key === "Enter" || e.key === " ")
      {
        e.preventDefault();
        selectCourt();
      }
      else if (e.key === "ArrowDown")
      {
        e.preventDefault();
        const nextItem = item.nextElementSibling;
        if (nextItem && nextItem.classList.contains("court-item"))
        {
          nextItem.focus();
        }
      }
      else if (e.key === "ArrowUp")
      {
        e.preventDefault();
        const prevItem = item.previousElementSibling;
        if (prevItem && prevItem.classList.contains("court-item"))
        {
          prevItem.focus();
        }
      }
    });

    listContainer.appendChild(item);
  });

  syncCourtListFadeState(listContainer);
}

export function displaySpectateCourtList(courts)
{
  const listContainer = elements.spectateCourtList;
  ensureCourtListFadeBinding(listContainer);
  listContainer.innerHTML = "";
  syncClubColumn(listContainer);

  if (courts.length === 0)
  {
    listContainer.innerHTML = '<div class="no-courts">No courts found</div>';
    syncCourtListFadeState(listContainer);
    return;
  }

  courts.forEach(court =>
  {
    const item = document.createElement("div");
    item.className = "court-item";
    fillCourtItem(item, court);

    const selectCourt = async () =>
    {
      await enterCourt(court.id, true, { historyMode: "replace" });
    };

    item.addEventListener("click", selectCourt);

    item.addEventListener("keydown", (e) =>
    {
      if (e.key === "Enter" || e.key === " ")
      {
        e.preventDefault();
        void selectCourt();
      }
      else if (e.key === "ArrowDown")
      {
        e.preventDefault();
        const nextItem = item.nextElementSibling;
        if (nextItem && nextItem.classList.contains("court-item"))
        {
          nextItem.focus();
        }
      }
      else if (e.key === "ArrowUp")
      {
        e.preventDefault();
        const prevItem = item.previousElementSibling;
        if (prevItem && prevItem.classList.contains("court-item"))
        {
          prevItem.focus();
        }
      }
    });

    listContainer.appendChild(item);
  });

  syncCourtListFadeState(listContainer);
}

export function registerCourtSearch()
{
  elements.playCourtSearch.addEventListener("input", (e) =>
  {
    const searchTerm = e.target.value;
    appState.filteredCourts = filterCourts(searchTerm, appState.allCourts);
    displayPlayCourtList(appState.filteredCourts);
  });

  elements.spectateCourtSearch.addEventListener("input", (e) =>
  {
    const searchTerm = e.target.value;
    appState.filteredCourts = filterCourts(searchTerm, appState.allCourts);
    displaySpectateCourtList(appState.filteredCourts);
  });
}
