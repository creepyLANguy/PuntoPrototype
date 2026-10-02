#!/usr/bin/env node
// Frontend structure validation. Enforces the architectural guardrails
// described in docs/frontend-architecture.md:
//
//   - generated files are up to date with their sources (never edited directly);
//   - third-party minified assets are unmodified and excluded from budgets;
//   - module directories only import the layers they are allowed to;
//   - the Firebase SDK and html-to-image are only imported by their owners;
//   - app/js/script.js stays a thin compatibility entry point, never an implementation;
//   - no import cycle spans more than one module directory;
//   - source files stay inside the agreed size budget;
//   - every HTML include resolves and every asset an entry document references exists.
//
//   node scripts/check-frontend-structure.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { BUILD_TARGETS, REPO_ROOT, findMissingReferences, runBuild } from "./build-frontend.mjs";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

// Lines. Files above REVIEW are reported; files above FAIL fail the check
// unless they are listed in SIZE_EXEMPTIONS with a reason.
const SIZE_BUDGET = { review: 600, fail: 900 };

const SIZE_EXEMPTIONS = new Map([
  ["app/js/script.js", "legacy monolith, pending extraction into module directories"],
  ["app/css/style.css", "legacy stylesheet, pending split into ordered source files"],
  ["app/index.html", "legacy document, pending split into templates"],
  ["app/overlay.html", "legacy overlay document, pending split into sources"],
]);

// Modules that predate the module architecture and are temporarily excused
// from the layering and compatibility-entry rules while they are extracted.
const TRANSITIONAL_MODULES = new Map([
  ["app/js/script.js", "legacy monolith, pending extraction"],
  ["app/js/firebase.js", "still owns changeover UI behaviour, pending extraction"],
]);

// Directories and documents scanned for maintainability budgets. Generated
// artifacts are skipped automatically; their sources are budgeted instead.
const SOURCE_ROOTS = ["app/js", "app/css", "app/templates", "app/overlay"];
const SOURCE_FILES = ["app/index.html", "app/overlay.html"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".css", ".html"]);

// Third-party assets: never reformatted, never counted against budgets.
const VENDOR_FILES = new Map([
  ["app/js/jscolor.min.js", "d4ccfcb13aa7aa1b738cb7de0507b06f374a1603ae81561e64a2024e6ed5854b"],
  ["app/js/qrcode.min.js", "c541ef06327885a8415bca8df6071e14189b4855336def4f36db54bde8484f36"],
]);

// Deployment-time / developer-local files that are not part of the source tree.
const IGNORED_FILES = new Set(["app/js/firebase-config.js"]);

// Which app/js module directories each layer may import. Root-level shared
// modules (brand.mjs, scoreSync.mjs, firebase-config.js) are listed explicitly.
const INFRASTRUCTURE_LAYERS = {
  config: [],
  utils: ["config"],
  state: ["config", "utils"],
  firebase: ["config", "firebase-config.js"],
  audio: ["config", "utils", "state"],
  lifecycle: ["config", "utils", "state"],
  ui: ["config", "utils", "state", "audio", "lifecycle", "brand.mjs"],
};

const FEATURE_LAYERS = [
  "admin",
  "controls",
  "court",
  "details",
  "nfc",
  "qr",
  "routing",
  "scoring",
  "sharing",
  "teams",
];

const SHARED_ROOT_MODULES = ["brand.mjs", "scoreSync.mjs"];

const FEATURE_ALLOWED = [
  ...Object.keys(INFRASTRUCTURE_LAYERS).filter((layer) => layer !== "firebase"),
  "firebase",
  ...FEATURE_LAYERS,
  ...SHARED_ROOT_MODULES,
];

// Remote imports and the only modules allowed to make them.
const REMOTE_IMPORT_OWNERS = [
  { pattern: /^https:\/\/www\.gstatic\.com\/firebasejs\//, owners: ["firebase", "firebase.js"] },
  { pattern: /^https:\/\/esm\.sh\/html-to-image@/, owners: ["sharing"] },
];

// Entry documents whose referenced assets must exist.
const ENTRY_DOCUMENTS = ["app/index.html", "app/overlay.html"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const errors = [];
const warnings = [];

function rel(absolutePath) {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}

function walk(directory) {
  const absolute = path.join(REPO_ROOT, directory);
  if (!fs.existsSync(absolute)) return [];

  const files = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(child));
    else files.push(child.split(path.sep).join("/"));
  }
  return files.sort();
}

