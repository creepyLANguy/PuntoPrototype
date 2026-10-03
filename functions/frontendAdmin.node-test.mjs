// Frontend integration tests: the admin portal's court and device management.
// These pin the behaviour that existed before clubs were added (login, tabs,
// court and device lists, create / edit / delete) so that changes to the
// shared admin code cannot silently break it.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_SKELETON_KEY,
  bootFrontend,
  callableHandlers,
  firestoreState,
  seedBaseData,
  seedCourt,
  seedDoc,
  settle,
  waitFor,
} from "./frontendHarness/harness.mjs";

let window;
let document;
const callableRequests = [];

const $ = (id) => document.getElementById(id);
const isShown = (id) => window.getComputedStyle($(id)).display !== "none";
const texts = (selector) =>
  [...document.querySelectorAll(selector)].map((el) => el.textContent.trim());
const stored = (path) => firestoreState.docs.get(path);
const lastToast = () => texts(".toast").at(-1);
const courtNames = () => texts("#adminCourtList .aci-name strong");
const deviceIds = () =>
  [...document.querySelectorAll("#adminDeviceList .edit-btn")].map((button) => button.dataset.id);
const activeTab = () => document.querySelector(".admin-tabs .tab-btn.active").dataset.tab;

function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function choose(select, value) {
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function pressEscape() {
  document.body.dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
}

async function confirmDialog(accept = true) {
  await waitFor(() => !$("confirmModal").classList.contains("hidden"), { label: "confirm dialog" });
  const message = $("confirmMessage").textContent;
  $(accept ? "confirmOkBtn" : "confirmCancelBtn").click();
  await settle(10);
  return message;
}

async function logIn() {
  $("adminLoginBtn").click();
  await waitFor(() => isShown("adminAuthPage"), { label: "admin auth page" });
  $("adminAuthPassword").value = ADMIN_SKELETON_KEY;
  $("submitAdminAuthBtn").click();
  await waitFor(() => isShown("adminDashboardPage"), { label: "admin dashboard" });
}

async function waitForCourtList(count) {
  await waitFor(
    () =>
      isShown("adminDashboardPage") &&
      document.querySelectorAll("#adminCourtList .admin-court-item").length === count,
    { label: `dashboard court list with ${count} courts` },
  );
}

async function waitForDeviceList(count) {
  await waitFor(
    () =>
      isShown("adminDashboardPage") &&
      document.querySelectorAll("#adminDeviceList .admin-court-item").length === count,
    { label: `dashboard device list with ${count} devices` },
  );
}

function editCourtButton(courtId) {
  return document.querySelector(`#adminCourtList .edit-btn[data-id="${courtId}"]`);
}

async function openDeviceEditor(deviceId) {
  document.querySelector(`#adminDeviceList .edit-btn[data-id="${deviceId}"]`).click();
  // The Save / Delete handlers are attached once the court dropdown has loaded.
  await waitFor(
    () => isShown("editDevicePage") && $("editDeviceCourtIdSelect").options.length > 1,
    {
      label: `device editor for ${deviceId}`,
    },
  );
}

test.before(async () => {
  seedBaseData();
  seedCourt("abcd", { name: "Alpha Court", status: "open", password: "alpha-pw" });
  seedCourt("efgh", { name: "Beta Court", status: "private" });
  seedCourt("jkmn", { name: "Gamma Court", status: "closed" });
  seedDoc("devices/HUB-1", { courtId: "abcd", deviceSKU: "HUB" });
  seedDoc("devices/PULSE-2", { courtId: "efgh", deviceSKU: "PULSE", clubId: "club01" });

  for (const name of ["updateScoringOptions", "resetCourt"]) {
    callableHandlers.set(name, async (payload) => {
      callableRequests.push([name, structuredClone(payload)]);
      return {
        data: name === "updateScoringOptions" ? { scoringOptions: payload.scoringOptions } : {},
      };
    });
  }

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
});

test("the admin password is checked before the dashboard opens", async () => {
  $("adminLoginBtn").click();
  await waitFor(() => isShown("adminAuthPage"), { label: "admin auth page" });

  $("submitAdminAuthBtn").click();
  await settle();
  assert.equal($("adminAuthError").textContent, "Admin password cannot be empty.");

  $("adminAuthPassword").value = "wrong";
  $("submitAdminAuthBtn").click();
  await waitFor(() => $("adminAuthError").textContent === "Incorrect admin password.", {
    label: "wrong password error",
  });
  assert.equal(isShown("adminDashboardPage"), false);
  assert.equal($("adminAuthPassword").value, "", "the wrong password is cleared");

  $("adminAuthPassword").value = ADMIN_SKELETON_KEY;
  $("submitAdminAuthBtn").click();
  await waitForCourtList(3);
  assert.equal(activeTab(), "courts", "the Courts tab is open by default");
  assert.equal($("courtsTab").classList.contains("active"), true);
});

test("the court list is sorted by name and filtered by search and status", async () => {
  assert.deepEqual(courtNames(), ["Alpha Court", "Beta Court", "Gamma Court"]);
  const alpha = editCourtButton("abcd").closest(".admin-court-item");
  assert.equal(alpha.querySelector(".aci-id").textContent, "ID: abcd");
  assert.equal(alpha.querySelector(".password-cell code").textContent, "alpha-pw");
  assert.equal(alpha.querySelector(".status-badge").textContent, "OPEN");
  assert.equal(alpha.querySelector(".teams-cell .aci-value").textContent, "Team A vs Team B");

  typeInto($("adminCourtSearch"), "BETA");
  assert.deepEqual(courtNames(), ["Beta Court"]);
  typeInto($("adminCourtSearch"), "jkmn");
  assert.deepEqual(courtNames(), ["Gamma Court"]);
  typeInto($("adminCourtSearch"), "court");
  choose($("adminStatusFilter"), "private");
  assert.deepEqual(courtNames(), ["Beta Court"], "search and status filter combine");
  choose($("adminStatusFilter"), "closed");
  assert.deepEqual(courtNames(), ["Gamma Court"]);
  typeInto($("adminCourtSearch"), "zzz");
  assert.equal(texts("#adminCourtList .no-courts")[0], "No matching courts found.");

  typeInto($("adminCourtSearch"), "");
  choose($("adminStatusFilter"), "all");
  assert.equal(courtNames().length, 3);
});

test("the tabs switch between the court and device lists", async () => {
  document.querySelector('.tab-btn[data-tab="devices"]').click();
  await waitForDeviceList(2);
  assert.equal(activeTab(), "devices");
  assert.equal($("devicesTab").classList.contains("active"), true);
  assert.equal($("courtsTab").classList.contains("active"), false);
  assert.deepEqual(deviceIds(), ["HUB-1", "PULSE-2"]);
  assert.deepEqual(texts("#adminDeviceList .teams-cell .aci-value"), [
    "HUB-1",
    "abcd",
    "PULSE-2",
    "efgh",
  ]);

  typeInto($("adminDeviceSearch"), "pulse");
  assert.deepEqual(deviceIds(), ["PULSE-2"]);
  typeInto($("adminDeviceSearch"), "ABCD");
  assert.deepEqual(deviceIds(), ["HUB-1"], "devices are found by their court too");
  typeInto($("adminDeviceSearch"), "");

  document.querySelector('.tab-btn[data-tab="courts"]').click();
  await waitForCourtList(3);
  assert.equal(activeTab(), "courts");
  assert.equal($("devicesTab").classList.contains("active"), false);
});

test("Create Court validates its input and creates the court and its score", async () => {
  $("showCreateCourtModalBtn").click();
  await waitFor(() => isShown("createPage"), { label: "create court page" });

  const attempt = async (name, password) => {
    $("courtName").value = name;
    $("courtPassword").value = password;
    $("createCourtBtn").click();
    await settle();
  };
  await attempt("", "secret");
  assert.equal($("courtNameError").textContent, "Court name required.");
  await attempt("Delta Court", "");
  assert.equal($("courtPasswordError").textContent, "Court password required.");
  await attempt("Delta Court", "abc");
  assert.equal($("courtPasswordError").textContent, "Password must be at least 4 characters.");
  await attempt("Delta Court", "Delta Court");
  assert.equal($("courtPasswordError").textContent, "Password must be different from court name.");
  assert.equal(isShown("createPage"), true);

  choose($("courtStatus"), "private");
  await attempt("Delta Court", "delta-pw");
  await waitForCourtList(4);

  const [courtId, court] = [...firestoreState.docs].find(
    ([path, data]) => /^courts\/[^/]+$/.test(path) && data.name === "Delta Court",
  );
  const id = courtId.split("/")[1];
  assert.match(id, /^[a-z]{4}$/);
  assert.equal(lastToast(), `Court "Delta Court" created successfully. ID: ${id.toUpperCase()}`);
  assert.equal(court.password, "delta-pw");
  assert.equal(court.status, "private");
  assert.equal(court.scoreVersion, 0);
  assert.equal(court.clubId, undefined, "new courts belong to no club");
  assert.ok(stored(`courts/${id}/score/current`), "the initial score document exists");
  assert.ok(courtNames().includes("Delta Court"));
});

test("editing a court saves it and returns to the court list", async () => {
  editCourtButton("efgh").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court editor" });
  assert.equal(window.history.state.viewState.page, "editCourt");
  assert.equal(window.history.state.viewState.entityId, "efgh");
  assert.equal($("editCourtName").value, "Beta Court");
  assert.equal($("editCourtStatus").value, "private");

  $("editCourtName").value = "Beta Court Renamed";
  choose($("editCourtStatus"), "open");
  $("saveEditBtn").click();
  await waitFor(() => courtNames().includes("Beta Court Renamed"), { label: "renamed court" });

  assert.equal(isShown("editCourtPage"), false);
  assert.equal(lastToast(), "Court updated successfully!");
  assert.equal(window.history.state.viewState.page, "adminDashboard");
  assert.equal(stored("courts/efgh").name, "Beta Court Renamed");
  assert.equal(stored("courts/efgh").status, "open");
  assert.equal(callableRequests.at(-1)[0], "updateScoringOptions");
  assert.equal(callableRequests.at(-1)[1].courtId, "efgh");

  // Empty names are refused.
  editCourtButton("efgh").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court editor" });
  $("editCourtName").value = "  ";
  $("saveEditBtn").click();
  await waitFor(() => lastToast() === "Failed to update: Court name cannot be empty", {
    label: "empty name error",
  });
  assert.equal(isShown("editCourtPage"), true);
  assert.equal(stored("courts/efgh").name, "Beta Court Renamed");
});

test("Clear Score asks first and resets the court", async () => {
  $("clearCourtScoreBtn").click();
  assert.match(await confirmDialog(false), /Clear the existing score for court "efgh"/);
  assert.notEqual(callableRequests.at(-1)[0], "resetCourt");

  $("clearCourtScoreBtn").click();
  await confirmDialog(true);
  await waitFor(() => lastToast() === "Court score cleared.", { label: "score cleared" });
  assert.deepEqual(callableRequests.at(-1)[0], "resetCourt");
  assert.equal(callableRequests.at(-1)[1].courtId, "efgh");
});

test("closing or escaping the court editor returns to the dashboard", async () => {
  $("closeEditBtn").click();
  await waitForCourtList(4);
  assert.equal(isShown("editCourtPage"), false);

  editCourtButton("abcd").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court editor" });
  pressEscape();
  await waitForCourtList(4);
  assert.equal(isShown("editCourtPage"), false);
  assert.equal(activeTab(), "courts");
});

test("deleting a court asks first and removes it", async () => {
  editCourtButton("jkmn").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court editor" });

  $("deleteCourtBtn").click();
  assert.match(await confirmDialog(false), /delete court "jkmn"/);
  assert.ok(stored("courts/jkmn"), "cancelling keeps the court");

  $("deleteCourtBtn").click();
  await confirmDialog(true);
  await waitForCourtList(3);
  assert.equal(lastToast(), "Court deleted.");
  assert.equal(stored("courts/jkmn"), undefined);
  assert.equal(editCourtButton("jkmn"), null);
});

test("Add Device registers a device on the chosen court", async () => {
  $("showAddDeviceModalBtn").click();
  await waitFor(() => isShown("addDevicePage") && $("newDeviceCourtIdSelect").options.length > 1, {
    label: "add device page",
  });
  const options = [...$("newDeviceCourtIdSelect").options].map((option) => option.textContent);
  assert.equal(options[0], "— Select a court —");
  assert.deepEqual(options.slice(1, 3), ["Alpha Court (abcd)", "Beta Court Renamed (efgh)"]);
  assert.match(options[3], /^Delta Court \([a-z]{4}\)$/, "courts are listed by name");

  $("saveNewDeviceBtn").click();
  await waitFor(() => lastToast() === "Device ID is required", { label: "missing id error" });

  $("newDeviceId").value = "BEACON-7";
  choose($("newDeviceCourtIdSelect"), "abcd");
  $("saveNewDeviceBtn").click();
  await waitFor(() => lastToast() === "Device added successfully", { label: "device added" });
  assert.deepEqual(stored("devices/BEACON-7"), { courtId: "abcd" });
  await waitFor(() => isShown("adminDashboardPage") && !isShown("addDevicePage"), {
    label: "dashboard after adding",
  });
});

test("Add Device also accepts a court id typed by hand", async () => {
  $("showAddDeviceModalBtn").click();
  await waitFor(() => isShown("addDevicePage"), { label: "add device page" });
  $("newDeviceManualToggle").click();
  assert.equal($("newDeviceCourtIdManual").style.display, "");
  $("newDeviceId").value = "BEACON-8";
  $("newDeviceCourtIdManual").value = "  manual-court  ";
  $("saveNewDeviceBtn").click();
  await waitFor(() => stored("devices/BEACON-8"), { label: "manually mapped device" });
  assert.deepEqual(stored("devices/BEACON-8"), { courtId: "manual-court" });
});

test("re-adding a registered device replaces its record but keeps its club", async () => {
  $("showAddDeviceModalBtn").click();
  await waitFor(() => isShown("addDevicePage") && $("newDeviceCourtIdSelect").options.length > 1, {
    label: "add device page",
  });
  assert.equal($("newDeviceId").value, "", "the form starts empty");
  $("newDeviceId").value = "PULSE-2";
  choose($("newDeviceCourtIdSelect"), "abcd");
  $("saveNewDeviceBtn").click();
  await waitFor(() => stored("devices/PULSE-2").courtId === "abcd", { label: "re-added device" });
  assert.deepEqual(stored("devices/PULSE-2"), { courtId: "abcd", clubId: "club01" });
});

test("editing a device changes its court and returns to the device list", async () => {
  document.querySelector('.tab-btn[data-tab="devices"]').click();
  await waitForDeviceList(4);

  await openDeviceEditor("HUB-1");
  assert.equal(window.history.state.viewState.page, "editDevice");
  assert.equal($("editDeviceIdTitle").textContent, "HUB-1");
  assert.equal($("editDeviceCourtIdSelect").value, "abcd", "the current court is preselected");

  choose($("editDeviceCourtIdSelect"), "efgh");
  $("saveEditDeviceBtn").click();
  await waitFor(() => lastToast() === "Mapping updated", { label: "device saved" });
  await waitForDeviceList(4);
  assert.equal(activeTab(), "devices");
  assert.deepEqual(stored("devices/HUB-1"), { courtId: "efgh", deviceSKU: "HUB" });

  // A court id that is not in the list opens in manual mode.
  await openDeviceEditor("BEACON-8");
  assert.equal($("editDeviceCourtIdManual").style.display, "");
  assert.equal($("editDeviceCourtIdManual").value, "manual-court");
  $("closeEditDeviceBtn").click();
  await waitForDeviceList(4);
  assert.equal(activeTab(), "devices", "returning keeps the Devices tab and reloads it");
});

test("deleting a device asks first and removes it", async () => {
  await openDeviceEditor("BEACON-8");
  $("deleteDeviceBtn").click();
  assert.match(await confirmDialog(false), /Delete this device registration\?/);
  assert.ok(stored("devices/BEACON-8"));

  $("deleteDeviceBtn").click();
  await confirmDialog(true);
  await waitForDeviceList(3);
  assert.equal(lastToast(), "Device deleted");
  assert.equal(stored("devices/BEACON-8"), undefined);
});

// Leaving the dashboard steps back through the browser history. The admin
// session has ended by then, so any admin page reached that way shows the
// login page instead.
async function expectLoggedOut() {
  await waitFor(() => !isShown("adminDashboardPage"), { label: "dashboard closed" });
  if (!isShown("adminAuthPage")) {
    $("adminLoginBtn").click();
  }
  await waitFor(() => isShown("adminAuthPage"), { label: "login required" });
  assert.equal(isShown("adminDashboardPage"), false);
}

test("Escape on the dashboard ends the admin session", async () => {
  pressEscape();
  await expectLoggedOut();

  $("adminAuthPassword").value = ADMIN_SKELETON_KEY;
  $("submitAdminAuthBtn").click();
  await waitFor(() => isShown("adminDashboardPage"), { label: "dashboard after a new login" });
});

test("the dashboard close button ends the admin session", async () => {
  $("closeAdminDashboardBtn").click();
  await expectLoggedOut();
});

test("admin pages reached through the browser history need a login", async () => {
  window.history.back();
  await settle(50);
  await waitFor(() => isShown("adminAuthPage") || isShown("menuPage"), {
    label: "page after back",
  });
  for (const page of [
    "adminDashboardPage",
    "editCourtPage",
    "editDevicePage",
    "addDevicePage",
    "createPage",
  ]) {
    assert.equal(isShown(page), false, `${page} stays closed`);
  }
});
