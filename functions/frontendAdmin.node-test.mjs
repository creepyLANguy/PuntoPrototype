// Frontend integration tests: the admin portal's court and device management.
// These pin the behaviour that existed before clubs were added (login, tabs,
// court and device lists, create / edit / delete) so that changes to the
// shared admin code cannot silently break it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  await waitFor(() => isShown("adminDashboardPage"), { label: "admin portal" });
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

// The device editor enables Save / Delete once its court list has loaded.
const deviceEditorReady = () => isShown("editDevicePage") && !$("saveEditDeviceBtn").disabled;

async function openDeviceEditor(deviceId) {
  document.querySelector(`#adminDeviceList .edit-btn[data-id="${deviceId}"]`).click();
  await waitFor(deviceEditorReady, { label: `device editor for ${deviceId}` });
}

// Holds reads of a collection until the returned release() is called.
function holdReads(collectionPath) {
  let release;
  firestoreState.readGates.set(
    collectionPath,
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  return () => {
    firestoreState.readGates.delete(collectionPath);
    release();
  };
}

test.before(async () => {
  seedBaseData();
  seedCourt("abcda", { name: "Alpha Court", status: "open", password: "alpha-pw" });
  seedCourt("efgha", { name: "Beta Court", status: "private" });
  seedCourt("jkmna", { name: "Gamma Court", status: "closed" });
  seedDoc("devices/HUB-1", { courtId: "abcda", deviceSKU: "HUB" });
  seedDoc("devices/PULSE-2", { courtId: "efgha", deviceSKU: "PULSE", clubId: "abch" });
  seedDoc("clubs/abch", { name: "Club", state: "open", courtIds: [], deviceIds: ["PULSE-2"] });

  for (const name of ["updateScoringOptions", "resetCourt"]) {
    callableHandlers.set(name, async (payload) => {
      callableRequests.push([name, structuredClone(payload)]);
      return {
        data: name === "updateScoringOptions" ? { scoringOptions: payload.scoringOptions } : {},
      };
    });
  }
  callableHandlers.set("createCourt", async (payload) => {
    callableRequests.push(["createCourt", structuredClone(payload)]);
    const courtId = "pqrsa";
    seedCourt(courtId, {
      name: payload.name,
      password: payload.password,
      status: payload.status,
      scoringMode: payload.scoringOptions.scoringMode,
      scoringOptions: payload.scoringOptions,
      activeMatchId: null,
      lastMatchId: null,
      clubId: null,
    });
    return { data: { courtId, allocationId: stored(`courts/${courtId}`).allocationId } };
  });

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
});

test("the admin password is checked before the dashboard opens", async () => {
  assert.equal(isShown("menuPage"), true, "main menu is initially visible");
  assert.notEqual(
    window.getComputedStyle($("appearanceMenuBtn")).display,
    "none",
    "floating appearance button is shown alongside the admin button on the main menu",
  );

  $("adminLoginBtn").click();
  await waitFor(() => isShown("adminAuthPage"), { label: "admin auth page" });
  assert.equal(
    window.getComputedStyle($("appearanceMenuBtn")).display,
    "none",
    "floating appearance button is hidden on the admin login page",
  );

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
  await waitFor(() => isShown("adminDashboardPage"), { label: "admin portal" });
  assert.equal(activeTab(), "all", "the All tab is open when no preference exists");
  assert.deepEqual(
    [...document.querySelectorAll(".admin-tabs .tab-btn")].map((button) => button.dataset.tab),
    ["all", "tournaments", "clubs", "courts", "matches", "devices"],
  );
  assert.ok($("allTab").classList.contains("active"));
  assert.equal($("courtsTab").classList.contains("active"), false);
  assert.equal(
    document.querySelectorAll(".tab-content.active").length,
    1,
    "only one admin panel is active at a time",
  );
  const tabBar = document.querySelector(".admin-tabs");
  const tabBarStyle = window.getComputedStyle(tabBar);
  assert.equal(tabBarStyle.display, "flex");
  assert.equal(tabBarStyle.flexWrap, "nowrap");
  assert.equal(tabBarStyle.overflowX, "auto");
  assert.equal(
    window.getComputedStyle($("allTab")).overflowY,
    "auto",
    "All overview stays within the portal and scrolls instead of overflowing",
  );
  assert.equal(window.getComputedStyle(document.querySelector(".admin-tool-grid")).display, "grid");
  const adminStyles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
  assert.match(
    adminStyles,
    /\.admin-tool-grid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s,
    "desktop overview uses a four-column tile grid",
  );
  assert.match(
    adminStyles,
    /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.admin-tool-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s,
    "medium layouts reduce the tile grid to three columns",
  );
  assert.match(
    adminStyles,
    /@media\s*\(max-width:\s*820px\)[\s\S]*?\.admin-tool-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s,
    "tablet and mobile layouts reduce the tile grid to two columns",
  );
  assert.equal(document.querySelectorAll("#allTab .admin-tool-tile").length, 8);
  assert.ok(document.querySelector("#allTab .admin-tool-tile[data-admin-tool='nfc']"));
  assert.ok(document.querySelector("#allTab .admin-tool-tile[data-admin-tool='harness']"));
  assert.ok(document.querySelector("#allTab .admin-tool-tile[data-admin-tool='theme']"));
  assert.equal(document.querySelectorAll("#allTab .admin-tool-tile svg.admin-tool-icon").length, 8);
  assert.ok($("appearanceMenuBtn"), "the appearance control remains available to the Theme tile");
  assert.equal(
    window.getComputedStyle($("appearanceMenuBtn")).display,
    "none",
    "the floating appearance button is hidden inside the Admin Portal",
  );
  assert.equal(
    document.querySelectorAll(".tab-content.active").length,
    1,
    "the All panel is the only active panel when the portal opens",
  );

  const originalOpen = window.open;
  const openedUrls = [];
  window.open = (...args) => openedUrls.push(args);
  document.querySelector("#allTab .admin-tool-tile[data-admin-tool='nfc']").click();
  document.querySelector("#allTab .admin-tool-tile[data-admin-tool='harness']").click();
  assert.deepEqual(openedUrls, [
    ["/nfc/index.html", "_blank"],
    ["/harness", "_blank"],
  ]);
  window.open = originalOpen;

  document.querySelector("#allTab .admin-tool-tile[data-admin-tool='theme']").click();
  assert.equal($("appearanceMenu").classList.contains("hidden"), false);
  document.body.click();
  assert.equal($("appearanceMenu").classList.contains("hidden"), true);

  const tabControls = {
    tournaments: ["adminTournamentSearch", "showCreateTournamentBtn"],
    clubs: ["adminClubSearch", "showCreateClubBtn"],
    courts: ["adminCourtSearch", "showCreateCourtModalBtn"],
    matches: ["adminMatchSearch", "showAddMatchBtn"],
    devices: ["adminDeviceSearch", "showAddDeviceModalBtn"],
  };
  for (const [tab, [searchId, addId]] of Object.entries(tabControls)) {
    assert.ok($(searchId), tab + " tab has a search box");
    assert.ok($(addId), tab + " tab has an add button");
  }

  document.querySelector('.admin-tool-tile[data-tab="courts"]').click();
  await waitForCourtList(3);
  assert.equal(activeTab(), "courts");
  assert.equal($("courtsTab").classList.contains("active"), true);
  assert.equal(document.querySelectorAll(".tab-content.active").length, 1);
  assert.equal(window.localStorage.getItem("padelPushAdminLastTab"), "courts");

  // Opening the portal again in the same browser restores the user's last tab.
  $("adminDashboardPage").style.display = "none";
  $("adminLoginBtn").click();
  await waitForCourtList(3);
  assert.equal(activeTab(), "courts");
});

test("the court list is sorted by name and filtered by search and status", async () => {
  assert.deepEqual(courtNames(), ["Alpha Court", "Beta Court", "Gamma Court"]);
  const alpha = editCourtButton("abcda").closest(".admin-court-item");
  assert.equal(alpha.querySelector(".aci-id").textContent, "ID: abcda");
  assert.equal(alpha.querySelector(".password-cell code").textContent, "alpha-pw");
  assert.equal(alpha.querySelector(".status-badge").textContent, "OPEN");
  assert.equal(alpha.querySelector(".teams-cell .aci-value").textContent, "Team A vs Team B");

  typeInto($("adminCourtSearch"), "BETA");
  assert.deepEqual(courtNames(), ["Beta Court"]);
  typeInto($("adminCourtSearch"), "jkmna");
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
    "abcda",
    "PULSE-2",
    "efgha",
  ]);

  typeInto($("adminDeviceSearch"), "pulse");
  assert.deepEqual(deviceIds(), ["PULSE-2"]);
  typeInto($("adminDeviceSearch"), "ABCDA");
  assert.deepEqual(deviceIds(), ["HUB-1"], "devices are found by their court too");
  typeInto($("adminDeviceSearch"), "");

  document.querySelector('.tab-btn[data-tab="courts"]').click();
  await waitForCourtList(3);
  assert.equal(activeTab(), "courts");
  assert.equal($("devicesTab").classList.contains("active"), false);
});

