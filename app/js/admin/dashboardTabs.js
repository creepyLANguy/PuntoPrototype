// Admin portal tabs: switch the visible tab and reload its data when applicable.
import { loadClubList } from "./clubs.js";
import { displayAdminCourtList } from "./courts.js";
import { loadDevices } from "./devices.js";
import { loadAdminMatches } from "./matches.js";
import { loadAdminTournaments } from "./tournaments.js";
import { activateAdminTab, ADMIN_TABS, getPreferredAdminTab } from "./tabState.js";

const TAB_LOADERS = {
  [ADMIN_TABS.CLUBS]: loadClubList,
  [ADMIN_TABS.COURTS]: displayAdminCourtList,
  [ADMIN_TABS.MATCHES]: loadAdminMatches,
  [ADMIN_TABS.TOURNAMENTS]: loadAdminTournaments,
  [ADMIN_TABS.DEVICES]: loadDevices,
};

export function showAdminTab(tab) {
  const selectedTab = Object.values(ADMIN_TABS).includes(tab)
    ? tab
    : ADMIN_TABS.ALL;

  activateAdminTab(selectedTab);
  const loader = TAB_LOADERS[selectedTab];
  return loader ? loader() : Promise.resolve();
}

// Re-open the last-used tab, or the All overview when no valid preference exists.
export function refreshActiveAdminTab() {
  return showAdminTab(getPreferredAdminTab());
}
