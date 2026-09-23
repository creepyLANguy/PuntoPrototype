/**
 * Canonical customer-facing Padel Push™ brand configuration.
 *
 * Technical identifiers, domains, email addresses and persisted storage keys
 * intentionally live outside this registry.
 */
export const BRAND = Object.freeze({
  id: "padelpush",
  name: "Padel Push™",
  displayName: "PADEL PUSH™",
  tagline: "Smart scoring. Connected courts. One platform.",

  landing: Object.freeze({
    title: "Smart Scoring for Modern Padel Clubs",
    description:
      "The connected smart court ecosystem with portable scoring devices, live scoreboards, and scalable tools for modern padel clubs.",
    socialDescription:
      "Smart devices, live scoring, and connected tools for modern padel clubs.",
    socialAlt: "Padel Push™ - Smart scoring for modern padel clubs"
  }),

  app: Object.freeze({
    title: "Live Scoreboard",
    description:
      "Padel Push™ — Live padel scoring system. Track points, games, sets, and matches in real-time.",
    socialDescription:
      "Live padel scoring system. Track points, games, sets and matches in real time.",
    socialAlt: "Padel Push™ - Live padel scoring"
  }),

  overlay: Object.freeze({
    title: "Score Overlay"
  }),

  nfc: Object.freeze({
    title: "NFC Tool"
  })
});

export default BRAND;

if (typeof globalThis !== "undefined") {
  globalThis.PadelPushBrand = BRAND;
}