test("Add Court validates its input and requests backend court creation", async () => {
  $("showCreateCourtModalBtn").click();
  await waitFor(() => isShown("createPage"), { label: "add court page" });

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
  choose($("courtScoringMode"), "fixedTotalPoints");
  $("courtFixedPointsTarget").value = "24";
  $("courtFixedServeOrder").value = "A1, B1, A2, B2";
  $("courtFixedServeBlockLength").value = "1";
  choose($("courtFixedSideSwapRule"), "after_all_players_serve_once");
  choose($("courtFixedTieResolution"), "golden_point");
  const createHandler = callableHandlers.get("createCourt");
  let failedRequests = 0;
  callableHandlers.set("createCourt", async () => {
    failedRequests += 1;
    throw Object.assign(new Error("Could not allocate a unique court id. Please try again."), {
      code: "functions/aborted",
    });
  });
  await attempt("Delta Court", "delta-pw");
  assert.equal(failedRequests, 1, "the browser does not retry allocation itself");
  assert.equal(isShown("createPage"), true, "failed creation keeps the form open");
  assert.equal($("createCourtBtn").disabled, false, "creation can be retried");
  assert.equal($("courtName").value, "Delta Court");
  assert.match(lastToast(), /Could not allocate a unique court id/);
  callableHandlers.set("createCourt", createHandler);
  await attempt("Delta Court", "delta-pw");
  await waitForCourtList(4);

  const [courtId, court] = [...firestoreState.docs].find(
    ([path, data]) => /^courts\/[^/]+$/.test(path) && data.name === "Delta Court",
  );
  const id = courtId.split("/")[1];
  assert.match(id, /^[abcdefghjkmnpqrstuxyz]{5}$/);
  assert.equal(id, "pqrsa", "the backend assigns the ID");
  const [callable, payload] = callableRequests.at(-1);
  assert.equal(callable, "createCourt");
  assert.equal(payload.courtId, undefined, "the browser does not allocate an ID");
  assert.equal(payload.credentials.adminKey, ADMIN_SKELETON_KEY);
  assert.equal(lastToast(), `Court "Delta Court" created successfully. ID: ${id.toUpperCase()}`);
  assert.equal(court.password, "delta-pw");
  assert.equal(court.status, "private");
  assert.equal(court.clubId, null, "new courts belong to no club");
  assert.equal(court.activeMatchId, null, "a new court has no live match until play starts");
  assert.equal(court.scoringMode, "fixedTotalPoints");
  assert.equal(court.scoringOptions.pointsTarget, 24);
  assert.deepEqual(court.scoringOptions.serving.order, ["A1", "B1", "A2", "B2"]);
  assert.equal(court.scoringOptions.completion.tieResolution, "golden_point");
  assert.equal(stored(`courts/${id}/score/current`), undefined, "courts no longer own score docs");
  assert.ok(courtNames().includes("Delta Court"));
});

