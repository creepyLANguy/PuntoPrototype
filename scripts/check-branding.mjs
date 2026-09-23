import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BRAND from "../app/js/brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DISPLAY_FILES = [
  "index.html",
  "app/index.html",
  "app/js/script.js",
  "app/overlay.html",
  "nfc/index.html",
  "docs/api.md",
  "docs/api/openapi.yaml",
  "docs/PP_Basic_Flow.mmd",
  "docs/PP_Architecture.mmd",
  "app/css/style.css"
];
const errors = [];

for (const relative of DISPLAY_FILES) {
  const text = await fs.readFile(path.join(ROOT, relative), "utf8");
  if (/\bPadel Push\b(?!™)/.test(text)) errors.push(relative + ": untrademarked Padel Push occurrence");
  if (/\bPADEL PUSH\b(?!™)/.test(text)) errors.push(relative + ": untrademarked PADEL PUSH occurrence");
}

if (BRAND.name !== "Padel Push™") errors.push("BRAND.name is not canonical");
if (BRAND.displayName !== "PADEL PUSH™") errors.push("BRAND.displayName is not canonical");
if (BRAND.tagline !== "Smart scoring. Connected courts. One platform.") errors.push("BRAND.tagline is not canonical");

const index = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
if (!index.includes(BRAND.tagline)) errors.push("index.html does not contain the canonical tagline");
if (index.includes("Smart devices. Live scoring. Connected courts.")) errors.push("legacy primary tagline remains in index.html");

const app = await fs.readFile(path.join(ROOT, "app/index.html"), "utf8");
if (!app.includes(BRAND.name + " - " + BRAND.app.title)) errors.push("app/index.html does not contain the canonical app title");

const overlay = await fs.readFile(path.join(ROOT, "app/overlay.html"), "utf8");
if (!overlay.includes(BRAND.name + " — " + BRAND.overlay.title)) errors.push("app/overlay.html does not contain the canonical overlay title");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Branding check passed.");
