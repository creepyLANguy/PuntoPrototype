// Hosting-route regression tests for the public endpoint rename.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const firebase = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
const redirects = firebase.hosting.redirects || [];
const rewrites = firebase.hosting.rewrites || [];

function findRedirect(source) {
  return redirects.find((redirect) => redirect.source === source) || null;
}

function findSource(source) {
  return rewrites.find((rewrite) => rewrite.source === source) || null;
}

test("canonical full-word read endpoints redirect to Johannesburg functions", () => {
  const expected = [
    ["/score/:courtId", "getCourtScore"],
    ["/revision/:courtId", "getCourtScoreRevision"],
    ["/stats/:courtId", "getCourtStats"],
    ["/momentum/:courtId", "getCourtMomentum"],
  ];

  for (const [source, functionId] of expected) {
    const redirect = findRedirect(source);
    assert.equal(redirect?.type, 307);

    const destination = new URL(redirect.destination);
    assert.equal(destination.protocol, "https:");

    const isJohannesburgFunction =
      destination.hostname === "africa-south1-__firebase_project_id__.cloudfunctions.net" ||
      /^africa-south1-[a-z0-9-]+\.cloudfunctions\.net$/.test(destination.hostname);

    assert.equal(
      isJohannesburgFunction,
      true,
      `unexpected Johannesburg function hostname: ${destination.hostname}`,
    );
    assert.equal(destination.pathname, `/${functionId}/:courtId`);
  }
});

test("canonical overlay route is deployed", () => {
  assert.equal(findSource("/overlay")?.destination, "/app/overlay.html");
  assert.equal(findSource("/overlay/**")?.destination, "/app/overlay.html");
});

test("court and play roots are available without a court id", () => {
  assert.equal(findSource("/c")?.destination, "/app/index.html");
  assert.equal(findSource("/c/**")?.destination, "/app/index.html");
  assert.equal(findSource("/p")?.destination, "/app/index.html");
  assert.equal(findSource("/p/**")?.destination, "/app/index.html");
});

test("legacy single-character endpoint routes are genuinely free", () => {
  for (const source of ["/a/**", "/r/**", "/s/**", "/b", "/b/**", "/o", "/o/**"]) {
    assert.equal(findSource(source), null, `legacy route ${source} is still reserved`);
  }
});

test("/m/** is reserved for durable match pages and /t/** for tournaments", () => {
  assert.equal(findSource("/m")?.destination, "/app/match.html");
  assert.equal(findSource("/m/**")?.destination, "/app/match.html");
  assert.equal(findSource("/t")?.destination, "/app/tournament.html");
  assert.equal(findSource("/t/**")?.destination, "/app/tournament.html");

  // The match and tournament routes must win over the catch-all rewrite.
  const index = (source) => rewrites.findIndex((rewrite) => rewrite.source === source);
  assert.ok(index("/m/**") < index("**"));
  assert.ok(index("/t/**") < index("**"));
});

test("public read endpoints also address durable matches", () => {
  const expected = [
    ["/score/match/:matchId", "getCourtScore"],
    ["/revision/match/:matchId", "getCourtScoreRevision"],
    ["/stats/match/:matchId", "getCourtStats"],
    ["/momentum/match/:matchId", "getCourtMomentum"],
  ];
  for (const [source, functionId] of expected) {
    const redirect = findRedirect(source);
    assert.equal(redirect?.type, 307, source);
    assert.equal(new URL(redirect.destination).pathname, `/${functionId}/match/:matchId`);
  }
});

// Firebase Hosting header globs: `**` spans path segments, `*` stays within one.
function globToRegExp(glob) {
  const pattern = glob
    .split("**")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"))
    .join(".*");
  return new RegExp(`^${pattern}$`);
}

function listFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const child = `${directory}/${entry.name}`;
    return entry.isDirectory() ? listFiles(child) : [child];
  });
}

// Header rules that disable caching, as regular expressions over the request
// path. A rule has either a glob `source` or an RE2 `regex` (RE2 is a subset
// of JavaScript regular expressions for the patterns used here).
const noCacheSources = (firebase.hosting.headers || [])
  .filter(({ headers }) =>
    headers.some(
      ({ key, value }) =>
        key === "Cache-Control" && value === "no-cache, no-store, must-revalidate",
    ),
  )
  .map(({ source, regex }) => (regex ? new RegExp(regex) : globToRegExp(source)));
const isNoCache = (requestPath) => noCacheSources.some((pattern) => pattern.test(requestPath));

test("every frontend module, stylesheet and generated document is served without caching", () => {
  const servedFiles = [
    ...listFiles("app/js").filter((file) => /\.m?js$/.test(file)),
    ...listFiles("app/css").filter((file) => file.endsWith(".css")),
    "app/index.html",
    "app/overlay.html",
  ];

  assert.ok(servedFiles.includes("app/js/main.js"));
  assert.ok(servedFiles.includes("app/js/scoring/scoreboard.js"));
  for (const file of servedFiles) {
    assert.ok(
      isNoCache(`/${file}`),
      `/${file} must keep the no-cache headers so modules never mix versions`,
    );
  }
});

// Hosting matches headers against the requested URL, not the rewrite
// destination, so every page URL needs its own no-cache rule. Otherwise a
// browser can keep an hour-old copy of the page and run it with the newest
// modules (which are never cached), and the app breaks wherever the old
// markup lacks elements the new code needs.
test("every page URL is served without caching, whatever document it rewrites to", () => {
  const pageRoutes = firebase.hosting.rewrites.filter(({ destination }) =>
    destination?.endsWith(".html"),
  );
  assert.ok(pageRoutes.length > 20);

  const samplePaths = new Set(["/", "/unknown-page", "/app/c/abcd", "/app/p/abcd"]);
  for (const { source } of pageRoutes) {
    if (source === "**") continue;
    samplePaths.add(source.replace(/\/\*\*$/, ""));
    samplePaths.add(source.replace(/\*\*$/, "abcd"));
    samplePaths.add(source.replace(/\*\*$/, "abcd/extra"));
  }
  assert.ok(samplePaths.has("/c/abcd") && samplePaths.has("/admin") && samplePaths.has("/overlay"));

  for (const requestPath of samplePaths) {
    assert.ok(isNoCache(requestPath), `${requestPath} must be served without caching`);
  }

  const htmlFiles = [
    "index.html",
    ...listFiles("app").filter((file) => /^app\/[^/]+\.html$/.test(file)),
    "nfc/index.html",
    "device-harness/index.html",
  ];
  for (const file of htmlFiles) {
    assert.ok(isNoCache(`/${file}`), `/${file} must be served without caching`);
  }
});

test("images and other static media stay cacheable", () => {
  const mediaFiles = listFiles("media");
  assert.ok(mediaFiles.length > 0);
  for (const file of mediaFiles) {
    assert.equal(isNoCache(`/${file}`), false, `/${file} should keep normal caching`);
  }
});