test("editing a court saves it and returns to the court list", async () => {
  editCourtButton("efgha").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court editor" });
  assert.equal(window.history.state.viewState.page, "editCourt");
  assert.equal(window.history.state.viewState.entityId, "efgha");
  assert.equal($("editCourtName").value, "Beta Court");
  assert.equal($("editCourtStatus").value, "private");
  await waitFor(() => !$("editTeamAName").disabled, { label: "editable match loaded" });

  $("editCourtName").value = "Beta Court Renamed";
  choose($("editCourtStatus"), "open");
  choose($("editCourtScoringMode"), "fixedTotalPoints");
  $("editCourtFixedPointsTarget").value = "32";
  $("editCourtFixedServeOrder").value = "A1, B1, A2, B2";
  $("editCourtFixedServeBlockLength").value = "1";
  choose($("editCourtFixedSideSwapRule"), "after_all_players_serve_once");
  choose($("editCourtFixedTieResolution"), "allow_draw");
  $("saveEditBtn").click();
  await waitFor(() => courtNames().includes("Beta Court Renamed"), { label: "renamed court" });

  assert.equal(isShown("editCourtPage"), false);
  assert.equal(lastToast(), "Court updated successfully!");
  assert.equal(window.history.state.viewState.page, "adminDashboard");
  assert.equal(stored("courts/efgha").name, "Beta Court Renamed");
  assert.equal(stored("courts/efgha").status, "open");
  assert.equal(stored("courts/efgha").scoringMode, "fixedTotalPoints");
  assert.equal(stored("courts/efgha").scoringOptions.pointsTarget, 32);
  assert.equal(stored("courts/efgha").scoringOptions.completion.tieResolution, "allow_draw");
  assert.equal(callableRequests.at(-1)[0], "updateScoringOptions");
  assert.equal(callableRequests.at(-1)[1].courtId, "efgha");

  // Empty names are refused.
  editCourtButton("efgha").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court editor" });
  $("editCourtName").value = "  ";
  $("saveEditBtn").click();
  await waitFor(() => lastToast() === "Failed to update: Court name cannot be empty", {
    label: "empty name error",
  });
  assert.equal(isShown("editCourtPage"), true);
  assert.equal(stored("courts/efgha").name, "Beta Court Renamed");
});

