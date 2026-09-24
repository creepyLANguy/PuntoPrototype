import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
const source = readFileSync(new URL("../app/js/script.js", import.meta.url), "utf8");

test("match details and share buttons use the same infinite engagement animation", () =>
{
  assert.match(
    styles,
    /\.match-details-btn,\s*\.dm-share-btn\s*\{[\s\S]*?animation:\s*matchEngagementPulse\s+4\.8s\s+ease-in-out\s+infinite;/
  );
  assert.match(styles, /@keyframes\s+matchEngagementPulse\s*\{/);
  assert.doesNotMatch(styles, /engagement-nudge-once|matchDetailsShareNudge|matchStatsEngagementPulse/);
});

test("the engagement pulse briefly restores full opacity before fading back to resting opacity", () =>
{
  const animation = styles.match(
    /@keyframes\s+matchEngagementPulse\s*\{([\s\S]*?)\n\}/
  )?.[1];

  assert.ok(animation, "shared engagement animation should exist");
  assert.match(animation, /0%, 72%, 100%\s*\{[\s\S]*?opacity:\s*0\.45/);
  assert.match(animation, /82%\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(animation, /90%\s*\{[\s\S]*?opacity:\s*0\.65/);
});

test("engagement animation is disabled when reduced motion is requested", () =>
{
  assert.match(
    styles,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.match-details-btn,\s*\.dm-share-btn\s*\{[\s\S]*?animation:\s*none;/
  );
});

test("share engagement is CSS-driven rather than one-shot JavaScript state", () =>
{
  assert.doesNotMatch(source, /detailsShareNudgePending|prepareDetailsShareNudge|triggerDetailsShareNudge|engagement-nudge-once/);
});
