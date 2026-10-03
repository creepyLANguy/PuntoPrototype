// Admin court management: the admin court list (search, status filter), the create
// court form and the edit court form (save, clear score, delete). Owns
// #adminCourtList, #createPage and #editCourtPage.
import { ALLOWED_COURT_ID_CHARS, DEFAULT_PLAYER_NAMES, DEFAULT_SCORING_OPTIONS, STATUS, TOAST_TYPES } from "../config/constants.js";
import { NAV_PAGES } from "../config/routes.js";
import { resetCourt, updateScoringOptions } from "../firebase/callables.js";
import { createCourt, deleteCourt, getAllCourts, setCourtScore, updateCourt } from "../firebase/courtRepository.js";
import { replaceNavigationState, stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { normalizeScoringOptions } from "../scoring/options.js";
import { updateUI } from "../scoring/scoreboard.js";
import { syncCourtScoringRuleControlsDisabled, syncScoringControls } from "../scoring/settings.js";
import { appState } from "../state/appState.js";
import { defaultScore, session } from "../state/sessionState.js";
import { normalizePlayerNames } from "../teams/playerNames.js";
import { normalizeTeamNames, resolvePersistedTeamNames, resolveTeamNames } from "../teams/teamNames.js";
import { elements } from "../ui/dom.js";
import { hideSpinner, showSpinner } from "../ui/loading.js";
import { showConfirm } from "../ui/modals.js";
import { showToast } from "../ui/toast.js";

let allAdminCourts = [];

export function registerAdminCourtFilters()
{
  // ADMIN DASHBOARD SEARCH & FILTER
  elements.adminCourtSearch.addEventListener("input", filterAndDisplayAdminCourts);
  elements.adminStatusFilter.addEventListener("change", filterAndDisplayAdminCourts);
}

export async function displayAdminCourtList()
{
  elements.adminCourtList.innerHTML = '<div class="loading">Loading all courts...</div>';

  try
  {
    const snapshot = await getAllCourts();

    const courtPromises = snapshot.docs.map(async (courtDoc) =>
    {
      const data = courtDoc.data();
      return {
        id: courtDoc.id,
        ...data
      };
    });

    allAdminCourts = await Promise.all(courtPromises);
    allAdminCourts.sort((a, b) => a.id.localeCompare(b.id));

    filterAndDisplayAdminCourts();
  }
  catch (error)
  {
    console.error("Error loading admin courts:", error);
    elements.adminCourtList.innerHTML = '<div class="error">Error loading courts.</div>';
  }
}

function filterAndDisplayAdminCourts()
{
  const searchTerm = elements.adminCourtSearch.value.toLowerCase().trim();
  const statusFilter = elements.adminStatusFilter.value;

  const filtered = allAdminCourts.filter(court =>
  {
    const matchesSearch =
      (court.name || "").toLowerCase().includes(searchTerm) ||
      court.id.toLowerCase().includes(searchTerm);

    const matchesStatus = statusFilter === "all" || court.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  renderAdminCourtList(filtered);
}

function renderAdminCourtList(courts)
{
  elements.adminCourtList.innerHTML = "";

  if (courts.length === 0)
  {
    elements.adminCourtList.innerHTML = '<div class="no-courts">No matching courts found.</div>';
    return;
  }

  //sort courts by name, then by id
  courts.sort((a, b) => {
    const nameComparison = (a.name || "").localeCompare(b.name || "");
    if (nameComparison !== 0) return nameComparison;
    return a.id.localeCompare(b.id);
  });

  courts.forEach(court =>
  {
    const item = document.createElement("div");
    item.className = "admin-court-item";

    item.innerHTML = `
          <div class="aci-name">
            <strong>${court.name || "N/A"}</strong>
            <div class="aci-id">ID: ${court.id}</div>
          </div>
          <div class="aci-field teams-cell">
            <div class="aci-label">Teams</div>
            <div class="aci-value">
              ${court.teamNames?.A || "A"} vs ${court.teamNames?.B || "B"}
            </div>
          </div>
          <div class="aci-field password-cell">
            <div class="aci-label">Password</div>
            <div class="aci-value"><code>${court.password || "No Password"}</code></div>
          </div>
          <div class="aci-field status-cell">
            <div class="aci-value">
              <span class="status-badge status-${court.status}">${court.status?.toUpperCase() || "UNKNOWN"}</span>
            </div>
          </div>
          <div class="aci-field status-cell">
            <div class="aci-actions">
              <button class="edit-btn" data-id="${court.id}">Edit</button>
            </div>
          </div>
        `;

    const resolvedTeamNames = resolveTeamNames(court.teamNames || {}, court.playerNames || {});
    const teamsValue = item.querySelector(".teams-cell .aci-value");
    if (teamsValue)
    {
      teamsValue.textContent = `${resolvedTeamNames.A} vs ${resolvedTeamNames.B}`;
    }

    item.querySelector(".edit-btn").addEventListener("click", () =>
    {
      openEditModal(court);
    });

    elements.adminCourtList.appendChild(item);
  });
}

export function openEditModal(court, syncHistory = true)
{
  appState.courtToEdit = court;
  const scoringOptions = normalizeScoringOptions({
    ...(court.scoringOptions || {}),
    scoringMode: court.scoringMode || court.scoringOptions?.scoringMode
  });

  elements.editCourtNameTitle.innerHTML = `${court.name}<br/>ID: ${court.id}`;
  elements.editCourtName.value = court.name || "";
  const rawTeamNames = normalizeTeamNames(court.teamNames || {});
  const playerNames = normalizePlayerNames(court.playerNames || {});
  elements.editTeamAName.value = rawTeamNames.A || "";
  elements.editTeamBName.value = rawTeamNames.B || "";
  elements.editPlayerA1Name.value = playerNames.A1;
  elements.editPlayerA2Name.value = playerNames.A2;
  elements.editPlayerB1Name.value = playerNames.B1;
  elements.editPlayerB2Name.value = playerNames.B2;
  elements.editCourtPassword.value = court.password || "";
  elements.editCourtStatus.value = court.status || STATUS.CLOSED;
  elements.editCourtScoringMode.value = scoringOptions.scoringMode;
  if (elements.editCourtDeuceMode)
  {
    elements.editCourtDeuceMode.value = scoringOptions.deuceMode;
  }
  if (elements.editCourtTiebreakMode)
  {
    elements.editCourtTiebreakMode.value = scoringOptions.tiebreakMode;
  }
  syncCourtScoringRuleControlsDisabled(
    elements.editCourtScoringMode,
    elements.editCourtDeuceMode,
    elements.editCourtTiebreakMode
  );

  elements.adminDashboardPage.style.display = "none";
  elements.editCourtPage.style.display = "flex";

  if (syncHistory)
  {
    syncCurrentViewState();
  }
}

export function registerAdminCourtEditor()
{
  elements.saveEditBtn.addEventListener("click", async () =>
  {
    if (!appState.courtToEdit) return;

    showSpinner(elements.editCourtPage);

    try
    {
      const courtId = appState.courtToEdit.id;
      const newName = elements.editCourtName.value.trim();

      if (!newName) throw new Error("Court name cannot be empty");

      const scoringOptions = normalizeScoringOptions({
        ...(appState.courtToEdit.scoringOptions || {}),
        scoringMode: elements.editCourtScoringMode.value,
        deuceMode: elements.editCourtDeuceMode?.value ||
          appState.courtToEdit.scoringOptions?.deuceMode ||
          DEFAULT_SCORING_OPTIONS.deuceMode,
        tiebreakMode: elements.editCourtTiebreakMode?.value ||
          appState.courtToEdit.scoringOptions?.tiebreakMode ||
          DEFAULT_SCORING_OPTIONS.tiebreakMode
      });
      const playerNames = normalizePlayerNames({
        A1: elements.editPlayerA1Name.value.trim(),
        A2: elements.editPlayerA2Name.value.trim(),
        B1: elements.editPlayerB1Name.value.trim(),
        B2: elements.editPlayerB2Name.value.trim()
      });
      const manualTeamNames = {
        A: elements.editTeamAName.value.trim(),
        B: elements.editTeamBName.value.trim()
      };
      const normalizedTeamNames = normalizeTeamNames(manualTeamNames);
      const resolvedTeamNames = resolvePersistedTeamNames(normalizedTeamNames, playerNames);
      await updateCourt(courtId, {
        name: newName,
        teamNames: resolvedTeamNames,
        playerNames,
        password: elements.editCourtPassword.value.trim(),
        status: elements.editCourtStatus.value,
        scoringMode: scoringOptions.scoringMode,
        scoringOptions
      });

      const result = await updateScoringOptions({
        courtId,
        scoringMode: scoringOptions.scoringMode,
        scoringOptions
      });
      const serverOptions = normalizeScoringOptions(result?.data?.scoringOptions || scoringOptions);
      session.currentScoringOptions = serverOptions;
      syncScoringControls();
      updateUI();

      showToast("Court updated successfully!", TOAST_TYPES.SUCCESS);
      elements.editCourtPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
      syncCurrentViewState("replace");
    }
    catch (err)
    {
      showToast("Failed to update: " + err.message, TOAST_TYPES.ERROR);
    }
    finally
    {
      hideSpinner(elements.editCourtPage);
    }
  });

  elements.clearCourtScoreBtn.addEventListener("click", async () =>
  {
    if (!appState.courtToEdit) return;

    if (!(await showConfirm(`Clear the existing score for court "${appState.courtToEdit.id}"?`))) return;

    try
    {
      await resetCourt(appState.courtToEdit.id, false);
      showToast("Court score cleared.", TOAST_TYPES.SUCCESS);
    }
    catch (err)
    {
      showToast("Failed to clear score: " + err.message, TOAST_TYPES.ERROR);
    }
  });

  elements.deleteCourtBtn.addEventListener("click", async () =>
  {
    if (!appState.courtToEdit) return;
    if (!(await showConfirm(`Are you sure you want to delete court "${appState.courtToEdit.id}"?\nThis cannot be undone.`))) return;

    try
    {
      await deleteCourt(appState.courtToEdit.id);
      showToast("Court deleted.", TOAST_TYPES.SUCCESS);
      elements.editCourtPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
      syncCurrentViewState("replace");
    }
    catch (err)
    {
      showToast("Delete failed: " + err.message, TOAST_TYPES.ERROR);
    }
  });

  elements.closeEditBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({ page: appState.isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
  });

  elements.closeEditBtn.onclick = () =>
  {
    void replaceNavigationState(createViewState({ page: appState.isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
  }
}

export function registerCreateCourt()
{
  elements.showCreateCourtModalBtn.addEventListener("click", () =>
  {
    elements.adminDashboardPage.style.display = "none";
    elements.createPage.style.display = "flex";
    elements.courtName.value = "";
    elements.courtPassword.value = "";
    elements.courtNameError.textContent = "";
    elements.courtPasswordError.textContent = "";
    syncCurrentViewState();
  });

  elements.closeCreateBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({ page: appState.isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
  });

  elements.createCourtBtn.addEventListener("click", async () =>
  {
    const courtName = elements.courtName.value.trim();
    const courtPass = elements.courtPassword.value.trim();
    const scoringMode = elements.courtScoringMode?.value || DEFAULT_SCORING_OPTIONS.scoringMode;
    const deuceMode = elements.courtDeuceMode?.value || DEFAULT_SCORING_OPTIONS.deuceMode;
    const tiebreakMode = elements.courtTiebreakMode?.value || DEFAULT_SCORING_OPTIONS.tiebreakMode;
    const scoringOptions = normalizeScoringOptions({ scoringMode, deuceMode, tiebreakMode });

    elements.courtNameError.textContent = "";
    elements.courtPasswordError.textContent = "";

    if (!courtName)
    {
      elements.courtNameError.textContent = "Court name required.";
      return;
    }

    if (!courtPass)
    {
      elements.courtPasswordError.textContent = "Court password required.";
      return;
    }
    else if (courtPass.length < 4)
    {
      elements.courtPasswordError.textContent = "Password must be at least 4 characters.";
      return;
    }
    else if (courtPass === courtName)
    {
      elements.courtPasswordError.textContent = "Password must be different from court name.";
      return;
    }

    const createRandomCourtId = () =>
      Array.from({ length: 4 }, () =>
        ALLOWED_COURT_ID_CHARS[Math.floor(Math.random() * ALLOWED_COURT_ID_CHARS.length)]
      ).join("");

    const existingCourtsSnapshot = await getAllCourts();
    const existingCourtIdsLower = new Set(
      existingCourtsSnapshot.docs.map((courtDoc) => courtDoc.id.toLowerCase())
    );

    let courtId = createRandomCourtId();
    while (existingCourtIdsLower.has(courtId.toLowerCase()))
    {
      courtId = createRandomCourtId();
    }

    courtId = courtId.toLowerCase();

    // Create court metadata
    await createCourt(courtId, {
      name: courtName,
      password: courtPass,
      scoreVersion: 0,
      beaconSidesSwapped: false,
      teamNames: { A: "Team A", B: "Team B" },
      playerNames: { ...DEFAULT_PLAYER_NAMES },
      status: elements.courtStatus.value,
      scoringMode: scoringOptions.scoringMode,
      scoringOptions
    });

    // Create initial score document
    await setCourtScore(
      courtId,
      defaultScore(scoringOptions)
    );

    showToast(`Court "${courtName}" created successfully. ID: ${courtId.toUpperCase()}`, TOAST_TYPES.SUCCESS);

    elements.createPage.style.display = "none";
    if (appState.isAdmin)
    {
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
    }
    else
    {
      elements.menuPage.style.display = "flex";
    }

    elements.courtName.value = "";
    elements.courtPassword.value = "";
    if (elements.courtScoringMode) elements.courtScoringMode.value = DEFAULT_SCORING_OPTIONS.scoringMode;
    if (elements.courtDeuceMode) elements.courtDeuceMode.value = DEFAULT_SCORING_OPTIONS.deuceMode;
    if (elements.courtTiebreakMode)
    {
      elements.courtTiebreakMode.value = DEFAULT_SCORING_OPTIONS.tiebreakMode;
      elements.courtTiebreakMode.disabled = false;
    }
    syncCourtScoringRuleControlsDisabled(
      elements.courtScoringMode,
      elements.courtDeuceMode,
      elements.courtTiebreakMode
    );
    syncCurrentViewState("replace");
  });
}
