// Admin court management: the admin court list (search by court or club,
// status filter), the create court form and the edit court form (save, clear
// score, delete). Owns #adminCourtList, #createPage and #editCourtPage.
import { clubSummary, courtMatchesSearch } from "../clubs/clubIndex.js";
import { loadClubIndex } from "../clubs/clubLoader.js";
import { fillAdminClubCell } from "./clubCell.js";
import {
  DEFAULT_SCORING_OPTIONS,
  STATUS,
  TOAST_TYPES,
} from "../config/constants.js";
import { NAV_PAGES } from "../config/routes.js";
import {
  createWithUniqueId,
  resetCourt,
  updateScoringOptions,
} from "../firebase/callables.js";
import {
  deleteCourt,
  getAllCourts,
  updateCourt,
} from "../firebase/courtRepository.js";
import {
  getMatch,
  getMatchesByStatus,
  updateMatch,
} from "../firebase/matchRepository.js";
import { resolveMatchTitle } from "../match/matchIdentity.js";
import {
  replaceNavigationState,
  stepBackInApp,
  syncCurrentViewState,
} from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { normalizeScoringOptions } from "../scoring/options.js";
import { updateUI } from "../scoring/scoreboard.js";
import {
  syncCourtScoringRuleControlsDisabled,
  syncScoringControls,
} from "../scoring/settings.js";
import { appState } from "../state/appState.js";
import { getCourtCredentials } from "../state/credentialsState.js";
import { session } from "../state/sessionState.js";
import { normalizePlayerNames } from "../teams/playerNames.js";
import {
  normalizeTeamNames,
  resolvePersistedTeamNames,
} from "../teams/teamNames.js";
import { elements } from "../ui/dom.js";
import { hideSpinner, showSpinner } from "../ui/loading.js";
import { showConfirm } from "../ui/modals.js";
import { showToast } from "../ui/toast.js";

let allAdminCourts = [];

function readFixedCourtScoringControls(prefix) {
  const byId = (suffix) => elements[prefix + suffix];
  const order = (byId("FixedServeOrder")?.value || "")
    .split(",")
    .map((slot) => slot.trim().toUpperCase())
    .filter(Boolean);

  return {
    pointsTarget: Number(byId("FixedPointsTarget")?.value),
    serving: {
      enabled: true,
      order,
      serveBlockLength: Number(byId("FixedServeBlockLength")?.value),
      sideSwapRule: byId("FixedSideSwapRule")?.value,
    },
    completion: {
      rule: "exact_total_points",
      tieResolution: byId("FixedTieResolution")?.value,
    },
  };
}

function populateFixedCourtScoringControls(prefix, options = {}) {
  const byId = (suffix) => elements[prefix + suffix];
  const order = options.serving?.order || ["A1", "B1", "A2", "B2"];

  if (byId("FixedPointsTarget"))
    byId("FixedPointsTarget").value = options.pointsTarget ?? 36;
  if (byId("FixedServeOrder")) byId("FixedServeOrder").value = order.join(", ");
  if (byId("FixedServeBlockLength"))
    byId("FixedServeBlockLength").value =
      options.serving?.serveBlockLength ?? 1;
  if (byId("FixedSideSwapRule"))
    byId("FixedSideSwapRule").value =
      options.serving?.sideSwapRule || "after_all_players_serve_once";
  if (byId("FixedTieResolution"))
    byId("FixedTieResolution").value =
      options.completion?.tieResolution || "allow_draw";
}

export function registerAdminCourtFilters() {
  // ADMIN DASHBOARD SEARCH & FILTER
  elements.adminCourtSearch.addEventListener(
    "input",
    filterAndDisplayAdminCourts,
  );
  elements.adminStatusFilter.addEventListener(
    "change",
    filterAndDisplayAdminCourts,
  );
}

