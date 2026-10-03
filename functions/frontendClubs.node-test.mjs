// Frontend integration tests: clubs. Court lists show each court's club and can
// be searched by club; the admin portal lists, creates, edits and deletes
// clubs and opens a club's courts and devices for editing. The club callables
// are stood in for by handlers that apply the request to the mock Firestore;
// the real backend rules are covered by clubs.test.js.
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
  writeDoc,
} from "./frontendHarness/harness.mjs";

let window;
let document;
const callableCalls = [];

const $ = (id) => document.getElementById(id);
const isShown = (id) => window.getComputedStyle($(id)).display !== "none";
const texts = (selector) =>
  [...document.querySelectorAll(selector)].map((el) => el.textContent.trim());

// Stand-in for the club callables: replaces the club's members and removes
// them from any other club, like the backend does.
function saveClubDoc(clubId, { name, courtIds, deviceIds }) {
  for (const [path, data] of firestoreState.docs) {
    if (!path.startsWith("clubs/") || path === `clubs/${clubId}`) continue;
    writeDoc(path, {
      ...data,
      courtIds: (data.courtIds || []).filter((id) => !courtIds.includes(id)),
      deviceIds: (data.deviceIds || []).filter((id) => !deviceIds.includes(id)),
    });
  }
  writeDoc(`clubs/${clubId}`, { name, courtIds, deviceIds });
  return { data: { clubId, name, courtIds, deviceIds, moved: { courts: [], devices: [] } } };
}

function installClubCallables() {
  callableHandlers.set("createClub", async (payload) => {
    callableCalls.push(["createClub", payload]);
    return saveClubDoc("newclb", payload);
  });
  callableHandlers.set("updateClub", async (payload) => {
    callableCalls.push(["updateClub", payload]);
    return saveClubDoc(payload.clubId, payload);
  });
  callableHandlers.set("deleteClub", async (payload) => {
    callableCalls.push(["deleteClub", payload]);
    firestoreState.docs.delete(`clubs/${payload.clubId}`);
    return { data: { clubId: payload.clubId, releasedCount: 0 } };
  });
}

function clickMenuButton(label) {
  const button = [...document.querySelectorAll(".menu-btn")].find(
    (btn) => btn.textContent.trim() === label,
  );
  assert.ok(button, `menu button ${label}`);
  button.click();
}

function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function confirmDialog(accept = true) {
  await waitFor(() => !$("confirmModal").classList.contains("hidden"), { label: "confirm dialog" });
  const message = $("confirmMessage").textContent;
  $(accept ? "confirmOkBtn" : "confirmCancelBtn").click();
  await settle(10);
  return message;
}

const memberRow = (listId, memberId) =>
  document.querySelector(`#${listId} .club-member-item[data-member-id="${memberId}"]`);

async function waitForEditorLists() {
  await waitFor(() => document.querySelector("#clubCourtList .club-member-item"), {
    label: "club editor court rows",
  });
  await waitFor(() => document.querySelector("#clubDeviceList .club-member-item"), {
    label: "club editor device rows",
  });
}

test.before(async () => {
  seedBaseData();
  seedCourt("abcd", { name: "Alpha Court" });
  seedCourt("efgh", { name: "Beta Court" });
  seedCourt("jkmn", { name: "Gamma Court" });
  seedCourt("pqrs", { name: "Delta Court", status: "private" });
  seedDoc("clubs/rvside", { name: "Riverside Padel", courtIds: ["abcd"], deviceIds: ["HUB-1"] });
  seedDoc("clubs/hiltop", { name: "Hilltop Club", courtIds: ["jkmn"], deviceIds: [] });
  seedDoc("devices/HUB-1", { courtId: "abcd", clubId: "rvside" });
  seedDoc("devices/PULSE-2", { courtId: "efgh" });
  installClubCallables();

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;
});

