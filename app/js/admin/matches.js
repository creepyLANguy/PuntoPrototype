// Admin match management (spec section 34.1): search and inspect matches by
// status, and start, move, detach, complete, cancel or reset them. Every
// operation runs server-side through the manageMatch callable. Owns
// #adminMatchList.
import { TOAST_TYPES } from "../config/constants.js";
import { manageMatch } from "../firebase/callables.js";
import { getAllCourts } from "../firebase/courtRepository.js";
import { getMatchesByStatus } from "../firebase/matchRepository.js";
import { rankMatch } from "../match/discoverySearch.js";
import {
  formatScoreLine,
  getMatchPath,
  resolveMatchTitle,
} from "../match/matchIdentity.js";
import { getCourtCredentials } from "../state/credentialsState.js";
import { elements } from "../ui/dom.js";
import { showAdminListSpinner } from "../ui/loading.js";
import { showConfirm } from "../ui/modals.js";
import { showToast } from "../ui/toast.js";

let adminMatches = [];
let adminCourts = [];
let filtersBound = false;

function bindFilters() {
  if (filtersBound) return;
  filtersBound = true;
  elements.adminMatchSearch?.addEventListener("input", renderAdminMatches);
  elements.adminMatchStatusFilter?.addEventListener(
    "change",
    () => void loadAdminMatches(),
  );
  elements.showAddMatchBtn?.addEventListener("click", openCreateMatchPanel);
  elements.cancelAddMatchBtn?.addEventListener("click", closeCreateMatchPanel);
  elements.saveAddMatchBtn?.addEventListener("click", () => void createAdminMatch());
}

export async function loadAdminMatches() {
  bindFilters();
  if (!elements.adminMatchList) return;
  showAdminListSpinner(elements.adminMatchList, "Loading matches");
  try {
    const status = elements.adminMatchStatusFilter?.value || "live";
    const [matchesSnap, courtsSnap] = await Promise.all([
      getMatchesByStatus(status),
      getAllCourts(),
    ]);
    adminCourts = courtsSnap.docs
      .map((courtDoc) => ({ courtId: courtDoc.id, ...courtDoc.data() }))
      .sort((a, b) => (a.name || a.courtId).localeCompare(b.name || b.courtId));
    const courtNames = new Map(
      adminCourts.map((court) => [court.courtId, court.name || court.courtId]),
    );
    adminMatches = matchesSnap.docs.map((matchDoc) => {
      const data = matchDoc.data();
      return {
        matchId: matchDoc.id,
        ...data,
        courtName: data.currentCourtId
          ? courtNames.get(data.currentCourtId) || data.currentCourtId
          : null,
      };
    });
    populateCreateMatchCourts();
    renderAdminMatches();
  } catch (error) {
    console.error("Error loading matches:", error);
    elements.adminMatchList.innerHTML =
      '<div class="error">Error loading matches.</div>';
  }
}

function populateCreateMatchCourts() {
  const select = elements.adminMatchCourt;
  if (!select) return;

  const current = select.value;
  select.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "No court — leave scheduled";
  select.appendChild(empty);

  adminCourts.forEach((court) => {
    const option = document.createElement("option");
    option.value = court.courtId;
    option.textContent = `${court.name || court.courtId}${court.status === "closed" ? " (closed)" : ""}`;
    select.appendChild(option);
  });

  if (current && adminCourts.some((court) => court.courtId === current)) {
    select.value = current;
  }
}

function openCreateMatchPanel() {
  elements.adminMatchCreatePanel?.classList.remove("hidden");
  populateCreateMatchCourts();
  elements.adminMatchName?.focus();
}

function closeCreateMatchPanel() {
  elements.adminMatchCreatePanel?.classList.add("hidden");
}

async function createAdminMatch() {
  const name = elements.adminMatchName?.value.trim() || null;
  const teamA = elements.adminMatchTeamA?.value.trim() || "Team A";
  const teamB = elements.adminMatchTeamB?.value.trim() || "Team B";
  const courtId = elements.adminMatchCourt?.value || null;

  if (elements.saveAddMatchBtn) elements.saveAddMatchBtn.disabled = true;

  try {
    await manageMatch(
      "createMatch",
      {
        name,
        teamNames: { A: teamA, B: teamB },
        courtId,
        visibility: "public",
      },
      getCourtCredentials(),
    );

    closeCreateMatchPanel();
    if (elements.adminMatchName) elements.adminMatchName.value = "";
    if (elements.adminMatchTeamA) elements.adminMatchTeamA.value = "";
    if (elements.adminMatchTeamB) elements.adminMatchTeamB.value = "";
    if (elements.adminMatchStatusFilter) {
      elements.adminMatchStatusFilter.value = courtId ? "live" : "scheduled";
    }
    showToast("Match created.", TOAST_TYPES.SUCCESS);
    await loadAdminMatches();
  } catch (error) {
    showToast(error.message || "That did not work.", TOAST_TYPES.ERROR);
  } finally {
    if (elements.saveAddMatchBtn) elements.saveAddMatchBtn.disabled = false;
  }
}

