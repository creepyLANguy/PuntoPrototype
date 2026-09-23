import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BRAND from "../app/js/brand.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND_NAME = "Padel Push";
const WORDMARK = "PADEL PUSH";

const normalizeExistingBrand = (text) =>
  text.replaceAll("PADEL PUSH™", WORDMARK).replaceAll("Padel Push™", BRAND_NAME);

const applyDisplayName = (text) =>
  normalizeExistingBrand(text).replaceAll(WORDMARK, BRAND.displayName).replaceAll(BRAND_NAME, BRAND.name);

async function updateFile(relativePath, transform) {
  const absolutePath = path.join(ROOT, relativePath);
  const before = await fs.readFile(absolutePath, "utf8");
  const after = transform(before);
  if (after !== before) {
    await fs.writeFile(absolutePath, after, "utf8");
    console.log("updated " + relativePath);
  }
}

await updateFile("index.html", (text) => {
  let out = text;
  out = out.replace(/<title>[^<]*<\/title>/, "<title>" + BRAND.name + " | " + BRAND.landing.title + "</title>");
  out = out.replace(/<meta name="description"\s+content="[^"]*">/, "<meta name=\"description\"\n    content=\"" + BRAND.landing.description + "\">");
  out = out.replace(/<meta property="og:title" content="[^"]*" \/>/, "<meta property=\"og:title\" content=\"" + BRAND.name + " | " + BRAND.landing.title + "\" />");
  out = out.replace(/<meta property="og:description"\s+content="[^"]*" \/>/, "<meta property=\"og:description\"\n    content=\"" + BRAND.landing.socialDescription + "\" />");
  out = out.replace(/<meta name="twitter:image:alt" content="[^"]*" \/>/, "<meta name=\"twitter:image:alt\" content=\"" + BRAND.landing.socialAlt + "\" />");
  out = out.replace(/(<p class="lead">)[\s\S]*?(<\/p>)/, "$1" + BRAND.tagline + "$2");
  out = out.replaceAll("Padel%20Push%E2%84%A2", encodeURIComponent(BRAND.name));
  out = out.replaceAll("Padel%20Push", encodeURIComponent(BRAND.name));
  return applyDisplayName(out);
});

await updateFile("app/index.html", (text) => {
  let out = text;
  out = out.replace(/<title>[^<]*<\/title>/, "<title>" + BRAND.name + " - " + BRAND.app.title + "</title>");
  out = out.replace(/<meta name="description"\s+content="[^"]*" \/>/, "<meta name=\"description\"\n    content=\"" + BRAND.app.description + "\" />");
  out = out.replace(/<meta property="og:title" content="[^"]*" \/>/, "<meta property=\"og:title\" content=\"" + BRAND.name + " - " + BRAND.app.title + "\" />");
  out = out.replace(/<meta property="og:description"\s+content="[^"]*" \/>/, "<meta property=\"og:description\"\n    content=\"" + BRAND.app.socialDescription + "\" />");
  out = out.replace(/<meta name="twitter:image:alt" content="[^"]*" \/>/, "<meta name=\"twitter:image:alt\" content=\"" + BRAND.app.socialAlt + "\" />");
  return applyDisplayName(out);
});

await updateFile("app/overlay.html", (text) =>
  applyDisplayName(text).replace(/<title>[^<]*<\/title>/, "<title>" + BRAND.name + " — " + BRAND.overlay.title + "</title>")
);

for (const relativePath of ["nfc/index.html", "docs/api.md", "docs/api/openapi.yaml", "docs/PP_Basic_Flow.mmd", "docs/PP_Architecture.mmd"]) {
  await updateFile(relativePath, applyDisplayName);
}

await updateFile("app/js/script.js", (text) => {
  let out = text;
  if (!out.startsWith('import BRAND from "./brand.mjs";')) {
    out = 'import BRAND from "./brand.mjs";\n' + out;
  }
  return out
    .replaceAll('lines.push("Padel Push\\n");', 'lines.push(BRAND.name + "\\n");')
    .replaceAll('document.title = "Padel Push - Live Scoreboard";', 'document.title = BRAND.name + " - " + BRAND.app.title;')
    .replaceAll('document.title = `${courtName} (${courtId.toUpperCase()}) | Padel Push`;', 'document.title = `${courtName} (${courtId.toUpperCase()}) | ${BRAND.name}`;')
    .replaceAll('showCourtTitle("Padel Push - Live Scoreboard");', 'showCourtTitle(BRAND.name + " - " + BRAND.app.title);')
    .replaceAll('alt="Padel Push Logo"', 'alt="${BRAND.name} Logo"')
    .replaceAll('alt="Padel Push logo"', 'alt="${BRAND.name} logo"')
);

await updateFile("app/css/style.css", (text) =>
  text.replace("/* Court name drops to its own line beneath the Padel Push heading */",
               "/* Court name drops to its own line beneath the application heading */")
);

console.log("Branding build completed.");