function lineCount(text) {
  if (!text) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

// The layer of an app/js module: its first directory, or its file name for
// root-level modules.
function layerOf(relativePath) {
  const inside = relativePath.slice("app/js/".length);
  const [first, ...rest] = inside.split("/");
  return rest.length ? first : first;
}

function isDirectoryLayer(relativePath) {
  return relativePath.slice("app/js/".length).includes("/");
}

// Static import/export-from specifiers (including side-effect imports). The
// frontend never uses dynamic import().
const IMPORT_PATTERNS = [
  /^[ \t]*import\s+(?:[\w*{}\s,$]+?\s+from\s*)?["']([^"']+)["']/gm,
  /^[ \t]*export\s+(?:\*(?:\s+as\s+\w+)?|\{[\w\s,$]*\})\s*from\s*["']([^"']+)["']/gm,
];

function importSpecifiers(source) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return IMPORT_PATTERNS.flatMap((pattern) =>
    [...withoutComments.matchAll(pattern)].map((match) => match[1]),
  );
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkGeneratedArtifacts() {
  const { problems, results } = runBuild({ check: true, log: () => {} });
  errors.push(...problems);

  const generated = new Set(BUILD_TARGETS.map((target) => target.output));
  for (const result of results) {
    for (const dependency of result.dependencies) {
      if (generated.has(dependency)) {
        errors.push(`${result.target.output} includes the generated file ${dependency}`);
      }
    }
  }
  return generated;
}

function checkVendorFiles() {
  for (const [file, expectedHash] of VENDOR_FILES) {
    const absolute = path.join(REPO_ROOT, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`${file}: vendor asset is missing`);
      continue;
    }
    const hash = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    if (hash !== expectedHash) {
      errors.push(
        `${file}: third-party asset changed. Vendor files must not be edited or reformatted; ` +
          "update VENDOR_FILES deliberately when upgrading the library.",
      );
    }
  }
}