export async function displayAdminCourtList() {
  elements.adminCourtList.innerHTML =
    '<div class="loading">Loading all courts...</div>';

  try {
    const [snapshot, clubIndex, liveMatches] = await Promise.all([
      getAllCourts(),
      loadClubIndex(),
      getMatchesByStatus("live").catch(() => null),
    ]);
    const liveMatchById = new Map(
      (liveMatches?.docs || []).map((matchDoc) => [
        matchDoc.id,
        matchDoc.data(),
      ]),
    );

    const courtPromises = snapshot.docs.map(async (courtDoc) => {
      const data = courtDoc.data();
      const activeMatch = data.activeMatchId
        ? liveMatchById.get(data.activeMatchId) || null
        : null;
      return {
        id: courtDoc.id,
        ...data,
        activeMatch: activeMatch
          ? { matchId: data.activeMatchId, ...activeMatch }
          : null,
        club: clubSummary(clubIndex.clubByCourtId.get(courtDoc.id)),
      };
    });

    allAdminCourts = await Promise.all(courtPromises);
    allAdminCourts.sort((a, b) => a.id.localeCompare(b.id));

    filterAndDisplayAdminCourts();
  } catch (error) {
    console.error("Error loading admin courts:", error);
    elements.adminCourtList.innerHTML =
      '<div class="error">Error loading courts.</div>';
  }
}

