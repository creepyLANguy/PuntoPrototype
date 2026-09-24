import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
const source = readFileSync(new URL("../app/js/script.js", import.meta.url), "utf8");

test("share button uses the continuous engagement animation", () =>
{
  assert.match(
    styles,
    /\.dm-share-btn\s*\{[\s\S]*?animation:\s*matchEngagementPulse\s+4\.8s\s+ease-in-out\s+infinite;/
  );
  assert.match(styles, /@keyframes\s+matchEngagementPulse\s*\{/);
});

test("share button stops animating after it is clicked", () =>
{
  assert.match(
    styles,
    /\.dm-share-btn\.engagement-animation-disabled\s*\{[\s\S]*?animation:\s*none;[\s\S]*?opacity:\s*var\(--engagement-rest-opacity\);/
  );
  assert.match(
    source,
    /elements\.shareDetailsBtn\.classList\.add\("engagement-animation-disabled"\);[\s\S]*?void share\("details"\);/
  );
});

test("share animation is re-enabled when the details modal is actually opened", () =>
{
  assert.match(
    source,
    /const detailsWasHidden = elements\.detailsModal\.classList\.contains\("hidden"\);/
  );
  assert.match(
    source,
    /if \(detailsWasHidden\)\s*\{[\s\S]*?elements\.shareDetailsBtn\?\.classList\.remove\("engagement-animation-disabled"\);/
  );
});

test("share animation is not reset just because already-open details are refreshed", () =>
{
  assert.match(
    source,
    /if \(detailsWasHidden\)[\s\S]*?elements\.detailsModal\.classList\.remove\("hidden"\);/
  );
  assert.match(
    source,
    /showMatchDetails\(false, elements\.dmDetailsContent\.hidden === false, true\);/
  );
});

test("share engagement rests at a lower opacity and briefly increases opacity", () =>
{
  assert.match(
    styles,
    /\.dm-share-btn\s*\{[\s\S]*?--engagement-rest-opacity:\s*0\.75;[\s\S]*?opacity:\s*var\(--engagement-rest-opacity\);/
  );
  assert.match(styles, /82%\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(styles, /90%\s*\{[\s\S]*?opacity:\s*0\.9/);
});

test("scoreboard Match Details animation is restricted to detected mobile devices", () =>
{
  assert.match(
    styles,
    /\.mobile-device \.match-details-btn\s*\{[\s\S]*?animation:\s*matchEngagementPulse\s+4\.8s\s+ease-in-out\s+infinite;/
  );

  const matchDetailsRule = styles.match(
    /\.match-details-btn\s*\{[\s\S]*?\}/
  )?.[0];

  assert.ok(matchDetailsRule, "base Match Details rule should exist");
  assert.doesNotMatch(matchDetailsRule, /animation:\s*matchEngagementPulse/);

  assert.match(source, /navigator\.userAgentData\?\.mobile === true/);
  assert.match(source, /navigator\.platform === "MacIntel" && navigator\.maxTouchPoints > 1/);
  assert.match(source, /classList\.toggle\("mobile-device", isMobileDevice\)/);
});

test("expandable match details arrow pulses twice while collapsed and stops while expanded", () =>
{
  assert.match(
    styles,
    /\.dm-details-toggle\[aria-expanded="false"\] \.dm-details-toggle-icon\s*\{[\s\S]*?animation:\s*matchDetailsArrowPulse\s+4\.8s\s+ease-in-out\s+infinite;[\s\S]*?animation-delay:\s*-2\.4s;/
  );
  assert.match(styles, /transform:\s*scale\(1\.14\)\s+translateY\(5px\);[\s\S]*?transform:\s*scale\(1\.14\)\s+translateY\(0\);[\s\S]*?transform:\s*scale\(1\.14\)\s+translateY\(5px\);/);
  assert.match(
    styles,
    /\.dm-details-toggle\[aria-expanded="true"\] \.dm-details-toggle-icon\s*\{[\s\S]*?animation:\s*none;[\s\S]*?transform:\s*rotate\(180deg\);/
  );
});

test("engagement animations are disabled when reduced motion is requested", () =>
{
  assert.match(
    styles,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.match-details-btn,\s*\.dm-share-btn,\s*\.dm-details-toggle-icon\s*\{[\s\S]*?animation:\s*none;/
  );
});