test("the spectate list shows each court's club in its own column", async () => {
  clickMenuButton("Spectate");
  await waitFor(() => document.querySelectorAll("#spectateCourtList .court-item").length === 3, {
    label: "spectate list",
  });

  assert.match($("spectateCourtSearch").placeholder, /club/i);
  assert.equal($("spectateCourtList").classList.contains("has-clubs"), true);

  const rows = [...document.querySelectorAll("#spectateCourtList .court-item")].map((row) => [
    row.dataset.courtId,
    row.querySelector(".court-item-club").textContent,
  ]);
  assert.deepEqual(rows, [
    ["abcd", "Riverside Padel"],
    ["efgh", ""],
    ["jkmn", "Hilltop Club"],
  ]);
  assert.equal(
    document.querySelector('#spectateCourtList [data-court-id="abcd"]').getAttribute("aria-label"),
    "Alpha Court - abcd - Riverside Padel",
  );
});

test("court searches also match club names and club ids", async () => {
  const search = $("spectateCourtSearch");
  const visibleCourts = () =>
    [...document.querySelectorAll("#spectateCourtList .court-item")].map(
      (row) => row.dataset.courtId,
    );

  typeInto(search, "riverside");
  assert.deepEqual(visibleCourts(), ["abcd"]);

  typeInto(search, "HILTOP");
  assert.deepEqual(visibleCourts(), ["jkmn"]);

  typeInto(search, "beta");
  assert.deepEqual(visibleCourts(), ["efgh"], "court names still match");
  assert.equal(
    $("spectateCourtList").classList.contains("has-clubs"),
    true,
    "the club column stays while filtered rows have no club",
  );

  typeInto(search, "");
  $("closeSpectateBtn").click();
  await waitFor(() => isShown("menuPage"), { label: "menu" });
});

test("the play list shows clubs and searches by club as well", async () => {
  clickMenuButton("Play");
  await waitFor(() => document.querySelectorAll("#playCourtList .court-item").length === 4, {
    label: "play list (open and private courts)",
  });
  assert.match($("playCourtSearch").placeholder, /club/i);
  assert.equal(
    document.querySelector('#playCourtList [data-court-id="jkmn"] .court-item-club').textContent,
    "Hilltop Club",
  );

  typeInto($("playCourtSearch"), "padel");
  assert.deepEqual(
    [...document.querySelectorAll("#playCourtList .court-item")].map((row) => row.dataset.courtId),
    ["abcd"],
  );

  typeInto($("playCourtSearch"), "");
  $("closePlayBtn").click();
  await waitFor(() => isShown("menuPage"), { label: "menu" });
});

test("admins see the club of every court and device in the dashboard lists", async () => {
  $("adminLoginBtn").click();
  await waitFor(() => isShown("adminAuthPage"), { label: "admin auth page" });
  $("adminAuthPassword").value = ADMIN_SKELETON_KEY;
  $("submitAdminAuthBtn").click();
  await waitFor(() => document.querySelectorAll("#adminCourtList .admin-court-item").length === 4, {
    label: "admin court list",
  });

  const clubOf = (courtId) =>
    [...document.querySelectorAll("#adminCourtList .admin-court-item")]
      .find((row) => row.querySelector(".edit-btn").dataset.id === courtId)
      .querySelector(".club-cell .aci-value").textContent;
  assert.equal(clubOf("abcd"), "Riverside Padel");
  assert.equal(clubOf("efgh"), "—");

  assert.match($("adminCourtSearch").placeholder, /club/i);
  typeInto($("adminCourtSearch"), "hilltop");
  assert.deepEqual(texts("#adminCourtList .aci-name strong"), ["Gamma Court"]);
  typeInto($("adminCourtSearch"), "");

  document.querySelector('.tab-btn[data-tab="devices"]').click();
  await waitFor(
    () => document.querySelectorAll("#adminDeviceList .admin-court-item").length === 2,
    {
      label: "admin device list",
    },
  );
  assert.deepEqual(texts("#adminDeviceList .club-cell .aci-value"), ["Riverside Padel", "—"]);
  typeInto($("adminDeviceSearch"), "riverside");
  assert.equal(document.querySelectorAll("#adminDeviceList .admin-court-item").length, 1);
  typeInto($("adminDeviceSearch"), "");
});

