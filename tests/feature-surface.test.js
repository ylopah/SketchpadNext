import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const helpSource = readFileSync(new URL("../src/core/help.js", import.meta.url), "utf8");

function occurrences(source, literal) {
  return source.split(literal).length - 1;
}

test("measurement menu exposes every extended measurement exactly once", () => {
  const measurementValues = [
    "pointLineDistance",
    "polygonPerimeter",
    "polygonArea",
    "coordinateX",
    "coordinateY",
  ];

  measurementValues.forEach((value) => {
    assert.equal(
      occurrences(indexHtml, 'value="' + value + '"'),
      1,
      value + " should appear exactly once in the measurement menu",
    );
  });
});

test("numeric and coordinate inspector controls have unique ids", () => {
  const inspectorIds = [
    "numericObjectSection",
    "numericObjectDetails",
    "editNumericObjectButton",
    "coordinateSystemSection",
    "coordinateUnitX",
    "coordinateUnitY",
    "coordinateGridType",
    "coordinateShowGrid",
    "coordinateShowTicks",
    "coordinateShowLabels",
    "applyCoordinateSystemButton",
  ];

  inspectorIds.forEach((id) => {
    assert.equal(
      occurrences(indexHtml, 'id="' + id + '"'),
      1,
      id + " should appear exactly once",
    );
  });
});

test("application keeps calculation editing and coordinate snapping contracts", () => {
  assert.ok(appSource.includes("documentModel.updateCalculation("));
  assert.ok(appSource.includes("function coordinateSystemResolution()"));
  assert.ok(appSource.includes("function snapCoordinateSystem()"));
  assert.ok(appSource.includes(
    "coordinate.origin.x + Math.round((world.x - coordinate.origin.x) / coordinate.unitX) * coordinate.unitX",
  ));
  assert.ok(appSource.includes(
    "coordinate.origin.y + Math.round((world.y - coordinate.origin.y) / coordinate.unitY) * coordinate.unitY",
  ));
  assert.ok(appSource.includes("if (coordinate?.showGrid) return;"));
  assert.ok(!appSource.includes("hasVisibleCoordinateGrid"));
  assert.ok(appSource.includes("存在多个可见坐标系，请同时选中要使用的坐标系"));
  assert.ok(appSource.includes("存在多个可见坐标系，请先选中要使用的坐标系"));
});

test("help states radian, degree and two-argument function semantics", () => {
  const requiredTerms = [
    "sin/cos/tan 和 asin/acos/atan 使用弧度",
    "sind/cosd/tand 与 asind/acosd/atand 使用角度制",
    "rad(180)",
    "deg(pi)",
    "min(a,b)",
    "max(a,b)",
    "atan2(y,x)",
    "mod(a,b)",
  ];

  requiredTerms.forEach((term) => {
    assert.ok(helpSource.includes(term), "help should mention " + term);
  });
});
