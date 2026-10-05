// Frontend integration tests: club management in the admin portal, driven
// end to end. The real club callables and deletion triggers run against the
// harness's in-memory Firestore (frontendHarness/clubBackend.mjs), so these
// tests also pin the contract between the app and the backend: what the app
// sends, what it does with the answer, and what ends up stored.
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
import { installClubBackend } from "./frontendHarness/clubBackend.mjs";

let window;
let document;
let clubRequests;

const $ = (id) => document.getElementById(id);
const isShown = (id) => window.getComputedStyle($(id)).display !== "none";
const texts = (selector) =>
  [...document.querySelectorAll(selector)].map((el) => el.textContent.trim());
const stored = (path) => firestoreState.docs.get(path);
const clubIdNamed = (name) =>
  [...firestoreState.docs]
    .find(([path, data]) => path.startsWith("clubs/") && data.name === name)?.[0]
    .split("/")[1];

function typeInto(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function pressKey(target, key) {
  target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
}

async function confirmDialog(accept = true) {
  await waitFor(() => !$("confirmModal").classList.contains("hidden"), { label: "confirm dialog" });
  const message = $("confirmMessage").textContent;
  $(accept ? "confirmOkBtn" : "confirmCancelBtn").click();
  await settle(10);
  return message;
}

const confirmIsOpen = () => !$("confirmModal").classList.contains("hidden");
const memberRow = (listId, memberId) =>
  document.querySelector(`#${listId} .club-member-item[data-member-id="${memberId}"]`);
const memberChecked = (listId, memberId) =>
  memberRow(listId, memberId).querySelector("input").checked;
const clubRow = (clubId) => document.querySelector(`#adminClubList [data-club-id="${clubId}"]`);
const lastToast = () => texts(".toast").at(-1);

async function waitForEditor() {
  await waitFor(() => isShown("editClubPage"), { label: "club editor" });
  await waitFor(
    () =>
      document.querySelector("#clubCourtList .club-member-item, #clubCourtList .no-courts") &&
      document.querySelector("#clubDeviceList .club-member-item, #clubDeviceList .no-courts"),
    { label: "club editor lists" },
  );
}

async function waitForDashboardClubs(count) {
  await waitFor(
    () =>
      isShown("adminDashboardPage") &&
      !isShown("editClubPage") &&
      document.querySelectorAll("#adminClubList .admin-club-item").length === count,
    { label: `dashboard with ${count} clubs` },
  );
}

async function openClub(clubId) {
  await waitFor(() => clubRow(clubId), { label: `club ${clubId} in the list` });
  clubRow(clubId).querySelector(".edit-btn").click();
  await waitForEditor();
}

test.before(async () => {
  seedBaseData();
  seedCourt("abcd", { name: "Alpha Court", clubId: "rvside" });
  seedCourt("efgh", { name: "Beta Court" });
  seedCourt("jkmn", { name: "Gamma Court", clubId: "hiltop" });
  seedCourt("pqrs", { name: "Delta Court", status: "private" });
  seedCourt("stux", { name: "Echo Court", clubId: "ghostc" });
  seedDoc("clubs/rvside", {
    name: "Riverside Padel",
    state: "open",
    courtIds: ["abcd"],
    deviceIds: ["HUB-1"],
  });
  seedDoc("clubs/hiltop", {
    name: "Hilltop Club",
    state: "open",
    courtIds: ["jkmn"],
    deviceIds: [],
  });
  // Lists a court and a device that no longer exist.
  seedDoc("clubs/ghostc", {
    name: "Ghost Club",
    state: "closed",
    courtIds: ["stux", "zzzz"],
    deviceIds: ["GONE-9"],
  });
  seedDoc("devices/HUB-1", { courtId: "abcd", clubId: "rvside" });
  seedDoc("devices/PULSE-2", { courtId: "efgh" });

  clubRequests = installClubBackend();
  callableHandlers.set("updateScoringOptions", async ({ scoringOptions }) => ({
    data: { scoringOptions },
  }));

  const dom = await bootFrontend();
  window = dom.window;
  document = window.document;

  $("adminLoginBtn").click();
  await waitFor(() => isShown("adminAuthPage"), { label: "admin auth page" });
  $("adminAuthPassword").value = ADMIN_SKELETON_KEY;
  $("submitAdminAuthBtn").click();
  await waitFor(() => document.querySelectorAll("#adminCourtList .admin-court-item").length === 5, {
    label: "admin court list",
  });
});

test("the admin court and device lists show each item's club and search by it", async () => {
  const courtClub = (courtId) =>
    document
      .querySelector(`#adminCourtList .edit-btn[data-id="${courtId}"]`)
      .closest(".admin-court-item")
      .querySelector(".club-cell");
  assert.equal(courtClub("abcd").querySelector(".aci-value").textContent, "Riverside Padel");
  assert.equal(courtClub("abcd").querySelector(".aci-value").title, "Riverside Padel (RVSIDE)");
  assert.equal(courtClub("abcd").classList.contains("is-empty"), false);
  assert.equal(courtClub("efgh").querySelector(".aci-value").textContent, "—");
  assert.equal(courtClub("efgh").classList.contains("is-empty"), true);

  assert.match($("adminCourtSearch").placeholder, /club/i);
  typeInto($("adminCourtSearch"), "hiltop");
  assert.deepEqual(texts("#adminCourtList .aci-name strong"), ["Gamma Court"]);
  typeInto($("adminCourtSearch"), "");

  document.querySelector('.tab-btn[data-tab="devices"]').click();
  await waitFor(
    () => document.querySelectorAll("#adminDeviceList .admin-court-item").length === 2,
    {
      label: "admin device list",
    },
  );
  assert.match($("adminDeviceSearch").placeholder, /club/i);
  assert.deepEqual(texts("#adminDeviceList .club-cell .aci-value"), ["Riverside Padel", "—"]);
  for (const [term, count] of [
    ["riverside", 1],
    ["RVSIDE", 1],
    ["efgh", 1],
    ["pulse", 1],
    ["", 2],
  ]) {
    typeInto($("adminDeviceSearch"), term);
    assert.equal(
      document.querySelectorAll("#adminDeviceList .admin-court-item").length,
      count,
      `device search "${term}"`,
    );
  }
});

test("the Clubs tab lists every club with its court and device counts", async () => {
  assert.deepEqual(texts(".admin-tabs .tab-btn"), [
    "Tournaments",
    "Clubs",
    "Courts",
    "Matches",
    "Devices",
  ]);

  document.querySelector('.tab-btn[data-tab="clubs"]').click();
  await waitForDashboardClubs(3);
  assert.equal($("clubsTab").classList.contains("active"), true);
  assert.equal($("devicesTab").classList.contains("active"), false);

  const rows = [...document.querySelectorAll("#adminClubList .admin-club-item")].map((item) => [
    item.querySelector(".club-name").textContent,
    item.querySelector(".aci-id").textContent,
    item.querySelector(".club-state-cell .status-badge").textContent,
    item.querySelector(".club-courts-cell .aci-value").textContent,
    item.querySelector(".club-devices-cell .aci-value").textContent,
  ]);
  assert.deepEqual(rows, [
    ["Ghost Club", "ID: GHOSTC", "Closed", "2 courts", "1 device"],
    ["Hilltop Club", "ID: HILTOP", "Open", "1 court", "0 devices"],
    ["Riverside Padel", "ID: RVSIDE", "Open", "1 court", "1 device"],
  ]);

  for (const [term, expected] of [
    ["rvs", ["Riverside Padel"]],
    ["CLUB", ["Ghost Club", "Hilltop Club"]],
    ["nope", []],
  ]) {
    typeInto($("adminClubSearch"), term);
    assert.deepEqual(texts("#adminClubList .club-name"), expected, `club search "${term}"`);
  }
  assert.equal(texts("#adminClubList .no-courts")[0], "No matching clubs found.");
  typeInto($("adminClubSearch"), "");
});

test("Add Club creates the club and moves members from their old club", async () => {
  document.querySelector('.tab-btn[data-tab="courts"]').click();
  await settle();

  $("showCreateClubBtn").click();
  await waitForEditor();
  assert.equal(window.history.state.viewState.page, "createClub");
  assert.equal($("editClubTitle").textContent, "Add Club");
  assert.equal($("editClubIdLine").textContent, "");
  assert.equal($("saveClubBtn").textContent, "Add Club");
  assert.equal($("deleteClubBtn").style.display, "none");
  assert.equal($("clubCourtsCount").textContent, "0 selected");
  assert.equal($("clubDevicesCount").textContent, "0 selected");
  assert.equal($("editClubState").value, "maintenance");

  $("saveClubBtn").click();
  await settle();
  assert.equal($("editClubNameError").textContent, "Club name required.");
  typeInto($("editClubName"), "   ");
  $("saveClubBtn").click();
  await settle();
  assert.equal($("editClubNameError").textContent, "Club name required.");
  assert.equal(clubRequests.length, 0);

  typeInto($("editClubName"), "Seaside Club");
  assert.equal($("editClubNameError").textContent, "", "typing clears the error");

  // Enter in a search box filters; it must not save the club.
  typeInto($("clubCourtSearch"), "beta");
  pressKey($("clubCourtSearch"), "Enter");
  await settle();
  assert.equal(clubRequests.length, 0);
  assert.deepEqual(
    [...document.querySelectorAll("#clubCourtList .club-member-item")].map(
      (r) => r.dataset.memberId,
    ),
    ["efgh"],
  );
  memberRow("clubCourtList", "efgh").querySelector("input").click();
  typeInto($("clubCourtSearch"), "");

  const gamma = memberRow("clubCourtList", "jkmn");
  assert.equal(gamma.querySelector(".club-member-club").textContent, "Hilltop Club");
  assert.equal(
    gamma.querySelector(".club-member-club").title,
    "Currently in Hilltop Club (HILTOP)",
  );
  gamma.querySelector("input").click();
  assert.equal(gamma.classList.contains("will-move"), true);
  gamma.querySelector("input").click();
  assert.equal(gamma.classList.contains("will-move"), false, "unticking clears the move marker");
  gamma.querySelector("input").click();

  typeInto($("clubDeviceSearch"), "efgh");
  memberRow("clubDeviceList", "PULSE-2").querySelector("input").click();
  typeInto($("clubDeviceSearch"), "");
  assert.equal($("clubCourtsCount").textContent, "2 selected");
  assert.equal($("clubDevicesCount").textContent, "1 selected");

  // Enter in the name field saves.
  pressKey($("editClubName"), "Enter");
  const message = await confirmDialog(true);
  assert.match(message, /already in another club and will move to "Seaside Club"/);
  assert.match(message, /Court Gamma Court \(from Hilltop Club\)/);

  await waitForDashboardClubs(4);
  assert.deepEqual(clubRequests.at(-1), [
    "createClub",
    {
      name: "Seaside Club",
      state: "maintenance",
      courtIds: ["efgh", "jkmn"],
      deviceIds: ["PULSE-2"],
    },
  ]);

  const seasideId = clubIdNamed("Seaside Club");
  assert.match(seasideId, /^[a-z]{6}$/);
  assert.match(
    lastToast(),
    new RegExp(`Club "Seaside Club" created\\. ID: ${seasideId.toUpperCase()}`),
  );
  assert.deepEqual(stored(`clubs/${seasideId}`).courtIds, ["efgh", "jkmn"]);
  assert.deepEqual(stored(`clubs/${seasideId}`).deviceIds, ["PULSE-2"]);
  assert.equal(stored("courts/efgh").clubId, seasideId);
  assert.equal(stored("courts/jkmn").clubId, seasideId);
  assert.equal(stored("devices/PULSE-2").clubId, seasideId);
  assert.deepEqual(stored("clubs/hiltop").courtIds, [], "Gamma Court left Hilltop Club");

  assert.equal($("clubsTab").classList.contains("active"), true, "lands on the Clubs tab");
  assert.equal(
    clubRow("hiltop").querySelector(".club-courts-cell .aci-value").textContent,
    "0 courts",
  );
});

test("a club the backend rejects stays open with the reason shown", async () => {
  $("showCreateClubBtn").click();
  await waitForEditor();

  // maxlength stops typing past 80 characters; the backend enforces it too.
  $("editClubName").value = "x".repeat(81);
  $("saveClubBtn").click();
  await waitFor(() => lastToast()?.startsWith("Failed to save club"), { label: "error toast" });
  assert.equal(lastToast(), "Failed to save club: Club name must be at most 80 characters.");
  assert.equal(isShown("editClubPage"), true);
  assert.equal($("saveClubBtn").disabled, false, "the save button is usable again");
  assert.equal(clubIdNamed("x".repeat(81)), undefined);

  $("closeEditClubBtn").click();
  assert.match(await confirmDialog(true), /Discard your unsaved changes/);
  await waitForDashboardClubs(4);
});

test("a club's courts and devices open their edit pages and return to the club", async () => {
  await openClub("rvside");
  assert.deepEqual(window.history.state.viewState.page, "editClub");
  assert.equal(window.history.state.viewState.entityId, "rvside");
  assert.equal($("editClubTitle").textContent, "Riverside Padel");
  assert.equal($("editClubIdLine").textContent, "ID: RVSIDE");
  assert.equal($("saveClubBtn").textContent, "Save Club");
  assert.equal(memberChecked("clubCourtList", "abcd"), true);
  assert.equal(memberChecked("clubDeviceList", "HUB-1"), true);
  assert.equal(document.querySelector("#clubCourtList .club-member-item").dataset.memberId, "abcd");
  assert.equal(
    memberRow("clubCourtList", "abcd").querySelector(".club-member-club").textContent,
    "",
  );

  // An unsaved change survives visits to the members' edit pages.
  memberRow("clubCourtList", "efgh").querySelector("input").click();

  memberRow("clubCourtList", "abcd").querySelector(".club-member-open").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court edit page" });
  assert.equal(isShown("editClubPage"), false);
  assert.equal($("editCourtName").value, "Alpha Court");
  $("closeEditBtn").click();
  await waitForEditor();
  assert.equal(memberChecked("clubCourtList", "efgh"), true);

  memberRow("clubDeviceList", "HUB-1").querySelector(".club-member-open").click();
  await waitFor(() => isShown("editDevicePage") && !$("saveEditDeviceBtn").disabled, {
    label: "device edit page",
  });
  $("saveEditDeviceBtn").click();
  await waitForEditor();
  assert.equal(lastToast(), "Mapping updated");
  assert.equal(memberChecked("clubCourtList", "efgh"), true);

  // Saving a court returns here too, and the list shows the saved name.
  memberRow("clubCourtList", "abcd").querySelector(".club-member-open").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court edit page" });
  $("editCourtName").value = "Alpha Court Renamed";
  $("saveEditBtn").click();
  await waitForEditor();
  await waitFor(
    () => memberRow("clubCourtList", "abcd")?.textContent.includes("Alpha Court Renamed"),
    {
      label: "renamed court in the club editor",
    },
  );
  assert.equal(stored("courts/abcd").name, "Alpha Court Renamed");
  assert.equal(stored("courts/abcd").clubId, "rvside", "editing a court keeps its club");
  assert.equal(memberChecked("clubCourtList", "efgh"), true);

  // Unticking a member releases it from the club on save.
  memberRow("clubDeviceList", "HUB-1").querySelector("input").click();
  assert.equal($("clubDevicesCount").textContent, "0 selected");

  const seasideId = clubIdNamed("Seaside Club");
  $("saveClubBtn").click();
  assert.match(await confirmDialog(true), /Court Beta Court \(from Seaside Club\)/);
  await waitForDashboardClubs(4);
  assert.deepEqual(clubRequests.at(-1), [
    "updateClub",
    {
      clubId: "rvside",
      name: "Riverside Padel",
      state: "open",
      courtIds: ["abcd", "efgh"],
      deviceIds: [],
    },
  ]);
  assert.equal(lastToast(), 'Club "Riverside Padel" saved.');
  assert.deepEqual(stored("clubs/rvside").courtIds, ["abcd", "efgh"]);
  assert.deepEqual(stored("clubs/rvside").deviceIds, []);
  assert.equal(stored("devices/HUB-1").clubId, null, "the unticked device was released");
  assert.equal(stored("courts/efgh").clubId, "rvside");
  assert.deepEqual(stored(`clubs/${seasideId}`).courtIds, ["jkmn"]);
});

test("browser back and forward leave and restore the editor with its unsaved changes", async () => {
  await openClub("hiltop");
  memberRow("clubCourtList", "pqrs").querySelector("input").click();

  window.history.back();
  await waitFor(() => isShown("adminDashboardPage") && !isShown("editClubPage"), {
    label: "dashboard after back",
  });

  window.history.forward();
  await waitForEditor();
  assert.equal($("editClubTitle").textContent, "Hilltop Club");
  assert.equal(memberChecked("clubCourtList", "pqrs"), true, "the unsaved selection is kept");

  // Escape asks before discarding it.
  pressKey(document.body, "Escape");
  assert.match(await confirmDialog(false), /Discard your unsaved changes/);
  assert.equal(isShown("editClubPage"), true);

  pressKey(document.body, "Escape");
  await confirmDialog(true);
  await waitForDashboardClubs(4);
});

test("an editor without changes closes straight away", async () => {
  await openClub("hiltop");
  assert.equal(
    memberChecked("clubCourtList", "pqrs"),
    false,
    "a fresh open starts from the saved club",
  );

  pressKey(document.body, "Escape");
  await settle(20);
  assert.equal(confirmIsOpen(), false);
  await waitForDashboardClubs(4);

  await openClub("hiltop");
  $("closeEditClubBtn").click();
  await settle(20);
  assert.equal(confirmIsOpen(), false);
  await waitForDashboardClubs(4);
});

test("members that no longer exist are dropped, also when deleted from the editor", async () => {
  await openClub("ghostc");
  // zzzz and GONE-9 do not exist any more, so only Echo Court counts.
  assert.equal($("clubCourtsCount").textContent, "1 selected");
  assert.equal($("clubDevicesCount").textContent, "0 selected");
  assert.equal(memberRow("clubCourtList", "zzzz"), null);

  memberRow("clubCourtList", "stux").querySelector(".club-member-open").click();
  await waitFor(() => isShown("editCourtPage"), { label: "court edit page" });
  $("deleteCourtBtn").click();
  await confirmDialog(true);
  await waitForEditor();
  assert.equal(memberRow("clubCourtList", "stux"), null);
  assert.equal($("clubCourtsCount").textContent, "0 selected");
  assert.equal(stored("courts/stux"), undefined);
  await waitFor(() => !stored("clubs/ghostc").courtIds.includes("stux"), {
    label: "the court deletion trigger drops the court from its club",
  });

  $("saveClubBtn").click();
  await waitForDashboardClubs(4);
  assert.deepEqual(clubRequests.at(-1), [
    "updateClub",
    { clubId: "ghostc", name: "Ghost Club", courtIds: [], deviceIds: [] },
  ]);
  assert.deepEqual(stored("clubs/ghostc").courtIds, []);
  assert.deepEqual(stored("clubs/ghostc").deviceIds, []);
});

test("club names are shown as text, never as markup", async () => {
  const markupName = "<b>Bold</b> & Co";
  await openClub("ghostc");
  typeInto($("editClubName"), markupName);
  $("saveClubBtn").click();
  await waitForDashboardClubs(4);

  const name = clubRow("ghostc").querySelector(".club-name");
  assert.equal(name.textContent, markupName);
  assert.equal(name.querySelector("b"), null);

  await openClub("ghostc");
  assert.equal($("editClubTitle").textContent, markupName);
  $("deleteClubBtn").click();
  await waitFor(confirmIsOpen, { label: "delete confirmation" });
  assert.equal($("confirmMessage").querySelector("b"), null);
  assert.match($("confirmMessage").textContent, /Delete club "<b>Bold<\/b> & Co"\?/);
  $("confirmCancelBtn").click();
  await settle();
  assert.equal(isShown("editClubPage"), true, "cancelling keeps the club");
  assert.ok(stored("clubs/ghostc"));
  $("closeEditClubBtn").click();
  await waitForDashboardClubs(4);
});

test("Delete Club removes the club and releases its courts and devices", async () => {
  await openClub("rvside");
  $("deleteClubBtn").click();
  assert.match(await confirmDialog(true), /no longer belong to a club/);

  await waitForDashboardClubs(3);
  assert.deepEqual(clubRequests.at(-1), ["deleteClub", { clubId: "rvside" }]);
  assert.equal(lastToast(), "Club deleted.");
  assert.equal(stored("clubs/rvside"), undefined);
  assert.equal(stored("courts/abcd").clubId, null);
  assert.equal(stored("courts/efgh").clubId, null);
  assert.equal(stored("devices/HUB-1").clubId, null);
  assert.equal(clubRow("rvside"), null);
});

test("the Clubs tab explains how to start when there are no clubs", async () => {
  for (const path of [...firestoreState.docs.keys()]) {
    if (path.startsWith("clubs/")) firestoreState.docs.delete(path);
  }
  document.querySelector('.tab-btn[data-tab="courts"]').click();
  await settle();
  document.querySelector('.tab-btn[data-tab="clubs"]').click();
  await waitFor(() => texts("#adminClubList .no-courts").length === 1, {
    label: "empty club list",
  });
  assert.equal(texts("#adminClubList .no-courts")[0], "No clubs yet. Use Add Club to add one.");
});