test("the Clubs tab lists every club with its court and device counts", async () => {
  const tabs = texts(".admin-tabs .tab-btn");
  assert.deepEqual(tabs, ["Clubs", "Courts", "Devices"]);

  document.querySelector('.tab-btn[data-tab="clubs"]').click();
  await waitFor(() => document.querySelectorAll("#adminClubList .admin-club-item").length === 2, {
    label: "club list",
  });
  assert.equal($("clubsTab").classList.contains("active"), true);
  assert.equal($("courtsTab").classList.contains("active"), false);

  const rows = [...document.querySelectorAll("#adminClubList .admin-club-item")].map((row) => [
    row.querySelector(".club-name").textContent,
    row.querySelector(".aci-id").textContent,
    row.querySelector(".club-courts-cell .aci-value").textContent,
    row.querySelector(".club-devices-cell .aci-value").textContent,
  ]);
  assert.deepEqual(rows, [
    ["Hilltop Club", "ID: HILTOP", "1 court", "0 devices"],
    ["Riverside Padel", "ID: RVSIDE", "1 court", "1 device"],
  ]);

  typeInto($("adminClubSearch"), "rvs");
  assert.deepEqual(texts("#adminClubList .club-name"), ["Riverside Padel"]);
  typeInto($("adminClubSearch"), "");
});

test("Create Club saves the name and the selected courts and devices", async () => {
  // Start from the Courts tab: creating a club still lands on the Clubs tab.
  document.querySelector('.tab-btn[data-tab="courts"]').click();
  await settle();

  $("showCreateClubBtn").click();
  await waitFor(() => isShown("editClubPage"), { label: "club editor" });
  await waitForEditorLists();

  assert.equal($("editClubTitle").textContent, "Create Club");
  assert.equal($("saveClubBtn").textContent, "Create Club");
  assert.equal($("deleteClubBtn").style.display, "none", "a new club cannot be deleted");
  assert.equal($("clubCourtsCount").textContent, "0 selected");

  $("saveClubBtn").click();
  await settle();
  assert.equal($("editClubNameError").textContent, "Club name required.");
  assert.equal(callableCalls.length, 0);

  typeInto($("editClubName"), "Seaside Club");
  typeInto($("clubCourtSearch"), "beta");
  assert.deepEqual(
    [...document.querySelectorAll("#clubCourtList .club-member-item")].map(
      (row) => row.dataset.memberId,
    ),
    ["efgh"],
  );
  memberRow("clubCourtList", "efgh").querySelector("input").click();
  typeInto($("clubCourtSearch"), "");

  // Gamma Court belongs to Hilltop Club: selecting it marks it as a move.
  const gamma = memberRow("clubCourtList", "jkmn");
  assert.equal(gamma.querySelector(".club-member-club").textContent, "Hilltop Club");
  gamma.querySelector("input").click();
  assert.equal(gamma.classList.contains("will-move"), true);
  memberRow("clubDeviceList", "PULSE-2").querySelector("input").click();
  assert.equal($("clubCourtsCount").textContent, "2 selected");
  assert.equal($("clubDevicesCount").textContent, "1 selected");

  $("saveClubBtn").click();
  const message = await confirmDialog(true);
  assert.match(message, /Court Gamma Court \(from Hilltop Club\)/);

  await waitFor(() => callableCalls.length === 1, { label: "createClub call" });
  assert.deepEqual(callableCalls[0], [
    "createClub",
    { name: "Seaside Club", courtIds: ["efgh", "jkmn"], deviceIds: ["PULSE-2"] },
  ]);

  await waitFor(() => isShown("adminDashboardPage") && !isShown("editClubPage"), {
    label: "back on the dashboard",
  });
  await waitFor(() => document.querySelectorAll("#adminClubList .admin-club-item").length === 3, {
    label: "club list with the new club",
  });
  assert.equal($("clubsTab").classList.contains("active"), true);
});