function checkSizeBudgets(generated) {
  const files = [...SOURCE_ROOTS.flatMap((root) => walk(root)), ...SOURCE_FILES];

  for (const file of files) {
    {
      if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;
      if (generated.has(file) || VENDOR_FILES.has(file) || IGNORED_FILES.has(file)) continue;

      const lines = lineCount(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
      const exemption = SIZE_EXEMPTIONS.get(file);

      if (lines > SIZE_BUDGET.fail && !exemption) {
        errors.push(
          `${file}: ${lines} lines exceeds the ${SIZE_BUDGET.fail}-line budget. ` +
            "Split it by responsibility (or add a documented exemption).",
        );
      } else if (lines > SIZE_BUDGET.review) {
        warnings.push(
          `${file}: ${lines} lines (review required above ${SIZE_BUDGET.review})` +
            (exemption ? ` - exempt: ${exemption}` : ""),
        );
      }
    }
  }

  for (const file of SIZE_EXEMPTIONS.keys()) {
    if (!fs.existsSync(path.join(REPO_ROOT, file))) {
      errors.push(`${file}: stale size exemption (file no longer exists)`);
    } else if (generated.has(file)) {
      errors.push(`${file}: stale size exemption (the file is now generated)`);
    }
  }

  for (const [file, reason] of TRANSITIONAL_MODULES) {
    warnings.push(`${file}: transitional module excused from layering rules - ${reason}`);
  }
}

function buildModuleGraph() {
  const graph = new Map();

  for (const file of walk("app/js")) {
    if (![".js", ".mjs"].includes(path.extname(file))) continue;
    if (VENDOR_FILES.has(file) || IGNORED_FILES.has(file)) continue;
    if (file === "app/js/firebase-config.template.js") continue;

    const source = fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
    const imports = [];

    for (const specifier of importSpecifiers(source)) {
      if (/^[a-z]+:/i.test(specifier)) {
        imports.push({ specifier, remote: true });
        continue;
      }

      const target = rel(path.resolve(path.dirname(path.join(REPO_ROOT, file)), specifier));
      imports.push({ specifier, target });

      if (!fs.existsSync(path.join(REPO_ROOT, target)) && !IGNORED_FILES.has(target)) {
        errors.push(`${file}: import "${specifier}" does not resolve to a file`);
      }
    }

    graph.set(file, { source, imports });
  }

  return graph;
}

function checkLayering(graph) {
  for (const [file, { imports }] of graph) {
    if (TRANSITIONAL_MODULES.has(file)) continue;
    const layer = layerOf(file);

    for (const { specifier, target, remote } of imports) {
      if (remote) {
        const rule = REMOTE_IMPORT_OWNERS.find(({ pattern }) => pattern.test(specifier));
        if (!rule) {
          errors.push(`${file}: unexpected remote import "${specifier}"`);
        } else if (!rule.owners.includes(layer)) {
          errors.push(`${file}: "${specifier}" may only be imported by ${rule.owners.join(", ")}`);
        }
        continue;
      }

      if (!target.startsWith("app/js/")) {
        errors.push(`${file}: import "${specifier}" leaves app/js`);
        continue;
      }

      const targetLayer = layerOf(target);
      if (targetLayer === layer && isDirectoryLayer(file)) continue;

      if (targetLayer === "main.js") {
        if (file !== "app/js/script.js") {
          errors.push(`${file}: only the compatibility entry point may import main.js`);
        }
        continue;
      }

      if (layer === "main.js") continue;

      if (layer === "script.js") {
        errors.push(`${file}: the compatibility entry point may only import main.js`);
        continue;
      }

      if (layer === "firebase.js") {
        if (targetLayer !== "firebase") {
          errors.push(`${file}: firebase.js may only re-export the firebase/ infrastructure`);
        }
        continue;
      }

      if (layer === "brand.js" && targetLayer === "brand.mjs") continue;

      if (INFRASTRUCTURE_LAYERS[layer]) {
        if (!INFRASTRUCTURE_LAYERS[layer].includes(targetLayer)) {
          errors.push(
            `${file}: the ${layer}/ layer may not import ${target} ` +
              `(allowed: ${INFRASTRUCTURE_LAYERS[layer].join(", ") || "nothing"})`,
          );
        }
        continue;
      }

      if (FEATURE_LAYERS.includes(layer)) {
        if (!FEATURE_ALLOWED.includes(targetLayer)) {
          errors.push(`${file}: feature modules may not import ${target}`);
        }
        continue;
      }

      if (!SHARED_ROOT_MODULES.includes(layer) && layer !== "brand.js") {
        warnings.push(`${file}: module outside the known layers imports ${target}`);
      }
    }
  }
}

function checkCompatibilityEntryPoint(graph) {
  const shim = graph.get("app/js/script.js");
  if (!shim || TRANSITIONAL_MODULES.has("app/js/script.js")) return;

  const code = shim.source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const implementation = code.filter((line) => !/^(?:import|export)\b.*;$/.test(line));
  if (implementation.length) {
    errors.push(
      "app/js/script.js must remain a compatibility entry point that only imports/re-exports " +
        "main.js; application code belongs in the module directories.",
    );
  }
}

// Tarjan's strongly connected components. A cycle inside one directory is a
// cohesive feature; a cycle that spans directories is an architectural cycle.
function checkCycles(graph) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indices = new Map();
  const lowLinks = new Map();
  const components = [];

  const visit = (node) => {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const { target } of graph.get(node)?.imports || []) {
      if (!target || !graph.has(target)) continue;
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(target)));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indices.get(target)));
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component);
    }
  };

  for (const node of graph.keys()) {
    if (!indices.has(node)) visit(node);
  }

  for (const component of components) {
    if (component.length < 2) continue;
    const directories = new Set(component.map((file) => path.posix.dirname(file)));
    if (directories.size > 1) {
      errors.push(
        `Import cycle spans module directories: ${component.sort().join(", ")}. ` +
          "Invert the dependency (see the composition root in app/js/main.js).",
      );
    }
  }
}

function checkEntryDocuments() {
  for (const document of ENTRY_DOCUMENTS) {
    const absolute = path.join(REPO_ROOT, document);
    if (!fs.existsSync(absolute)) {
      errors.push(`${document}: entry document is missing`);
      continue;
    }
    errors.push(...findMissingReferences(document, fs.readFileSync(absolute, "utf8")));
  }
}

// ---------------------------------------------------------------------------

const generated = checkGeneratedArtifacts();
checkVendorFiles();
checkSizeBudgets(generated);
const graph = buildModuleGraph();
checkLayering(graph);
checkCompatibilityEntryPoint(graph);
checkCycles(graph);
checkEntryDocuments();

for (const warning of warnings) console.warn(`warning: ${warning}`);

if (errors.length) {
  for (const error of errors) console.error(`error: ${error}`);
  console.error(`Frontend structure check failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(
  `Frontend structure check passed (${graph.size} modules, ${warnings.length} warning(s)).`,
);
