// Unit tests: colour and formatting helpers (app/js/utils).
import assert from "node:assert/strict";
import test from "node:test";

import {
  getReadableTextColour,
  getReadableTextColourForBackground,
  getRelativeLuminance,
  normalizeHexColour,
  normalizeTeamColourPair,
} from "../app/js/utils/colour.js";
import { formatPct, normalizeCourtId } from "../app/js/utils/formatting.js";

test("hex colours are normalised to lower-case #rrggbb", () => {
  assert.equal(normalizeHexColour(" #AbCdEf "), "#abcdef");
  assert.equal(normalizeHexColour("#abc"), null);
  assert.equal(normalizeHexColour("abcdef"), null);
  assert.equal(normalizeHexColour(0xabcdef), null);
});

test("team colour pairs need two valid colours", () => {
  assert.deepEqual(normalizeTeamColourPair({ A: "#FFFF00", B: "#00ffff" }), {
    A: "#ffff00",
    B: "#00ffff",
  });
  assert.equal(normalizeTeamColourPair({ A: "#ffff00", B: "cyan" }), null);
  assert.equal(normalizeTeamColourPair(null), null);
});

test("readable text colours follow WCAG relative luminance", () => {
  assert.equal(getRelativeLuminance("#000000"), 0);
  assert.equal(getRelativeLuminance("#ffffff"), 1);
  assert.equal(getReadableTextColourForBackground("#ffff00"), "#000000");
  assert.equal(getReadableTextColourForBackground("#0a0a5a"), "#ffffff");
  assert.equal(getReadableTextColour({ A: "#ffff00", B: "#00ffff" }), "#000000");
  assert.equal(getReadableTextColour({ A: "#ad7535", B: "#0a91ac" }), "#ffffff");
});

test("court ids and percentages are formatted consistently", () => {
  assert.equal(normalizeCourtId("  AbCd "), "abcd");
  assert.equal(normalizeCourtId("   "), null);
  assert.equal(normalizeCourtId(42), null);
  assert.equal(formatPct(55.5), "56%");
  assert.equal(formatPct("12.4"), "12%");
  assert.equal(formatPct(undefined), "0%");
});
