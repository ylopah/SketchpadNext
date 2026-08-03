import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { HELP_SECTIONS, helpItemCount } from "../src/core/help.js";
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_CHANGE_EVENT,
  isSnapGridVisible,
  loadPreferences,
  mergePreferences,
  normalizePreferences,
  resetPreferences,
  savePreferences,
} from "../src/core/preferences.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("preferences use black points and normalize every user-controlled range", () => {
  assert.equal(DEFAULT_PREFERENCES.pointColor, "#000000");
  const preferences = normalizePreferences({
    pointSize: 999,
    pointColor: "invalid",
    lineWidth: 1.26,
    lineColor: "#ABCDEF",
    lineDash: "other",
    gridSize: 1,
    measurementDecimals: 99,
    textFontSize: 2,
    pointLabelFontSize: 100,
    futureSetting: "keep-me",
  });
  assert.equal(preferences.pointSize, 14);
  assert.equal(preferences.pointColor, "#000000");
  assert.equal(preferences.lineWidth, 1.5);
  assert.equal(preferences.lineColor, "#abcdef");
  assert.equal(preferences.lineDash, "solid");
  assert.equal(preferences.gridSize, 5);
  assert.equal(preferences.measurementDecimals, 10);
  assert.equal(preferences.textFontSize, 8);
  assert.equal(preferences.pointLabelFontSize, 48);
  assert.equal(preferences.futureSetting, "keep-me");
});

test("preferences load, merge, save and reset without losing forward-compatible fields", () => {
  const storage = memoryStorage();
  const saved = savePreferences({ shortcutsEnabled: false, pointSize: 9, extensionFlag: 7 }, storage);
  assert.equal(saved.shortcutsEnabled, false);
  assert.equal(loadPreferences(storage).extensionFlag, 7);
  const merged = mergePreferences(loadPreferences(storage), { measurementDecimals: 4 });
  assert.equal(merged.pointSize, 9);
  assert.equal(merged.measurementDecimals, 4);
  const reset = resetPreferences(storage);
  assert.deepEqual(reset, DEFAULT_PREFERENCES);
  assert.deepEqual(loadPreferences(memoryStorage({ "sketchpad-next.settings.v1": "{" })), normalizePreferences());
});

test("snap grid visibility has exactly the same switch as snapping", () => {
  assert.equal(isSnapGridVisible({ snapToGrid: true }), true);
  assert.equal(isSnapGridVisible({ snapToGrid: false }), false);
  assert.equal(isSnapGridVisible({}), false);
  assert.equal(PREFERENCES_CHANGE_EVENT, "sketchpadnext:preferenceschange");
});

test("built-in help documents all drawing tools, right-button panning and math notation", () => {
  assert.ok(helpItemCount() >= 25);
  const text = HELP_SECTIONS.flatMap((section) => section.items)
    .map((item) => `${item.title} ${item.shortcut || ""} ${item.description}`)
    .join("\n");
  for (const tool of ["选择/移动", "点", "线段", "直线", "射线", "圆", "过三点圆", "中点", "中垂线", "平行线", "垂线", "角平分线", "标识笔", "信息", "文本"]) {
    assert.match(text, new RegExp(tool.replace("/", "\\/")));
  }
  assert.match(text, /鼠标右键拖动/);
  assert.match(text, /\\alpha/);
  assert.match(text, /下标/);
  assert.match(text, /Alt\+P/);
});

test("page exposes help/settings, tool shortcuts, triangle commands and circle below ray", async () => {
  const html = await readFile(path.join(root, "index.html"), "utf8");
  assert.match(html, /id="helpButton"/);
  assert.match(html, /id="settingsButton"/);
  assert.match(html, /id="helpDialog"/);
  assert.match(html, /id="settingsDialog"/);
  assert.match(html, /title="选择\/移动 \(Alt\+V\)"/);
  assert.doesNotMatch(html, /Alt \+ 工具字母/);
  assert.doesNotMatch(html, /空格\+拖动 \/ 中键 \/ 右键/);
  assert.match(html, /id="snapToggle"[^>]*\/> 吸附与网格/);
  for (const command of ["centroid", "incenter", "orthocenter", "incircle"]) {
    assert.match(html, new RegExp(`option value="${command}"`));
  }
  const rayPosition = html.indexOf('data-tool="ray"');
  const circlePosition = html.indexOf('data-tool="circle"');
  const midpointPosition = html.indexOf('data-tool="midpoint"');
  assert.ok(rayPosition < circlePosition && circlePosition < midpointPosition);
});
