import { appState } from "../state/appState.js";

// Device detection: the mobile-device class used by CSS, and the device
// identifier stamped onto every event this client writes (createdBy).
export function updateMobileDeviceClass()
{
  const userAgent = navigator.userAgent || "";
  const isIpadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const isMobileDevice = navigator.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|IEMobile|Windows Phone|Mobile/i.test(userAgent) ||
    isIpadDesktopMode;

  document.documentElement.classList.toggle("mobile-device", isMobileDevice);
  return isMobileDevice;
}

export function DetermineThisDeviceId()
{
  const ua = navigator.userAgent;
  let os = "Unknown";
  let browser = "Unknown";
  let mode = "WEB";
  let model = "Generic";

  // 1. OS & Model Detection
  if (/android/i.test(ua))
  {
    os = "Android";
    // Try to extract Android model: usually after "Android X.X;" and before next ";" or ")"
    const match = ua.match(/Android\s+[^;]+;\s+([^;)]+)/);
    if (match) model = match[1].trim();
  }
  else if (/iPad|iPhone|iPod/.test(ua))
  {
    os = "iOS";
    if (/iPhone/.test(ua)) model = "iPhone";
    else if (/iPad/.test(ua)) model = "iPad";
    else if (/iPod/.test(ua)) model = "iPod";
  }
  else if (/Win/i.test(ua)) os = "Windows";
  else if (/Mac/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";

  // 2. Browser Detection
  if (/edg/i.test(ua)) browser = "Edge";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";
  else if (/trident/i.test(ua)) browser = "IE";

  // 3. Platform Mode (Web / PWA / TWA)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isStandalone)
  {
    mode = "PWA";
    if (ua.includes('wv') || ua.includes('Version/'))
    {
      mode = "TWA";
    }
  }

  // 4. Persistence (Unique ID)
  let uuid = localStorage.getItem("punto_device_uuid");
  if (!uuid)
  {
    uuid = "uuid_" + Math.random().toString(36).substring(2, 8).toUpperCase();
    localStorage.setItem("punto_device_uuid", uuid);
  }

  // 5. Screen Info
  const res = `${window.screen.width}x${window.screen.height}`;

  // Clean up model string (remove spaces)
  const cleanModel = model.replace(/\s+/g, "_");

  // Format: MODE-OS-MODEL-BROWSER-RES-UUID
  // e.g. TWA-Android-Pixel_6-Chrome-412x915-uuid_X9Y8Z7
  let id = `${mode}-${os}-${cleanModel}-${browser}-${res}-${uuid}`;

  console.log(`Device ID: ${id}`);
  return id;
}

export function initDeviceIdentity()
{
  appState.thisDeviceId = DetermineThisDeviceId();
}