function renderAdminMatches() {
  const list = elements.adminMatchList;
  if (!list) return;
  const term = elements.adminMatchSearch?.value || "";
  const matches = adminMatches
    .map((match) => ({ match, rank: term.trim() ? rankMatch(match, term) : 0 }))
    .filter((entry) => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((entry) => entry.match);

  list.innerHTML = "";
  if (matches.length === 0) {
    list.innerHTML = '<div class="no-courts">No matching matches found.</div>';
    return;
  }
  matches.forEach((match) => list.appendChild(buildMatchRow(match)));
}

function cell(label, value) {
  const field = document.createElement("div");
  field.className = "aci-field";
  const labelEl = document.createElement("div");
  labelEl.className = "aci-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = "aci-value";
  valueEl.textContent = value;
  field.append(labelEl, valueEl);
  return field;
}

function actionButton(label, onClick, className = "edit-btn") {
  const button = document.createElement("button");
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function runOperation(operation, data, successMessage) {
  try {
    await manageMatch(operation, data, getCourtCredentials());
    showToast(successMessage, TOAST_TYPES.SUCCESS);
    await loadAdminMatches();
  } catch (error) {
    showToast(error.message || "That did not work.", TOAST_TYPES.ERROR);
  }
}

function buildMatchRow(match) {
  const item = document.createElement("div");
  item.className = "admin-court-item admin-match-item";

  const name = document.createElement("div");
  name.className = "aci-name";
  const title = document.createElement("strong");
  title.textContent = resolveMatchTitle(match, match.matchId);
  const id = document.createElement("div");
  id.className = "aci-id";
  id.textContent = `ID: ${match.matchId}${match.tournamentId ? ` - Tournament ${match.tournamentId}` : ""}`;
  name.append(title, id);
  item.appendChild(name);

  item.appendChild(cell("Court", match.courtName || "No court"));
  item.appendChild(
    cell(
      "Score",
      formatScoreLine(match.scoreSummary, match.scoringMode) || "-",
    ),
  );
  item.appendChild(cell("Status", String(match.status || "").toUpperCase()));

  const actions = document.createElement("div");
  actions.className = "aci-actions";
  const open = document.createElement("a");
  open.className = "edit-btn";
  open.href = getMatchPath(match.matchId);
  open.textContent = "Open";
  actions.appendChild(open);

  if (match.status === "live" || match.status === "scheduled") {
    const courtSelect = document.createElement("select");
    courtSelect.className = "admin-match-court-select";
    courtSelect.setAttribute("aria-label", "Court");
    adminCourts.forEach((court) => {
      const option = document.createElement("option");
      option.value = court.courtId;
      option.textContent = `${court.name || court.courtId}${court.status === "closed" ? " (closed)" : ""}`;
      option.selected = court.courtId === match.currentCourtId;
      courtSelect.appendChild(option);
    });
    actions.appendChild(courtSelect);
    const onCourt = match.status === "live" && match.currentCourtId;
    actions.appendChild(
      actionButton(onCourt ? "Move" : "Start", () =>
        runOperation(
          onCourt ? "moveMatch" : "startMatch",
          { matchId: match.matchId, courtId: courtSelect.value },
          onCourt ? "Match moved." : "Match started.",
        ),
      ),
    );
  }

  if (match.status === "live") {
    if (match.currentCourtId) {
      actions.appendChild(
        actionButton("Detach", () =>
          runOperation(
            "detachMatch",
            { matchId: match.matchId },
            "Match detached from its court.",
          ),
        ),
      );
    }
    actions.appendChild(
      actionButton("Complete", async () => {
        if (
          await showConfirm(
            `Complete "${resolveMatchTitle(match, match.matchId)}" with its current score?`,
          )
        ) {
          await runOperation(
            "completeMatch",
            { matchId: match.matchId },
            "Match completed.",
          );
        }
      }),
    );
    actions.appendChild(
      actionButton("Reset", async () => {
        if (
          await showConfirm("Reset this match's score? The match keeps its id.")
        ) {
          await runOperation(
            "resetMatch",
            { matchId: match.matchId, reason: "Admin reset" },
            "Match reset.",
          );
        }
      }),
    );
  }

  if (match.status === "live" || match.status === "scheduled") {
    actions.appendChild(
      actionButton(
        "Cancel",
        async () => {
          if (
            await showConfirm(
              "Cancel this match? It stays in history as cancelled.",
            )
          ) {
            await runOperation(
              "cancelMatch",
              { matchId: match.matchId, reason: "Cancelled by admin" },
              "Match cancelled.",
            );
          }
        },
        "delete-btn",
      ),
    );
  }

  item.appendChild(actions);
  return item;
}
