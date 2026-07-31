import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { detectClientEnvironment } from "../src/core/environment.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("detects an iPhone Safari portrait client", () => {
  const environment = detectClientEnvironment({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    userAgentDataMobile: true,
    platform: "iPhone",
    maxTouchPoints: 5,
    coarsePointer: true,
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.equal(environment.device, "phone");
  assert.equal(environment.orientation, "portrait");
  assert.equal(environment.input, "coarse");
  assert.equal(environment.browser, "Safari");
  assert.equal(environment.os, "iOS/iPadOS");
  assert.equal(environment.label, "手机 · Safari");
});

test("detects an Android Chrome landscape phone", () => {
  const environment = detectClientEnvironment({
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36",
    userAgentDataMobile: true,
    platform: "Linux armv8l",
    coarsePointer: true,
    viewportWidth: 844,
    viewportHeight: 390,
  });
  assert.deepEqual(
    [environment.device, environment.orientation, environment.input, environment.browser, environment.os],
    ["phone", "landscape", "coarse", "Chrome", "Android"],
  );
});

test("recognizes iPadOS desktop-style user agents as tablets", () => {
  const environment = detectClientEnvironment({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5,
    coarsePointer: true,
    viewportWidth: 1024,
    viewportHeight: 768,
  });
  assert.equal(environment.device, "tablet");
  assert.equal(environment.browser, "Safari");
  assert.equal(environment.os, "iOS/iPadOS");
});

test("keeps a wide Windows Edge client in the desktop layout", () => {
  const environment = detectClientEnvironment({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 Edg/124.0",
    platform: "Win32",
    viewportWidth: 1366,
    viewportHeight: 768,
  });
  assert.deepEqual(
    [environment.device, environment.input, environment.browser, environment.os],
    ["desktop", "fine", "Edge", "Windows"],
  );
});

test("uses the compact phone layout for a narrow browser viewport", () => {
  const environment = detectClientEnvironment({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    platform: "Win32",
    viewportWidth: 390,
    viewportHeight: 844,
  });
  assert.equal(environment.device, "phone");
  assert.equal(environment.orientation, "portrait");
  assert.equal(environment.input, "fine");
});

test("an orientation hint prevents a virtual keyboard from flipping the layout", () => {
  const environment = detectClientEnvironment({
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile Safari/604.1",
    viewportWidth: 390,
    viewportHeight: 320,
    orientation: "portrait",
  });
  assert.equal(environment.orientation, "portrait");
});

test("page and styles expose the mobile layout contract", async () => {
  const [html, styles, app, environmentModule] = await Promise.all([
    readFile(path.join(root, "index.html"), "utf8"),
    readFile(path.join(root, "styles.css"), "utf8"),
    readFile(path.join(root, "src/app.js"), "utf8"),
    readFile(path.join(root, "src/core/environment.js"), "utf8"),
  ]);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<button id="environmentBadge"/);
  for (const id of ["environmentBadge", "mobileActionsMenu", "inspectorToggleButton", "inspectorPanel", "inspectorBackdrop"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
  assert.match(styles, /100dvh/);
  assert.match(styles, /data-device="phone"\]\[data-orientation="portrait"/);
  assert.match(styles, /data-device="phone"\]\[data-orientation="landscape"/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(styles, /environment-badge\[data-open="true"\]/);
  assert.match(styles, /\.workspace \{[^}]*overflow: hidden/);
  assert.match(app, /const cssPixels = .*=== "coarse" \? 18 : 10/);
  assert.match(app, /rect\.width \* 1\.25/);
  assert.match(app, /orientationChanged/);
  assert.match(environmentModule, /addEventListener\("click", handleBadgeClick\)/);
});

test("standalone build bundles the environment module", async () => {
  const [builder, standalone] = await Promise.all([
    readFile(path.join(root, "build-standalone.mjs"), "utf8"),
    readFile(path.join(root, "SketchpadNext.html"), "utf8"),
  ]);
  assert.match(builder, /read\("src\/core\/environment\.js"\)/);
  assert.match(builder, /replaceAll\("\.\.\/core\/environment\.js", environmentUrl\)/);
  assert.match(standalone, /id="environmentBadge"/);
  assert.match(standalone, /detectClientEnvironment/);
});
