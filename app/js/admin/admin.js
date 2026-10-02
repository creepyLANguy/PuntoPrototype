// Admin portal shell: admin authentication, the dashboard open/close flow, cross-tab
// logout, the dashboard tabs and the admin tool buttons. Owns #adminAuthPage and
// the dashboard chrome; the court and device lists live in courts.js / devices.js.
import { displayAdminCourtList } from "./courts.js";
import { loadDevices } from "./devices.js";
import { ADMIN_LOGOUT_SIGNAL_KEY, ADMIN_SESSION_STORAGE_KEY } from "../config/constants.js";
import { NAV_PAGES } from "../config/routes.js";
import { getSkeleton } from "../firebase/adminRepository.js";
import { stepBackInApp, syncCurrentViewState } from "../routing/history.js";
import { isAdminProtectedViewVisible } from "../routing/viewController.js";
import { createViewState } from "../routing/viewState.js";
import { clearAdminSession, endAdminSession } from "../state/adminSessionState.js";
import { appState } from "../state/appState.js";
import { $, elements } from "../ui/dom.js";
import { hideSpinner, showSpinner } from "../ui/loading.js";

export function registerAdminPortal()
{
  elements.adminLoginBtn.addEventListener("click", () =>
  {
    if (appState.isAdmin)
    {
      elements.menuPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
      syncCurrentViewState("replace");
      return;
    }

    elements.menuPage.style.display = "none";
    elements.adminAuthPage.style.display = "flex";
    elements.adminAuthPassword.value = "";
    elements.adminAuthError.textContent = "";
    elements.adminAuthPassword.focus();
    syncCurrentViewState();
  });

  elements.closeAdminAuthBtn.addEventListener("click", () =>
  {
    void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
  });

  elements.submitAdminAuthBtn.addEventListener("click", async () =>
  {
    const pass = elements.adminAuthPassword.value.trim();
    if (!pass)
    {
      elements.adminAuthError.textContent = "Admin password cannot be empty.";
      return;
    }

    showSpinner(elements.adminAuthPage);

    let skeleton;
    try {
      skeleton = await getSkeleton();
    }
    catch (err) {
      elements.adminAuthError.textContent = "Admin config error: " + err.message;
      hideSpinner(elements.adminAuthPage);
      return;
    }

    if (pass === skeleton)
    {
      try
      {
        sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, "true");
      }
      catch (storageError)
      {
        console.warn("Unable to persist admin session state.", storageError);
      }

      appState.isAdmin = true;
      elements.adminAuthPage.style.display = "none";
      elements.adminDashboardPage.style.display = "flex";
      displayAdminCourtList();
      syncCurrentViewState("replace");
    }
    else
    {
      elements.adminAuthError.textContent = "Incorrect admin password.";
      elements.adminAuthPassword.value = "";
      elements.adminAuthPassword.focus();
    }

    hideSpinner(elements.adminAuthPage);
  });

  elements.closeAdminDashboardBtn.addEventListener("click", () =>
  {
    endAdminSession();
    void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
  });

  window.addEventListener("storage", (event) =>
  {
    if (event.key !== ADMIN_LOGOUT_SIGNAL_KEY) return;
    if (!appState.isAdmin) return;

    clearAdminSession();
    appState.isAdmin = false;

    if (isAdminProtectedViewVisible())
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
    }
  });

  if (elements.nfcToolBtn)
  {
    elements.nfcToolBtn.addEventListener("click", () =>
    {
      window.open("/nfc/index.html", "_blank");
    });
  }

  const deviceHarnessBtn = $("deviceHarnessBtn");
  if (deviceHarnessBtn)
  {
    deviceHarnessBtn.addEventListener("click", () =>
    {
      window.open("/harness", "_blank");
    });
  }

  elements.adminAuthPage.addEventListener("click", (e) =>
  {
    if (e.target === elements.adminAuthPage)
    {
      void stepBackInApp(createViewState({ page: NAV_PAGES.MENU }));
    }
  });
}

export function registerAdminTabs()
{
  // Tab Switching Logic
  elements.adminTabs.forEach(btn =>
  {
    btn.addEventListener('click', () =>
    {
      elements.adminTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      if (tab === 'courts')
      {
        elements.courtsTab.classList.add("active");   // Added 'elements.'
        elements.devicesTab.classList.remove("active"); // Added 'elements.'
        displayAdminCourtList();
      } else
      {
        elements.devicesTab.classList.add("active");  // Added 'elements.'
        elements.courtsTab.classList.remove("active"); // Added 'elements.'
        loadDevices();
      }
    });
  });
}
