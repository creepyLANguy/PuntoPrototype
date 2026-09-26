function normalizeDeviceSku(value) {
  return typeof value === "string" ? value.trim() : "";
}

function mapBeaconEventType(eventType, deviceSku, beaconSidesSwapped) {
  if (!beaconSidesSwapped || deviceSku !== "Beacon") {
    return eventType;
  }

  if (eventType === "POINT_TEAM_A") return "POINT_TEAM_B";
  if (eventType === "POINT_TEAM_B") return "POINT_TEAM_A";

  return eventType;
}

module.exports = {
  normalizeDeviceSku,
  mapBeaconEventType,
};
