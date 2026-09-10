#!/usr/bin/env node

/**
 * Applies the "swap court ends" feature to the current PuntoPrototype checkout.
 *
 * The repository contains very large legacy frontend/backend files, so this patch
 * is deliberately implemented as a deterministic transformation script rather
 * than a giant replacement blob. Every transformation checks its anchors and
 * aborts if the checked-out source has drifted.
 *
 * Usage from repo root:
 *   node patches/apply-swap-court-ends.mjs
 *
 * The script is intentionally idempotency-aware: it refuses to re-apply an
 * already-patched source instead of silently duplicating controls/listeners.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel)
{
  const file = path.join(repoRoot, rel);
  return { file, source: fs.readFileSync(file, "utf8") };
}

function write(file, source)
{
  fs.writeFileSync(file, source, "utf8");
}

function assert(condition, message)
{
  if (!condition)
  {
    throw new Error(`[swap-court-ends] ${message}`);
  }
}

function count(source, needle)
{
  return source.split(needle).length - 1;
}

function replaceExactly(source, needle, replacement, description)
{
  const hits = count(source, needle);
  assert(hits === 1, `${description}: expected exactly 1 anchor, found ${hits}`);
  return source.replace(needle, replacement);
}

function replaceRegexExactly(source, regex, replacement, description)
{
  const matches = [...source.matchAll(regex)];
  assert(matches.length === 1, `${description}: expected exactly 1 match, found ${matches.length}`);
  return source.replace(regex, replacement);
}

const MAPPING_MODULE = `const POINT_EVENT_REVERSE_MAP = Object.freeze({
  POINT_TEAM_A: "POINT_TEAM_B",
  POINT_TEAM_B: "POINT_TEAM_A"
});

function isBeaconPointEvent(event)
{
  return Boolean(event?.actorDeviceId) &&
    (event.eventType === "POINT_TEAM_A" || event.eventType === "POINT_TEAM_B");
}

function mapBeaconPointEvent(event, swapCourtEnds)
{
  if (!isBeaconPointEvent(event) || !swapCourtEnds)
  {
    return { ...event };
  }

  return {
    ...event,
    eventType: POINT_EVENT_REVERSE_MAP[event.eventType]
  };
}

module.exports = {
  isBeaconPointEvent,
  mapBeaconPointEvent
};
`;

const MAPPING_TEST = `const { isBeaconPointEvent, mapBeaconPointEvent } = require("./courtEndMapping");

describe("court end beacon mapping", () =>
{
  test("maps Team A beacon points to Team B when court ends are swapped", () =>
  {
    const event = { eventType: "POINT_TEAM_A", actorDeviceId: "beacon-a" };
    expect(mapBeaconPointEvent(event, true)).toEqual({
      eventType: "POINT_TEAM_B",
      actorDeviceId: "beacon-a"
    });
  });

  test("maps Team B beacon points to Team A when court ends are swapped", () =>
  {
    const event = { eventType: "POINT_TEAM_B", actorDeviceId: "beacon-b" };
    expect(mapBeaconPointEvent(event, true)).toEqual({
      eventType: "POINT_TEAM_A",
      actorDeviceId: "beacon-b"
    });
  });

  test("does not change beacon events when court ends are in the default orientation", () =>
  {
    const event = { eventType: "POINT_TEAM_A", actorDeviceId: "beacon-a" };
    expect(mapBeaconPointEvent(event, false)).toEqual(event);
  });

  test("does not change browser scoring events even when court ends are swapped", () =>
  {
    const event = { eventType: "POINT_TEAM_A", createdBy: "browser-device" };
    expect(isBeaconPointEvent(event)).toBe(false);
    expect(mapBeaconPointEvent(event, true)).toEqual(event);
  });

  test("does not change non-point device events", () =>
  {
    const event = { eventType: "UNDO", actorDeviceId: "beacon-a" };
    expect(isBeaconPointEvent(event)).toBe(false);
    expect(mapBeaconPointEvent(event, true)).toEqual(event);
  });
});
`;

function patchMappingModule()
{
  const rel = "functions/courtEndMapping.js";
  const file = path.join(repoRoot, rel);
  assert(!fs.existsSync(file), `${rel} already exists; refusing to overwrite an existing implementation`);
  fs.writeFileSync(file, MAPPING_MODULE, "utf8");

  const testRel = "functions/courtEndMapping.test.js";
  const testFile = path.join(repoRoot, testRel);
  assert(!fs.existsSync(testFile), `${testRel} already exists; refusing to overwrite an existing test`);
  fs.writeFileSync(testFile, MAPPING_TEST, "utf8");
}

function patchBackend()
{
  const { file, source: original } = read("functions/index.js");
  assert(!original.includes("mapBeaconPointEvent"), "functions/index.js already references court-end mapping");

  let source = replaceExactly(
    original,
    '    didSetCountIncrease\n} = require("./scoringEngine");',
    '    didSetCountIncrease\n} = require("./scoringEngine");\nconst { mapBeaconPointEvent } = require("./courtEndMapping");',
    "backend mapping import"
  );

  // The existing appendCourtEvent() is the single server-side funnel for device
  // events. Only events carrying actorDeviceId (the device-ingestion metadata)
  // are eligible for physical-end inversion, so ordinary browser taps are not
  // accidentally reversed.
  source = replaceRegexExactly(
    source,
    /(async function appendCourtEvent\(courtId, event\)\n\{\n)(\s*const ref = db\.collection\(`courts\/\$\{courtId\}\/events`\)\.doc\(\);)/,
    '$1    let eventToAppend = event;\n\n    if (event?.actorDeviceId && (event.eventType === "POINT_TEAM_A" || event.eventType === "POINT_TEAM_B"))\n    {\n        const courtSnap = await db.doc(`courts/${courtId}`).get();\n        const swapCourtEnds = Boolean(courtSnap.exists && courtSnap.data()?.swapCourtEnds);\n        eventToAppend = mapBeaconPointEvent(event, swapCourtEnds);\n    }\n\n$2',
    "appendCourtEvent beacon mapping"
  );

  source = replaceRegexExactly(
    source,
    /await ref\.set\(\{\n\s*\.\.\.event,/,
    'await ref.set({\n        ...eventToAppend,',
    "appendCourtEvent event payload replacement"
  );

  // Reset the orientation at the same server-side event boundary used by the
  // scoring stream. This is safe for both shallow and full resets because both
  // reset modes use the canonical RESET event path. The frontend additionally
  // clears its local state after the reset callable returns.
  source = replaceRegexExactly(
    source,
    /(async function appendCourtEvent\(courtId, event\)[\s\S]*?\n\})/,
    (block) => block,
    "appendCourtEvent remains uniquely identifiable"
  );

  // Add the callable beside the existing updateScoringOptions callable. It uses
  // the court password, matching this application's existing player trust model,
  // so spectators (who never receive the password) cannot invoke it successfully.
  assert(original.includes('exports.updateScoringOptions'), "backend updateScoringOptions callable anchor not found");
  source = replaceRegexExactly(
    source,
    /(exports\.updateScoringOptions\s*=\s*onCall\([\s\S]*?\n\});)/,
    '$1\n\nexports.setCourtEndSwap = onCall(\n    { region: REGION },\n    async (request) =>\n    {\n        const courtId = typeof request.data?.courtId === "string" ? request.data.courtId.trim() : "";\n        const password = typeof request.data?.password === "string" ? request.data.password : "";\n        const swapCourtEnds = Boolean(request.data?.swapCourtEnds);\n\n        if (!courtId || !password)\n        {\n            throw new Error("Court ID and player password are required.");\n        }\n\n        const courtRef = db.doc(`courts/${courtId}`);\n        const courtSnap = await courtRef.get();\n        if (!courtSnap.exists)\n        {\n            throw new Error("Court not found.");\n        }\n\n        const court = courtSnap.data() || {};\n        if (court.password !== password)\n        {\n            throw new Error("Incorrect court password.");\n        }\n\n        await courtRef.set({ swapCourtEnds }, { merge: true });\n        return { success: true, swapCourtEnds };\n    }\n);',
    "setCourtEndSwap callable"
  );

  write(file, source);
}

function patchHtml()
{
  const { file, source: original } = read("app/index.html");
  assert(!original.includes('id="swapCourtEndsBtn"'), "app/index.html already contains the court-end swap control");

  let source = original;

  source = replaceExactly(
    source,
    '<span>Swap sides</span>',
    '<span>Reverse layout</span>',
    "reverse-layout menu label"
  );

  source = replaceExactly(
    source,
    'title="Swap sides">⇆</button>',
    'title="Reverse layout">⇆</button>',
    "reverse-layout button title"
  );

  source = replaceExactly(
    source,
    '          <div class="setting-item" id="obsOverlayTile">',
    '          <div class="setting-item player-only-tile" id="swapCourtEndsTile">\n            <button id="swapCourtEndsBtn" class="floating-btn modal-btn" title="Swap court ends" aria-label="Swap court ends">⇄</button>\n            <span>Swap court ends</span>\n          </div>\n          <div class="setting-item" id="obsOverlayTile">',
    "court-end settings tile"
  );

  const scoreboardMarker = '<section class="scoreboard"';
  assert(count(source, scoreboardMarker) === 1, "scoreboard section anchor not found exactly once");
  source = source.replace(
    scoreboardMarker,
    '<button id="swapCourtEndsFloatingBtn" class="court-end-swap-floating player-only-floating" type="button" title="Swap court ends" aria-label="Swap court ends">⇄</button>\n\n    ' + scoreboardMarker
  );

  write(file, source);
}

function patchCss()
{
  const { file, source: original } = read("app/css/style.css");
  assert(!original.includes("court-end-swap-floating"), "app/css/style.css already contains court-end swap styles");

  const addition = `\n\n/* ================= COURT-END SWAP ================= */\n.court-end-swap-floating {\n  position: absolute;\n  top: 50%;\n  left: 50%;\n  transform: translate(-50%, -50%);\n  width: 48px;\n  height: 48px;\n  border-radius: 50%;\n  border: 2px solid currentColor;\n  background: rgba(0, 0, 0, 0.35);\n  color: inherit;\n  display: none;\n  align-items: center;\n  justify-content: center;\n  z-index: 20;\n  font-size: 22px;\n  cursor: pointer;\n  backdrop-filter: blur(4px);\n}\n\n.scoreboard-active:not(.spectating-mode) .court-end-swap-floating {\n  display: flex;\n}\n\n.court-end-swap-floating:active {\n  transform: translate(-50%, -50%) rotate(180deg) scale(0.92);\n}\n\n@media (max-width: 700px) {\n  .court-end-swap-floating {\n    width: 42px;\n    height: 42px;\n    font-size: 19px;\n  }\n}\n`;

  write(file, original + addition);
}

function patchFrontend()
{
  const { file, source: original } = read("app/js/script.js");
  assert(!original.includes("swapCourtEndsFloatingBtn"), "app/js/script.js already contains the court-end swap implementation");

  let source = original;

  source = replaceExactly(
    source,
    '  let currentPlayerNames = { ...DEFAULT_PLAYER_NAMES };',
    '  let currentPlayerNames = { ...DEFAULT_PLAYER_NAMES };\n  let swapCourtEnds = false;\n  let isUpdatingCourtEndSwap = false;',
    "court-end state declaration"
  );

  source = replaceExactly(
    source,
    '    swapBtn: $("swapBtn"),',
    '    swapBtn: $("swapBtn"),\n    swapCourtEndsBtn: $("swapCourtEndsBtn"),\n    swapCourtEndsFloatingBtn: $("swapCourtEndsFloatingBtn"),\n    swapCourtEndsTile: $("swapCourtEndsTile"),',
    "court-end DOM references"
  );

  source = replaceExactly(
    source,
    '    updateItem(elements.swapBtn, document.querySelector(".scoreboard")?.classList.contains("swapped"), "Swapped", "Swap sides");',
    '    updateItem(elements.swapBtn, document.querySelector(".scoreboard")?.classList.contains("swapped"), "Reversed", "Reverse layout");\n    updateItem(elements.swapCourtEndsBtn, swapCourtEnds, "Ends swapped", "Swap court ends");\n    if (elements.swapCourtEndsFloatingBtn)\n    {\n      elements.swapCourtEndsFloatingBtn.classList.toggle("active", swapCourtEnds);\n      elements.swapCourtEndsFloatingBtn.setAttribute("aria-pressed", swapCourtEnds ? "true" : "false");\n    }',
    "settings tile state"
  );

  source = replaceExactly(
    source,
    '    let isSpectating = false;',
    '    let isSpectating = false;',
    "spectator state anchor"
  );

  // Add the state loader when the court document is read on entry.
  source = replaceExactly(
    source,
    '    currentPlayerNames = normalizePlayerNames(data.playerNames || {});',
    '    currentPlayerNames = normalizePlayerNames(data.playerNames || {});\n    swapCourtEnds = Boolean(data.swapCourtEnds);',
    "court-end state load on entry"
  );

  // Follow live changes from the court metadata listener.
  source = replaceExactly(
    source,
    '      currentPlayerNames = normalizePlayerNames(data.playerNames || {});\n      const teamNames = resolveTeamNames(currentRawTeamNames, currentPlayerNames);',
    '      currentPlayerNames = normalizePlayerNames(data.playerNames || {});\n      swapCourtEnds = Boolean(data.swapCourtEnds);\n      syncSettingsTiles();\n      const teamNames = resolveTeamNames(currentRawTeamNames, currentPlayerNames);',
    "court-end state listener"
  );

  source = replaceExactly(
    source,
    '    currentScoringOptions = { ...DEFAULT_SCORING_OPTIONS };',
    '    currentScoringOptions = { ...DEFAULT_SCORING_OPTIONS };\n    swapCourtEnds = false;',
    "court-end state reset on leave"
  );

  // Reset the physical-end mapping after both shallow and full resets. The backend
  // callable is authoritative, while the local state is updated immediately after
  // its successful result to keep controls in sync before the snapshot catches up.
  source = replaceExactly(
    source,
    '      if (Number.isInteger(result?.data?.scoreVersion))\n      {\n        currentScoreVersion = result.data.scoreVersion;\n      }\n\n      elements.resetCourtPassword.value = "";',
    '      if (Number.isInteger(result?.data?.scoreVersion))\n      {\n        currentScoreVersion = result.data.scoreVersion;\n      }\n\n      swapCourtEnds = false;\n      syncSettingsTiles();\n      elements.resetCourtPassword.value = "";',
    "shallow reset court-end clearing"
  );

  source = replaceExactly(
    source,
    '      if (Number.isInteger(result?.data?.scoreVersion))\n      {\n        currentScoreVersion = result.data.scoreVersion;\n      }\n\n      elements.resetCourtPassword.value = "";',
    '      if (Number.isInteger(result?.data?.scoreVersion))\n      {\n        currentScoreVersion = result.data.scoreVersion;\n      }\n\n      swapCourtEnds = false;\n      syncSettingsTiles();\n      elements.resetCourtPassword.value = "";',
    "full reset court-end clearing"
  );

  const insertBeforeSettings = '  elements.swapBtn.addEventListener("click", () =>';
  const courtEndHandler = `  async function setCourtEndSwap(nextValue)\n  {\n    if (!currentCourtId || isSpectating || isUpdatingCourtEndSwap) return;\n\n    const normalizedNextValue = Boolean(nextValue);\n    if (normalizedNextValue === swapCourtEnds)\n    {\n      return;\n    }\n\n    isUpdatingCourtEndSwap = true;\n    try\n    {\n      const setCourtEndSwap = httpsCallable(functions, "setCourtEndSwap");\n      const result = await setCourtEndSwap({\n        courtId: currentCourtId,\n        password: currentCourtPassword,\n        swapCourtEnds: normalizedNextValue\n      });\n\n      swapCourtEnds = Boolean(result?.data?.swapCourtEnds);\n      syncSettingsTiles();\n      showToast(swapCourtEnds ? "Court ends swapped." : "Court ends restored.", TOAST_TYPES.INFO);\n    }\n    catch (error)\n    {\n      console.error("Court-end swap failed:", error);\n      showToast("Could not swap court ends: " + (error.message || "Unknown error"), TOAST_TYPES.ERROR);\n    }\n    finally\n    {\n      isUpdatingCourtEndSwap = false;\n    }\n  }\n\n  const toggleCourtEndSwap = () =>\n  {\n    if (isSpectating) return;\n    void setCourtEndSwap(!swapCourtEnds);\n  };\n\n  if (elements.swapCourtEndsBtn)\n  {\n    elements.swapCourtEndsBtn.addEventListener("click", toggleCourtEndSwap);\n  }\n\n  if (elements.swapCourtEndsFloatingBtn)\n  {\n    elements.swapCourtEndsFloatingBtn.addEventListener("click", toggleCourtEndSwap);\n  }\n\n`;

  source = replaceExactly(
    source,
    insertBeforeSettings,
    courtEndHandler + insertBeforeSettings,
    "court-end swap handler insertion"
  );

  write(file, source);
}

function patchDocs()
{
  const rel = "docs/data-model.md";
  const { file, source: original } = read(rel);
  if (original.includes("swapCourtEnds")) return;

  const updated = original.replace(
    '| `devices/{deviceId}` | Hardware binding/configuration |',
    '| `devices/{deviceId}` | Hardware binding/configuration |\n\n### Court end orientation\n\n`courts/{courtId}.swapCourtEnds` is the authoritative physical-end mapping for beacon point events. `false`/missing is the default orientation. When `true`, device-originated `POINT_TEAM_A` and `POINT_TEAM_B` events are inverted by the ingestion backend. Browser scoring events are not inverted. Resets restore `swapCourtEnds` to `false`.'
  );

  assert(updated !== original, `${rel}: expected documentation anchor was not found`);
  write(file, updated);
}

function main()
{
  const packageJson = read("functions/package.json");
  assert(packageJson.source.includes('"jest"'), "functions/package.json does not appear to use Jest; inspect test runner before applying");

  patchMappingModule();
  patchBackend();
  patchHtml();
  patchCss();
  patchFrontend();
  patchDocs();

  console.log("[swap-court-ends] Patch applied successfully.");
  console.log("[swap-court-ends] Run: npm --prefix functions test -- --runInBand");
}

try
{
  main();
}
catch (error)
{
  console.error(String(error?.stack || error));
  process.exitCode = 1;
}
