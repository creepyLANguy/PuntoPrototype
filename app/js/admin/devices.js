// Admin device management: the registered-device list, the add / edit device forms
// and their court-id combo widgets (dropdown or manual entry). Owns
// #adminDeviceList, #addDevicePage and #editDevicePage.
import { TOAST_TYPES } from "../config/constants.js";
import { NAV_PAGES } from "../config/routes.js";
import { getAllCourts } from "../firebase/courtRepository.js";
import { deleteDevice, getAllDevices, setDevice, updateDevice } from "../firebase/deviceRepository.js";
import { stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { createViewState } from "../routing/viewState.js";
import { appState } from "../state/appState.js";
import { elements } from "../ui/dom.js";
import { showConfirm } from "../ui/modals.js";
import { showToast } from "../ui/toast.js";

let allDevices = [];

/**
 * Fetches all courts from Firestore and populates a <select> element.
 * Keeps the first placeholder option intact.
 */
async function populateCourtDropdown(selectEl)
{
  // Clear existing options except the first placeholder
  while (selectEl.options.length > 1) selectEl.remove(1);

  try
  {
    const snapshot = await getAllCourts();
    const courts = [];
    snapshot.forEach(d => courts.push({ id: d.id, name: (d.data().name || d.id) }));
    courts.sort((a, b) => a.name.localeCompare(b.name));

    courts.forEach(court =>
    {
      const opt = document.createElement("option");
      opt.value = court.id;
      opt.textContent = `${court.name} (${court.id})`;
      selectEl.appendChild(opt);
    });
  }
  catch (err)
  {
    console.error("Failed to load courts for dropdown:", err);
  }
}

/**
 * Switch a combo widget into manual-text mode.
 */
function switchComboToManual(selectWrapper, manualInput, manualToggleRow, dropdownToggleRow)
{
  selectWrapper.style.display = "none";
  manualToggleRow.style.display = "none";
  manualInput.style.display = "";
  dropdownToggleRow.style.display = "";
  manualInput.focus();
}

/**
 * Switch a combo widget back to dropdown mode.
 */
function switchComboToDropdown(selectWrapper, manualInput, manualToggleRow, dropdownToggleRow)
{
  manualInput.style.display = "none";
  dropdownToggleRow.style.display = "none";
  selectWrapper.style.display = "";
  manualToggleRow.style.display = "";
}

/**
 * Read the currently active value from a combo widget.
 * Returns the selected court id (from dropdown) OR the typed manual value.
 */
function getCourtIdFromCombo(selectEl, manualInputEl)
{
  const isManual = manualInputEl.style.display !== "none";
  return isManual ? manualInputEl.value.trim() : selectEl.value.trim();
}

export function registerDeviceAdmin()
{
  // Wire up combo toggle links — Add Device form
  elements.newDeviceManualToggle.addEventListener("click", (e) =>
  {
    e.preventDefault();
    switchComboToManual(
      elements.newDeviceManualToggle.closest(".court-id-combo").querySelector(".select-wrapper"),
      elements.newDeviceCourtIdManual,
      elements.newDeviceManualToggle.parentElement,
      elements.newDeviceDropdownToggleRow
    );
  });

  addDropdownKeyboardSupport(
    elements.newDeviceCourtIdSelect,
    elements.newDeviceCourtIdManual,
    elements.newDeviceManualToggle,
    elements.newDeviceDropdownToggle
  );

  elements.newDeviceDropdownToggle.addEventListener("click", (e) =>
  {
    e.preventDefault();
    switchComboToDropdown(
      elements.newDeviceDropdownToggle.closest(".court-id-combo").querySelector(".select-wrapper"),
      elements.newDeviceCourtIdManual,
      elements.newDeviceManualToggle.parentElement,
      elements.newDeviceDropdownToggleRow
    );
  });

  // Wire up combo toggle links — Edit Device form
  elements.editDeviceManualToggle.addEventListener("click", (e) =>
  {
    e.preventDefault();
    switchComboToManual(
      elements.editDeviceManualToggle.closest(".court-id-combo").querySelector(".select-wrapper"),
      elements.editDeviceCourtIdManual,
      elements.editDeviceManualToggle.parentElement,
      elements.editDeviceDropdownToggleRow
    );
  });

  addDropdownKeyboardSupport(
    elements.editDeviceCourtIdSelect,
    elements.editDeviceCourtIdManual,
    elements.editDeviceManualToggle,
    elements.editDeviceDropdownToggle
  );

  elements.editDeviceDropdownToggle.addEventListener("click", (e) =>
  {
    e.preventDefault();
    switchComboToDropdown(
      elements.editDeviceDropdownToggle.closest(".court-id-combo").querySelector(".select-wrapper"),
      elements.editDeviceCourtIdManual,
      elements.editDeviceManualToggle.parentElement,
      elements.editDeviceDropdownToggleRow
    );
  });

  // Add Device Logic
  elements.showAddDeviceModalBtn.addEventListener('click', async () =>
  {
    elements.adminDashboardPage.style.display = "none";
    elements.addDevicePage.style.display = 'flex';

    // Reset combo to dropdown mode and refresh court list
    const addSelectWrapper = elements.newDeviceCourtIdSelect.closest(".select-wrapper");
    switchComboToDropdown(
      addSelectWrapper,
      elements.newDeviceCourtIdManual,
      elements.newDeviceManualToggle.parentElement,
      elements.newDeviceDropdownToggleRow
    );
    elements.newDeviceId.value = "";
    elements.newDeviceCourtIdManual.value = "";
    elements.newDeviceCourtIdSelect.value = "";
    await populateCourtDropdown(elements.newDeviceCourtIdSelect);
    syncCurrentViewState();
  });

  elements.saveNewDeviceBtn.addEventListener('click', async () =>
  {
    const deviceId = elements.newDeviceId.value.trim();
    const courtId = getCourtIdFromCombo(elements.newDeviceCourtIdSelect, elements.newDeviceCourtIdManual);

    if (!deviceId) return showToast("Device ID is required", TOAST_TYPES.ERROR);

    try
    {
      await setDevice(deviceId, { courtId: courtId });
      showToast("Device added successfully", TOAST_TYPES.SUCCESS);
      elements.addDevicePage.style.display = 'none';
      elements.newDeviceId.value = "";
      elements.newDeviceCourtIdManual.value = "";
      elements.newDeviceCourtIdSelect.value = "";
      loadDevices();
      elements.adminDashboardPage.style.display = "flex";
      syncCurrentViewState("replace");
    } catch (error)
    {
      showToast("Failed to add device", TOAST_TYPES.ERROR);
    }
  });

  // Close buttons
  elements.closeAddDeviceBtn.onclick = () =>
  {
    void stepBackInApp(createViewState({ page: appState.isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
  }

  elements.closeEditDeviceBtn.onclick = () =>
  {
    void stepBackInApp(createViewState({ page: appState.isAdmin ? NAV_PAGES.ADMIN_DASHBOARD : NAV_PAGES.MENU }));
  }

  // Search logic for devices
  elements.adminDeviceSearch.addEventListener('input', (e) =>
  {
    const term = e.target.value.toLowerCase();
    const filtered = allDevices.filter(d =>
      d.id.toLowerCase().includes(term) ||
      (d.courtId && d.courtId.toLowerCase().includes(term))
    );
    renderDeviceList(filtered);
  });
}

// Add keyboard support (Tab, arrow keys) to court dropdowns
const addDropdownKeyboardSupport = (selectEl, manualEl, manualToggle, dropdownToggle) =>
{
  if (!selectEl) return;

  selectEl.addEventListener("keydown", (e) =>
  {
    if (e.key === "Tab")
    {
      // Tab naturally moves focus, just let it happen
      return;
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown")
    {
      // Native select handles arrow keys for navigation
      return;
    }

    // Allow Enter to confirm selection
    if (e.key === "Enter")
    {
      e.preventDefault();
      return;
    }
  });
};

// Device Management Functions
export async function loadDevices()
{
  elements.adminDeviceList.innerHTML = '<div class="loading">Loading devices...</div>';
  try
  {
    const snapshot = await getAllDevices();
    allDevices = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderDeviceList(allDevices);
  } catch (error)
  {
    showToast("Error loading devices", TOAST_TYPES.ERROR);
  }
}

function renderDeviceList(devices)
{
  elements.adminDeviceList.innerHTML = "";
  if (devices.length === 0)
  {
    elements.adminDeviceList.innerHTML = '<div class="no-courts">No devices registered.</div>';
    return;
  }

  devices.sort((a, b) => a.id.localeCompare(b.id));

  devices.forEach(device =>
  {
    const item = document.createElement("div");
    item.className = "admin-court-item";
    item.innerHTML = `
      <div class="aci-field teams-cell">
        <div class="aci-label">deviceId:</div>
        <div class="aci-value">
          ${device.id}
        </div>
      </div>
      <div class="aci-field teams-cell">
        <div class="aci-label">Mapped to:</div>
        <div class="aci-value">
          ${device.courtId || '???'}
        </div>
      </div>
      <div class="aci-actions">
        <button class="edit-btn" data-id="${device.id}">Edit</button>
      </div>

    `;
    item.querySelector('.edit-btn').addEventListener('click', () => openEditDeviceModal(device));
    elements.adminDeviceList.appendChild(item);
  });
}

// Edit/Delete Device Logic
export async function openEditDeviceModal(device, syncHistory = true)
{
  appState.currentDeviceToEdit = device;
  elements.adminDashboardPage.style.display = "none";
  elements.editDeviceIdTitle.textContent = device.id;
  elements.editDevicePage.style.display = 'flex';

  // Populate dropdown with all courts
  await populateCourtDropdown(elements.editDeviceCourtIdSelect);

  const currentCourtId = device.courtId || "";
  const editSelectWrapper = elements.editDeviceCourtIdSelect.closest(".select-wrapper");

  // Check if the current courtId exists in the dropdown
  const matchingOption = [...elements.editDeviceCourtIdSelect.options].find(o => o.value === currentCourtId);

  if (matchingOption)
  {
    // Pre-select the matching court in the dropdown
    elements.editDeviceCourtIdSelect.value = currentCourtId;
    elements.editDeviceCourtIdManual.value = "";
    switchComboToDropdown(
      editSelectWrapper,
      elements.editDeviceCourtIdManual,
      elements.editDeviceManualToggle.parentElement,
      elements.editDeviceDropdownToggleRow
    );
  }
  else
  {
    // Fall back to manual mode with the raw value pre-filled
    elements.editDeviceCourtIdManual.value = currentCourtId;
    elements.editDeviceCourtIdSelect.value = "";
    switchComboToManual(
      editSelectWrapper,
      elements.editDeviceCourtIdManual,
      elements.editDeviceManualToggle.parentElement,
      elements.editDeviceDropdownToggleRow
    );
  }

  if (syncHistory)
  {
    syncCurrentViewState();
  }

  elements.saveEditDeviceBtn.onclick = async () =>
  {
    try
    {
      const courtId = getCourtIdFromCombo(elements.editDeviceCourtIdSelect, elements.editDeviceCourtIdManual);
      await updateDevice(device.id, { courtId });
      showToast("Mapping updated", TOAST_TYPES.SUCCESS);
      elements.editDevicePage.style.display = 'none';
      loadDevices();
      elements.adminDashboardPage.style.display = "flex";
      syncCurrentViewState("replace");
    } catch (e) { showToast("Update failed", TOAST_TYPES.ERROR); }
  };

  elements.deleteDeviceBtn.onclick = async () =>
  {
    if (!(await showConfirm("Delete this device registration?"))) return;
    try
    {
      await deleteDevice(device.id);
      showToast("Device deleted", TOAST_TYPES.SUCCESS);
      elements.editDevicePage.style.display = 'none';
      loadDevices();
      elements.adminDashboardPage.style.display = "flex";
      syncCurrentViewState("replace");
    } catch (e) { showToast("Delete failed", TOAST_TYPES.ERROR); }
  };
}
