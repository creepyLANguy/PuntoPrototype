// Hosting-route regression tests for the public endpoint rename.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const firebase = JSON.parse(fs.readFileSync(path.join(root, "firebase.json"), "utf8"));
const rewrites = firebase.hosting.rewrites || [];

function findSource(source)
{
  return rewrites.find((rewrite) => rewrite.source === source) || null;
}

test("canonical full-word read endpoints are deployed", () =>
{
  assert.equal(findSource("/score/**")?.function?.functionId, "getCourtScore");
  assert.equal(findSource("/revision/**")?.function?.functionId, "getCourtScoreRevision");
  assert.equal(findSource("/stats/**")?.function?.functionId, "getCourtStats");
  assert.equal(findSource("/momentum/**")?.function?.functionId, "getCourtMomentum");
});

test("canonical overlay route is deployed", () =>
{
  assert.equal(findSource("/overlay")?.destination, "/app/overlay.html");
  assert.equal(findSource("/overlay/**")?.destination, "/app/overlay.html");
});

test("court and play roots are available without a court id", () =>
{
  assert.equal(findSource("/c")?.destination, "/app/index.html");
  assert.equal(findSource("/c/**")?.destination, "/app/index.html");
  assert.equal(findSource("/p")?.destination, "/app/index.html");
  assert.equal(findSource("/p/**")?.destination, "/app/index.html");
});

test("legacy single-character endpoint routes are genuinely free", () =>
{
  for (const source of [
    "/a/**",
    "/r/**",
    "/s/**",
    "/m/**",
    "/b",
    "/b/**",
    "/o",
    "/o/**"
  ])
  {
    assert.equal(findSource(source), null, `legacy route ${source} is still reserved`);
  }
});
