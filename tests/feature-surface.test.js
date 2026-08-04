import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const helpSource = readFileSync(new URL("../src/core/help.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

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
    "insertNumericIntoCalculationButton",
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

test("calculation composer is non-modal and exposes every insertion surface once", () => {
  const calculationIds = [
    "calculationPanel",
    "calculationForm",
    "calculationPanelTitle",
    "closeCalculationPanelButton",
    "calculationName",
    "calculationExpression",
    "calculationPreview",
    "calculationVariables",
    "calculationOperators",
    "calculationFunctions",
    "cancelCalculationButton",
    "saveCalculationButton",
  ];

  calculationIds.forEach((id) => {
    assert.equal(
      occurrences(indexHtml, 'id="' + id + '"'),
      1,
      id + " should appear exactly once",
    );
  });
  assert.match(indexHtml, /id="calculationPanel"[^>]*aria-modal="false"/);
  assert.match(indexHtml, /data-calculation-token="\*"/);
  assert.match(indexHtml, /data-calculation-template="sqrt\(\|\)"/);
  assert.match(indexHtml, /点击画布中的度量、参数或计算结果/);
});

test("transform menu distinguishes symmetry modes and exposes circle inversion", () => {
  ["markInversionCircle", "centralSymmetry", "invert"].forEach((value) => {
    assert.equal(
      occurrences(indexHtml, 'value="' + value + '"'),
      1,
      value + " should appear exactly once in the transform menu",
    );
  });
  assert.match(indexHtml, /<option value="reflect">轴对称<\/option>/);
  assert.match(indexHtml, /<option value="centralSymmetry">中心对称<\/option>/);
  assert.match(indexHtml, /<option value="invert">圆反演<\/option>/);
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
  assert.ok(appSource.includes("selectionAnchor: { ...pointerWorld }"));
});

test("selection, multiline text and preselected constructions use the direct interaction paths", () => {
  const pointerHandler = appSource.slice(
    appSource.indexOf("async function handleSinglePointerDown"),
    appSource.indexOf("function handleSinglePointerMove"),
  );
  const activateToolHandler = appSource.slice(
    appSource.indexOf("function activateTool"),
    appSource.indexOf("function clientToWorld"),
  );
  const endpointPairHandler = appSource.slice(
    appSource.indexOf("function endpointPairsFromSelection"),
    appSource.indexOf("function constructSegmentsFromSelection"),
  );
  const constructionDispatcher = appSource.slice(
    appSource.indexOf("function attemptConstructionFromSelection"),
    appSource.indexOf("function runConstructionCommand"),
  );
  const transformHandler = appSource.slice(
    appSource.indexOf("async function runTransformCommand"),
    appSource.indexOf("function createCoordinateSystem"),
  );
  assert.ok(activateToolHandler.includes("selectedIds.size && attemptConstructionFromSelection(tool)"));
  assert.ok(endpointPairHandler.includes('selection.length === 2 && selection.every((object) => object.type === "point")'));
  assert.ok(endpointPairHandler.includes('selection.every((object) => object.type === "segment")'));
  for (const command of ["segment", "line", "ray", "midpoint", "perpendicularBisector", "circle", "threePointCircle"]) {
    assert.ok(constructionDispatcher.includes(`command === "${command}"`));
  }
  assert.ok(appSource.includes("documentModel.hitTestPoint(pointerWorld, tolerance)"));
  assert.ok(pointerHandler.includes('consumeRecentCanvasClick("text", hit.object.id, event)'));
  assert.ok(!transformHandler.includes("consumeRecentCanvasClick"));
  assert.ok(appSource.includes('dataset.multiline !== "true"'));
  assert.doesNotMatch(indexHtml, /id="batchRenameButton"/);
  assert.doesNotMatch(indexHtml, /id="inspectorToggleButton"/);
  assert.doesNotMatch(indexHtml, /快捷操作/);
});

test("right click controls the inspector without disabling right-button panning", () => {
  const selectionHelpers = appSource.slice(
    appSource.indexOf("function closeInspectorWhenSelectionIsEmpty"),
    appSource.indexOf("function selectedObjects"),
  );
  assert.match(selectionHelpers, /if \(selectedIds\.size\) return/);
  assert.match(selectionHelpers, /sketchpadnext:inspectorrequest/);
  assert.equal((selectionHelpers.match(/closeInspectorWhenSelectionIsEmpty\(\)/g) || []).length, 4);
  const pointerHandler = appSource.slice(
    appSource.indexOf("async function handleSinglePointerDown"),
    appSource.indexOf("function handleSinglePointerMove"),
  );
  assert.match(pointerHandler, /event\.button === 2/);
  assert.match(pointerHandler, /const inspectorHitPosition = clientToWorld\(event, false\)/);
  assert.ok(
    pointerHandler.indexOf("documentModel.hitTestPoint(inspectorHitPosition")
      < pointerHandler.indexOf("|| directObject"),
  );
  assert.match(pointerHandler, /selectedIds\.has\(hitObject\.id\)/);
  assert.match(pointerHandler, /sketchpadnext:inspectorrequest/);
  assert.match(pointerHandler, /detail: \{ open: true \}/);
  assert.match(pointerHandler, /detail: \{ open: false \}/);
  assert.match(pointerHandler, /event\.button === 1 \|\| event\.button === 2/);
  assert.match(pointerHandler, /panState = \{/);
});

test("math overlines are rendered as one explicit SVG line above scripted text", () => {
  const formatter = appSource.slice(
    appSource.indexOf("function appendFormattedText"),
    appSource.indexOf("function clearLayer"),
  );
  assert.match(formatter, /class: "math-overline-run"/);
  assert.doesNotMatch(formatter, /text-decoration/);
  assert.match(formatter, /querySelectorAll\("\.math-overline-run"\)/);
  assert.match(formatter, /const bounds = run\.getBBox\(\)/);
  assert.match(formatter, /class: "math-overline"/);
  assert.match(formatter, /bounds\.y - Math\.max/);
  assert.match(stylesSource, /\.math-overline \{[^}]*pointer-events: none/);
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
