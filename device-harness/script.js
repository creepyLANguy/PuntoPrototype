import { db } from "../app/js/firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  DEVICE_PROFILES,
  normaliseSku,
  createInitialLocalState,
} from "./device-profiles.js";
import * as firebaseEnvironmentConfig from "../app/js/firebase-config.js";

const state = {
  environment: detectEnvironment(),
  environmentMismatch: false,
  devices: [],
  devicesLoading: true,
  deviceSearch: "",
  courts: [],
  courtsLoading: true,
  courtSearch: "",
  virtualDeviceCourtSearch: "",
  virtualDeviceCourtId: null,
  courtDetailsLoading: false,
  scoreLoading: false,
  eventsLoading: false,
  currentScore: null,
  selectedMatchId: null,
  clubs: [],
  clubByCourtId: new Map(),
  clubByDeviceId: new Map(),
  selectedDeviceId: null,
  selectedCourtId: null,
  trace: [],
  selectedTraceId: null,
  localStates: new Map(),
  selectedCourtUnsub: null,
  selectedScoreUnsub: null,
  selectedEventsUnsub: null,
  productionEnabled: false,
  failure: {
    mode: "none",
    latencyMs: 1500,
    timeoutMs: 3000,
    armed: false,
  },
};

const els = {};
const ADMIN_SESSION_STORAGE_KEY = "padelPushAdminUnlocked";
const ADMIN_LOGOUT_SIGNAL_KEY = "padelPushAdminLogoutSignal";
const HARNESS_THEME_STORAGE_KEY = "puntoDeviceHarnessTheme";

function $(id) {
  return document.getElementById(id);
}