test("a club's courts and devices open their own edit pages and return to the club", async () => {
  const riverside = [...document.querySelectorAll("#adminClubList .admin-club-item")].find(
    (row) => row.dataset.clubId === "rvside",
  );
  riverside.querySelector(".edit-btn").click();
  await waitFor(() => isShown("editClubPage"), { label: "club editor" });
  await waitForEditorLists();

  assert.equal($("editClubTitle").textContent, "Riverside Padel");
  assert.equal($("editClubIdLine").textContent, "ID: RVSIDE");
  assert.equal($("editClubName").value, "Riverside Padel");
  assert.equal(memberRow("clubCourtList", "abcd").querySelector("input").checked, true);
  assert.equal(memberRow("clubDeviceList", "HUB-1").querySelector("input").checked, true);
  assert.equal(
    document.querySelector("#clubCourtList .club-member-item").dataset.memberId,
    "abcd",
    "members are listed first",
  );

  // An unsaved change survives a visit to a court's edit page.
  memberRow("clubCourtList", "efgh").querySelector("input").click();

  memberRow("clubCourtList", "abcd").querySelector(".club-member-open").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court edit page" });
  assert.equal(isShown("editClubPage"), false);
  assert.equal($("editCourtName").value, "Alpha Court");

  $("closeEditBtn").click();
  await waitFor(() => isShown("editClubPage") && !isShown("editCourtPage"), {
    label: "back on the club editor",
  });
  await waitForEditorLists();
  assert.equal(memberRow("clubCourtList", "efgh").querySelector("input").checked, true);

  // Saving a device opened from the club returns to the club as well.
  memberRow("clubDeviceList", "HUB-1").querySelector(".club-member-open").click();
  // The page's Save handler is attached once its court dropdown has loaded.
  await waitFor(
    () => isShown("editDevicePage") && $("editDeviceCourtIdSelect").options.length > 1,
    {
      label: "device edit page",
    },
  );
  assert.equal($("editDeviceIdTitle").textContent, "HUB-1");
  $("saveEditDeviceBtn").click();
  await waitFor(() => isShown("editClubPage") && !isShown("editDevicePage"), {
    label: "back on the club editor after saving the device",
  });
  await waitForEditorLists();
  assert.equal(memberRow("clubCourtList", "efgh").querySelector("input").checked, true);

  // Beta Court joined Seaside Club in the previous test, so it moves.
  $("saveClubBtn").click();
  assert.match(await confirmDialog(true), /Court Beta Court \(from Seaside Club\)/);
  await waitFor(() => callableCalls.length === 2, { label: "updateClub call" });
  assert.deepEqual(callableCalls[1], [
    "updateClub",
    {
      clubId: "rvside",
      name: "Riverside Padel",
      courtIds: ["abcd", "efgh"],
      deviceIds: ["HUB-1"],
    },
  ]);
  await waitFor(() => isShown("adminDashboardPage") && !isShown("editClubPage"), {
    label: "back on the dashboard",
  });
});

test("closing the editor with unsaved changes asks first", async () => {
  await waitFor(() => document.querySelector('#adminClubList [data-club-id="hiltop"]'), {
    label: "club list",
  });
  document.querySelector('#adminClubList [data-club-id="hiltop"] .edit-btn').click();
  await waitFor(() => isShown("editClubPage"), { label: "club editor" });
  await waitForEditorLists();

  typeInto($("editClubName"), "Hilltop Padel Club");
  $("closeEditClubBtn").click();
  const message = await confirmDialog(false);
  assert.match(message, /Discard your unsaved changes/);
  assert.equal(isShown("editClubPage"), true, "cancelling keeps the editor open");

  $("closeEditClubBtn").click();
  await confirmDialog(true);
  await waitFor(() => isShown("adminDashboardPage") && !isShown("editClubPage"), {
    label: "dashboard after discarding",
  });
  assert.equal(callableCalls.length, 2, "nothing was saved");
});

test("Delete Club removes the club after confirmation", async () => {
  await waitFor(() => document.querySelector('#adminClubList [data-club-id="hiltop"]'), {
    label: "club list",
  });
  document.querySelector('#adminClubList [data-club-id="hiltop"] .edit-btn').click();
  await waitFor(() => isShown("editClubPage"), { label: "club editor" });

  $("deleteClubBtn").click();
  const message = await confirmDialog(true);
  assert.match(message, /Delete club "Hilltop Club"/);

  await waitFor(() => callableCalls.length === 3, { label: "deleteClub call" });
  assert.deepEqual(callableCalls[2], ["deleteClub", { clubId: "hiltop" }]);
  await waitFor(
    () =>
      isShown("adminDashboardPage") &&
      !document.querySelector('#adminClubList [data-club-id="hiltop"]') &&
      document.querySelectorAll("#adminClubList .admin-club-item").length === 2,
    { label: "club list without the deleted club" },
  );
});