test("Clear Score asks first and resets the court", async () => {
  $("clearCourtScoreBtn").click();
  assert.match(await confirmDialog(false), /Clear the existing score for court "efgha"/);
  assert.notEqual(callableRequests.at(-1)[0], "resetCourt");

  $("clearCourtScoreBtn").click();
  await confirmDialog(true);
  await waitFor(() => lastToast() === "Court score cleared.", { label: "score cleared" });
  assert.deepEqual(callableRequests.at(-1)[0], "resetCourt");
  assert.equal(callableRequests.at(-1)[1].courtId, "efgha");
});

test("closing or escaping the court editor returns to the dashboard", async () => {
  $("closeEditBtn").click();
  await waitForCourtList(4);
  assert.equal(isShown("editCourtPage"), false);

  editCourtButton("abcda").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court editor" });
  pressEscape();
  await waitForCourtList(4);
  assert.equal(isShown("editCourtPage"), false);
  assert.equal(activeTab(), "courts");
});

test("deleting a court asks first and removes it", async () => {
  editCourtButton("jkmna").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court editor" });

  $("deleteCourtBtn").click();
  assert.match(await confirmDialog(false), /delete court "jkmna"/);
  assert.ok(stored("courts/jkmna"), "cancelling keeps the court");

  $("deleteCourtBtn").click();
  await confirmDialog(true);
  await waitForCourtList(3);
  assert.equal(lastToast(), "Court deleted.");
  assert.equal(stored("courts/jkmna"), undefined);
  assert.equal(editCourtButton("jkmna"), null);
});

