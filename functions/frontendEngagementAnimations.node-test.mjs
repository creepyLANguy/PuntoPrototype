import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { JSDOM } from "jsdom";

const styles = readFileSync(new URL("../app/css/style.css", import.meta.url), "utf8");
const source = readFileSync(new URL("../app/js/script.js", import.meta.url), "utf8");

test("share button uses the continuous engagement animation", () => {
  assert.match(
    styles,
    /\.dm-share-btn\s*\{[\s\S]*?animation:\s*matchEngagementPulse\s+4\.8s\s+ease-in-out\s+infinite;/,
  );
  assert.match(styles, /@keyframes\s+matchEngagementPulse\s*\{/);
});

test("share button stops animating after it is clicked", () => {
  assert.match(
    styles,
    /\.dm-share-btn\.engagement-animation-disabled\s*\{[\s\S]*?animation:\s*none;[\s\S]*?opacity:\s*var\(--engagement-rest-opacity\);/,
  );
  assert.match(
    source,
    /elements\.shareDetailsBtn\.classList\.add\("engagement-animation-disabled"\);[\s\S]*?void share\("details"\);/,
  );
});

test("share animation is re-enabled when the details modal is actually opened", () => {
  assert.match(
    source,
    /const detailsWasHidden = elements\.detailsModal\.classList\.contains\("hidden"\);/,
  );
  assert.match(
    source,
    /if \(detailsWasHidden\)\s*\{[\s\S]*?elements\.shareDetailsBtn\?\.classList\.remove\("engagement-animation-disabled"\);/,
  );
});

test("share animation is not reset just because already-open details are refreshed", () => {
  assert.match(
    source,
    /if \(detailsWasHidden\)[\s\S]*?elements\.detailsModal\.classList\.remove\("hidden"\);/,
  );
  assert.match(
    source,
    /showMatchDetails\(false, elements\.dmDetailsContent\.hidden === false, true\);/,
  );
});

test("share engagement rests at a lower opacity and briefly increases opacity", () => {
  assert.match(
    styles,
    /\.dm-share-btn\s*\{[\s\S]*?--engagement-rest-opacity:\s*0\.75;[\s\S]*?opacity:\s*var\(--engagement-rest-opacity\);/,
  );
  assert.match(styles, /82%\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(styles, /90%\s*\{[\s\S]*?opacity:\s*0\.9/);
});

test("scoreboard Match Details animation is restricted to detected mobile devices", () => {
  assert.match(
    styles,
    /\.mobile-device \.match-details-btn\s*\{[\s\S]*?animation:\s*matchEngagementPulse\s+4\.8s\s+ease-in-out\s+infinite;/,
  );

  const matchDetailsRule = styles.match(/\.match-details-btn\s*\{[\s\S]*?\}/)?.[0];

  assert.ok(matchDetailsRule, "base Match Details rule should exist");
  assert.doesNotMatch(matchDetailsRule, /animation:\s*matchEngagementPulse/);

  assert.match(source, /navigator\.userAgentData\?\.mobile === true/);
  assert.match(source, /navigator\.platform === "MacIntel" && navigator\.maxTouchPoints > 1/);
  assert.match(source, /classList\.toggle\("mobile-device", isMobileDevice\)/);
});

test("expandable match details arrow pulses twice while collapsed and stops while expanded", () => {
  assert.match(
    styles,
    /\.dm-details-toggle\[aria-expanded="false"\] \.dm-details-toggle-icon\s*\{[\s\S]*?animation:\s*matchDetailsArrowPulse\s+4\.8s\s+ease-in-out\s+infinite;[\s\S]*?animation-delay:\s*-2\.4s;/,
  );
  assert.match(
    styles,
    /transform:\s*scale\(1\.14\)\s+translateY\(5px\);[\s\S]*?transform:\s*scale\(1\.14\)\s+translateY\(0\);[\s\S]*?transform:\s*scale\(1\.14\)\s+translateY\(5px\);/,
  );
  assert.match(
    styles,
    /\.dm-details-toggle\[aria-expanded="true"\] \.dm-details-toggle-icon\s*\{[\s\S]*?animation:\s*none;[\s\S]*?transform:\s*rotate\(180deg\);/,
  );
});


function extractFunction(source, functionName)
{
  const signature = `function ${functionName}(`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `Could not find ${functionName}`);

  const bodyStart = source.indexOf("{", start);
  assert.notEqual(bodyStart, -1, `Could not find ${functionName} body`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = bodyStart; i < source.length; i++)
  {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment)
    {
      if (char === "\n") lineComment = false;
      continue;
    }

    if (blockComment)
    {
      if (char === "*" && next === "/")
      {
        blockComment = false;
        i++;
      }
      continue;
    }

    if (quote)
    {
      if (escaped)
      {
        escaped = false;
        continue;
      }

      if (char === "\\")
      {
        escaped = true;
        continue;
      }

      if (char === quote)
      {
        quote = null;
      }

      continue;
    }

    if ((char === "'" || char === '"' || char === "`"))
    {
      quote = char;
      continue;
    }

    if (char === "/" && next === "/")
    {
      lineComment = true;
      i++;
      continue;
    }

    if (char === "/" && next === "*")
    {
      blockComment = true;
      i++;
      continue;
    }

    if (char === "{")
    {
      depth++;
      continue;
    }

    if (char === "}")
    {
      depth--;
      if (depth === 0)
      {
        return source.slice(start, i + 1);
      }
    }
  }

  throw new Error(`Could not find end of ${functionName}`);
}

function createToastHarness(rect, viewport = { width: 1000, height: 800 })
{
  const dom = new JSDOM(`
    <div id="toastContainer"></div>
    <div class="floating-controls"></div>
  `);

  const { document } = dom.window;
  const container = document.getElementById("toastContainer");
  const controls = document.querySelector(".floating-controls");

  Object.defineProperty(dom.window, "innerWidth", {
    configurable: true,
    value: viewport.width,
  });
  Object.defineProperty(dom.window, "innerHeight", {
    configurable: true,
    value: viewport.height,
  });

  controls.getBoundingClientRect = () => ({ ...rect });

  const updateToastContainerPosition = vm.runInNewContext(
    `(${extractFunction(source, "updateToastContainerPosition")})`,
    {
      document,
      window: dom.window,
    },
  );

  return {
    dom,
    document,
    container,
    controls,
    updateToastContainerPosition,
  };
}

test("toast positioning clears stale offsets before calculating a new position", () => {
  const harness = createToastHarness({
    top: 700,
    left: 100,
    width: 600,
    height: 60,
    right: 700,
    bottom: 760,
  });

  harness.container.style.setProperty("--toast-bottom-offset", "999px");
  harness.container.style.setProperty("--toast-right-offset", "888px");

  harness.updateToastContainerPosition();

  assert.equal(harness.container.style.getPropertyValue("--toast-bottom-offset"), "116px");
  assert.equal(harness.container.style.getPropertyValue("--toast-right-offset"), "");
});

test("toast positioning reserves the correct right-side clearance in landscape", () => {
  const harness = createToastHarness(
    {
      top: 50,
      left: 900,
      width: 70,
      height: 500,
      right: 970,
      bottom: 550,
    },
    { width: 1000, height: 600 },
  );

  harness.updateToastContainerPosition();

  assert.equal(harness.container.style.getPropertyValue("--toast-right-offset"), "116px");
  assert.equal(harness.container.style.getPropertyValue("--toast-bottom-offset"), "");
});

test("toast positioning enforces a minimum 16px clearance", () => {
  const portrait = createToastHarness({
    top: 799,
    left: 0,
    width: 400,
    height: 40,
    right: 400,
    bottom: 839,
  });

  portrait.updateToastContainerPosition();

  assert.equal(portrait.container.style.getPropertyValue("--toast-bottom-offset"), "16px");

  const landscape = createToastHarness(
    {
      top: 0,
      left: 999,
      width: 40,
      height: 400,
      right: 1039,
      bottom: 400,
    },
    { width: 1000, height: 600 },
  );

  landscape.updateToastContainerPosition();

  assert.equal(landscape.container.style.getPropertyValue("--toast-right-offset"), "16px");
});

test("toast positioning safely falls back to CSS defaults when controls are absent or not measurable", () => {
  const dom = new JSDOM(`
    <div id="toastContainer"></div>
  `);
  const { document } = dom.window;

  const updateToastContainerPosition = vm.runInNewContext(
    `(${extractFunction(source, "updateToastContainerPosition")})`,
    {
      document,
      window: dom.window,
    },
  );

  const container = document.getElementById("toastContainer");
  container.style.setProperty("--toast-bottom-offset", "123px");
  container.style.setProperty("--toast-right-offset", "456px");

  updateToastContainerPosition();

  assert.equal(container.style.getPropertyValue("--toast-bottom-offset"), "");
  assert.equal(container.style.getPropertyValue("--toast-right-offset"), "");

  const controls = document.createElement("div");
  controls.className = "floating-controls";
  controls.getBoundingClientRect = () => ({
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    right: 0,
    bottom: 0,
  });
  document.body.appendChild(controls);

  container.style.setProperty("--toast-bottom-offset", "123px");
  container.style.setProperty("--toast-right-offset", "456px");

  updateToastContainerPosition();

  assert.equal(container.style.getPropertyValue("--toast-bottom-offset"), "");
  assert.equal(container.style.getPropertyValue("--toast-right-offset"), "");
});

test("showToast recalculates positioning, appends a typed toast, and removes it after the toast duration", () => {
  const harness = createToastHarness({
    top: 700,
    left: 100,
    width: 600,
    height: 60,
    right: 700,
    bottom: 760,
  });

  let timeoutCallback = null;
  let timeoutDelay = null;

  const showToast = vm.runInNewContext(
    `(${extractFunction(source, "showToast")})`,
    {
      document: harness.document,
      updateToastContainerPosition: harness.updateToastContainerPosition,
      setTimeout: (callback, delay) =>
      {
        timeoutCallback = callback;
        timeoutDelay = delay;
        return 1;
      },
      window: harness.dom.window,
    },
  );

  showToast("Saved", "success");

  assert.equal(harness.container.children.length, 1);
  assert.equal(harness.container.firstElementChild.textContent, "Saved");
  assert.equal(harness.container.firstElementChild.className, "toast success");
  assert.equal(timeoutDelay, 3000);
  assert.equal(harness.container.style.getPropertyValue("--toast-bottom-offset"), "116px");
  assert.equal(typeof timeoutCallback, "function");

  timeoutCallback();

  assert.equal(harness.container.children.length, 0);
});

test("toast CSS keeps stacked notifications centered with a 10px gap and responsive widths", () => {
  const toastContainerBlocks = [...styles.matchAll(/\.toast-container\s*\{[\s\S]*?\n\}/g)].map(match => match[0]);
  assert.ok(toastContainerBlocks.length >= 2, "both toast container definitions should remain covered");

  for (const block of toastContainerBlocks.slice(0, 2))
  {
    assert.match(block, /display:\s*flex;/);
    assert.match(block, /flex-direction:\s*column;/);
    assert.match(block, /align-items:\s*center;/);
    assert.match(block, /gap:\s*10px;/);
    assert.match(block, /bottom:\s*calc\(var\(--toast-bottom-offset, 20px\)\s*\+\s*env\(safe-area-inset-bottom, 0px\)\);/);
  }

  assert.match(styles, /width:\s*min\(420px,\s*100%\);/);
  assert.match(styles, /min-width:\s*min\(200px,\s*100%\);/);
  assert.match(
    styles,
    /@media\s*\(orientation:\s*landscape\)[\s\S]*?right:\s*calc\(var\(--toast-right-offset, 20px\)\s*\+\s*env\(safe-area-inset-right, 0px\)\);/,
  );
});

test("toast positioning is recalculated whenever the viewport changes", () => {
  assert.match(
    source,
    /window\.addEventListener\("resize",[\s\S]*?updateToastContainerPosition\(\);/,
  );
  assert.match(
    source,
    /showToast\(message,[\s\S]*?updateToastContainerPosition\(\);/,
  );
});


test("engagement animations are disabled when reduced motion is requested", () => {
  assert.match(
    styles,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.match-details-btn,\s*\.dm-share-btn,\s*\.dm-details-toggle-icon\s*\{[\s\S]*?animation:\s*none;/,
  );
});
