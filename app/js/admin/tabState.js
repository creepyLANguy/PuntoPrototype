// Which admin dashboard tab is active (.tab-btn / .tab-content "active"
// classes). DOM state only; loading a tab's list is dashboardTabs.js.
import { elements } from "../ui/dom.js";

export const ADMIN_TABS = {
  CLUBS: "clubs",
  COURTS: "courts",
  DEVICES: "devices"
};

const tabContent = () => ({
  [ADMIN_TABS.CLUBS]: elements.clubsTab,
  [ADMIN_TABS.COURTS]: elements.courtsTab,
  [ADMIN_TABS.DEVICES]: elements.devicesTab
});

export function getActiveAdminTab()
{
  const active = [...elements.adminTabs].find((button) => button.classList.contains("active"));
  return active?.dataset.tab || ADMIN_TABS.COURTS;
}

export function activateAdminTab(tab)
{
  elements.adminTabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  for (const [name, content] of Object.entries(tabContent()))
  {
    content?.classList.toggle("active", name === tab);
  }
}
