export const DEVICE_PROFILES = {
  Hub: {
    label: "Hub",
    description: "NFC reader / control hub",
    localState: { wifiConnected: true, nfcReady: true, currentTeam: "A" },
    controls: [
      { id: "pointA", label: "Point · Team A", hint: "Send POINT_TEAM_A" },
      { id: "pointB", label: "Point · Team B", hint: "Send POINT_TEAM_B" },
      { id: "undo", label: "Undo", hint: "Send UNDO" },
      { id: "reset", label: "Reset score", hint: "Send RESET" },
      { id: "spectate", label: "Spectate court…", hint: "Send SPECTATE" },
      { id: "register", label: "Register device…", hint: "Send REGISTER" },
      { id: "nfc", label: "Inject NFC tag", hint: "Run the Hub NFC parser" },
      { id: "factoryReset", label: "Factory reset", hint: "Local device state only" }
    ]
  },
  Beacon: {
    label: "Beacon",
    description: "Distance-triggered point device",
    localState: { wifiConnected: true, distanceCm: 50, selectedTeam: "A", hasTriggered: false },
    controls: [
      { id: "pointA", label: "Trigger · Team A", hint: "Simulate object detection" },
      { id: "pointB", label: "Trigger · Team B", hint: "Simulate object detection" },
      { id: "clear", label: "Clear detection", hint: "Simulate object leaving range" },
      { id: "factoryReset", label: "Factory reset", hint: "Local device state only" }
    ]
  },
  Pulse: {
    label: "Pulse",
    description: "Button-driven remote",
    localState: { wifiConnected: true, currentTeam: "A", lastHoldMs: 0 },
    controls: [
      { id: "tap", label: "Tap", hint: "Normal point action" },
      { id: "undo", label: "Hold · 2s", hint: "Send UNDO" },
      { id: "switchTeam", label: "Hold · 5s", hint: "Switch local team" },
      { id: "factoryReset", label: "Hold · 15s", hint: "Local device state only" }
    ]
  }
};

export function normaliseSku(value) {
  const sku = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(DEVICE_PROFILES, sku) ? sku : "Hub";
}

export function createInitialLocalState(sku) {
  return { ...(DEVICE_PROFILES[normaliseSku(sku)]?.localState || {}) };
}