function filterAndDisplayAdminCourts() {
  const searchTerm = elements.adminCourtSearch.value;
  const statusFilter = elements.adminStatusFilter.value;

  const filtered = allAdminCourts.filter((court) => {
    const matchesSearch = courtMatchesSearch(court, searchTerm);

    const matchesStatus =
      statusFilter === "all" || court.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  renderAdminCourtList(filtered);
}

function renderAdminCourtList(courts) {
  elements.adminCourtList.innerHTML = "";

  if (courts.length === 0) {
    elements.adminCourtList.innerHTML =
      '<div class="no-courts">No matching courts found.</div>';
    return;
  }

  //sort courts by name, then by id
  courts.sort((a, b) => {
    const nameComparison = (a.name || "").localeCompare(b.name || "");
    if (nameComparison !== 0) return nameComparison;
    return a.id.localeCompare(b.id);
  });

  courts.forEach((court) => {
    const item = document.createElement("div");
    item.className = "admin-court-item";

    item.innerHTML = `
          <div class="aci-name">
            <strong>${court.name || "N/A"}</strong>
            <div class="aci-id">ID: ${court.id}</div>
          </div>
          <div class="aci-field club-cell">
            <div class="aci-label">Club</div>
            <div class="aci-value"></div>
          </div>
          <div class="aci-field teams-cell">
            <div class="aci-label">Match</div>
            <div class="aci-value"></div>
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

    fillAdminClubCell(item.querySelector(".club-cell"), court.club);

    const teamsValue = item.querySelector(".teams-cell .aci-value");
    if (teamsValue) {
      teamsValue.textContent = court.activeMatch
        ? resolveMatchTitle(court.activeMatch, court.activeMatch.matchId)
        : "No live match";
    }

    item.querySelector(".edit-btn").addEventListener("click", () => {
      appState.adminEditReturnView = null;
      openEditModal(court);
    });

    elements.adminCourtList.appendChild(item);
  });
}

// Names on the edit form belong to the casual match currently on the court;
// tournament match names come from the tournament roster.
async function loadEditableMatch(court) {
  if (!court.activeMatchId) return null;
  try {
    const snap = await getMatch(court.activeMatchId);
    return snap.exists()
      ? { matchId: court.activeMatchId, ...snap.data() }
      : null;
  } catch (err) {
    console.warn("Could not load the match on this court:", err);
    return null;
  }
}

function fillEditNames(match) {
  const rawTeamNames = normalizeTeamNames(match?.teamNames || {});
  const playerNames = normalizePlayerNames(match?.playerNames || {});
  elements.editTeamAName.value = rawTeamNames.A || "";
  elements.editTeamBName.value = rawTeamNames.B || "";
  elements.editPlayerA1Name.value = playerNames.A1;
  elements.editPlayerA2Name.value = playerNames.A2;
  elements.editPlayerB1Name.value = playerNames.B1;
  elements.editPlayerB2Name.value = playerNames.B2;
  const locked = Boolean(match?.tournamentId) || !match;
  [
    elements.editTeamAName,
    elements.editTeamBName,
    elements.editPlayerA1Name,
    elements.editPlayerA2Name,
    elements.editPlayerB1Name,
    elements.editPlayerB2Name,
  ].forEach((input) => {
    if (input) input.disabled = locked;
  });
}

export function openEditModal(court, syncHistory = true) {
  appState.courtToEdit = court;
  appState.courtToEditMatch = null;
  fillEditNames(null);
  void loadEditableMatch(court).then((match) => {
    if (appState.courtToEdit !== court) return;
    appState.courtToEditMatch = match;
    fillEditNames(match);
  });
  const scoringOptions = normalizeScoringOptions({
    ...(court.scoringOptions || {}),
    scoringMode: court.scoringMode || court.scoringOptions?.scoringMode,
  });

  elements.editCourtNameTitle.innerHTML = `${court.name}<br/>ID: ${court.id}`;
  elements.editCourtName.value = court.name || "";
  elements.editCourtPassword.value = court.password || "";
  elements.editCourtStatus.value = court.status || STATUS.CLOSED;
  elements.editCourtScoringMode.value = scoringOptions.scoringMode;
  if (elements.editCourtDeuceMode) {
    elements.editCourtDeuceMode.value = scoringOptions.deuceMode;
  }
  if (elements.editCourtTiebreakMode) {
    elements.editCourtTiebreakMode.value = scoringOptions.tiebreakMode;
  }
  populateFixedCourtScoringControls("editCourt", scoringOptions);
  syncCourtScoringRuleControlsDisabled(
    elements.editCourtScoringMode,
    elements.editCourtDeuceMode,
    elements.editCourtTiebreakMode,
    [
      elements.editCourtFixedPointsTarget,
      elements.editCourtFixedServeOrder,
      elements.editCourtFixedServeBlockLength,
      elements.editCourtFixedSideSwapRule,
      elements.editCourtFixedTieResolution,
    ],
  );
  elements.editCourtFixedScoringOptions?.classList.toggle(
    "hidden",
    scoringOptions.scoringMode !== "fixedTotalPoints",
  );

  elements.adminDashboardPage.style.display = "none";
  elements.editCourtPage.style.display = "flex";

  if (syncHistory) {
    syncCurrentViewState();
  }
}

// After a save or delete: back to the club editor the court was opened from,
// otherwise to the dashboard's court list.
function returnFromCourtEditor() {
  const returnView = appState.adminEditReturnView;
  appState.adminEditReturnView = null;
  if (returnView) {
    void stepBackInApp(returnView);
    return;
  }

  elements.editCourtPage.style.display = "none";
  elements.adminDashboardPage.style.display = "flex";
  displayAdminCourtList();
  syncCurrentViewState("replace");
}

export function registerAdminCourtEditor() {
  elements.saveEditBtn.addEventListener("click", async () => {
    if (!appState.courtToEdit) return;

    showSpinner(elements.editCourtPage);

    try {
      const courtId = appState.courtToEdit.id;
      const newName = elements.editCourtName.value.trim();

      if (!newName) throw new Error("Court name cannot be empty");

      const scoringMode = elements.editCourtScoringMode.value;
      const scoringOptions = normalizeScoringOptions({
        ...(appState.courtToEdit.scoringOptions || {}),
        scoringMode,
        deuceMode:
          elements.editCourtDeuceMode?.value ||
          appState.courtToEdit.scoringOptions?.deuceMode ||
          DEFAULT_SCORING_OPTIONS.deuceMode,
        tiebreakMode:
          elements.editCourtTiebreakMode?.value ||
          appState.courtToEdit.scoringOptions?.tiebreakMode ||
          DEFAULT_SCORING_OPTIONS.tiebreakMode,
        ...(scoringMode === "fixedTotalPoints"
          ? readFixedCourtScoringControls("editCourt")
          : {}),
      });
      const playerNames = normalizePlayerNames({
        A1: elements.editPlayerA1Name.value.trim(),
        A2: elements.editPlayerA2Name.value.trim(),
        B1: elements.editPlayerB1Name.value.trim(),
        B2: elements.editPlayerB2Name.value.trim(),
      });
      const manualTeamNames = {
        A: elements.editTeamAName.value.trim(),
        B: elements.editTeamBName.value.trim(),
      };
      const normalizedTeamNames = normalizeTeamNames(manualTeamNames);
      const resolvedTeamNames = resolvePersistedTeamNames(
        normalizedTeamNames,
        playerNames,
      );
      // The court keeps its physical settings and the default scoring for
      // new casual matches; names belong to the casual match on the court.
      await updateCourt(courtId, {
        name: newName,
        password: elements.editCourtPassword.value.trim(),
        status: elements.editCourtStatus.value,
        scoringMode: scoringOptions.scoringMode,
        scoringOptions,
      });

      const editableMatch = appState.courtToEditMatch;
      if (editableMatch && !editableMatch.tournamentId) {
        await updateMatch(editableMatch.matchId, {
          teamNames: resolvedTeamNames,
          playerNames,
        });
        const result = await updateScoringOptions({
          courtId,
          scoringMode: scoringOptions.scoringMode,
          scoringOptions,
          credentials: getCourtCredentials(),
        });
        if (session.currentCourtId === courtId) {
          session.currentScoringOptions = normalizeScoringOptions(
            result?.data?.scoringOptions || scoringOptions,
          );
          syncScoringControls();
          updateUI();
        }
      }

      showToast("Court updated successfully!", TOAST_TYPES.SUCCESS);
      returnFromCourtEditor();
    } catch (err) {
      showToast("Failed to update: " + err.message, TOAST_TYPES.ERROR);
    } finally {
      hideSpinner(elements.editCourtPage);
    }
  });

  elements.clearCourtScoreBtn.addEventListener("click", async () => {
    if (!appState.courtToEdit) return;

    if (
      !(await showConfirm(
        `Clear the existing score for court "${appState.courtToEdit.id}"?`,
      ))
    )
      return;

    try {
      await resetCourt(
        appState.courtToEdit.id,
        false,
        null,
        false,
        getCourtCredentials(),
      );
      showToast("Court score cleared.", TOAST_TYPES.SUCCESS);
    } catch (err) {
      showToast("Failed to clear score: " + err.message, TOAST_TYPES.ERROR);
    }
  });

  elements.deleteCourtBtn.addEventListener("click", async () => {
    if (!appState.courtToEdit) return;
    if (
      !(await showConfirm(
        `Are you sure you want to delete court "${appState.courtToEdit.id}"?\nThis cannot be undone.`,
      ))
    )
      return;

    try {
      await deleteCourt(appState.courtToEdit.id);
      showToast("Court deleted.", TOAST_TYPES.SUCCESS);
      returnFromCourtEditor();
    } catch (err) {
      showToast("Delete failed: " + err.message, TOAST_TYPES.ERROR);
    }
  });

  elements.closeEditBtn.addEventListener("click", () => {
    void stepBackInApp(
      createViewState({
        page: appState.isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU,
      }),
    );
  });

  elements.closeEditBtn.onclick = () => {
    void replaceNavigationState(
      createViewState({
        page: appState.isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU,
      }),
    );
  };
}

export function registerCreateCourt() {
  elements.showCreateCourtModalBtn.addEventListener("click", () => {
    elements.adminDashboardPage.style.display = "none";
    elements.createPage.style.display = "flex";
    elements.courtName.value = "";
    elements.courtPassword.value = "";
    elements.courtNameError.textContent = "";
    elements.courtPasswordError.textContent = "";
    syncCurrentViewState();
  });

  elements.closeCreateBtn.addEventListener("click", () => {
    void stepBackInApp(
      createViewState({
        page: appState.isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU,
      }),
    );
  });

  elements.createCourtBtn.addEventListener("click", async () => {
    const courtName = elements.courtName.value.trim();
    const courtPass = elements.courtPassword.value.trim();
    const scoringMode =
      elements.courtScoringMode?.value || DEFAULT_SCORING_OPTIONS.scoringMode;
    const deuceMode =
      elements.courtDeuceMode?.value || DEFAULT_SCORING_OPTIONS.deuceMode;
    const tiebreakMode =
      elements.courtTiebreakMode?.value || DEFAULT_SCORING_OPTIONS.tiebreakMode;
    const scoringOptions = normalizeScoringOptions({
      scoringMode,
      deuceMode,
      tiebreakMode,
      ...(scoringMode === "fixedTotalPoints"
        ? readFixedCourtScoringControls("court")
        : {}),
    });

    elements.courtNameError.textContent = "";
    elements.courtPasswordError.textContent = "";

    if (!courtName) {
      elements.courtNameError.textContent = "Court name required.";
      return;
    }

    if (!courtPass) {
      elements.courtPasswordError.textContent = "Court password required.";
      return;
    } else if (courtPass.length < 4) {
      elements.courtPasswordError.textContent =
        "Password must be at least 4 characters.";
      return;
    } else if (courtPass === courtName) {
      elements.courtPasswordError.textContent =
        "Password must be different from court name.";
      return;
    }

    let courtId;
    elements.createCourtBtn.disabled = true;
    try {
      ({ courtId } = await createWithUniqueId(
        "court",
        {
          name: courtName,
          password: courtPass,
          status: elements.courtStatus.value,
          scoringOptions,
        },
        getCourtCredentials(),
      ));
    } catch (error) {
      showToast(
        error?.message || "Could not create court. Please retry.",
        TOAST_TYPES.ERROR,
      );
      return;
    } finally {
      elements.createCourtBtn.disabled = false;
    }

    showToast(
      `Court "${courtName}" created successfully. ID: ${courtId.toUpperCase()}`,
      TOAST_TYPES.SUCCESS,
    );

    elements.createPage.style.display = "none";
    if (appState.isAdmin) {
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
    } else {
      elements.menuPage.style.display = "flex";
    }

    elements.courtName.value = "";
    elements.courtPassword.value = "";
    populateFixedCourtScoringControls("court", {
      pointsTarget: 36,
      serving: {
        order: ["A1", "B1", "A2", "B2"],
        serveBlockLength: 1,
        sideSwapRule: "after_all_players_serve_once",
      },
      completion: { tieResolution: "allow_draw" },
    });
    elements.courtFixedScoringOptions?.classList.add("hidden");
    if (elements.courtScoringMode)
      elements.courtScoringMode.value = DEFAULT_SCORING_OPTIONS.scoringMode;
    if (elements.courtDeuceMode)
      elements.courtDeuceMode.value = DEFAULT_SCORING_OPTIONS.deuceMode;
    if (elements.courtTiebreakMode) {
      elements.courtTiebreakMode.value = DEFAULT_SCORING_OPTIONS.tiebreakMode;
      elements.courtTiebreakMode.disabled = false;
    }
    syncCourtScoringRuleControlsDisabled(
      elements.courtScoringMode,
      elements.courtDeuceMode,
      elements.courtTiebreakMode,
      [
        elements.courtFixedPointsTarget,
        elements.courtFixedServeOrder,
        elements.courtFixedServeBlockLength,
        elements.courtFixedSideSwapRule,
        elements.courtFixedTieResolution,
      ],
    );
    syncCurrentViewState("replace");
  });
}
