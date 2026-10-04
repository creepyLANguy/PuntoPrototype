// Club editor: the create / edit club page (#editClubPage). Edits the club name
// and which courts and devices belong to the club, with a searchable,
// multi-select list for each. Every row can open that court's or device's own
// edit page (Clubs > Courts > Devices); the unsaved selection is kept in
// appState.clubEditor so it survives the round trip.
//
// Saving goes through the club callables, which move a court or device out
// of any other club it belonged to; the editor asks for confirmation first.
import { openEditModal } from "./courts.js";
import { openEditDeviceModal } from "./devices.js";
import { activateAdminTab, ADMIN_TABS } from "./tabState.js";
import { anyValueMatches, clubSummary, courtMatchesSearch, normalizeSearchTerm } from "../clubs/clubIndex.js";
import { loadClubIndex } from "../clubs/clubLoader.js";
import { TOAST_TYPES } from "../config/constants.js";
import { NAV_PAGES } from "../config/routes.js";
import { createClub, deleteClub, updateClub } from "../firebase/callables.js";
import { getClub } from "../firebase/clubRepository.js";
import { getAllCourts } from "../firebase/courtRepository.js";
import { getAllDevices } from "../firebase/deviceRepository.js";
import { stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { appState } from "../state/appState.js";
import { elements } from "../ui/dom.js";
import { hideSpinner, showSpinner } from "../ui/loading.js";
import { showConfirm } from "../ui/modals.js";
import { showToast } from "../ui/toast.js";
import { escapeHtml } from "../utils/formatting.js";

// Courts and devices shown in the editor, reloaded whenever the page is shown.
const editorData = {
  loaded: false,
  courts: [],
  devices: []
};

const MEMBER_LISTS = {
  courts: {
    selection: "courtIds",
    list: () => elements.clubCourtList,
    search: () => elements.clubCourtSearch,
    count: () => elements.clubCourtsCount,
    records: () => editorData.courts,
    matches: (court, term) => courtMatchesSearch(court, term),
    label: (court) => court.name,
    detail: (court) => court.id.toUpperCase(),
    noun: "court"
  },
  devices: {
    selection: "deviceIds",
    list: () => elements.clubDeviceList,
    search: () => elements.clubDeviceSearch,
    count: () => elements.clubDevicesCount,
    records: () => editorData.devices,
    matches: (device, term) =>
      anyValueMatches(normalizeSearchTerm(term), device.id, device.courtId, device.club?.name, device.club?.id),
    label: (device) => device.id,
    detail: (device) => (device.courtId ? `Court ${device.courtId.toUpperCase()}` : "No court"),
    noun: "device"
  }
};

function createDraft(club)
{
  return {
    clubId: club?.id || null,
    savedName: club?.name || "",
    savedCourtIds: [...(club?.courtIds || [])],
    savedDeviceIds: [...(club?.deviceIds || [])],
    name: club?.name || "",
    courtIds: new Set(club?.courtIds || []),
    deviceIds: new Set(club?.deviceIds || [])
  };
}

const sameMembers = (set, list) => set.size === list.length && list.every((id) => set.has(id));

export function isClubEditorDirty(draft = appState.clubEditor)
{
  if (!draft) return false;
  return draft.name.trim() !== draft.savedName ||
    !sameMembers(draft.courtIds, draft.savedCourtIds) ||
    !sameMembers(draft.deviceIds, draft.savedDeviceIds);
}

export function getClubEditorViewState()
{
  const clubId = appState.clubEditor?.clubId || null;
  return clubId
    ? createViewState({ page: NAV_PAGES.EDIT_CLUB, entityId: clubId })
    : createViewState({ page: NAV_PAGES.CREATE_CLUB });
}

// Opens the editor for `club` ({ id, name, courtIds, deviceIds }) or, with
// null, for a new club.
export async function openClubEditor(club, syncHistory = true)
{
  appState.clubEditor = createDraft(club);
  elements.clubCourtSearch.value = "";
  elements.clubDeviceSearch.value = "";
  await showClubEditorPage(syncHistory);
}

// Restores the editor for a history entry. A draft for the same club is kept
// (e.g. on returning from a court's edit page); otherwise the club is read
// again. Returns false when the club no longer exists.
export async function restoreClubEditor(clubId)
{
  const wantedClubId = clubId || null;
  if (appState.clubEditor && appState.clubEditor.clubId === wantedClubId)
  {
    await showClubEditorPage(false);
    return true;
  }

  if (!wantedClubId)
  {
    await openClubEditor(null, false);
    return true;
  }

  const snap = await getClub(wantedClubId);
  if (!snap.exists()) return false;

  const data = snap.data();
  await openClubEditor({
    id: snap.id,
    name: data.name || snap.id,
    courtIds: Array.isArray(data.courtIds) ? data.courtIds : [],
    deviceIds: Array.isArray(data.deviceIds) ? data.deviceIds : []
  }, false);
  return true;
}

async function showClubEditorPage(syncHistory)
{
  const draft = appState.clubEditor;

  elements.adminDashboardPage.style.display = "none";
  elements.editClubPage.style.display = "flex";

  elements.editClubTitle.textContent = draft.clubId ? draft.savedName : "Add Club";
  elements.editClubIdLine.textContent = draft.clubId ? `ID: ${draft.clubId.toUpperCase()}` : "";
  elements.editClubName.value = draft.name;
  elements.editClubNameError.textContent = "";
  elements.saveClubBtn.textContent = draft.clubId ? "Save Club" : "Add Club";
  elements.deleteClubBtn.style.display = draft.clubId ? "" : "none";
  elements.deleteClubDivider.style.display = draft.clubId ? "" : "none";

  if (syncHistory)
  {
    syncCurrentViewState();
  }

  editorData.loaded = false;
  renderMemberList("courts");
  renderMemberList("devices");
  await loadEditorData();
}

async function loadEditorData()
{
  try
  {
    const [courtSnapshot, deviceSnapshot, clubIndex] = await Promise.all([
      getAllCourts(),
      getAllDevices(),
      loadClubIndex()
    ]);

    editorData.courts = courtSnapshot.docs.map((courtDoc) => ({
      ...courtDoc.data(),
      id: courtDoc.id,
      name: courtDoc.data().name || courtDoc.id,
      club: clubSummary(clubIndex.clubByCourtId.get(courtDoc.id))
    }));
    editorData.devices = deviceSnapshot.docs.map((deviceDoc) => ({
      ...deviceDoc.data(),
      id: deviceDoc.id,
      club: clubSummary(clubIndex.clubByDeviceId.get(deviceDoc.id))
    }));
    editorData.loaded = true;
  }
  catch (error)
  {
    console.error("Failed to load courts and devices for the club editor:", error);
    showToast("Could not load courts and devices.", TOAST_TYPES.ERROR);
    return;
  }

  // Members deleted since the club was last saved cannot be saved again.
  const draft = appState.clubEditor;
  if (!draft) return;
  const courtIds = new Set(editorData.courts.map((court) => court.id));
  const deviceIds = new Set(editorData.devices.map((device) => device.id));
  draft.courtIds.forEach((id) => { if (!courtIds.has(id)) draft.courtIds.delete(id); });
  draft.deviceIds.forEach((id) => { if (!deviceIds.has(id)) draft.deviceIds.delete(id); });

  renderMemberList("courts");
  renderMemberList("devices");
}

function compareMembers(kind, selection)
{
  const { label } = MEMBER_LISTS[kind];
  return (a, b) =>
    Number(selection.has(b.id)) - Number(selection.has(a.id)) ||
    label(a).localeCompare(label(b)) ||
    a.id.localeCompare(b.id);
}

function renderMemberCount(kind)
{
  const config = MEMBER_LISTS[kind];
  const selected = appState.clubEditor?.[config.selection].size || 0;
  config.count().textContent = `${selected} selected`;
}

// Rows are sorted when the list is rendered (selected members first), not on
// every tick, so a row does not jump away from the pointer.
function renderMemberList(kind)
{
  const config = MEMBER_LISTS[kind];
  const listElement = config.list();
  const draft = appState.clubEditor;

  renderMemberCount(kind);
  listElement.innerHTML = "";

  if (!editorData.loaded || !draft)
  {
    listElement.innerHTML = '<div class="loading">Loading...</div>';
    return;
  }

  const selection = draft[config.selection];
  const records = config.records()
    .filter((record) => config.matches(record, config.search().value))
    .sort(compareMembers(kind, selection));

  if (records.length === 0)
  {
    listElement.innerHTML = config.records().length === 0
      ? `<div class="no-courts">No ${config.noun}s registered.</div>`
      : `<div class="no-courts">No matching ${config.noun}s.</div>`;
    return;
  }

  for (const record of records)
  {
    listElement.appendChild(createMemberRow(kind, record, selection));
  }
}

function createMemberRow(kind, record, selection)
{
  const config = MEMBER_LISTS[kind];
  const draft = appState.clubEditor;
  const row = document.createElement("div");
  row.className = "club-member-item";
  row.dataset.memberId = record.id;
  row.innerHTML = `
    <label class="club-member-select">
      <input type="checkbox" />
      <span class="club-member-text">
        <span class="club-member-name"></span>
        <span class="club-member-detail"></span>
      </span>
    </label>
    <span class="club-member-club"></span>
    <button type="button" class="edit-btn club-member-open">Edit</button>
  `;

  const checkbox = row.querySelector("input");
  checkbox.value = record.id;
  checkbox.checked = selection.has(record.id);
  checkbox.setAttribute("aria-label", `Include ${config.noun} ${config.label(record)} in this club`);
  row.querySelector(".club-member-name").textContent = config.label(record);
  row.querySelector(".club-member-detail").textContent = config.detail(record);

  const otherClub = record.club && record.club.id !== draft.clubId ? record.club : null;
  const clubBadge = row.querySelector(".club-member-club");
  if (otherClub)
  {
    clubBadge.textContent = otherClub.name;
    clubBadge.title = `Currently in ${otherClub.name} (${otherClub.id.toUpperCase()})`;
  }

  const syncRow = () =>
  {
    row.classList.toggle("is-selected", checkbox.checked);
    row.classList.toggle("will-move", checkbox.checked && Boolean(otherClub));
  };
  syncRow();

  checkbox.addEventListener("change", () =>
  {
    if (checkbox.checked) selection.add(record.id);
    else selection.delete(record.id);
    syncRow();
    renderMemberCount(kind);
  });

  const editButton = row.querySelector(".club-member-open");
  editButton.setAttribute("aria-label", `Edit ${config.noun} ${config.label(record)}`);
  editButton.addEventListener("click", () => void openMemberEditor(kind, record));

  return row;
}

// Opens a member's own edit page; saving or deleting there returns here.
async function openMemberEditor(kind, record)
{
  appState.adminEditReturnView = getClubEditorViewState();
  elements.editClubPage.style.display = "none";

  if (kind === "courts")
  {
    openEditModal(record);
  }
  else
  {
    await openEditDeviceModal(record);
  }
}

function describeMoves()
{
  const draft = appState.clubEditor;
  const moves = [];
  for (const kind of Object.keys(MEMBER_LISTS))
  {
    const config = MEMBER_LISTS[kind];
    for (const record of config.records())
    {
      if (draft[config.selection].has(record.id) && record.club && record.club.id !== draft.clubId)
      {
        moves.push(`• ${config.noun === "court" ? "Court" : "Device"} ${escapeHtml(config.label(record))} ` +
          `(from ${escapeHtml(record.club.name)})`);
      }
    }
  }
  return moves;
}

async function saveClub()
{
  const draft = appState.clubEditor;
  if (!draft) return;

  const name = elements.editClubName.value.trim();
  draft.name = name;
  if (!name)
  {
    elements.editClubNameError.textContent = "Club name required.";
    elements.editClubName.focus();
    return;
  }

  if (!editorData.loaded)
  {
    showToast("Courts and devices are still loading.", TOAST_TYPES.ERROR);
    return;
  }

  const moves = describeMoves();
  if (moves.length > 0 && !(await showConfirm(
    `These are already in another club and will move to "${escapeHtml(name)}":\n${moves.join("\n")}`
  ))) return;

  const payload = {
    name,
    courtIds: [...draft.courtIds],
    deviceIds: [...draft.deviceIds]
  };

  showSpinner(elements.editClubPage);
  elements.saveClubBtn.disabled = true;

  try
  {
    const result = draft.clubId
      ? await updateClub({ clubId: draft.clubId, ...payload })
      : await createClub(payload);
    const saved = result?.data || {};

    showToast(
      draft.clubId
        ? `Club "${saved.name || name}" saved.`
        : `Club "${saved.name || name}" created. ID: ${String(saved.clubId || "").toUpperCase()}`,
      TOAST_TYPES.SUCCESS
    );
    await leaveClubEditor();
  }
  catch (error)
  {
    showToast("Failed to save club: " + error.message, TOAST_TYPES.ERROR);
  }
  finally
  {
    elements.saveClubBtn.disabled = false;
    hideSpinner(elements.editClubPage);
  }
}

async function removeClub()
{
  const draft = appState.clubEditor;
  if (!draft?.clubId) return;

  const message = `Delete club "${escapeHtml(draft.savedName)}"?\n` +
    "Its courts and devices are kept and simply no longer belong to a club.";
  if (!(await showConfirm(message))) return;

  try
  {
    await deleteClub(draft.clubId);
    showToast("Club deleted.", TOAST_TYPES.SUCCESS);
    await leaveClubEditor();
  }
  catch (error)
  {
    showToast("Delete failed: " + error.message, TOAST_TYPES.ERROR);
  }
}

// Back to the dashboard's Clubs tab, discarding the draft.
async function leaveClubEditor()
{
  appState.clubEditor = null;
  activateAdminTab(ADMIN_TABS.CLUBS);
  await stepBackInApp(createViewState({ page: NAV_PAGES.ADMIN_DASHBOARD }));
}

// Close button / Escape: asks before discarding unsaved changes.
export async function closeClubEditor()
{
  if (isClubEditorDirty() && !(await showConfirm("Discard your unsaved changes to this club?"))) return;
  await leaveClubEditor();
}

export function registerClubEditor()
{
  elements.showCreateClubBtn.addEventListener("click", () =>
  {
    activateAdminTab(ADMIN_TABS.CLUBS);
    void openClubEditor(null);
  });

  elements.editClubName.addEventListener("input", () =>
  {
    if (appState.clubEditor) appState.clubEditor.name = elements.editClubName.value;
    elements.editClubNameError.textContent = "";
  });

  elements.clubCourtSearch.addEventListener("input", () => renderMemberList("courts"));
  elements.clubDeviceSearch.addEventListener("input", () => renderMemberList("devices"));
  elements.saveClubBtn.addEventListener("click", () => void saveClub());
  elements.deleteClubBtn.addEventListener("click", () => void removeClub());
  elements.closeEditClubBtn.addEventListener("click", () => void closeClubEditor());
}
