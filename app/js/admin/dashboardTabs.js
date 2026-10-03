// Admin dashboard tabs: switching tab and (re)loading the list the active tab
// shows (clubs, courts or devices).
import { loadClubList } from "./clubs.js";
import { displayAdminCourtList } from "./courts.js";
import { loadDevices } from "./devices.js";
import { activateAdminTab, ADMIN_TABS, getActiveAdminTab } from "./tabState.js";

const TAB_LOADERS = {
  [ADMIN_TABS.CLUBS]: loadClubList,
  [ADMIN_TABS.COURTS]: displayAdminCourtList,
  [ADMIN_TABS.DEVICES]: loadDevices
};

export function showAdminTab(tab)
{
  const loader = TAB_LOADERS[tab] ? tab : ADMIN_TABS.COURTS;
  activateAdminTab(loader);
  return TAB_LOADERS[loader]();
}

// Reloads the list of the tab that is currently active, e.g. when returning
// to the dashboard from an edit page.
export function refreshActiveAdminTab()
{
  return showAdminTab(getActiveAdminTab());
}
