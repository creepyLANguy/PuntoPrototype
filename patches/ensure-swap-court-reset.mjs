#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "functions/index.js");

function fail(message)
{
  throw new Error(`[swap-court-ends-reset] ${message}`);
}

const source = fs.readFileSync(file, "utf8");
if (!source.includes("setCourtEndSwap"))
{
  fail("apply patches/apply-swap-court-ends.mjs first");
}
if (source.includes("swapCourtEnds: false"))
{
  console.log("[swap-court-ends-reset] backend reset already contains swapCourtEnds: false");
  process.exit(0);
}

const resetStart = source.indexOf("exports.resetCourt");
if (resetStart < 0)
{
  fail("could not locate exports.resetCourt");
}

const nextExport = source.indexOf("\nexports.", resetStart + 1);
const resetEnd = nextExport >= 0 ? nextExport : source.length;
const resetBlock = source.slice(resetStart, resetEnd);

// The reset callable must update the court document as part of its transaction.
// Refuse to guess if the implementation has materially drifted.
const courtWrite = resetBlock.match(/(await\s+[^\n]*courtRef\.(?:set|update)\(\{\n)/);
if (!courtWrite)
{
  fail("could not find the reset courtRef.set/update object; inspect resetCourt manually rather than guessing");
}

const absolute = resetStart + courtWrite.index + courtWrite[0].length;
const replacement = `${source.slice(0, absolute)}        swapCourtEnds: false,\n${source.slice(absolute)}`;

fs.writeFileSync(file, replacement, "utf8");
console.log("[swap-court-ends-reset] resetCourt now explicitly restores swapCourtEnds=false");