test("Add Device registers a device on the chosen court", async () => {
  $("showAddDeviceModalBtn").click();
  await waitFor(() => isShown("addDevicePage") && $("newDeviceCourtIdSelect").options.length > 1, {
    label: "add device page",
  });
  const options = [...$("newDeviceCourtIdSelect").options].map((option) => option.textContent);
  assert.equal(options[0], "— No court (unlinked) —");
  assert.deepEqual(options.slice(1, 3), ["Alpha Court (abcda)", "Beta Court Renamed (efgha)"]);
  assert.match(options[3], /^Delta Court \([a-z]{5}\)$/, "courts are listed by name");

  $("saveNewDeviceBtn").click();
  await waitFor(() => lastToast() === "Device ID is required", { label: "missing id error" });

  $("newDeviceId").value = "BEACON-7";
  choose($("newDeviceCourtIdSelect"), "abcda");
  $("saveNewDeviceBtn").click();
  await waitFor(() => lastToast() === "Device added successfully", { label: "device added" });
  assert.deepEqual(stored("devices/BEACON-7"), {
    courtId: "abcda",
    courtAllocationId: stored("courts/abcda").allocationId,
  });
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
  $("newDeviceCourtIdManual").value = "legacy-court";
  $("saveNewDeviceBtn").click();
  await waitFor(() => lastToast().startsWith("Failed to add device:\n"), {
    label: "invalid court id error",
  });
  assert.equal(stored("devices/BEACON-8"), undefined, "invalid court references are not stored");
  $("newDeviceCourtIdManual").value = "zzzzz";
  $("saveNewDeviceBtn").click();
  await waitFor(
    () =>
      lastToast() ===
      'Failed to add device:\nThe court "zzzzz" was not found in the loaded courts. Select an existing court, or refresh the list and try again.',
    { label: "missing court error" },
  );
  assert.equal(stored("devices/BEACON-8"), undefined);
  $("newDeviceCourtIdManual").value = "  pqrsa  ";
  $("saveNewDeviceBtn").click();
  await waitFor(() => stored("devices/BEACON-8"), { label: "manually mapped device" });
  assert.deepEqual(stored("devices/BEACON-8"), {
    courtId: "pqrsa",
    courtAllocationId: stored("courts/pqrsa").allocationId,
  });
});

test("re-adding a registered device replaces its record but keeps its club", async () => {
  $("showAddDeviceModalBtn").click();
  await waitFor(() => isShown("addDevicePage") && $("newDeviceCourtIdSelect").options.length > 1, {
    label: "add device page",
  });
  assert.equal($("newDeviceId").value, "", "the form starts empty");
  $("newDeviceId").value = "PULSE-2";
  choose($("newDeviceCourtIdSelect"), "abcda");
  $("saveNewDeviceBtn").click();
  await waitFor(() => stored("devices/PULSE-2").courtId === "abcda", { label: "re-added device" });
  assert.deepEqual(stored("devices/PULSE-2"), {
    courtId: "abcda",
    clubId: "abch",
    courtAllocationId: stored("courts/abcda").allocationId,
    clubAllocationId: stored("clubs/abch").allocationId,
  });
});

test("editing a device changes its court and returns to the device list", async () => {
  document.querySelector('.tab-btn[data-tab="devices"]').click();
  await waitForDeviceList(4);

  await openDeviceEditor("HUB-1");
  assert.equal(window.history.state.viewState.page, "editDevice");
  assert.equal($("editDeviceIdTitle").textContent, "HUB-1");
  assert.equal($("editDeviceCourtIdSelect").value, "abcda", "the current court is preselected");

  choose($("editDeviceCourtIdSelect"), "efgha");
  $("saveEditDeviceBtn").click();
  await waitFor(() => lastToast() === "Mapping updated", { label: "device saved" });
  await waitForDeviceList(4);
  assert.equal(activeTab(), "devices");
  assert.deepEqual(stored("devices/HUB-1"), {
    courtId: "efgha",
    deviceSKU: "HUB",
    courtAllocationId: stored("courts/efgha").allocationId,
  });

  // Manual court ids are trimmed when saving an existing device.
  await openDeviceEditor("BEACON-8");
  assert.equal($("editDeviceCourtIdSelect").value, "pqrsa");
  $("editDeviceManualToggle").click();
  assert.equal($("editDeviceCourtIdManual").style.display, "");
  $("editDeviceCourtIdManual").value = "zzzzz";
  $("saveEditDeviceBtn").click();
  await waitFor(
    () =>
      lastToast() ===
      'Update failed:\nThe court "zzzzz" was not found in the loaded courts. Select an existing court, or refresh the list and try again.',
    { label: "missing court update error" },
  );
  assert.equal(stored("devices/BEACON-8").courtId, "pqrsa");
  assert.equal(isShown("editDevicePage"), true);
  $("editDeviceCourtIdManual").value = "  abcda  ";
  $("saveEditDeviceBtn").click();
  await waitFor(() => stored("devices/BEACON-8").courtId === "abcda", {
    label: "manually remapped device",
  });
  assert.equal(stored("devices/BEACON-8").courtAllocationId, stored("courts/abcda").allocationId);
  await waitForDeviceList(4);
  assert.equal(activeTab(), "devices", "returning keeps the Devices tab and reloads it");
});

