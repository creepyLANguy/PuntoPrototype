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
  for (const source of ["/a/**", "/r/**", "/s/**", "/m/**", "/b", "/b/**", "/o", "/o/**"]) {
    assert.equal(findSource(source), null, `legacy route ${source} is still reserved`);
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

test("every frontend module, stylesheet and generated document is served without caching", () => {
  const noCacheSources = (firebase.hosting.headers || [])
    .filter(({ headers }) =>
      headers.some(
        ({ key, value }) =>
          key === "Cache-Control" && value === "no-cache, no-store, must-revalidate",
      ),
    )
    .map(({ source }) => globToRegExp(source));

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
      noCacheSources.some((pattern) => pattern.test(`/${file}`)),
      `/${file} must keep the no-cache headers so modules never mix versions`,
    );
  }
});
