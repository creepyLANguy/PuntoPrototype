// Verifies that customer-facing files use the canonical brand from
// app/js/brand.mjs. Both the sources (templates, overlay parts, modules,
// stylesheet parts) and the generated documents are checked.
import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BRAND from "../app/js/brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function filesUnder(relativeDirectory, extensions) {
  const absolute = path.join(ROOT, relativeDirectory);
  if (!existsSync(absolute)) return [];

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return filesUnder(child, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [child] : [];
  });
}

const DISPLAY_FILES = [
  "index.html",
  "app/index.html",
  "app/overlay.html",
  "app/css/style.css",
  ...filesUnder("app/templates", [".html"]),
  ...filesUnder("app/overlay", [".html", ".css", ".js"]),
  ...filesUnder("app/js", [".js", ".mjs"]).filter(
    (file) => !file.endsWith(".min.js") && !file.endsWith("firebase-config.js"),
  ),
  ...filesUnder("app/css", [".css"]).filter((file) => file !== "app/css/style.css"),
  "nfc/index.html",
  "docs/api.md",
  "docs/api/openapi.yaml",
  "docs/PP_Basic_Flow.mmd",
  "docs/PP_Architecture.mmd",
];
const errors = [];

for (const relative of DISPLAY_FILES) {
  const text = await fs.readFile(path.join(ROOT, relative), "utf8");
  if (/\bPadel Push\b(?!™)/.test(text))
    errors.push(relative + ": untrademarked Padel Push occurrence");
  if (/\bPADEL PUSH\b(?!™)/.test(text))
    errors.push(relative + ": untrademarked PADEL PUSH occurrence");
}

if (BRAND.name !== "Padel Push™") errors.push("BRAND.name is not canonical");
if (BRAND.displayName !== "PADEL PUSH™") errors.push("BRAND.displayName is not canonical");
if (BRAND.tagline !== "Smart scoring. Connected courts. One platform.")
  errors.push("BRAND.tagline is not canonical");

const index = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
if (!index.includes(BRAND.tagline))
  errors.push("index.html does not contain the canonical tagline");
if (index.includes("Smart devices. Live scoring. Connected courts."))
  errors.push("legacy primary tagline remains in index.html");

for (const relative of ["app/templates/index.template.html", "app/index.html"]) {
  const app = await fs.readFile(path.join(ROOT, relative), "utf8");
  if (!app.includes(BRAND.name + " - " + BRAND.app.title))
    errors.push(relative + " does not contain the canonical app title");
}

for (const relative of ["app/overlay/template.html", "app/overlay.html"]) {
  const overlay = await fs.readFile(path.join(ROOT, relative), "utf8");
  if (!overlay.includes(BRAND.name + " — " + BRAND.overlay.title))
    errors.push(relative + " does not contain the canonical overlay title");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Branding check passed.");