test("the device editor keeps Save and Delete disabled until its courts have loaded", async () => {
  const releaseCourts = holdReads("courts");
  document.querySelector('#adminDeviceList .edit-btn[data-id="HUB-1"]').click();
  await waitFor(() => isShown("editDevicePage"), { label: "device editor shown while loading" });

  assert.equal($("editDeviceIdTitle").textContent, "HUB-1");
  assert.equal($("saveEditDeviceBtn").disabled, true);
  assert.equal($("saveEditDeviceBtn").textContent, "Loading courts…");
  assert.equal($("deleteDeviceBtn").disabled, true);
  assert.equal($("editDeviceCourtIdSelect").disabled, true);
  assert.equal($("editDevicePage").getAttribute("aria-busy"), "true");
  assert.equal(window.getComputedStyle($("saveEditDeviceBtn")).opacity, "0.5");

  const before = structuredClone(stored("devices/HUB-1"));
  $("saveEditDeviceBtn").click();
  $("deleteDeviceBtn").click();
  await settle();
  assert.deepEqual(stored("devices/HUB-1"), before, "nothing is saved while loading");
  assert.equal($("confirmModal").classList.contains("hidden"), true, "delete does not ask");

  releaseCourts();
  await waitFor(deviceEditorReady, { label: "device editor ready" });
  assert.equal($("saveEditDeviceBtn").textContent, "Save Mapping");
  assert.equal($("deleteDeviceBtn").disabled, false);
  assert.equal($("editDeviceCourtIdSelect").disabled, false);
  assert.equal($("editDevicePage").getAttribute("aria-busy"), "false");
  assert.equal($("editDeviceCourtIdSelect").value, "efgha");

  $("closeEditDeviceBtn").click();
  await waitForDeviceList(4);
});

test("a device editor never saves to the previously opened device", async () => {
  // HUB-1's editor is opened, left before it finishes loading, and PULSE-2's
  // is opened. HUB-1's late load must not take over the page, and Save must
  // only ever reach PULSE-2.
  const releaseFirst = holdReads("courts");
  document.querySelector('#adminDeviceList .edit-btn[data-id="HUB-1"]').click();
  await waitFor(() => isShown("editDevicePage"), { label: "HUB-1 editor loading" });
  $("closeEditDeviceBtn").click();
  await waitFor(() => isShown("adminDashboardPage") && !isShown("editDevicePage"), {
    label: "dashboard",
  });
  await waitForDeviceList(4);

  const releaseSecond = holdReads("courts");
  document.querySelector('#adminDeviceList .edit-btn[data-id="PULSE-2"]').click();
  await waitFor(() => isShown("editDevicePage"), { label: "PULSE-2 editor loading" });
  assert.equal($("saveEditDeviceBtn").onclick, null, "no handler is left from HUB-1");

  releaseFirst();
  await settle();
  assert.equal($("editDeviceIdTitle").textContent, "PULSE-2");
  assert.equal($("saveEditDeviceBtn").disabled, true, "HUB-1's late load does not enable Save");

  releaseSecond();
  await waitFor(deviceEditorReady, { label: "PULSE-2 editor ready" });
  const hubBefore = structuredClone(stored("devices/HUB-1"));
  choose($("editDeviceCourtIdSelect"), "efgha");
  $("saveEditDeviceBtn").click();
  await waitFor(() => stored("devices/PULSE-2").courtId === "efgha", { label: "PULSE-2 saved" });
  assert.deepEqual(stored("devices/HUB-1"), hubBefore, "HUB-1 is untouched");
  await waitForDeviceList(4);
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
  assert.notEqual(
    window.getComputedStyle($("appearanceMenuBtn")).display,
    "none",
    "floating appearance button is restored as soon as the portal closes",
  );
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
