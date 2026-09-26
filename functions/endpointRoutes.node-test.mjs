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
    assert.match(
      redirect?.destination || "",
      new RegExp(
        `^https://africa-south1-[a-z0-9-]+\\\\.cloudfunctions\\\\.net/${functionId}/:courtId$`,
      ),
    );
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
