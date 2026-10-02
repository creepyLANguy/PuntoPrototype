#!/usr/bin/env node
// Frontend build: assembles the generated Hosting artifacts from their source
// representation.
//
//   node scripts/build-frontend.mjs           write every generated artifact
//   node scripts/build-frontend.mjs --check   fail if any artifact is stale
//
// The build is intentionally tiny. It does not bundle, transpile or minify:
// the browser still receives the same complete documents and native ES
// modules it always has. It only
//
//   1. assembles HTML templates (`<!-- @include path -->` lines),
//   2. assembles CSS source files (`@import "path";` lines),
//   3. validates the local assets referenced by the generated documents,
//   4. fails on unresolved or circular includes, and
//   5. produces deterministic output (no timestamps, LF line endings).
//
// See docs/frontend-architecture.md for the source layout.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Every generated artifact, in build order. `source` is the entry template or
// stylesheet; `output` is the file Firebase Hosting serves.
export const BUILD_TARGETS = [
  { kind: "css", source: "app/css/index.css", output: "app/css/style.css" },
];

const HTML_INCLUDE = /^[ \t]*<!--[ \t]*@include[ \t]+(\S+)[ \t]*-->[ \t]*$/;
const CSS_IMPORT = /^@import[ \t]+"([^"]+)";[ \t]*$/;

export class BuildError extends Error {}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function readSource(absolutePath, includeChain) {
  if (!fs.existsSync(absolutePath)) {
    const from = includeChain.length
      ? ` (included from ${toPosix(path.relative(REPO_ROOT, includeChain.at(-1)))})`
      : "";
    throw new BuildError(
      `Unresolved include: ${toPosix(path.relative(REPO_ROOT, absolutePath))}${from}`,
    );
  }

  return fs.readFileSync(absolutePath, "utf8").replace(/\r\n/g, "\n");
}

// Expands include directives recursively. A directive must occupy a whole
// line; the line is replaced by the included file's content verbatim, so the
// included file carries its own indentation and trailing newline.
function expand(absolutePath, directive, includeChain, dependencies) {
  if (includeChain.includes(absolutePath)) {
    const cycle = [...includeChain, absolutePath]
      .map((file) => toPosix(path.relative(REPO_ROOT, file)))
      .join(" -> ");
    throw new BuildError(`Circular include: ${cycle}`);
  }

  const text = readSource(absolutePath, includeChain);
  dependencies.add(absolutePath);

  const chain = [...includeChain, absolutePath];
  const lines = text.split("\n");
  const out = [];

  lines.forEach((line, index) => {
    const match = line.match(directive);
    if (!match) {
      out.push(index === lines.length - 1 ? line : line + "\n");
      return;
    }

    const includePath = path.resolve(path.dirname(absolutePath), match[1]);
    const included = expand(includePath, directive, chain, dependencies);
    if (!included.endsWith("\n")) {
      throw new BuildError(
        `Included file must end with a newline: ${toPosix(path.relative(REPO_ROOT, includePath))}`,
      );
    }
    out.push(included);
  });

  return out.join("");
}

function generatedBanner(target) {
  const source = target.source;
  const notice = `GENERATED FILE - DO NOT EDIT. Built by scripts/build-frontend.mjs from ${source}.`;
  return target.kind === "css" ? `/* ${notice} */\n` : `<!-- ${notice} -->\n`;
}

function withBanner(target, body) {
  const banner = generatedBanner(target);

  if (target.kind === "css") {
    return banner + body;
  }

  // Keep <!DOCTYPE html> as the first line so the document mode is unaffected.
  const doctype = body.match(/^<!DOCTYPE html>\n/i);
  return doctype ? doctype[0] + banner + body.slice(doctype[0].length) : banner + body;
}

// A stylesheet manifest lists its parts in cascade order. Its own comments and
// blank lines document the manifest and are not emitted; anything else would
// silently change the cascade, so it is rejected.
function expandStylesheetManifest(sourcePath, dependencies) {
  const text = readSource(sourcePath, []);
  dependencies.add(sourcePath);

  const withoutComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const parts = [];
  for (const line of withoutComments.split("\n")) {
    if (line.trim() === "") continue;
    const match = line.match(CSS_IMPORT);
    if (!match) {
      throw new BuildError(
        `${toPosix(path.relative(REPO_ROOT, sourcePath))}: a stylesheet manifest may only contain ` +
          `@import "part.css"; lines and comments (found: ${line.trim()})`,
      );
    }
    parts.push(path.resolve(path.dirname(sourcePath), match[1]));
  }

  return parts
    .map((part) => {
      const content = expand(part, CSS_IMPORT, [sourcePath], dependencies);
      if (!content.endsWith("\n")) {
        throw new BuildError(
          `Stylesheet part must end with a newline: ${toPosix(path.relative(REPO_ROOT, part))}`,
        );
      }
      return content;
    })
    .join("");
}

