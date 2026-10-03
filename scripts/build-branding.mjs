// Applies the canonical brand (app/js/brand.mjs) to the customer-facing
// sources, then rebuilds the generated frontend artifacts:
//
//   BRAND -> source templates / modules / stylesheet parts -> frontend build -> generated assets
//
// Generated files (app/index.html, app/overlay.html, app/css/style.css) are
// never edited here; they are rebuilt from the branded sources.
import fs from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import BRAND from "../app/js/brand.mjs";
import { runBuild } from "./build-frontend.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BRAND_NAME = "Padel Push";
const WORDMARK = "PADEL PUSH";

const normalizeExistingBrand = (text) =>
  text.replaceAll("PADEL PUSH™", WORDMARK).replaceAll("Padel Push™", BRAND_NAME);

const applyDisplayName = (text) =>
  normalizeExistingBrand(text)
    .replaceAll(WORDMARK, BRAND.displayName)
    .replaceAll(BRAND_NAME, BRAND.name);

function filesUnder(relativeDirectory, extensions) {
  const absolute = path.join(ROOT, relativeDirectory);
  if (!existsSync(absolute)) return [];

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return filesUnder(child, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [child] : [];
  });
}

async function updateFile(relativePath, transform) {
  const absolutePath = path.join(ROOT, relativePath);
  const before = await fs.readFile(absolutePath, "utf8");
  const after = transform(before, relativePath);
  if (after !== before) {
    await fs.writeFile(absolutePath, after, "utf8");
    console.log("updated " + relativePath);
  }
}

// Landing page (a standalone document, not generated).
await updateFile("index.html", (text) => {
  let out = text;
  out = out.replace(
    /<title>[^<]*<\/title>/,
    "<title>" + BRAND.name + " | " + BRAND.landing.title + "</title>",
  );
  out = out.replace(
    /<meta name="description"\s+content="[^"]*">/,
    '<meta name="description"\n    content="' + BRAND.landing.description + '">',
  );
  out = out.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    '<meta property="og:title" content="' + BRAND.name + " | " + BRAND.landing.title + '" />',
  );
  out = out.replace(
    /<meta property="og:description"\s+content="[^"]*" \/>/,
    '<meta property="og:description"\n    content="' + BRAND.landing.socialDescription + '" />',
  );
  out = out.replace(
    /<meta name="twitter:image:alt" content="[^"]*" \/>/,
    '<meta name="twitter:image:alt" content="' + BRAND.landing.socialAlt + '" />',
  );
  out = out.replace(/(<p class="lead">)[\s\S]*?(<\/p>)/, "$1" + BRAND.tagline + "$2");
  // Normalise first (like normalizeExistingBrand) so re-running is a no-op.
  out = out.replaceAll("Padel%20Push%E2%84%A2", "Padel%20Push");
  out = out.replaceAll("Padel%20Push", encodeURIComponent(BRAND.name));
  return applyDisplayName(out);
});

// Scoring app document: the head lives in the template, the body in fragments.
await updateFile("app/templates/index.template.html", (text) => {
  let out = text;
  out = out.replace(
    /<title>[^<]*<\/title>/,
    "<title>" + BRAND.name + " - " + BRAND.app.title + "</title>",
  );
  out = out.replace(
    /<meta name="description"\s+content="[^"]*" \/>/,
    '<meta name="description"\n    content="' + BRAND.app.description + '" />',
  );
  out = out.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    '<meta property="og:title" content="' + BRAND.name + " - " + BRAND.app.title + '" />',
  );
  out = out.replace(
    /<meta property="og:description"\s+content="[^"]*" \/>/,
    '<meta property="og:description"\n    content="' + BRAND.app.socialDescription + '" />',
  );
  out = out.replace(
    /<meta name="twitter:image:alt" content="[^"]*" \/>/,
    '<meta name="twitter:image:alt" content="' + BRAND.app.socialAlt + '" />',
  );
  return applyDisplayName(out);
});

for (const relativePath of filesUnder("app/templates", [".html"])) {
  if (relativePath === "app/templates/index.template.html") continue;
  await updateFile(relativePath, applyDisplayName);
}

// OBS overlay: template plus its stylesheet and script parts.
await updateFile("app/overlay/template.html", (text) =>
  applyDisplayName(text).replace(
    /<title>[^<]*<\/title>/,
    "<title>" + BRAND.name + " — " + BRAND.overlay.title + "</title>",
  ),
);

for (const relativePath of filesUnder("app/overlay", [".css", ".js"])) {
  await updateFile(relativePath, applyDisplayName);
}

for (const relativePath of [
  "nfc/index.html",
  "docs/api.md",
  "docs/api/openapi.yaml",
  "docs/PP_Basic_Flow.mmd",
  "docs/PP_Architecture.mmd",
]) {
  await updateFile(relativePath, applyDisplayName);
}

// Scoring app modules: customer-facing strings come from BRAND at runtime.
for (const relativePath of filesUnder("app/js", [".js"])) {
  if (relativePath.endsWith(".min.js") || relativePath.endsWith("firebase-config.js")) continue;

  await updateFile(relativePath, (text) => {
    let out = text
      .replaceAll('lines.push("Padel Push\\n");', 'lines.push(BRAND.name + "\\n");')
      .replaceAll(
        'document.title = "Padel Push - Live Scoreboard";',
        'document.title = BRAND.name + " - " + BRAND.app.title;',
      )
      .replaceAll(
        "document.title = `${courtName} (${courtId.toUpperCase()}) | Padel Push`;",
        "document.title = `${courtName} (${courtId.toUpperCase()}) | ${BRAND.name}`;",
      )
      .replaceAll(
        'showCourtTitle("Padel Push - Live Scoreboard");',
        'showCourtTitle(BRAND.name + " - " + BRAND.app.title);',
      )
      .replaceAll('alt="Padel Push Logo"', 'alt="${BRAND.name} Logo"')
      .replaceAll('alt="Padel Push logo"', 'alt="${BRAND.name} logo"')
      .replaceAll(
        "new Error('Padel Push logo could not be loaded')",
        "new Error(`${BRAND.name} logo could not be loaded`)",
      )
      .replaceAll("// Cache the Padel Push logo", "// Cache the brand logo");

    if (/\bBRAND\./.test(out) && !/^import BRAND from /m.test(out)) {
      const brandModule = path.posix.relative(path.posix.dirname(relativePath), "app/js/brand.mjs");
      const specifier = brandModule.startsWith(".") ? brandModule : "./" + brandModule;
      // After the module's header comment, before its first import.
      const statement = `import BRAND from "${specifier}";\n`;
      const header = out.match(/^(?:\/\/[^\n]*\n)*/)[0];
      const firstImport = out.search(/^import /m);
      const at = firstImport === -1 ? header.length : firstImport;
      out = out.slice(0, at) + statement + out.slice(at);
    }
    return out;
  });
}

for (const relativePath of filesUnder("app/css", [".css"])) {
  if (relativePath === "app/css/style.css") continue;
  await updateFile(relativePath, (text) =>
    text.replace(
      "/* Court name drops to its own line beneath the Padel Push heading */",
      "/* Court name drops to its own line beneath the application heading */",
    ),
  );
}

const { problems } = runBuild({ log: (line) => console.log(line) });
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}

console.log("Branding build completed.");
