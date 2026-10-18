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

  for (const [name, content] of Object.entries(tabContent())) {
    content?.classList.toggle("active", name === selectedTab);
  }

  try {
    localStorage.setItem(ADMIN_TAB_STORAGE_KEY, selectedTab);
  } catch {
    // Keep the tab usable even when local persistence is unavailable.
  }
}