export function buildTarget(target) {
  const sourcePath = path.join(REPO_ROOT, target.source);
  const dependencies = new Set();
  const body =
    target.kind === "css"
      ? expandStylesheetManifest(sourcePath, dependencies)
      : expand(sourcePath, HTML_INCLUDE, [], dependencies);

  return {
    target,
    content: withBanner(target, body),
    dependencies: [...dependencies].map((file) => toPosix(path.relative(REPO_ROOT, file))),
  };
}

// ---------------------------------------------------------------------------
// Reference validation
// ---------------------------------------------------------------------------

const ATTRIBUTE_REFERENCE =
  /<(script|link|img|source|audio|video)\b[^>]*?\s(src|href)\s*=\s*"([^"]*)"/gi;

function isExternalReference(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value) || value === "";
}

// Resolves a reference the way the browser would for the document's served
// URL path (honouring <base href>), then maps it onto the Hosting public root.
export function resolveLocalReference(documentUrlPath, html, reference) {
  const baseMatch = html.match(/<base\s+href="([^"]+)"/i);
  const documentUrl = new URL(documentUrlPath, "https://hosting.invalid");
  const baseUrl = baseMatch ? new URL(baseMatch[1], documentUrl) : documentUrl;
  const resolved = new URL(reference, baseUrl);
  return decodeURIComponent(resolved.pathname);
}

// Markup only: inline scripts, inline styles and comments are not references.
function stripNonMarkup(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, "$1$2")
    .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, "$1$2");
}

export function findMissingReferences(outputRelativePath, html) {
  const documentUrlPath = "/" + toPosix(outputRelativePath);
  const missing = [];

  for (const match of stripNonMarkup(html).matchAll(ATTRIBUTE_REFERENCE)) {
    const [, tag, attribute, value] = match;
    if (isExternalReference(value)) continue;

    // Only stylesheet/icon/manifest links point at files; preconnect and
    // canonical links do not.
    if (
      tag.toLowerCase() === "link" &&
      !/rel="(?:stylesheet|icon|manifest|preload)"/i.test(match[0])
    ) {
      continue;
    }

    const urlPath = resolveLocalReference(documentUrlPath, html, value);
    const filePath = path.join(REPO_ROOT, urlPath);
    if (!fs.existsSync(filePath)) {
      missing.push(
        `${outputRelativePath}: <${tag} ${attribute}="${value}"> -> ${urlPath} does not exist`,
      );
    }
  }

  return missing;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function runBuild({ check = false, log = console.log } = {}) {
  const problems = [];
  const results = [];

  for (const target of BUILD_TARGETS) {
    let result;
    try {
      result = buildTarget(target);
    } catch (error) {
      if (error instanceof BuildError) {
        problems.push(error.message);
        continue;
      }
      throw error;
    }

    results.push(result);

    if (target.kind === "html") {
      problems.push(...findMissingReferences(target.output, result.content));
    }

    const outputPath = path.join(REPO_ROOT, target.output);
    const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : null;

    if (current === result.content) {
      log(`up to date  ${target.output}`);
      continue;
    }

    if (check) {
      problems.push(
        `${target.output} is out of date with its sources. ` +
          "Edit the sources and run `node scripts/build-frontend.mjs` instead of editing the generated file.",
      );
      continue;
    }

    fs.writeFileSync(outputPath, result.content, "utf8");
    log(`generated   ${target.output}`);
  }

  return { problems, results };
}

const isCli = import.meta.url === pathToFileURL(process.argv[1] || "").href;

if (isCli) {
  const check = process.argv.includes("--check");
  const { problems } = runBuild({ check });

  if (problems.length) {
    console.error(problems.map((problem) => `error: ${problem}`).join("\n"));
    process.exit(1);
  }

  console.log(check ? "Frontend build check passed." : "Frontend build completed.");
}