function getStoredTheme() {
  try {
    return localStorage.getItem(HARNESS_THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme) {
  const resolvedTheme = theme === "dark" ? "dark" : "light";
  document.body.classList.toggle("dark", resolvedTheme === "dark");

  try {
    localStorage.setItem(HARNESS_THEME_STORAGE_KEY, resolvedTheme);
  } catch (storageError) {
    console.warn("Unable to persist harness theme.", storageError);
  }

  const buttons = [
    $("themeToggleBtn"),
    $("themeToggleGateBtn"),
    $("themeToggleProductionGateBtn"),
  ].filter(Boolean);
  const isDark = resolvedTheme === "dark";
  buttons.forEach((button) => {
    button.textContent = isDark ? "☀️" : "🌙";
    button.title = isDark ? "Switch to light theme" : "Switch to dark theme";
    button.setAttribute("aria-label", button.title);
    button.setAttribute("aria-pressed", String(isDark));
  });
}

function toggleTheme() {
  const nextTheme = document.body.classList.contains("dark") ? "light" : "dark";
  applyTheme(nextTheme);
}

function endAdminSession() {
  try {
    sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
  } catch (storageError) {
    console.warn("Unable to clear admin session state.", storageError);
  }

  try {
    localStorage.setItem(ADMIN_LOGOUT_SIGNAL_KEY, String(Date.now()));
  } catch (storageError) {
    console.warn("Unable to broadcast admin logout.", storageError);
  }

  window.location.href = "/app";
}

function hasAdminSession() {
  try {
    return sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

async function getAdminPassword() {
  const adminRef = doc(db, "admin", "goodies");
  const adminSnap = await getDoc(adminRef);
  const data = adminSnap.data();
  if (!data || !data.skeletonKey) {
    throw new Error("Admin config missing or skeletonKey not found.");
  }
  return data.skeletonKey;
}

async function unlockHarness() {
  const passwordInput = $("adminPassword");
  const unlockButton = $("adminUnlockBtn");
  const error = $("adminPasswordError");
  const password = passwordInput.value.trim();

  error.textContent = "";
  if (!password) {
    error.textContent = "Admin password cannot be empty.";
    passwordInput.focus();
    return;
  }

  unlockButton.disabled = true;
  try {
    const adminPassword = await getAdminPassword();
    if (password !== adminPassword) {
      error.textContent = "Incorrect admin password.";
      passwordInput.value = "";
      passwordInput.focus();
      return;
    }

    try {
      sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, "true");
    } catch (storageError) {
      console.warn("Unable to persist admin session state.", storageError);
    }

    $("adminGate").classList.add("hidden");
    initHarness();
  } catch (err) {
    error.textContent = "Admin config error: " + (err?.message || String(err));
  } finally {
    unlockButton.disabled = false;
  }
}

function detectEnvironment() {
  const host = globalThis.location.hostname;

  if (host === "www.padelpush.co.za" || host === "padelpush.co.za")
    return "production";
  if (host === "qa.padelpush.co.za") return "staging";

  // Local development instances intentionally use the staging backend.
  // This keeps locally hosted harness sessions safe while exercising the
  // same non-production Firebase project as the QA environment.
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]"
  )
    return "staging";

  return "development";
}

function projectIdForEnvironment() {
  const configs = firebaseEnvironmentConfig.firebaseConfigs || {};
  const config =
    configs[firebaseEnvironmentConfig.activeFirebaseEnvironment] || {};
  return config.projectId || "unknown-project";
}

function postEventUrl() {
  const projectId = projectIdForEnvironment();
  if (!projectId || projectId === "unknown-project") {
    throw new Error(
      "Firebase project ID is not available for the active environment.",
    );
  }
  return "https://africa-south1-" + projectId + ".cloudfunctions.net/postEvent";
}

function firebaseEnvironmentMatchesHost() {
  const configured = firebaseEnvironmentConfig.activeFirebaseEnvironment;
  if (state.environment === "production") return configured === "production";
  if (state.environment === "staging") return configured === "staging";
  return true;
}

function formatTime(value) {
  if (!value) return "—";
  if (typeof value?.toDate === "function")
    return value.toDate().toLocaleTimeString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString();
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = typeof value?.toDate === "function"
    ? value.toDate()
    : value instanceof Date
      ? value
      : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function deviceActivityFor(deviceId) {
  const entries = state.trace.filter(
    (entry) => entry.request?.body?.deviceId === deviceId,
  );

  const lastEvent = entries.find(
    (entry) =>
      entry.direction === "OUT →" &&
      typeof entry.request?.body?.eventType === "string" &&
      entry.request.body.eventType.length > 0,
  ) || null;

  const lastError = entries.find((entry) => {
    if (entry.direction !== "IN ←") return false;
    if (entry.code === "ERROR" || entry.code === "TIMEOUT") return true;

    const status = Number(entry.response?.status ?? entry.code);
    const responseBody = entry.response?.body;
    return (
      status >= 400 ||
      entry.simulator?.failureMode === "malformed" ||
      Boolean(entry.response?.error) ||
      (responseBody !== null &&
        typeof responseBody === "object" &&
        (responseBody.success === false || Boolean(responseBody.error)))
    );
  }) || null;

  return { lastEvent, lastError };
}

function lastErrorDescription(entry) {
  if (!entry) return "No errors recorded this session";
  if (entry.simulator?.failureMode === "malformed") {
    return "Malformed JSON response";
  }
  const body = entry.response?.body;
  const detail =
    entry.response?.error ||
    (body && typeof body === "object" ? body.error : null) ||
    (entry.code === "TIMEOUT" ? "Request timed out" : null) ||
    entry.detail ||
    entry.summary;
  return String(detail || entry.summary);
}

function formatJson(value) {
  return JSON.stringify(value, null, 2);
}

function newId(prefix = "trace") {
  return prefix + "-" + Math.random().toString(36).slice(2, 10);
}

function currentDevice() {
  return state.devices.find((d) => d.id === state.selectedDeviceId) || null;
}

function currentCourt() {
  return state.courts.find((c) => c.id === state.selectedCourtId) || null;
}

function currentLocalState() {
  const device = currentDevice();
  if (!device) return null;
  if (!state.localStates.has(device.id)) {
    state.localStates.set(
      device.id,
      createInitialLocalState(normaliseSku(device.deviceSKU)),
    );
  }
  return state.localStates.get(device.id);
}

function canMutate() {
  if (state.environmentMismatch) return false;
  return state.environment !== "production" || state.productionEnabled;
}

function requireMutationAccess() {
  if (state.environmentMismatch) {
    showToast(
      "Device Lab mutations are blocked because the Firebase environment does not match this hostname.",
      "error",
    );
    return false;
  }
  if (canMutate()) return true;
  showToast(
    "Production mutations are locked. Enable production mutations first.",
    "error",
  );
  return false;
}

function getFocusableElements(container) {
  return Array.from(
    container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => {
    const style = globalThis.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function focusDialogElement(dialog, preferredSelector = "") {
  queueMicrotask(() => {
    const preferred = preferredSelector
      ? dialog.querySelector(preferredSelector)
      : null;
    const target = preferred || getFocusableElements(dialog)[0];
    target?.focus();
  });
}

function registerDialogAccessibility(dialog) {
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusables = getFocusableElements(dialog);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  dialog.addEventListener("close", () => {
    const opener = dialog.__returnFocusElement;
    dialog.__returnFocusElement = null;
    if (opener?.isConnected) {
      queueMicrotask(() => opener.focus());
    }
  });
}

function openHarnessDialog(dialog, preferredSelector = "") {
  dialog.__returnFocusElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  dialog.showModal();
  focusDialogElement(dialog, preferredSelector);
}

function registerGateAccessibility(gate, preferredSelector = "") {
  gate.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusables = getFocusableElements(gate);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  gate.__focusPreferredSelector = preferredSelector;
}

function focusGate(gate) {
  const preferred = gate.__focusPreferredSelector
    ? gate.querySelector(gate.__focusPreferredSelector)
    : null;
  (preferred || getFocusableElements(gate)[0])?.focus();
}

function updateProductionGate() {
  const gate = $("productionGate");
  const warning = $("productionGateWarning");
  const ack = $("productionAck");
  const enableButton = $("productionEnableBtn");
  const isProduction = state.environment === "production";
  const mismatch = state.environmentMismatch;

  gate.classList.toggle("hidden", !isProduction && !mismatch);
  warning.classList.toggle("hidden", !mismatch);

  if (mismatch) {
    $("productionGateEyebrow").textContent = "CONFIGURATION BLOCKED";
    $("productionGateTitle").textContent = "Environment configuration mismatch";
    $("productionGateDescription").textContent =
      "The Device Lab cannot safely send mutations because the hostname and active Firebase environment do not match.";
    warning.textContent =
      "Correct the Firebase environment configuration before using the Device Lab. Mutation controls remain disabled until the mismatch is resolved.";
    ack.checked = false;
    ack.disabled = true;
    enableButton.disabled = true;
    return;
  }

  $("productionGateEyebrow").textContent = "LIVE PRODUCTION";
  $("productionGateTitle").textContent = "Production device simulation";
  $("productionGateDescription").textContent =
    "The Device Lab will send real device events into the production Padel Push backend and can change live court state.";
  warning.textContent = "";
  ack.disabled = false;
  enableButton.disabled = !ack.checked;
}

function openProductionGateIfNeeded() {
  const shouldShow =
    state.environment === "production" || state.environmentMismatch;
  $("productionGate").classList.toggle("hidden", !shouldShow);
  if (shouldShow) {
    updateProductionGate();
    requestAnimationFrame(() => focusGate($("productionGate")));
  }
}

function showToast(message, type = "info") {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast " + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2800);
}

async function loadClubs() {
  const snapshot = await getDocs(collection(db, "clubs"));
  state.clubs = snapshot.docs.map((item) => ({
    id: item.id,
    ...item.data(),
  }));
  state.clubByCourtId = new Map();
  state.clubByDeviceId = new Map();

  state.clubs.forEach((club) => {
    (club.courtIds || []).forEach((courtId) => {
      state.clubByCourtId.set(courtId, club);
    });
    (club.deviceIds || []).forEach((deviceId) => {
      state.clubByDeviceId.set(deviceId, club);
    });
  });
}

function clubForCourt(courtId) {
  return courtId ? state.clubByCourtId.get(courtId) || null : null;
}

function clubForDevice(device) {
  return (
    (device?.clubId ? state.clubs.find((club) => club.id === device.clubId) : null) ||
    state.clubByDeviceId.get(device?.id) ||
    clubForCourt(device?.courtId) ||
    null
  );
}

async function loadCourts() {
  state.courtsLoading = true;
  renderCourtSelectors();

  try {
    if (state.clubs.length === 0) await loadClubs();
    const snapshot = await getDocs(collection(db, "courts"));
    state.courts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    state.courts.sort((a, b) => a.id.localeCompare(b.id));
    renderCourtSelectors();
    renderDeviceList();
    renderSelectedDevice();
    if (state.selectedCourtId) renderCourtState({ court: currentCourt() });
  } finally {
    state.courtsLoading = false;
    renderCourtSelectors();
    renderDeviceList();
    renderSelectedDevice();
  }
}

async function loadDevices() {
  state.devicesLoading = true;
  renderDeviceList();

  try {
    const snapshot = await getDocs(collection(db, "devices"));
    state.devices = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    state.devices.sort((a, b) => a.id.localeCompare(b.id));
    if (state.selectedDeviceId && !state.devices.some((item) => item.id === state.selectedDeviceId)) {
      state.selectedDeviceId = null;
    }
    renderDeviceList();
    renderSelectedDevice();
  } finally {
    state.devicesLoading = false;
    renderDeviceList();
    ensureSelectedDeviceVisible();
  }
}

function renderCourtSelectors() {
  const current = state.selectedCourtId;
  const allCourts = state.courts.slice();
  if (current && !allCourts.some((court) => court.id === current) && !state.courtsLoading) {
    allCourts.push({ id: current, name: current });
  }

  const filterCourts = (courts, search) => {
    const normalizedSearch = String(search || "").trim().toLocaleLowerCase();
    let visible = normalizedSearch
      ? courts.filter((court) =>
          (String(court.name || "") + " " + String(court.id || ""))
            .toLocaleLowerCase()
            .includes(normalizedSearch),
        )
      : courts.slice();

    // Preserve the selected court in the list even while the search is being edited.
    const selectedId = arguments.length > 2 ? arguments[2] : "";
    if (selectedId && !visible.some((court) => court.id === selectedId)) {
      const selected = courts.find((court) => court.id === selectedId);
      if (selected) visible.unshift(selected);
    }
    return visible;
  };

  const search = String(state.courtSearch || "").trim().toLocaleLowerCase();
  let visibleCourts = search
    ? allCourts.filter((court) =>
        (String(court.name || "") + " " + String(court.id || "")).toLocaleLowerCase().includes(search),
      )
    : allCourts.slice();
  if (current && !visibleCourts.some((court) => court.id === current)) {
    const selected = allCourts.find((court) => court.id === current);
    if (selected) visibleCourts.unshift(selected);
  }

  const modalCurrent = state.virtualDeviceCourtId ?? state.selectedCourtId ?? "";
  const modalCourts = state.courts.slice();
  if (modalCurrent && !modalCourts.some((court) => court.id === modalCurrent) && !state.courtsLoading) {
    modalCourts.push({ id: modalCurrent, name: modalCurrent });
  }
  const modalSearch = String(state.virtualDeviceCourtSearch || "").trim().toLocaleLowerCase();
  let visibleModalCourts = modalSearch
    ? modalCourts.filter((court) =>
        (String(court.name || "") + " " + String(court.id || "")).toLocaleLowerCase().includes(modalSearch),
      )
    : modalCourts.slice();
  if (modalCurrent && !visibleModalCourts.some((court) => court.id === modalCurrent)) {
    const selected = modalCourts.find((court) => court.id === modalCurrent);
    if (selected) visibleModalCourts.unshift(selected);
  }

  const courtOption = (court) =>
    '<option value="' + escapeHtml(court.id) + '">' +
    escapeHtml(court.name || court.id) + " · " + escapeHtml(court.id) + "</option>";

  const mainPlaceholder = state.courtsLoading
    ? "Loading courts…"
    : !state.courts.length
      ? "No courts available"
      : search && visibleCourts.length === 0
        ? "No matching courts"
        : "Select a court…";
  $("courtSelect").innerHTML =
    '<option value="">' + mainPlaceholder + "</option>" + visibleCourts.map(courtOption).join("");
  $("courtSelect").value = current || "";
  $("courtSelect").disabled = state.courtsLoading || visibleCourts.length === 0;
  $("courtSearch").disabled = state.courtsLoading || state.courts.length === 0;
  $("courtLoadingSpinner").classList.toggle("hidden", !state.courtsLoading);
  $("courtCount").textContent = search
    ? visibleCourts.length + (visibleCourts.length === 1 ? " matching court" : " matching courts")
    : visibleCourts.length + (visibleCourts.length === 1 ? " court" : " courts");

  const modalPlaceholder = state.courtsLoading
    ? "Loading courts…"
    : !state.courts.length
      ? "No courts available"
      : modalSearch && visibleModalCourts.length === 0
        ? "No matching courts"
        : "Select a court…";
  $("virtualDeviceCourt").innerHTML =
    '<option value="">' + modalPlaceholder + "</option>" +
    visibleModalCourts.map(courtOption).join("");
  $("virtualDeviceCourt").value = modalCurrent || "";
  $("virtualDeviceCourt").disabled = state.courtsLoading || visibleModalCourts.length === 0;
  $("virtualDeviceCourtSearch").disabled = state.courtsLoading || state.courts.length === 0;
  $("virtualDeviceCourtCount").textContent = modalSearch
    ? visibleModalCourts.length + (visibleModalCourts.length === 1 ? " matching court" : " matching courts")
    : visibleModalCourts.length + (visibleModalCourts.length === 1 ? " court" : " courts");
}

function renderDeviceList() {
  const search = String(state.deviceSearch || "").trim().toLocaleLowerCase();
  const matchesSearch = (device) => {
    if (!search) return true;
    const court = state.courts.find((item) => item.id === device.courtId);
    const searchText = [
      device.id,
      device.deviceSKU,
      normaliseSku(device.deviceSKU),
      device.courtId,
      court?.name,
      device.simulatorProfile,
      device.isVirtual === true ? "virtual" : "physical",
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    return searchText.includes(search);
  };

  const allPhysical = state.devices.filter((device) => device.isVirtual !== true);
  const allVirtual = state.devices.filter((device) => device.isVirtual === true);
  const physical = allPhysical.filter(matchesSearch);
  const virtual = allVirtual.filter(matchesSearch);
  $("deviceCount").textContent = state.devicesLoading ? "…" : String(state.devices.length);
  $("physicalDeviceCount").textContent = state.devicesLoading ? "…" : String(allPhysical.length);
  $("virtualDeviceCount").textContent = state.devicesLoading ? "…" : String(allVirtual.length);

  const loadingMarkup = (label) =>
    '<div class="loading-state" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><span>' +
    escapeHtml(label) + "</span></div>";
  const renderCard = (device) => {
    const sku = normaliseSku(device.deviceSKU);
    const virtualDevice = device.isVirtual === true;
    const deviceCourt = state.courts.find((court) => court.id === device.courtId);
    const courtLabel = device.courtId
      ? (deviceCourt ? (deviceCourt.name || deviceCourt.id) + " · " + deviceCourt.id : "Court " + device.courtId)
      : "No court assigned";
    return (
      '<button class="device-item ' +
      (device.id === state.selectedDeviceId ? "selected" : "") +
      '" data-device-id="' + escapeHtml(device.id) + '">' +
      '<div class="device-item-top"><span class="device-item-name">' + escapeHtml(device.id) +
      '</span><span class="device-dot"></span></div>' +
      '<div class="device-item-meta">' + escapeHtml(courtLabel) + "</div>" +
      '<span class="device-type-badge ' + (virtualDevice ? "virtual" : "physical") + '">' +
      escapeHtml(sku === "Hub" ? "HUB" : sku) + "</span></button>"
    );
  };

  const emptyMessage = (type, allDevices) => search
    ? '<div class="hint device-group-empty">No ' + type + ' devices match “' + escapeHtml(state.deviceSearch) + '”.</div>'
    : '<div class="hint device-group-empty">No ' + type + ' devices registered.</div>';

  $("physicalDeviceList").innerHTML = state.devicesLoading
    ? loadingMarkup("Loading physical devices…")
    : physical.length
      ? physical.map(renderCard).join("")
      : emptyMessage("physical", allPhysical);
  $("virtualDeviceList").innerHTML = state.devicesLoading
    ? loadingMarkup("Loading virtual devices…")
    : virtual.length
      ? virtual.map(renderCard).join("")
      : emptyMessage("virtual", allVirtual);

  document.querySelectorAll("[data-device-id]").forEach((button) => {
    button.addEventListener("click", () => selectDevice(button.dataset.deviceId));
  });
}

function ensureSelectedDeviceVisible() {
  const selected = document.querySelector("[data-device-id].selected");
  selected?.scrollIntoView({ block: "nearest" });
}

function updateDeviceListToggle() {
  const toggle = $("deviceListToggle");
  const list = $("deviceList");
  if (!toggle || !list) return;

  if (globalThis.matchMedia("(max-width: 820px)").matches) {
    const expanded = !list.classList.contains("is-collapsed");
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.textContent = expanded ? "Hide list" : "Show list";
    return;
  }

  list.classList.remove("is-collapsed");
  toggle.setAttribute("aria-expanded", "true");
  toggle.textContent = "Hide list";
}

async function selectDevice(deviceId) {
  const device = state.devices.find((item) => item.id === deviceId);
  if (!device) return;
  state.selectedDeviceId = deviceId;
  if (!state.localStates.has(device.id)) {
    state.localStates.set(device.id, createInitialLocalState(normaliseSku(device.deviceSKU)));
  }
  renderAll();
  requestAnimationFrame(ensureSelectedDeviceVisible);
}

function selectCourt(courtId) {
  if (state.selectedCourtUnsub) state.selectedCourtUnsub();
  if (state.selectedScoreUnsub) state.selectedScoreUnsub();
  if (state.selectedEventsUnsub) state.selectedEventsUnsub();
  state.selectedCourtUnsub = null;
  state.selectedScoreUnsub = null;
  state.selectedEventsUnsub = null;

  state.selectedCourtId = courtId || null;
  state.courtSearch = "";
  $("courtSearch").value = "";
  state.courtDetailsLoading = Boolean(courtId);
  state.scoreLoading = Boolean(courtId);
  state.eventsLoading = Boolean(courtId);
  state.currentScore = null;
  state.selectedMatchId = null;
  renderCourtSelectors();

  if (!courtId) {
    state.courtDetailsLoading = false;
    state.scoreLoading = false;
    state.eventsLoading = false;
    renderAll();
    renderCourtEvents([]);
    return;
  }

  const courtRef = doc(db, "courts", courtId);
  let followedMatchId;
  const followMatch = (matchId) => {
    if (state.selectedCourtId !== courtId || matchId === followedMatchId) return;
    followedMatchId = matchId;
    state.selectedMatchId = matchId || null;
    if (state.selectedScoreUnsub) state.selectedScoreUnsub();
    if (state.selectedEventsUnsub) state.selectedEventsUnsub();
    state.selectedScoreUnsub = null;
    state.selectedEventsUnsub = null;
    state.currentScore = null;

    if (!matchId) {
      state.scoreLoading = false;
      state.eventsLoading = false;
      renderCourtState();
      renderCourtEvents([]);
      return;
    }

    state.scoreLoading = true;
    state.eventsLoading = true;
    renderCourtState();
    renderCourtEvents([]);
    const scoreRef = doc(db, "matches", matchId, "score", "current");
    const eventQuery = query(collection(db, "matches", matchId, "events"), orderBy("createdAt", "desc"), limit(20));

    state.selectedScoreUnsub = onSnapshot(
      scoreRef,
      (snap) => {
        if (state.selectedCourtId !== courtId || state.selectedMatchId !== matchId) return;
        state.currentScore = snap.exists() ? snap.data() : null;
        state.scoreLoading = false;
        renderCourtState();
      },
      () => {
        if (state.selectedCourtId !== courtId || state.selectedMatchId !== matchId) return;
        state.currentScore = null;
        state.scoreLoading = false;
        renderCourtState();
      },
    );
    state.selectedEventsUnsub = onSnapshot(
      eventQuery,
      (snap) => {
        if (state.selectedCourtId !== courtId || state.selectedMatchId !== matchId) return;
        state.eventsLoading = false;
        renderCourtEvents(snap.docs.map((item) => ({ id: item.id, ...item.data() })));
      },
      () => {
        if (state.selectedCourtId !== courtId || state.selectedMatchId !== matchId) return;
        state.eventsLoading = false;
        renderCourtEvents([]);
      },
    );
  };

  state.selectedCourtUnsub = onSnapshot(
    courtRef,
    (snap) => {
      if (state.selectedCourtId !== courtId) return;
      state.courtDetailsLoading = false;
      if (snap.exists()) {
        const index = state.courts.findIndex((item) => item.id === courtId);
        const updated = { id: courtId, ...snap.data() };
        if (index >= 0) state.courts[index] = updated;
        else state.courts.push(updated);
        state.courts.sort((a, b) => a.id.localeCompare(b.id));
        renderCourtSelectors();
        renderDeviceList();
        renderCourtState({ court: updated });
      } else {
        renderCourtState();
      }
      const data = snap.exists() ? snap.data() : {};
      followMatch(data.activeMatchId || data.lastMatchId || null);
    },
    () => {
      if (state.selectedCourtId !== courtId) return;
      state.courtDetailsLoading = false;
      state.scoreLoading = false;
      state.eventsLoading = false;
      renderCourtState();
      renderCourtEvents([]);
    },
  );

  renderAll();
  renderCourtEvents([]);
}

function renderAll() {
  renderDeviceList();
  renderSelectedDevice();
  renderCourtState({});
  updateEnvironmentUi();
}

function updateViewCourtInfoButton(device = currentDevice()) {
  const button = $("viewCourtInfoBtn");
  if (!button) return;
  const enabled = Boolean(device && device.courtId);
  button.disabled = !enabled;
  button.setAttribute("aria-disabled", String(!enabled));
  button.title = enabled ? "Load the court assigned to this device" : "Select a device with an assigned court";
}

function renderDeviceActivity() {
  const container = $("deviceActivity");
  if (!container) return;

  const device = currentDevice();
  if (!device) {
    container.innerHTML =
      '<div class="panel-empty-state device-activity-empty">Select a device to view its latest event and error.</div>';
    return;
  }

  const { lastEvent, lastError } = deviceActivityFor(device.id);
  const cards = [
    {
      label: "Last event",
      value: lastEvent
        ? String(lastEvent.request?.body?.eventType || lastEvent.summary || "Unknown event")
        : "No events recorded this session",
      timestamp: lastEvent ? formatTimestamp(lastEvent.startedAt) : "",
    },
    {
      label: "Last error",
      value: lastError
        ? lastErrorDescription(lastError)
        : "No errors recorded this session",
      timestamp: lastError ? formatTimestamp(lastError.startedAt) : "",
    },
  ];

  container.innerHTML = cards.map((card) =>
    '<div class="device-activity-card">' +
      '<div class="device-activity-label">' + escapeHtml(card.label) + '</div>' +
      '<div class="device-activity-value">' + escapeHtml(card.value) + '</div>' +
      (card.timestamp
        ? '<div class="device-activity-time">' + escapeHtml(card.timestamp) + '</div>'
        : '') +
    '</div>',
  ).join("");
}

function renderSelectedDevice() {
  const device = currentDevice();
  updateViewCourtInfoButton(device);
  renderDeviceActivity();
  if (!device) {
    $("selectedDeviceValue").textContent = "—";
    $("deviceTitle").textContent = "No device selected";
    $("deviceStatus").textContent = "—";
    $("deviceStatus").className = "status-pill";
    $("deviceIdentity").innerHTML = '<div class="panel-empty-state">Select a device to inspect its identity and configuration.</div>';
    $("deviceControls").innerHTML = '<div class="panel-empty-state">Select a device to view its available controls.</div>';
    $("localStatePanel").innerHTML = '<div class="panel-empty-state">Local simulator state appears after you select a device.</div>';
    $("controlHint").textContent = "";
    return;
  }

  const sku = normaliseSku(device.deviceSKU);
  const profile = DEVICE_PROFILES[sku];
  $("selectedDeviceValue").textContent = device.id;
  $("deviceTitle").textContent = profile.label;
  $("deviceStatus").textContent = device.disabled === true ? "DISABLED" : "READY";
  $("deviceStatus").className = "status-pill " + (device.disabled === true ? "disabled" : "");

  const deviceCourt = state.courts.find((court) => court.id === device.courtId);
  const deviceClub = clubForDevice(device);
  const fields = [
    ["Device ID", device.id],
    ["Device type / SKU", device.deviceSKU || "Not provisioned"],
    ["Assigned court", deviceCourt ? (deviceCourt.name || deviceCourt.id) + " · " + deviceCourt.id : device.courtId ? "Court unavailable · " + device.courtId : "Unassigned"],
    ["Club", deviceClub ? (deviceClub.name || deviceClub.id) + " · " + deviceClub.id : "Unassigned"],
    ["Club state", deviceClub?.state || "—"],
    ["Device kind", device.isVirtual === true ? "Virtual" : "Physical"],
    ["Simulator profile", device.simulatorProfile || profile.label],
    ["Firmware version", device.firmwareVersion || "Not recorded"],
    ["Created", formatTimestamp(device.createdAt)],
  ];

  $("deviceIdentity").innerHTML = fields.map(
    ([label, value]) =>
      '<div class="identity-cell"><div class="identity-label">' + escapeHtml(label) +
      '</div><div class="identity-value">' + escapeHtml(String(value)) + "</div></div>",
  ).join("");

  const local = currentLocalState();
  $("localStatePanel").innerHTML = Object.entries(local || {}).map(
    ([label, value]) =>
      '<div class="state-cell"><div class="state-label">' + escapeHtml(label) +
      '</div><div class="state-value">' + escapeHtml(String(value)) + "</div></div>",
  ).join("");

  $("deviceControls").innerHTML = profile.controls.map(
    (control) =>
      '<button class="control-btn" data-control="' + escapeHtml(control.id) + '">' +
      '<span class="control-btn-title">' + escapeHtml(control.label) + "</span>" +
      '<span class="control-btn-hint">' + escapeHtml(control.hint) + "</span></button>",
  ).join("");

  $("controlHint").textContent = device.isVirtual === true
    ? "Virtual device. Actions use the real backend."
    : "Registered physical device record. This simulator can exercise its backend binding too.";
  document.querySelectorAll("[data-control]").forEach((button) => {
    button.addEventListener("click", () => handleDeviceControl(button.dataset.control));
  });
}

function loadingMarkup(label) {
  return '<div class="loading-state" role="status" aria-live="polite">' +
    '<span class="spinner" aria-hidden="true"></span><span>' + escapeHtml(label) + "</span></div>";
}

function renderCourtState({ court } = {}) {
  const mergedCourt = court || currentCourt();
  if (!state.selectedCourtId) {
    $("courtTitle").textContent = "No court selected";
    $("selectedCourtValue").textContent = "—";
    $("selectedClubValue").textContent = "—";
    $("courtMeta").textContent = "Select a court, or use View Court Info on an assigned device.";
    $("scoreState").innerHTML = '<div class="panel-empty-state">Select a court to load its live score.</div>';
    $("courtEvents").innerHTML = '<div class="panel-empty-state">Select a court to load recent events.</div>';
    return;
  }

  $("selectedCourtValue").textContent = state.selectedCourtId;
  if (!mergedCourt) {
    $("courtTitle").textContent = state.selectedCourtId;
    $("selectedClubValue").textContent = "—";
    $("courtMeta").innerHTML = state.courtDetailsLoading
      ? loadingMarkup("Loading court information…")
      : '<div class="hint">Court record not found.</div>';
  } else {
    const club = clubForCourt(mergedCourt.id);
    $("selectedClubValue").textContent = club ? (club.name || club.id) : "Unassigned";
    $("courtTitle").textContent = mergedCourt.name || mergedCourt.id;
    const clubLabel = club
      ? (club.name || club.id) + " · " + club.id + " · club " + (club.state || "unknown")
      : "No club assignment";
    const metaText = (mergedCourt.name || mergedCourt.id) + " · " + mergedCourt.id +
      " · club " + clubLabel + " · status " + (mergedCourt.status || "unknown") +
      " · Beacon changeover " + (mergedCourt.beaconSidesSwapped === true ? "ACTIVE" : "off");
    $("courtMeta").innerHTML = state.courtDetailsLoading ? loadingMarkup("Refreshing court information…") : "";
    if (!state.courtDetailsLoading) $("courtMeta").textContent = metaText;
  }

  if (state.scoreLoading) {
    $("scoreState").innerHTML = loadingMarkup("Loading live score…");
  } else if (!state.selectedMatchId) {
    $("scoreState").innerHTML = '<div class="panel-empty-state">No active match on this court.</div>';
  } else if (!state.currentScore) {
    $("scoreState").innerHTML = '<div class="panel-empty-state">No score snapshot available for this match.</div>';
  } else {
    const score = state.currentScore, teamA = score.A || {}, teamB = score.B || {}, courtData = mergedCourt || {};
    $("scoreState").innerHTML =
      '<div class="score-card"><div class="score-team">' + escapeHtml(courtData.teamNames?.A || "Team A") +
      '</div><div class="score-points">' + escapeHtml(String(teamA.pointsDisplay ?? teamA.points ?? 0)) +
      '</div><div class="score-games">Games ' + escapeHtml(String(teamA.games ?? 0)) + " · Sets " +
      escapeHtml(String(teamA.sets ?? 0)) + "</div></div>" +
      '<div class="score-card"><div class="score-team">' + escapeHtml(courtData.teamNames?.B || "Team B") +
      '</div><div class="score-points">' + escapeHtml(String(teamB.pointsDisplay ?? teamB.points ?? 0)) +
      '</div><div class="score-games">Games ' + escapeHtml(String(teamB.games ?? 0)) + " · Sets " +
      escapeHtml(String(teamB.sets ?? 0)) + "</div></div>";
  }
}

function renderCourtEvents(events) {
  if (state.eventsLoading) {
    $("courtEvents").innerHTML = loadingMarkup("Loading recent court events…");
    return;
  }
  if (!state.selectedCourtId) {
    $("courtEvents").innerHTML =
      '<div class="panel-empty-state">Select a court to load recent events.</div>';
    return;
  }
  if (!state.selectedMatchId) {
    $("courtEvents").innerHTML =
      '<div class="panel-empty-state">No active match on this court.</div>';
    return;
  }

  $("courtEvents").innerHTML = events.length
    ? events.map((event) => `
        <div class="event-row">
          <div class="event-main">
            <div class="event-type">${escapeHtml(event.eventType || "UNKNOWN")}</div>
            <div class="event-meta">
              ${escapeHtml(formatTime(event.createdAt))} ·
              ${escapeHtml(event.actorDeviceId || event.createdBy || "unknown")}
            </div>
          </div>
          <div class="event-badge">${escapeHtml(String(event.id || "").slice(0, 10))}</div>
        </div>
      `).join("")
    : '<div class="hint">No events yet.</div>';
}

function updateEnvironmentUi() {
  const mismatch = !firebaseEnvironmentMatchesHost();
  const mismatchChanged = mismatch !== state.environmentMismatch;
  state.environmentMismatch = mismatch;

  $("envValue").textContent = state.environment.toUpperCase();
  $("environmentBadge").textContent = mismatch
    ? state.environment.toUpperCase() + " · CONFIG MISMATCH"
    : state.environment.toUpperCase();
  $("environmentBadge").className =
    "env-badge " + state.environment + (mismatch ? " mismatch" : "");
  $("environmentBadge").title = mismatch
    ? "Mutations blocked: Firebase environment does not match this hostname."
    : "Firebase environment: " +
      String(firebaseEnvironmentConfig.activeFirebaseEnvironment || "unknown");

  if (mismatchChanged && mismatch) {
    showToast(
      "Firebase environment config does not match this hostname. Mutations are blocked.",
      "error",
    );
  }

  updateProductionGate();
}

function addTrace(entry) {
  state.trace.unshift(entry);
  state.trace = state.trace.slice(0, 250);
  state.selectedTraceId = entry.id;
  renderDeviceActivity();
  renderTrace();
  renderExchange(entry);
}

function renderTrace() {
  $("traceList").innerHTML = state.trace.length
    ? state.trace
        .map(
          (entry) =>
            '<button class="trace-row ' +
            (entry.id === state.selectedTraceId ? "selected" : "") +
            '" data-trace-id="' +
            escapeHtml(entry.id) +
            '">' +
            '<span class="trace-time">' +
            escapeHtml(formatTime(entry.startedAt)) +
            "</span>" +
            '<span class="trace-kind">' +
            escapeHtml(entry.direction) +
            "</span>" +
            '<span class="trace-summary"><strong>' +
            escapeHtml(entry.summary) +
            "</strong><span>" +
            escapeHtml(entry.detail || "") +
            "</span></span>" +
            '<span class="trace-code ' +
            traceCodeClass(entry.code) +
            '">' +
            escapeHtml(String(entry.code || "—")) +
            "</span></button>",
        )
        .join("")
    : '<div class="hint" style="padding:20px;">No requests yet.</div>';
  document.querySelectorAll("[data-trace-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTraceId = button.dataset.traceId;
      renderTrace();
      const entry = state.trace.find(
        (item) => item.id === state.selectedTraceId,
      );
      if (entry) renderExchange(entry);
    });
  });
}

function renderExchange(entry) {
  $("selectedTraceTime").textContent = formatTime(entry.startedAt);
  $("exchangeDetail").textContent = formatJson({
    request: entry.request,
    response: entry.response,
    simulator: entry.simulator,
  });
}

function traceCodeClass(code) {
  const n = Number(code);
  if ((n >= 200 && n < 300) || code === "ACK") return "ok";
  if (n >= 500 || code === "ERROR" || code === "TIMEOUT") return "error";
  return "warn";
}

async function executeDeviceRequest(body, label) {
  if (!requireMutationAccess()) return null;

  const injection = state.failure.armed
    ? { ...state.failure }
    : {
        mode: "none",
        latencyMs: state.failure.latencyMs,
        timeoutMs: state.failure.timeoutMs,
        armed: false,
      };
  const attempts = 2;
  let finalResult = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = new Date();
    const traceId = newId();
    const request = {
      method: "POST",
      url: postEventUrl(),
      headers: { "Content-Type": "application/json" },
      body,
    };
    const baseTrace = {
      id: traceId,
      startedAt,
      direction: "OUT →",
      summary: label + " · attempt " + attempt + "/" + attempts,
      detail: body.eventType + " · " + body.deviceId,
      code: "—",
      request,
      simulator: {
        environment: state.environment,
        failureMode: injection.mode,
        attempt,
      },
    };
    addTrace(baseTrace);

    try {
      const response = await transportRequest(body, injection);
      const payload = await parseResponse(
        response,
        injection.mode === "malformed",
      );
      const entry = {
        ...baseTrace,
        direction: "IN ←",
        summary: label + " response · attempt " + attempt + "/" + attempts,
        detail: response.synthetic ? "Injected response" : response.url,
        code: response.status,
        request,
        response: {
          status: response.status,
          headers: response.headers,
          body: payload,
        },
        simulator: {
          environment: state.environment,
          failureMode: injection.mode,
          attempt,
        },
      };
      addTrace(entry);
      finalResult = { response, payload };

      if (response.status >= 200 && response.status < 300) {
        break;
      }
    } catch (error) {
      const code = error?.name === "AbortError" ? "TIMEOUT" : "ERROR";
      const entry = {
        ...baseTrace,
        direction: "IN ←",
        summary:
          label + " network failure · attempt " + attempt + "/" + attempts,
        detail: error?.message || String(error),
        code,
        response: {
          status: null,
          body: null,
          error: error?.message || String(error),
        },
        simulator: {
          environment: state.environment,
          failureMode: injection.mode,
          attempt,
        },
      };
      addTrace(entry);
      finalResult = { error };
    }

    if (attempt < attempts) {
      const retryEntry = {
        id: newId("retry"),
        startedAt: new Date(),
        direction: "RETRY ↻",
        summary: label + " · firmware-style retry",
        detail: "The physical firmware retries once after a failed POST.",
        code: "RETRY",
        request,
        response: null,
        simulator: { retryOf: traceId, failureMode: injection.mode },
      };
      addTrace(retryEntry);
    }
  }

  state.failure.mode = "none";
  state.failure.armed = false;
  $("failNextBtn").textContent = "Arm next failure";
  updateFailureUi();
  if (finalResult?.payload?.eventId) {
    await waitForEventPropagation(finalResult.payload.eventId);
  }
  await loadDevices();
  return finalResult;
}

async function transportRequest(body, injection) {
  if (injection.mode === "latency") {
    await delay(injection.latencyMs);
  }

  if (injection.mode === "connection_reset") {
    throw new Error(
      "Simulated connection reset before the request reached the backend.",
    );
  }

  if (injection.mode === "http_500") {
    return syntheticResponse(500, {
      success: false,
      error: "Simulated HTTP 500",
    });
  }
  if (injection.mode === "http_401") {
    return syntheticResponse(401, {
      success: false,
      error: "Simulated HTTP 401",
    });
  }
  if (injection.mode === "http_403") {
    return syntheticResponse(403, {
      success: false,
      error: "Simulated HTTP 403",
    });
  }

  const controller = new AbortController();
  let timer = null;
  if (injection.mode === "timeout") {
    timer = setTimeout(
      () => controller.abort(),
      Number(injection.timeoutMs) || 3000,
    );
  }

  const response = await fetch(postEventUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: controller.signal,
    cache: "no-store",
  });
  if (timer) clearTimeout(timer);

  if (injection.mode === "duplicate") {
    const duplicate = await fetch(postEventUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    addTrace({
      id: newId("duplicate"),
      startedAt: new Date(),
      direction: "DUPLICATE ↻",
      summary: "Duplicate request",
      detail: "Second identical POST was sent to the real backend.",
      code: duplicate.status,
      request: {
        method: "POST",
        url: postEventUrl(),
        headers: { "Content-Type": "application/json" },
        body,
      },
      response: {
        status: duplicate.status,
        body: await duplicate.json().catch(() => null),
      },
      simulator: {
        environment: state.environment,
        failureMode: injection.mode,
      },
    });
  }

  return response;
}

function syntheticResponse(status, body) {
  return {
    synthetic: true,
    status,
    url: globalThis.location.origin + "/device-api/postEvent",
    headers: { "content-type": "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

async function parseResponse(response, malformed) {
  if (malformed) return "{ simulated malformed response";
  return response.json();
}

async function waitForEventPropagation(eventId) {
  if (!eventId) return;
  addTrace({
    id: newId("firestore"),
    startedAt: new Date(),
    direction: "FIRESTORE",
    summary: "Event accepted by backend",
    detail: "Watching court event stream for " + eventId,
    code: "ACK",
    request: null,
    response: null,
    simulator: { eventId },
  });
}

async function handleDeviceControl(controlId) {
  const device = currentDevice();
  if (!device) return;
  const sku = normaliseSku(device.deviceSKU);
  const local = currentLocalState();

  if (controlId === "factoryReset") {
    local.wifiConnected = false;
    if (sku === "Pulse") local.currentTeam = "A";
    if (sku === "Beacon") {
      local.distanceCm = 50;
      local.hasTriggered = false;
    }
    addTrace({
      id: newId("local"),
      startedAt: new Date(),
      direction: "LOCAL",
      summary: sku + " factory reset",
      detail: "Local simulator state reset; no backend request was made.",
      code: "LOCAL",
      request: null,
      response: null,
      simulator: { environment: state.environment },
    });
    renderSelectedDevice();
    setTimeout(() => {
      local.wifiConnected = true;
      renderSelectedDevice();
    }, 250);
    return;
  }

  if (sku === "Pulse" && controlId === "switchTeam") {
    local.currentTeam = local.currentTeam === "A" ? "B" : "A";
    local.lastHoldMs = 5000;
    renderSelectedDevice();
    addTrace({
      id: newId("local"),
      startedAt: new Date(),
      direction: "LOCAL",
      summary: "Pulse switched team",
      detail:
        "Local team changed to " + local.currentTeam + ". No backend request.",
      code: "LOCAL",
      request: null,
      response: null,
      simulator: { environment: state.environment },
    });
    return;
  }

  if (sku === "Beacon" && controlId === "clear") {
    local.distanceCm = 50;
    local.hasTriggered = false;
    renderSelectedDevice();
    return;
  }

  if (sku === "Beacon" && (controlId === "pointA" || controlId === "pointB")) {
    const team = controlId.endsWith("A") ? "A" : "B";
    local.selectedTeam = team;
    local.distanceCm = 5;
    local.hasTriggered = true;
    renderSelectedDevice();
    return executeDeviceRequest(
      {
        deviceId: device.id,
        deviceSKU: "Beacon",
        eventType: team === "A" ? "POINT_TEAM_A" : "POINT_TEAM_B",
      },
      "Beacon detection",
    );
  }

  if (sku === "Pulse" && (controlId === "tap" || controlId === "undo")) {
    const eventType =
      controlId === "tap"
        ? local.currentTeam === "A"
          ? "POINT_TEAM_A"
          : "POINT_TEAM_B"
        : "UNDO";
    if (controlId === "undo") local.lastHoldMs = 2000;
    renderSelectedDevice();
    return executeDeviceRequest(
      {
        deviceId: device.id,
        deviceSKU: "Pulse",
        eventType,
      },
      controlId === "tap" ? "Pulse tap" : "Pulse undo",
    );
  }

  if (
    sku === "Hub" &&
    ["pointA", "pointB", "undo", "reset"].includes(controlId)
  ) {
    const eventType = {
      pointA: "POINT_TEAM_A",
      pointB: "POINT_TEAM_B",
      undo: "UNDO",
      reset: "RESET",
    }[controlId];
    return executeDeviceRequest(
      {
        deviceId: device.id,
        deviceSKU: "Hub",
        eventType,
      },
      "Hub " + eventType,
    );
  }

  if (sku === "Hub" && controlId === "nfc") {
    openNfcDialog();
    return;
  }

  if (sku === "Hub" && (controlId === "spectate" || controlId === "register")) {
    openOperationalDialog(controlId);
  }
}

function openNfcDialog() {
  $("actionDialogTitle").textContent = "Inject Hub NFC tag";
  $("actionDialogBody").innerHTML =
    '<label class="dialog-copy">Tag payload<input id="nfcPayload" class="text-input" value="EVENT: POINT_TEAM_A" /></label>' +
    '<div class="dialog-copy">The simulator applies the same EVENT / COURTID / DEVICEID field convention used by the Hub firmware.</div>';
  $("actionConfirmBtn").textContent = "Scan tag";
  openHarnessDialog($("actionDialog"), "#nfcPayload");
  $("actionConfirmBtn").onclick = (event) => {
    event.preventDefault();
    const payload = $("nfcPayload").value.trim();
    const eventType = extractTagField(payload, "EVENT") || payload;
    const device = currentDevice();
    if (!device) return;
    const normalized = eventType.toUpperCase();
    const supported = ["POINT_TEAM_A", "POINT_TEAM_B", "UNDO", "RESET"];
    if (!supported.includes(normalized)) {
      showToast(
        "This simple NFC action expects a scoring event. Use SPECTATE or REGISTER directly from the device controls.",
        "error",
      );
      return;
    }
    $("actionDialog").close();
    void executeDeviceRequest(
      { deviceId: device.id, deviceSKU: "Hub", eventType: normalized },
      "Hub NFC scan",
    );
  };
}

function openOperationalDialog(controlId) {
  const device = currentDevice();
  if (!device) return;
  if (controlId === "spectate") {
    $("actionDialogTitle").textContent = "Hub → Spectate court";
    $("actionDialogBody").innerHTML =
      '<label>Target court<select id="actionCourtSelect" class="select">' +
      state.courts
        .map(
          (court) =>
            '<option value="' +
            escapeHtml(court.id) +
            '">' +
            escapeHtml(court.name || court.id) +
            " · " +
            escapeHtml(court.id) +
            "</option>",
        )
        .join("") +
      "</select></label>";
    $("actionConfirmBtn").textContent = "Send SPECTATE";
    $("actionConfirmBtn").onclick = (event) => {
      event.preventDefault();
      const targetCourtId = $("actionCourtSelect").value;
      $("actionDialog").close();
      void executeDeviceRequest(
        {
          deviceId: device.id,
          deviceSKU: "Hub",
          eventType: "SPECTATE",
          courtId: targetCourtId,
        },
        "Hub SPECTATE",
      );
    };
  } else {
    $("actionDialogTitle").textContent = "Hub → Register device";
    $("actionDialogBody").innerHTML =
      '<label>Device to register<select id="actionDeviceSelect" class="select">' +
      state.devices
        .filter((item) => item.id !== device.id)
        .map(
          (item) =>
            '<option value="' +
            escapeHtml(item.id) +
            '">' +
            escapeHtml(item.id) +
            " · " +
            escapeHtml(item.deviceSKU || "unknown") +
            "</option>",
        )
        .join("") +
      "</select></label>";
    $("actionConfirmBtn").textContent = "Send REGISTER";
    $("actionConfirmBtn").onclick = (event) => {
      event.preventDefault();
      const registeringDeviceId = $("actionDeviceSelect").value;
      $("actionDialog").close();
      void executeDeviceRequest(
        {
          deviceId: device.id,
          deviceSKU: "Hub",
          eventType: "REGISTER",
          registeringDeviceId,
        },
        "Hub REGISTER",
      );
    };
  }
  openHarnessDialog($("actionDialog"));
}

function extractTagField(tag, fieldName) {
  const wanted = fieldName.toUpperCase();
  return (
    String(tag)
      .split(";")
      .map((part) => {
        const index = part.indexOf(":");
        if (index < 0) return null;
        return {
          key: part.slice(0, index).trim().toUpperCase(),
          value: part.slice(index + 1).trim(),
        };
      })
      .find((field) => field?.key === wanted)?.value || ""
  );
}

async function createVirtualDevice() {
  if (!requireMutationAccess()) return;
  const deviceId = $("virtualDeviceId").value.trim();
  const deviceSKU = $("virtualDeviceSku").value;
  const courtId = $("virtualDeviceCourt").value;
  if (!deviceId) {
    showToast("Enter a device ID before creating the virtual device.", "error");
    $("virtualDeviceId").focus();
    return;
  }
  if (!deviceSKU) {
    showToast("Select a device type.", "error");
    $("virtualDeviceSku").focus();
    return;
  }
  if (!courtId || !state.courts.some((court) => court.id === courtId)) {
    showToast("Select a valid court before creating the virtual device.", "error");
    $("virtualDeviceCourt").focus();
    return;
  }
  const ref = doc(db, "devices", deviceId);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    showToast("That deviceId already exists.", "error");
    return;
  }
  await setDoc(ref, {
    deviceSKU,
    courtId,
    isVirtual: true,
    simulatorProfile: deviceSKU,
    createdAt: serverTimestamp(),
  });
  $("deviceDialog").close();
  await loadDevices();
  await selectDevice(deviceId);
  showToast("Virtual " + deviceSKU + " created.", "success");
}

function updateFailureUi() {
  const mode = $("failureMode").value;
  state.failure.mode = mode;

  const latencyEnabled = mode === "latency";
  const latencyControl = $("latencyControl");
  latencyControl.classList.toggle("is-disabled", !latencyEnabled);
  latencyControl.setAttribute("aria-disabled", String(!latencyEnabled));
  $("latencyMs").disabled = !latencyEnabled;

  const timeoutEnabled = mode === "timeout";
  const timeoutControl = $("timeoutControl");
  timeoutControl.classList.toggle("is-disabled", !timeoutEnabled);
  timeoutControl.setAttribute("aria-disabled", String(!timeoutEnabled));
  $("timeoutMs").disabled = !timeoutEnabled;

  const descriptions = {
    none: "Normal requests are sent to the real backend.",
    latency:
      "Delay before the real backend request. Useful for timing behaviour.",
    timeout:
      "Abort the browser-side request after the configured timeout. The server may still process the request.",
    connection_reset: "Drop the request before it reaches the backend.",
    http_500: "Return a synthetic 500 without calling the backend.",
    http_401: "Return a synthetic 401 without calling the backend.",
    http_403: "Return a synthetic 403 without calling the backend.",
    malformed:
      "Call the real backend, then present malformed JSON to the simulated device.",
    duplicate: "Send the same request twice to the real backend.",
  };
  $("failureDescription").textContent = descriptions[mode] || descriptions.none;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function initHarness() {
  els.deviceList = $("deviceList");
  $("environmentBadge").title =
    "Firebase environment: " +
    String(firebaseEnvironmentConfig.activeFirebaseEnvironment || "unknown");
  $("courtSelect").addEventListener("change", (event) => selectCourt(event.target.value));
  $("courtSearch").addEventListener("input", (event) => {
    state.courtSearch = event.target.value || "";
    renderCourtSelectors();
  });
  $("deviceSearch").addEventListener("input", (event) => {
    state.deviceSearch = event.target.value || "";
    renderDeviceList();
  });
  $("virtualDeviceCourtSearch").addEventListener("input", (event) => {
    state.virtualDeviceCourtSearch = event.target.value || "";
    renderCourtSelectors();
  });
  $("virtualDeviceCourt").addEventListener("change", (event) => {
    state.virtualDeviceCourtId = event.target.value || "";
    renderCourtSelectors();
  });
  $("viewCourtInfoBtn").addEventListener("click", () => {
    const device = currentDevice();
    if (device?.courtId) selectCourt(device.courtId);
  });
  $("clearTraceBtn").addEventListener("click", () => {
    state.trace = [];
    state.selectedTraceId = null;
    renderTrace();
    renderSelectedDevice();
    $("exchangeDetail").textContent = "Select a trace entry.";
  });
  $("failureMode").addEventListener("change", updateFailureUi);
  $("latencyMs").addEventListener(
    "input",
    (event) => (state.failure.latencyMs = Number(event.target.value) || 0),
  );
  $("timeoutMs").addEventListener(
    "input",
    (event) => (state.failure.timeoutMs = Number(event.target.value) || 3000),
  );
  $("networkResetBtn").addEventListener("click", () => {
    state.failure = {
      mode: "none",
      latencyMs: 1500,
      timeoutMs: 3000,
      armed: false,
    };
    $("failureMode").value = "none";
    $("latencyMs").value = "1500";
    $("timeoutMs").value = "3000";
    $("failNextBtn").textContent = "Arm next failure";
    updateFailureUi();
  });
  $("failNextBtn").addEventListener("click", () => {
    const mode = $("failureMode").value;
    if (mode === "none") {
      showToast("Select a failure mode first.", "error");
      $("failureMode").focus();
      return;
    }
    state.failure.armed = true;
    showToast(
      "Armed: " + mode + " will apply to the next device request only.",
      "info",
    );
    $("failNextBtn").textContent = "Failure armed";
  });
  $("addVirtualDeviceBtn").addEventListener("click", () => {
    if (!requireMutationAccess()) return;
    $("virtualDeviceId").value =
      "SIM-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    state.virtualDeviceCourtSearch = "";
    state.virtualDeviceCourtId = state.selectedCourtId || "";
    $("virtualDeviceCourtSearch").value = "";
    renderCourtSelectors();
    openHarnessDialog($("deviceDialog"), "#virtualDeviceId");
  });
  $("closeDeviceDialogBtn").addEventListener("click", () => $("deviceDialog").close());
  $("cancelDeviceDialogBtn").addEventListener("click", () => $("deviceDialog").close());
  $("createVirtualDeviceBtn").addEventListener("click", (event) => {
    event.preventDefault();
    void createVirtualDevice();
  });
  registerDialogAccessibility($("deviceDialog"));
  registerDialogAccessibility($("actionDialog"));
  registerGateAccessibility($("adminGate"), "#adminPassword");
  registerGateAccessibility($("productionGate"), "#productionAck");

  $("deviceListToggle").addEventListener("click", () => {
    const list = $("deviceList");
    const collapsed = list.classList.toggle("is-collapsed");
    $("deviceListToggle").setAttribute("aria-expanded", String(!collapsed));
    $("deviceListToggle").textContent = collapsed ? "Show list" : "Hide list";
  });
  window.addEventListener("resize", updateDeviceListToggle);

  $("productionAck").addEventListener("change", (event) => {
    $("productionEnableBtn").disabled =
      state.environmentMismatch || !event.target.checked;
  });
  $("productionEnableBtn").addEventListener("click", () => {
    if (state.environmentMismatch || !$("productionAck").checked) return;
    state.productionEnabled = true;
    $("productionGate").classList.add("hidden");
    showToast("Production mutations enabled.", "warning");
  });

  updateDeviceListToggle();
  updateFailureUi();
  renderCourtSelectors();
  renderAll();
  renderTrace();
  void (async () => {
    try {
      await loadClubs();
      await Promise.all([loadCourts(), loadDevices()]);
    } catch (error) {
      console.error(error);
      showToast(
        "Failed to load courts/devices/clubs: " + (error?.message || error),
        "error",
      );
    }
  })();

  openProductionGateIfNeeded();
}

function init() {
  applyTheme(getStoredTheme());

  window.addEventListener("storage", (event) => {
    if (event.key !== ADMIN_LOGOUT_SIGNAL_KEY) return;

    try {
      sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    } catch (storageError) {
      console.warn("Unable to clear admin session state.", storageError);
    }

    window.location.href = "/app";
  });

  $("themeToggleBtn")?.addEventListener("click", toggleTheme);
  $("themeToggleGateBtn")?.addEventListener("click", toggleTheme);
  $("themeToggleProductionGateBtn")?.addEventListener("click", toggleTheme);
  $("logoutBtn")?.addEventListener("click", endAdminSession);

  $("adminUnlockBtn").addEventListener("click", () => {
    void unlockHarness();
  });

  $("adminPassword").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void unlockHarness();
  });

  if (hasAdminSession()) {
    $("adminGate").classList.add("hidden");
    initHarness();
  } else {
    focusGate($("adminGate"));
  }
}

document.addEventListener("DOMContentLoaded", init);
