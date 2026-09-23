import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BRAND from "../app/js/brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEXT_EXTENSIONS = new Set([".html", ".js", ".mjs", ".css", ".md", ".mmd", ".yaml", ".yml", ".json"]);
const EXCLUDED_DIRS = new Set([".git", "node_modules"]);
const errors = [];

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) { await walk(fullPath); continue; }
    if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const text = await fs.readFile(fullPath, "utf8");
    const relative = path.relative(ROOT, fullPath).replaceAll(path.sep, "/");
    if (/\bPadel Push\b(?!™)/.test(text)) errors.push(relative + ": untrademarked Padel Push occurrence");
    if (/\bPADEL PUSH\b(?!™)/.test(text)) errors.push(relative + ": untrademarked PADEL PUSH occurrence");
  }
}

await walk(ROOT);
if (BRAND.name !== "Padel Push™") errors.push("BRAND.name is not canonical");
if (BRAND.displayName !== "PADEL PUSH™") errors.push("BRAND.displayName is not canonical");
if (BRAND.tagline !== "Smart scoring. Connected courts. One platform.") errors.push("BRAND.tagline is not canonical");
const index = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
if (index.includes("Smart devices. Live scoring. Connected courts.")) errors.push("legacy primary tagline remains in index.html");
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("Branding check passed.");
