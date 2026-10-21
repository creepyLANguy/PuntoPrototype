// Active admin portal tab state. The selected tab is persisted locally so
// reopening the portal returns to the last tab the user visited.
import { elements } from "../ui/dom.js";

export const ADMIN_TABS = {
  ALL: "all",
  CLUBS: "clubs",
  COURTS: "courts",
  MATCHES: "matches",
  TOURNAMENTS: "tournaments",
  DEVICES: "devices",
};

const ADMIN_TAB_STORAGE_KEY = "padelPushAdminLastTab";
const isValidAdminTab = (tab) => Object.values(ADMIN_TABS).includes(tab);

const ADMIN_ALL_TAB_LOGO_SELECTOR = ".admin-all-tab-btn .admin-all-tab-logo";

// The external logo SVG is white-only. Blend transparent button/ancestor
// backgrounds over the page background, then use its luminance to keep the
// white mark at a minimum 3:1 contrast ratio against the rendered surface.
function parseCssColor(color) {
  const channels = color.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3) return null;
  return [
    channels[0],
    channels[1],
    channels[2],
    channels.length >= 4 ? channels[3] : 1,
  ];
}

function compositeColor(foreground, background) {
  const alpha = foreground[3];
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
  ];
}

function getRelativeLuminance(rgb) {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

export function syncAdminAllTabLogoContrast() {
  const button = document.querySelector(".admin-all-tab-btn");
  const logo = document.querySelector(ADMIN_ALL_TAB_LOGO_SELECTOR);
  if (!button || !logo || !document.body) return;

  const buttonBackground = parseCssColor(
    window.getComputedStyle(button).backgroundColor,
  );

  // Some environments (including jsdom) cannot resolve CSS custom properties
  // into computed background colours. The supported tab themes have known
  // active/inactive surfaces, so use that state as a deterministic fallback
  // only when the active surface is unresolved or transparent.
  if (
    !buttonBackground ||
    (button.classList.contains("active") && buttonBackground[3] < 0.999)
  ) {
    const isLightTheme = document.body.classList.contains("light-mode");
    const shouldInvert = isLightTheme
      ? !button.classList.contains("active")
      : button.classList.contains("active");
    logo.classList.toggle("contrast-invert", shouldInvert);
    return;
  }

  const bodyColor = parseCssColor(window.getComputedStyle(document.body).backgroundColor);
  let effectiveBackground = bodyColor
    ? bodyColor.slice(0, 3)
    : [0, 0, 0];

  const ancestors = [];
  for (let current = button; current && current !== document.body; current = current.parentElement) {
    ancestors.push(current);
  }

  for (const ancestor of ancestors.reverse()) {
    const layer = parseCssColor(window.getComputedStyle(ancestor).backgroundColor);
    if (layer && layer[3] > 0) effectiveBackground = compositeColor(layer, effectiveBackground);
  }

  // White has contrast below 3:1 once the background luminance exceeds 0.30.
  const backgroundLuminance = getRelativeLuminance(effectiveBackground);
  logo.classList.toggle("contrast-invert", backgroundLuminance > 0.30);
}

function observeAdminAllTabLogoContrast() {
  const button = document.querySelector(".admin-all-tab-btn");
  if (!button || !document.body) return;

  syncAdminAllTabLogoContrast();
  for (const eventName of ["pointerenter", "pointerleave", "focus", "blur", "transitionend"]) {
    button.addEventListener(eventName, syncAdminAllTabLogoContrast);
  }

  if (typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver((mutations) => {
      const relevantChange = mutations.some(
        ({ target }) => target === document.body || target.matches?.(".admin-all-tab-btn"),
      );
      if (relevantChange) syncAdminAllTabLogoContrast();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
  }
}

if (typeof document !== "undefined") observeAdminAllTabLogoContrast();

const tabContent = () => ({
  [ADMIN_TABS.ALL]: elements.allTab,
  [ADMIN_TABS.CLUBS]: elements.clubsTab,
  [ADMIN_TABS.COURTS]: elements.courtsTab,
  [ADMIN_TABS.MATCHES]: elements.matchesTab,
  [ADMIN_TABS.TOURNAMENTS]: elements.tournamentsTab,
  [ADMIN_TABS.DEVICES]: elements.devicesTab,
});

export function getPreferredAdminTab() {
  try {
    const savedTab = localStorage.getItem(ADMIN_TAB_STORAGE_KEY);
    if (isValidAdminTab(savedTab)) return savedTab;
  } catch {
    // Storage can be unavailable in private browsing or restricted contexts.
  }

  return ADMIN_TABS.ALL;
}

export function getActiveAdminTab() {
  const active = [...elements.adminTabs].find((button) =>
    button.classList.contains("active"),
  );
  return isValidAdminTab(active?.dataset.tab)
    ? active.dataset.tab
    : getPreferredAdminTab();
}

export function activateAdminTab(tab) {
  const selectedTab = isValidAdminTab(tab) ? tab : ADMIN_TABS.ALL;

  elements.adminTabs.forEach((button) =>
    button.classList.toggle("active", button.dataset.tab === selectedTab),
  );

  // Tile shortcuts can switch to a tab that is off-screen in the mobile
  // horizontal tab strip. Bring the active tab into view without scrolling
  // the page vertically; jsdom and older browsers may not implement this API.
  const activeButton = [...elements.adminTabs].find(
    (button) => button.dataset.tab === selectedTab,
  );
  if (typeof activeButton?.scrollIntoView === "function") {
    activeButton.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "auto",
    });
  }

  syncAdminAllTabLogoContrast();

  for (const [name, content] of Object.entries(tabContent())) {
    content?.classList.toggle("active", name === selectedTab);
  }

  try {
    localStorage.setItem(ADMIN_TAB_STORAGE_KEY, selectedTab);
  } catch {
    // Keep the tab usable even when local persistence is unavailable.
  }
}
