import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  circleCircleIntersections,
  clipLineGeometryToView,
  clipParametricLineToRect,
  lineCircleIntersections,
  lineLineIntersections,
  projectPointToLine,
  triangleCentroid,
  triangleIncircle,
  triangleIncenter,
  triangleOrthocenter,
} from "../src/core/geometry.js";
import { GeometryDocument } from "../src/core/document.js";
import { DocumentHistory } from "../src/core/history.js";
import { evaluateExpression, expressionIdentifiers } from "../src/core/expression.js";
import { createTikzExport, escapeLatexText } from "../src/core/latex.js";
import {
  angleBisectorFromCommonEndpoint,
  hasExceededDragThreshold,
  pointLinePairs,
  selectionDragIntent,
} from "../src/core/selection.js";
import { parseMathText, plainMathText } from "../src/core/text-format.js";
import { clientPointToWorld, fitViewToGesture, panViewFromClientDelta, zoomViewAtClientPoint } from "../src/core/view.js";

const settings = {
  pointSize: 6,
  pointColor: "#2563eb",
  lineWidth: 2,
  lineColor: "#334155",
  showLabels: true,
};

function close(actual, expected, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be close to ${expected}`);
}

test("projects a point onto a segment and clamps the parameter", () => {
  const projection = projectPointToLine({ x: 12, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 }, true);
  assert.deepEqual(projection.point, { x: 10, y: 0 });
  assert.equal(projection.t, 1);
});

test("pinch view keeps the original world anchor under the moving centroid", () => {
  const rect = { left: 0, top: 0, width: 1000, height: 500 };
  const startView = { x: 0, y: 0, width: 1000, height: 500 };
  const next = fitViewToGesture(
    startView, rect, { x: 500, y: 250 }, 100, { x: 600, y: 300 }, 200,
  );
  assert.deepEqual(next, { x: 200, y: 100, width: 500, height: 250 });
  assert.deepEqual(clientPointToWorld(next, rect, { x: 600, y: 300 }), { x: 500, y: 250 });
});

test("view gesture helpers pan independently by axis and clamp zoom", () => {
  const rect = { left: 10, top: 20, width: 1000, height: 500 };
  const startView = { x: 0, y: 0, width: 1200, height: 720 };
  assert.deepEqual(
    panViewFromClientDelta(startView, rect, { x: 100, y: 100 }, { x: 200, y: 150 }),
    { x: -120, y: -72, width: 1200, height: 720 },
  );
  const minimum = zoomViewAtClientPoint(startView, rect, { x: 510, y: 270 }, 0.01, { minWidth: 180, maxWidth: 8000 });
  const maximum = zoomViewAtClientPoint(startView, rect, { x: 510, y: 270 }, 100, { minWidth: 180, maxWidth: 8000 });
  assert.equal(minimum.width, 180);
  assert.equal(maximum.width, 8000);
  assert.ok([minimum, maximum].every((view) => Number.isFinite(view.x) && Number.isFinite(view.y)));
});

test("clips infinite lines and rays to the visible rectangle", () => {
  const rectangle = { x1: 0, y1: 0, x2: 100, y2: 80 };
  const line = clipParametricLineToRect({ x: 20, y: 30 }, { x: 30, y: 30 }, rectangle);
  assert.deepEqual(line, { a: { x: 0, y: 30 }, b: { x: 100, y: 30 } });

  const ray = clipParametricLineToRect({ x: 20, y: 30 }, { x: 30, y: 30 }, rectangle, true);
  assert.deepEqual(ray, { a: { x: 20, y: 30 }, b: { x: 100, y: 30 } });

  assert.equal(
    clipParametricLineToRect({ x: 20, y: 90 }, { x: 30, y: 90 }, rectangle),
    null,
  );
});

test("reclips infinite lines and rays for every pan and zoom view", () => {
  const line = {
    kind: "line",
    a: { x: 20, y: 30 },
    b: { x: 30, y: 30 },
    segment: false,
    ray: false,
  };
  assert.deepEqual(
    clipLineGeometryToView(line, { x: 0, y: 0, width: 100, height: 80 }),
    { a: { x: -20, y: 30 }, b: { x: 120, y: 30 } },
  );
  assert.deepEqual(
    clipLineGeometryToView(line, { x: 100, y: 20, width: 100, height: 80 }),
    { a: { x: 80, y: 30 }, b: { x: 220, y: 30 } },
  );
  assert.deepEqual(
    clipLineGeometryToView(line, { x: 25, y: 20, width: 25, height: 20 }),
    { a: { x: 5, y: 30 }, b: { x: 70, y: 30 } },
  );
  assert.deepEqual(
    clipLineGeometryToView({ ...line, ray: true }, { x: 100, y: 20, width: 100, height: 80 }),
    { a: { x: 80, y: 30 }, b: { x: 220, y: 30 } },
  );

  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.doesNotMatch(appSource, /updateViewBox\(\);\s*scheduleRender\(\);/);
  assert.match(appSource, /clientPointToWorld\(\s*view,/);
});

test("finds line-line intersection", () => {
  const result = lineLineIntersections(
    { x: 0, y: 0 }, { x: 10, y: 10 },
    { x: 0, y: 10 }, { x: 10, y: 0 },
  );
  assert.equal(result.length, 1);
  close(result[0].x, 5);
  close(result[0].y, 5);
});

test("finds two line-circle intersections", () => {
  const result = lineCircleIntersections(
    { x: -10, y: 0 }, { x: 10, y: 0 },
    { x: 0, y: 0 }, 5,
  );
  assert.equal(result.length, 2);
  close(result[0].x, -5);
  close(result[1].x, 5);
});

test("finds two circle-circle intersections", () => {
  const result = circleCircleIntersections({ x: 0, y: 0 }, 5, { x: 6, y: 0 }, 5);
  assert.equal(result.length, 2);
  close(result[0].x, 3);
  close(Math.abs(result[0].y), 4);
});

test("derived intersection follows moved parent points", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 10 }, settings);
  const c = document.addFreePoint({ x: 0, y: 10 }, settings);
  const d = document.addFreePoint({ x: 10, y: 0 }, settings);
  const first = document.addLine(a.id, b.id, settings);
  const second = document.addLine(c.id, d.id, settings);
  const intersection = document.addIntersectionPoints(first.id, second.id, settings)[0];
  close(document.getPointPosition(intersection).x, 5);
  document.movePoint(b.id, { x: 20, y: 10 });
  close(document.getPointPosition(intersection).x, 20 / 3);
  close(document.getPointPosition(intersection).y, 10 / 3);
});

test("point constrained to a circle stays on it", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 0, y: 0 }, settings);
  const through = document.addFreePoint({ x: 10, y: 0 }, settings);
  const circle = document.addCircle(center.id, through.id, settings);
  const constrained = document.addPointOnShape(circle.id, { x: 0, y: 12 }, settings);
  let position = document.getPointPosition(constrained);
  close(position.x, 0);
  close(position.y, 10);
  document.movePoint(through.id, { x: 20, y: 0 });
  position = document.getPointPosition(constrained);
  close(position.y, 20);
});

test("serialization round-trips and deletion cascades", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 0 }, settings);
  const segment = document.addSegment(a.id, b.id, settings);
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.objects.length, 3);
  const removed = restored.removeWithDependents(a.id);
  assert.ok(removed.includes(segment.id));
  assert.equal(restored.objects.length, 1);
});

test("hidden construction objects keep dependencies but leave hit testing", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 20, y: 0 }, settings);
  const segment = document.addSegment(a.id, b.id, settings);
  document.setObjectsHidden([segment.id], true);
  assert.equal(document.getShapeGeometry(segment).kind, "line");
  assert.equal(document.hitTestShapes({ x: 10, y: 0 }, 1).some((hit) => hit.object.id === segment.id), false);
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.getObject(segment.id).hidden, true);
});

test("history restores complete documents", () => {
  let document = new GeometryDocument();
  const history = new DocumentHistory();
  history.recordSnapshot(document.serialize());
  document.addFreePoint({ x: 2, y: 3 }, settings);
  document = history.undo(document);
  assert.equal(document.objects.length, 0);
  document = history.redo(document);
  assert.equal(document.objects.length, 1);
});

test("one history snapshot undoes a complete multi-object construction", () => {
  let document = new GeometryDocument();
  const history = new DocumentHistory();
  history.recordSnapshot(document.serialize());
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 0 }, settings);
  document.addSegment(a.id, b.id, settings);
  assert.equal(document.objects.length, 3);
  document = history.undo(document);
  assert.equal(document.objects.length, 0);
});

test("clicking near a crossing creates an exact dynamic intersection", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 100, y: 100 }, settings);
  const c = document.addFreePoint({ x: 0, y: 100 }, settings);
  const d = document.addFreePoint({ x: 100, y: 0 }, settings);
  document.addLine(a.id, b.id, settings);
  document.addLine(c.id, d.id, settings);

  const result = document.addPointAt({ x: 50.6, y: 49.7 }, settings, 1.2);
  assert.equal(result.snappedToIntersection, true);
  assert.equal(result.point.definition.kind, "intersection");
  const position = document.getPointPosition(result.point);
  close(position.x, 50);
  close(position.y, 50);
});

test("rectangle selection finds points and crossing shapes", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 20, y: 20 }, settings);
  const line = document.addLine(a.id, b.id, settings);
  const hits = document.objectsInRect({ x1: 4, y1: 4, x2: 8, y2: 8 });
  assert.ok(hits.some((object) => object.id === line.id));
  assert.ok(!hits.some((object) => object.id === a.id));
});

test("a newly dragged object becomes the sole selection after a CSS-pixel threshold", () => {
  const newTarget = selectionDragIntent(["A"], "B");
  assert.deepEqual(newTarget.pointerDownSelection, ["A", "B"]);
  assert.deepEqual(newTarget.dragSelection, ["B"]);
  assert.equal(newTarget.exclusiveOnDrag, true);
  assert.equal(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 14, y: 10 }), false);
  assert.equal(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 15, y: 10 }), true);

  const selectedTarget = selectionDragIntent(["A", "B"], "B");
  assert.deepEqual(selectedTarget.dragSelection, ["A", "B"]);
  assert.equal(selectedTarget.exclusiveOnDrag, false);

  const firstTarget = selectionDragIntent([], "B");
  assert.deepEqual(firstTarget.dragSelection, ["B"]);
  assert.equal(firstTarget.exclusiveOnDrag, false);
});

test("shape dependencies expose the free points required for translation", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 3, y: 4 }, settings);
  const through = document.addFreePoint({ x: 8, y: 4 }, settings);
  const circle = document.addCircle(center.id, through.id, settings);
  assert.deepEqual(new Set(document.getFreePointDependencyIds(circle.id)), new Set([center.id, through.id]));
  document.setFreePointPosition(center.id, { x: 10, y: 10 });
  assert.deepEqual(document.getPointPosition(center.id), { x: 10, y: 10 });
});

test("midpoint follows both parent points", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 4 }, settings);
  const b = document.addFreePoint({ x: 10, y: 8 }, settings);
  const midpoint = document.addMidpoint(a.id, b.id, settings);
  assert.deepEqual(document.getPointPosition(midpoint), { x: 5, y: 6 });
  document.movePoint(b.id, { x: 20, y: 12 });
  assert.deepEqual(document.getPointPosition(midpoint), { x: 10, y: 8 });
});

test("parallel and perpendicular lines follow their base line", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 4 }, settings);
  const through = document.addFreePoint({ x: 2, y: 8 }, settings);
  const base = document.addLine(a.id, b.id, settings);
  const parallel = document.addParallelLine(through.id, base.id, settings);
  const perpendicular = document.addPerpendicularLine(through.id, base.id, settings);
  const baseGeometry = document.getShapeGeometry(base);
  const parallelGeometry = document.getShapeGeometry(parallel);
  const perpendicularGeometry = document.getShapeGeometry(perpendicular);
  const baseDirection = { x: baseGeometry.b.x - baseGeometry.a.x, y: baseGeometry.b.y - baseGeometry.a.y };
  const parallelDirection = { x: parallelGeometry.b.x - parallelGeometry.a.x, y: parallelGeometry.b.y - parallelGeometry.a.y };
  const perpendicularDirection = { x: perpendicularGeometry.b.x - perpendicularGeometry.a.x, y: perpendicularGeometry.b.y - perpendicularGeometry.a.y };
  close(baseDirection.x * parallelDirection.y - baseDirection.y * parallelDirection.x, 0);
  close(baseDirection.x * perpendicularDirection.x + baseDirection.y * perpendicularDirection.y, 0);
  assert.deepEqual(parallelGeometry.a, { x: 2, y: 8 });
  assert.deepEqual(perpendicularGeometry.a, { x: 2, y: 8 });
});

test("selected points and lines form every parallel and perpendicular pair", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 0 }, settings);
  const c = document.addFreePoint({ x: 0, y: 10 }, settings);
  const d = document.addFreePoint({ x: 10, y: 10 }, settings);
  const firstPoint = document.addFreePoint({ x: 3, y: 4 }, settings);
  const secondPoint = document.addFreePoint({ x: 7, y: 8 }, settings);
  const firstLine = document.addLine(a.id, b.id, settings);
  const secondLine = document.addSegment(a.id, c.id, settings);
  const thirdLine = document.addRay(b.id, d.id, settings);
  const isLine = (object) => document.getShapeGeometry(object)?.kind === "line";
  const pairs = pointLinePairs([firstPoint, firstLine, secondPoint, secondLine, thirdLine], isLine);

  assert.deepEqual(
    pairs.map(({ point, line }) => `${point.id}:${line.id}`),
    [
      `${firstPoint.id}:${firstLine.id}`,
      `${firstPoint.id}:${secondLine.id}`,
      `${firstPoint.id}:${thirdLine.id}`,
      `${secondPoint.id}:${firstLine.id}`,
      `${secondPoint.id}:${secondLine.id}`,
      `${secondPoint.id}:${thirdLine.id}`,
    ],
  );
  assert.equal(pointLinePairs([firstPoint, firstLine, secondLine, thirdLine], isLine).length, 3);
  assert.equal(pointLinePairs([firstPoint, secondPoint, firstLine], isLine).length, 2);
  const circle = document.addCircle(a.id, b.id, settings);
  assert.deepEqual(pointLinePairs([firstPoint, firstLine, circle], isLine), []);

  const parallels = pairs.map(({ point, line }) => document.addParallelLine(point.id, line.id, settings));
  const perpendiculars = pairs.map(({ point, line }) => document.addPerpendicularLine(point.id, line.id, settings));
  assert.equal(parallels.filter(Boolean).length, 6);
  assert.equal(perpendiculars.filter(Boolean).length, 6);
  assert.deepEqual(
    parallels.map((line) => `${line.pointId}:${line.parentLineId}`),
    pairs.map(({ point, line }) => `${point.id}:${line.id}`),
  );
  assert.deepEqual(
    perpendiculars.map((line) => `${line.pointId}:${line.parentLineId}`),
    pairs.map(({ point, line }) => `${point.id}:${line.id}`),
  );
});

test("exports a complete standalone TikZ document for visible geometry", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 50, y: 50 }, settings, "C");
  const right = document.addFreePoint({ x: 70, y: 50 }, settings, "A");
  const bottom = document.addFreePoint({ x: 50, y: 70 }, settings, "B");
  document.addSegment(right.id, bottom.id, settings);
  document.addLine(center.id, right.id, settings);
  document.addRay(center.id, bottom.id, settings);
  const circle = document.addCircle(center.id, right.id, settings);
  document.addArcOnCircle(circle.id, right.id, bottom.id, settings);

  const result = createTikzExport(document, {
    view: { x: 0, y: 0, width: 100, height: 100 },
    targetWidthCm: 10,
  });

  assert.equal(result.exportedCount, 8);
  assert.match(result.code, /\\documentclass\[tikz,border=4pt\]\{standalone\}/);
  assert.match(result.code, /\\begin\{tikzpicture\}/);
  assert.match(result.code, /use as bounding box/);
  assert.match(result.code, /\\clip \(0,0\) rectangle \(10,10\);/);
  assert.match(result.code, /circle\[radius=2cm\]/);
  assert.match(result.code, /delta angle=-90/);
  assert.match(result.code, /\\node\[.*\]\s+at/);
  assert.match(result.code, /\\end\{document\}/);
  assert.doesNotMatch(result.code, /NaN|Infinity|undefined/);
});

test("escapes LaTeX control characters and preserves point subscripts", () => {
  assert.equal(
    escapeLatexText("\\{}$&#_%~^"),
    "\\textbackslash{}\\{\\}\\$\\&\\#\\_\\%\\textasciitilde{}\\textasciicircum{}",
  );
  const document = new GeometryDocument();
  document.addFreePoint({ x: 10, y: 10 }, settings, "P[1]");
  document.addText({ x: 15, y: 25 }, "中文 A_1 & 50% # {x} \\", settings);
  const result = createTikzExport(document, {
    view: { x: 0, y: 0, width: 100, height: 60 },
    pointLabelFontSize: 34,
  });

  assert.match(result.code, /\\usepackage\[UTF8\]\{ctex\}/);
  assert.ok(result.code.includes("P\\textsubscript{1}"));
  assert.ok(result.code.includes("中文 A\\textsubscript{1} \\& 50\\% \\# \\{x\\} \\textbackslash{}"));
  assert.ok(result.code.includes("\\itshape\\fontsize{14pt}{16pt}"));
});

test("omits hidden, undefined and non-finite objects from TikZ output", () => {
  const document = new GeometryDocument();
  const hiddenParent = document.addFreePoint({ x: 10, y: 10 }, settings, "HIDDEN_PARENT");
  const visibleParent = document.addFreePoint({ x: 90, y: 10 }, settings, "B");
  document.addSegment(hiddenParent.id, visibleParent.id, settings);
  document.setObjectsHidden([hiddenParent.id], true);
  const hiddenText = document.addText({ x: 10, y: 20 }, "SECRET_TEXT", settings);
  document.setObjectsHidden([hiddenText.id], true);
  const sameA = document.addFreePoint({ x: 30, y: 30 }, settings);
  const sameB = document.addFreePoint({ x: 40, y: 30 }, settings);
  document.addLine(sameA.id, sameB.id, settings);
  document.setFreePointPosition(sameB.id, { x: 30, y: 30 });
  const invalidPoint = document.addFreePoint({ x: 60, y: 60 }, settings, "INVALID_POINT");
  invalidPoint.definition.x = Number.POSITIVE_INFINITY;
  const invalidLabel = document.addFreePoint({ x: 70, y: 70 }, settings, "BAD_OFFSET");
  invalidLabel.labelOffset.x = Number.POSITIVE_INFINITY;
  document.addDoodle([{ x: 1e308, y: 50 }, { x: -1e308, y: 50 }], settings);

  const result = createTikzExport(document, { view: { x: 0, y: 0, width: 100, height: 100 } });

  assert.ok(result.skippedCount >= 2);
  assert.ok(!result.code.includes("HIDDEN\\_PARENT"));
  assert.ok(!result.code.includes("SECRET\\_TEXT"));
  assert.ok(!result.code.includes("INVALID\\_POINT"));
  assert.ok(!result.code.includes("BAD\\_OFFSET"));
  assert.match(result.code, /\\draw\[.*\] .* -- .*;/);
  assert.doesNotMatch(result.code, /NaN|Infinity|null|undefined/);
});

test("clips exported lines to the viewport and preserves line style", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: -100, y: 50 }, settings);
  const b = document.addFreePoint({ x: 200, y: 50 }, settings);
  const line = document.addLine(a.id, b.id, settings);
  document.applyStylePatch(line.id, { color: "#ff00aa", width: 0.5, dash: "dashed" });

  const result = createTikzExport(document, {
    view: { x: 0, y: 0, width: 100, height: 100 },
    targetWidthCm: 10,
  });

  assert.ok(result.code.includes("{HTML}{FF00AA}"));
  assert.ok(result.code.includes("line width=1.423pt"));
  assert.ok(result.code.includes("dash pattern=on "));
  assert.ok(result.code.includes("(0,5) -- (10,5)"));
});

test("derived point borders stay solid in the browser and TikZ output", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 20, y: 20 }, settings);
  const b = document.addFreePoint({ x: 80, y: 20 }, settings);
  document.addMidpoint(a.id, b.id, settings);
  const result = createTikzExport(document, {
    view: { x: 0, y: 0, width: 100, height: 100 },
  });
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.geometry-point\s*\{[^}]*stroke-dasharray:\s*none/);
  assert.doesNotMatch(styles, /\.geometry-point\.derived\s*\{[^}]*stroke-dasharray/);
  assert.doesNotMatch(result.code, /\\filldraw\[[^\]]*dash pattern/);
});

test("skips one overflowing object without aborting the complete TikZ export", () => {
  const document = new GeometryDocument();
  document.addFreePoint({ x: 20, y: 20 }, settings, "SAFE_POINT");
  document.addCoordinateSystem({ x: 50, y: 50 }, settings, {
    unitX: 1e308,
    unitY: 1e308,
    gridType: "square",
    showGrid: true,
  });
  document.addText(
    { x: 10, y: 10 },
    Array.from({ length: 300 }, (_, index) => "OVERFLOW_LINE_" + index).join("\n"),
    settings,
  );

  const result = createTikzExport(document, {
    view: { x: 0, y: 0, width: 100, height: 100 },
    targetWidthCm: 12,
  });

  assert.ok(result.exportedCount >= 2);
  assert.ok(result.skippedCount >= 1);
  assert.ok(result.code.includes("SAFE\\textsubscript{P}OINT"));
  assert.ok(!result.code.includes("OVERFLOW\\_LINE"));
  assert.doesNotMatch(result.code, /NaN|Infinity|null|undefined/);
});

test("point labels can be renamed and moved within a bounded area", () => {
  const document = new GeometryDocument();
  const point = document.addFreePoint({ x: 0, y: 0 }, settings);
  assert.equal(document.renamePoint(point.id, "中心点"), true);
  assert.equal(point.label, "中心点");
  document.setPointLabelOffset(point.id, { x: 200, y: 0 }, 64);
  close(point.labelOffset.x, 64);
  close(point.labelOffset.y, 0);
});

test("point labels and canvas text support subscripts, superscripts and geometry symbols", () => {
  assert.deepEqual(parseMathText("A_12^3", { enableScripts: true }), [
    { text: "A", script: "normal" },
    { text: "12", script: "sub" },
    { text: "3", script: "super" },
  ]);
  assert.deepEqual(parseMathText("E[2]", { legacyBracketSubscript: true }), [
    { text: "E", script: "normal" },
    { text: "2", script: "sub" },
  ]);
  assert.deepEqual(parseMathText("x_{n+1}{^2}", { enableScripts: true }), [
    { text: "x", script: "normal" },
    { text: "n+1", script: "sub" },
    { text: "2", script: "super" },
  ]);
  assert.equal(
    plainMathText("\\alpha \\beta \\gamma \\delta \\theta \\pi \\Delta \\angle \\perp \\parallel \\cong \\sim \\neq \\le \\ge \\pm \\times \\cdot \\infty"),
    "α β γ δ θ π Δ ∠ ⟂ ∥ ≅ ∼ ≠ ≤ ≥ ± × · ∞",
  );
  assert.equal(plainMathText("{angle}A{rightangle} {degree} {lte} {gte}"), "∠A∟ ° ≤ ≥");
  assert.equal(plainMathText("A\\_1"), "A_1");
});

test("point name editing is deferred until blur and label dragging uses the tighter bound", () => {
  const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(appSource, /function loadSettings\(\) \{\s*return loadPreferences\(\);/);
  assert.match(appSource, /setPointLabelOffset\([\s\S]*?}, 32\);/);
  assert.match(appSource, /pointName\.addEventListener\("blur", commitPointNameEdit\)/);
  assert.ok(appSource.includes("if (event.isComposing || event.keyCode === 229) return;"));
  assert.ok(appSource.includes('appendFormattedText(tspan, line || " ", { enableScripts: true });'));
  assert.doesNotMatch(appSource, /pointName\.addEventListener\("input"[\s\S]{0,300}renamePoint/);
});

test("new line objects inherit the selected dash style", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 0 }, settings);
  const dashed = document.addLine(a.id, b.id, { ...settings, lineDash: "dashed" });
  assert.equal(dashed.style.dash, "dashed");
});

test("partial style edits preserve unrelated object properties", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 0 }, settings);
  const segment = document.addSegment(a.id, b.id, {
    ...settings, lineColor: "#ef4444", lineWidth: 3, lineDash: "dashed",
  });
  document.applyStylePatch(segment.id, { width: 6 });
  assert.deepEqual(segment.style, { color: "#ef4444", width: 6, dash: "dashed" });
  document.applyStylePatch(a.id, { radius: 9 });
  assert.equal(a.style.radius, 9);
  assert.equal(a.style.color, settings.pointColor);
  assert.equal(a.style.showLabel, true);
});

test("ray intersections exclude the direction behind its endpoint", () => {
  const document = new GeometryDocument();
  const origin = document.addFreePoint({ x: 0, y: 0 }, settings);
  const direction = document.addFreePoint({ x: 1, y: 0 }, settings);
  const ray = document.addRay(origin.id, direction.id, settings);
  const behindA = document.addFreePoint({ x: -2, y: -1 }, settings);
  const behindB = document.addFreePoint({ x: -2, y: 1 }, settings);
  const aheadA = document.addFreePoint({ x: 3, y: -1 }, settings);
  const aheadB = document.addFreePoint({ x: 3, y: 1 }, settings);
  const behindLine = document.addLine(behindA.id, behindB.id, settings);
  const aheadLine = document.addLine(aheadA.id, aheadB.id, settings);
  assert.equal(document.getIntersections(ray.id, behindLine.id).length, 0);
  const intersections = document.getIntersections(ray.id, aheadLine.id);
  assert.equal(intersections.length, 1);
  assert.deepEqual(intersections[0], { x: 3, y: 0 });
});

test("perpendicular bisector follows the midpoint and remains perpendicular", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 8, y: 4 }, settings);
  const bisector = document.addPerpendicularBisector(a.id, b.id, settings);
  let geometry = document.getShapeGeometry(bisector);
  assert.deepEqual(geometry.a, { x: 4, y: 2 });
  close((b.definition.x - a.definition.x) * (geometry.b.x - geometry.a.x) +
    (b.definition.y - a.definition.y) * (geometry.b.y - geometry.a.y), 0);
  document.movePoint(b.id, { x: 10, y: 0 });
  geometry = document.getShapeGeometry(bisector);
  assert.deepEqual(geometry.a, { x: 5, y: 0 });
});

test("internal angle bisector is an equal-angle ray", () => {
  const document = new GeometryDocument();
  const vertex = document.addFreePoint({ x: 0, y: 0 }, settings);
  const a = document.addFreePoint({ x: 6, y: 0 }, settings);
  const b = document.addFreePoint({ x: 0, y: 9 }, settings);
  const bisector = document.addAngleBisector(vertex.id, a.id, b.id, settings);
  const geometry = document.getShapeGeometry(bisector);
  assert.equal(geometry.ray, true);
  close(geometry.b.x - geometry.a.x, 1);
  close(geometry.b.y - geometry.a.y, 1);
});

test("circle through three points computes a dynamic circumcircle", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 4, y: 0 }, settings);
  const c = document.addFreePoint({ x: 0, y: 3 }, settings);
  const circle = document.addThreePointCircle(a.id, b.id, c.id, settings);
  const center = document.getObject(circle.centerPointId);
  assert.equal(center.type, "point");
  assert.equal(center.definition.kind, "circumcenter");
  assert.equal(center.label, "圆心");
  assert.equal(center.style.showLabel, false);
  assert.equal(document.nextLabel, 3);
  const nextPoint = document.addFreePoint({ x: 8, y: 8 }, settings);
  assert.equal(nextPoint.label, "D");
  let geometry = document.getShapeGeometry(circle);
  close(geometry.center.x, 2);
  close(geometry.center.y, 1.5);
  close(geometry.radius, 2.5);
  close(document.getPointPosition(center).x, 2);
  close(document.getPointPosition(center).y, 1.5);
  document.movePoint(c.id, { x: 0, y: 4 });
  geometry = document.getShapeGeometry(circle);
  close(geometry.center.x, 2);
  close(geometry.center.y, 2);
  close(geometry.radius, Math.sqrt(8));
  close(document.getPointPosition(center).y, 2);
  assert.deepEqual(new Set(document.dependenciesOf(circle)), new Set([a.id, b.id, c.id, center.id]));
});

test("legacy three-point circles gain a visible dynamic center when loaded", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 4, y: 0 }, settings);
  const c = document.addFreePoint({ x: 0, y: 4 }, settings);
  const circle = document.addThreePointCircle(a.id, b.id, c.id, settings);
  const saved = document.toJSON();
  saved.objects = saved.objects.filter((object) => object.id !== circle.centerPointId);
  const savedCircle = saved.objects.find((object) => object.id === circle.id);
  delete savedCircle.centerPointId;
  const restored = GeometryDocument.fromJSON(saved);
  const restoredCircle = restored.getObject(circle.id);
  const restoredCenter = restored.getObject(restoredCircle.centerPointId);
  assert.equal(restoredCenter.definition.kind, "circumcenter");
  assert.equal(restoredCenter.label, "圆心");
  assert.equal(restoredCenter.style.showLabel, false);
  assert.equal(restored.addFreePoint({ x: 8, y: 8 }, settings).label, "D");
  close(restored.getPointPosition(restoredCenter).x, 2);
  close(restored.getPointPosition(restoredCenter).y, 2);
});

test("copying a three-point circle does not spend a point label on its center", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 4, y: 0 }, settings);
  const c = document.addFreePoint({ x: 0, y: 4 }, settings);
  const circle = document.addThreePointCircle(a.id, b.id, c.id, settings);
  const [copy] = document.duplicateObjects([circle.id], { x: 10, y: 10 });
  const copiedCenter = document.getObject(copy.centerPointId);

  assert.equal(copiedCenter.label, "圆心");
  assert.equal(copiedCenter.style.showLabel, false);
  assert.equal(document.addFreePoint({ x: 20, y: 20 }, settings).label, "G");
});

test("circle using a segment as radius follows the segment length", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 10, y: 10 }, settings);
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 3, y: 4 }, settings);
  const segment = document.addSegment(a.id, b.id, settings);
  const circle = document.addCircleWithSegmentRadius(center.id, segment.id, settings);
  let geometry = document.getShapeGeometry(circle);
  close(geometry.radius, 5);
  document.movePoint(b.id, { x: 0, y: 8 });
  geometry = document.getShapeGeometry(circle);
  close(geometry.radius, 8);
  assert.deepEqual(new Set(document.dependenciesOf(circle)), new Set([center.id, segment.id]));
});

test("degenerate circles and arcs with off-circle endpoints are rejected", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 0, y: 0 }, settings);
  const samePosition = document.addFreePoint({ x: 0, y: 0 }, settings);
  const onCircleA = document.addFreePoint({ x: 10, y: 0 }, settings);
  const onCircleB = document.addFreePoint({ x: 0, y: 10 }, settings);
  const offCircle = document.addFreePoint({ x: 3, y: 4 }, settings);
  assert.equal(document.addCircle(center.id, samePosition.id, settings), null);
  assert.equal(document.addSegment(center.id, samePosition.id, settings), null);
  assert.equal(document.addLine(center.id, samePosition.id, settings), null);
  assert.equal(document.addPerpendicularBisector(center.id, samePosition.id, settings), null);
  const circle = document.addCircle(center.id, onCircleA.id, settings);
  assert.equal(document.addArcOnCircle(circle.id, onCircleA.id, offCircle.id, settings), null);
  assert.ok(document.addArcOnCircle(circle.id, onCircleA.id, onCircleB.id, settings));
  const collinear = document.addFreePoint({ x: 20, y: 0 }, settings);
  assert.equal(document.addThreePointArc(center.id, onCircleA.id, collinear.id, settings), null);
});

test("angle mark switches dynamically between an arc and a right-angle square", () => {
  const document = new GeometryDocument();
  const vertex = document.addFreePoint({ x: 0, y: 0 }, settings);
  const a = document.addFreePoint({ x: 20, y: 0 }, settings);
  const b = document.addFreePoint({ x: 0, y: 20 }, settings);
  const sideA = document.addSegment(vertex.id, a.id, settings);
  const sideB = document.addSegment(vertex.id, b.id, settings);
  const inferred = document.findAngleAt(vertex.id, { x: 10, y: 10 }, 0.01);
  assert.equal(inferred.sideAId, sideA.id);
  assert.equal(inferred.sideBId, sideB.id);
  const mark = document.addAngleMarkFromSides(
    inferred.vertexId,
    inferred.sideAId,
    inferred.directionA,
    inferred.sideBId,
    inferred.directionB,
    settings,
  );
  let geometry = document.getShapeGeometry(mark);
  assert.equal(geometry.kind, "angleMark");
  assert.equal(geometry.rightAngle, true);
  assert.ok(geometry.corner);
  close(Math.abs(geometry.signedAngle), Math.PI / 2);

  document.movePoint(b.id, { x: 10, y: 10 * Math.sqrt(3) });
  geometry = document.getShapeGeometry(mark);
  assert.equal(geometry.rightAngle, false);
  assert.equal(geometry.corner, null);
  close(Math.abs(geometry.signedAngle), Math.PI / 3);
});

test("angle marks can be selected near their visible stroke", () => {
  const document = new GeometryDocument();
  const vertex = document.addFreePoint({ x: 0, y: 0 }, settings);
  const a = document.addFreePoint({ x: 30, y: 0 }, settings);
  const b = document.addFreePoint({ x: 0, y: 30 }, settings);
  const sideA = document.addSegment(vertex.id, a.id, settings);
  const sideB = document.addSegment(vertex.id, b.id, settings);
  const mark = document.addAngleMarkFromSides(vertex.id, sideA.id, 1, sideB.id, 1, settings);
  const geometry = document.getShapeGeometry(mark);
  const hit = document.hitTestShapes(geometry.corner, 1);
  assert.ok(hit.some((item) => item.object.id === mark.id));
  assert.deepEqual(new Set(document.dependenciesOf(mark)), new Set([vertex.id, sideA.id, sideB.id]));
  assert.equal(geometry.strokeCount, 1);
  document.cycleAngleMark(mark.id);
  assert.equal(document.getShapeGeometry(mark).strokeCount, 2);
  document.setAngleMarkRadius(mark.id, 18);
  assert.equal(document.getShapeGeometry(mark).radius, 18);
});

test("marker drag direction chooses the adjacent angle at a line intersection", () => {
  const document = new GeometryDocument();
  const left = document.addFreePoint({ x: -20, y: 0 }, settings);
  const right = document.addFreePoint({ x: 20, y: 0 }, settings);
  const top = document.addFreePoint({ x: 0, y: -20 }, settings);
  const bottom = document.addFreePoint({ x: 0, y: 20 }, settings);
  const horizontal = document.addLine(left.id, right.id, settings);
  const vertical = document.addLine(top.id, bottom.id, settings);
  const vertex = document.addIntersectionPoint(horizontal.id, vertical.id, 0, settings);
  const inferred = document.findAngleAt(vertex.id, { x: -8, y: -8 }, 0.01);
  assert.deepEqual(new Set([inferred.sideAId, inferred.sideBId]), new Set([horizontal.id, vertical.id]));
  close(inferred.angle, Math.PI / 2);
});

test("path marks follow their parent segment and cycle marks", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 20, y: 0 }, settings);
  const segment = document.addSegment(a.id, b.id, settings);
  const mark = document.addPathMark(segment.id, { x: 8, y: 1 }, settings);
  let geometry = document.getShapeGeometry(mark);
  close(geometry.center.x, 8);
  close(geometry.center.y, 0);
  assert.equal(geometry.strokeCount, 1);
  document.cyclePathMark(mark.id);
  document.setPathMarkKind(mark.id, "arrow");
  geometry = document.getShapeGeometry(mark);
  assert.equal(geometry.strokeCount, 2);
  assert.equal(geometry.markKind, "arrow");
  document.movePoint(b.id, { x: 0, y: 20 });
  geometry = document.getShapeGeometry(mark);
  close(geometry.center.x, 0);
  close(geometry.center.y, 8);
  document.movePathMark(mark.id, { x: 0, y: 15 });
  geometry = document.getShapeGeometry(mark);
  close(geometry.center.y, 15);
  assert.deepEqual(document.dependenciesOf(mark), [segment.id]);
});

test("doodles are selectable without construction dependencies", () => {
  const document = new GeometryDocument();
  const doodle = document.addDoodle([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }], settings);
  assert.equal(document.getShapeGeometry(doodle).kind, "doodle");
  assert.ok(document.hitTestShapes({ x: 5, y: 5 }, 0.5).some((hit) => hit.object.id === doodle.id));
  assert.deepEqual(document.dependenciesOf(doodle), []);
});

test("standalone text can be edited, moved, selected and serialized", () => {
  const document = new GeometryDocument();
  const text = document.addText({ x: 12, y: 34 }, "勾股定理", settings);
  assert.equal(document.hitTest({ x: 14, y: 30 }, 2).object.id, text.id);
  document.updateText(text.id, "直角三角形");
  document.moveText(text.id, { x: 40, y: 50 });
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.getObject(text.id).content, "直角三角形");
  assert.equal(restored.getObject(text.id).x, 40);
  assert.deepEqual(restored.dependenciesOf(restored.getObject(text.id)), []);
  assert.equal(restored.updateText(text.id, ""), true);
  assert.equal(restored.getObject(text.id), null);
});

test("measurements update dynamically with their parent geometry", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const vertex = document.addFreePoint({ x: 3, y: 0 }, settings);
  const b = document.addFreePoint({ x: 3, y: 4 }, settings);
  const segment = document.addSegment(a.id, b.id, settings);
  const circle = document.addCircle(a.id, vertex.id, settings);
  const distanceValue = document.addMeasurement("distance", [a.id, b.id], { x: 0, y: 0 }, settings);
  const lengthValue = document.addMeasurement("length", [segment.id], { x: 0, y: 20 }, settings);
  const angleValue = document.addMeasurement("angle", [a.id, vertex.id, b.id], { x: 0, y: 40 }, settings);
  const radiusValue = document.addMeasurement("radius", [circle.id], { x: 0, y: 60 }, settings);
  assert.equal(document.getMeasurementText(distanceValue), "距离 AC = 5.00");
  assert.equal(document.getMeasurementText(lengthValue), "线段 AC 长度 = 5.00");
  assert.equal(document.getMeasurementText(angleValue), "∠ABC = 90.00°");
  assert.equal(document.getMeasurementText(radiusValue), "圆 A 半径 = 3.00");
  document.movePoint(b.id, { x: 6, y: 0 });
  assert.equal(document.getMeasurementText(distanceValue), "距离 AC = 6.00");
  assert.deepEqual(document.dependenciesOf(distanceValue), [a.id, b.id]);
});

test("collinearity measurement reports normalized point-to-line error", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 0 }, settings);
  const c = document.addFreePoint({ x: 25, y: 0 }, settings);
  const value = document.addMeasurement("collinearity", [a.id, b.id, c.id], { x: 0, y: 0 }, settings);
  close(document.getMeasurementValue(value), 0);
  assert.match(document.getMeasurementText(value), /A、B、C 共线误差 = 0\.000e\+0（数值验证：共线）/);
  document.movePoint(c.id, { x: 25, y: 4 });
  close(document.getMeasurementValue(value), 4);
  assert.match(document.getMeasurementText(value), /数值验证：不共线/);
});

test("angle marks and arcs can be measured with named dynamic results", () => {
  const document = new GeometryDocument();
  const vertex = document.addFreePoint({ x: 0, y: 0 }, settings);
  const a = document.addFreePoint({ x: 20, y: 0 }, settings);
  const b = document.addFreePoint({ x: 0, y: 20 }, settings);
  const sideA = document.addSegment(vertex.id, a.id, settings);
  const sideB = document.addSegment(vertex.id, b.id, settings);
  const mark = document.addAngleMarkFromSides(vertex.id, sideA.id, 1, sideB.id, 1, settings);
  const markValue = document.addMeasurement("angle", [mark.id], { x: 0, y: 0 }, settings);
  assert.equal(document.getMeasurementText(markValue), "∠BAC = 90.00°");
  close(document.getMeasurementValue(markValue), 90);

  const circle = document.addCircle(vertex.id, a.id, settings);
  const arc = document.addArcOnCircle(circle.id, a.id, b.id, settings);
  const arcValue = document.addMeasurement("angle", [arc.id], { x: 0, y: 20 }, settings);
  assert.equal(document.getMeasurementText(arcValue), "弧 BC 圆心角 = 90.00°");
});

test("any two line-like objects can report their named smaller angle", () => {
  const document = new GeometryDocument();
  const origin = document.addFreePoint({ x: 0, y: 0 }, settings);
  const horizontalPoint = document.addFreePoint({ x: 10, y: 0 }, settings);
  const upperPoint = document.addFreePoint({ x: 0, y: 10 }, settings);
  const base = document.addLine(origin.id, horizontalPoint.id, settings);
  const parallel = document.addParallelLine(upperPoint.id, base.id, settings);
  const perpendicular = document.addPerpendicularLine(origin.id, base.id, settings);
  const value = document.addMeasurement("angle", [parallel.id, perpendicular.id], { x: 0, y: 0 }, settings);
  close(document.getMeasurementValue(value), 90);
  assert.equal(document.getMeasurementText(value), "过 C 的平行线 与 过 A 的垂线 的夹角 = 90.00°");
});

test("arc length, segment ratio, path value and coordinate-system measurements are dynamic", () => {
  const document = new GeometryDocument();
  const origin = document.addFreePoint({ x: 100, y: 100 }, settings);
  const right = document.addFreePoint({ x: 120, y: 100 }, settings);
  const bottom = document.addFreePoint({ x: 100, y: 120 }, settings);
  const circle = document.addCircle(origin.id, right.id, settings);
  const arc = document.addArcOnCircle(circle.id, right.id, bottom.id, settings);
  const first = document.addSegment(origin.id, right.id, settings);
  const second = document.addSegment(origin.id, bottom.id, settings);
  const driver = document.addPointOnShape(first.id, { x: 110, y: 100 }, settings);
  const system = document.addCoordinateSystem(origin.id, settings, { unitX: 20, unitY: 20 });
  const arcValue = document.addMeasurement("arcLength", [arc.id], { x: 0, y: 0 }, settings);
  const ratioValue = document.addMeasurement("ratio", [first.id, second.id], { x: 0, y: 20 }, settings);
  const pointValue = document.addMeasurement("pointValue", [driver.id], { x: 0, y: 40 }, settings);
  const coordinates = document.addMeasurement("coordinates", [right.id, system.id], { x: 0, y: 60 }, settings);
  close(document.getMeasurementValue(arcValue), Math.PI * 10);
  close(document.getMeasurementValue(ratioValue), 1);
  close(document.getMeasurementValue(pointValue), 0.5);
  assert.equal(document.getMeasurementText(coordinates), "点 B 坐标 = (1.00, 0.00)");
  assert.equal(document.getMeasurementText(pointValue), "点 D（位于线段 AB） 路径参数 = 0.50");
});

test("translated, rotated, scaled and reflected points remain dynamic", () => {
  const document = new GeometryDocument();
  const origin = document.addFreePoint({ x: 0, y: 0 }, settings);
  const point = document.addFreePoint({ x: 10, y: 0 }, settings);
  const mirrorEnd = document.addFreePoint({ x: 0, y: 10 }, settings);
  const mirror = document.addLine(origin.id, mirrorEnd.id, settings);
  const translated = document.addTranslatedPoint(point.id, 5, 3, settings);
  const rotated = document.addRotatedPoint(point.id, origin.id, 90, settings);
  const scaled = document.addScaledPoint(point.id, origin.id, 2, settings);
  const reflected = document.addReflectedPoint(point.id, mirror.id, settings);
  assert.deepEqual(document.getPointPosition(translated), { x: 15, y: 3 });
  close(document.getPointPosition(rotated).x, 0);
  close(document.getPointPosition(rotated).y, 10);
  assert.deepEqual(document.getPointPosition(scaled), { x: 20, y: 0 });
  close(document.getPointPosition(reflected).x, -10);
  close(document.getPointPosition(reflected).y, 0);
  document.movePoint(point.id, { x: 4, y: 0 });
  assert.deepEqual(document.getPointPosition(translated), { x: 9, y: 3 });
  document.markTransformCenter(origin.id);
  document.markMirror(mirror.id);
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.markedCenterId, origin.id);
  assert.equal(restored.markedMirrorId, mirror.id);
});

test("circle arcs, three-point arcs and their interiors remain dynamic", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 0, y: 0 }, settings);
  const right = document.addFreePoint({ x: 10, y: 0 }, settings);
  const left = document.addFreePoint({ x: -10, y: 0 }, settings);
  const circle = document.addCircle(center.id, right.id, settings);
  const bottom = document.addPointOnShape(circle.id, { x: 0, y: 10 }, settings);
  const arc = document.addArcOnCircle(circle.id, right.id, bottom.id, settings);
  let geometry = document.getShapeGeometry(arc);
  assert.equal(geometry.kind, "arc");
  close(geometry.signedAngle, Math.PI / 2);
  const throughArc = document.addThreePointArc(right.id, bottom.id, left.id, settings);
  geometry = document.getShapeGeometry(throughArc);
  close(Math.abs(geometry.signedAngle), Math.PI);
  const sector = document.addArcInterior(arc.id, "sector", settings);
  const segment = document.addArcInterior(arc.id, "segment", settings);
  const disk = document.addCircleInterior(circle.id, settings);
  assert.equal(document.getShapeGeometry(sector).kind, "arcInterior");
  assert.equal(document.getShapeGeometry(segment).interiorKind, "segment");
  assert.equal(document.getShapeGeometry(disk).kind, "circleInterior");
  document.movePoint(right.id, { x: 20, y: 0 });
  close(document.getShapeGeometry(arc).radius, 20);
  close(document.getShapeGeometry(arc).end.y, 20);
});

test("circle arcs become undefined instead of projecting detached endpoints", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 0, y: 0 }, settings);
  const right = document.addFreePoint({ x: 10, y: 0 }, settings);
  const bottom = document.addFreePoint({ x: 0, y: 10 }, settings);
  const circle = document.addCircle(center.id, right.id, settings);
  const arc = document.addArcOnCircle(circle.id, right.id, bottom.id, settings);
  assert.equal(document.getShapeGeometry(arc).kind, "arc");
  document.movePoint(right.id, { x: 20, y: 0 });
  assert.equal(document.getShapeGeometry(arc), null);
});

test("intersections with an arc exclude the unused part of its circle", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 0, y: 0 }, settings);
  const right = document.addFreePoint({ x: 10, y: 0 }, settings);
  const bottom = document.addFreePoint({ x: 0, y: 10 }, settings);
  const lineA = document.addFreePoint({ x: -20, y: 5 }, settings);
  const lineB = document.addFreePoint({ x: 20, y: 5 }, settings);
  const circle = document.addCircle(center.id, right.id, settings);
  const arc = document.addArcOnCircle(circle.id, right.id, bottom.id, settings);
  const line = document.addLine(lineA.id, lineB.id, settings);
  const intersections = document.getIntersections(arc.id, line.id);
  assert.equal(intersections.length, 1);
  assert.ok(intersections[0].x > 0);
});

test("safe expressions support precedence, powers, constants and math functions", () => {
  close(evaluateExpression("2 + 3 * 4^2"), 50);
  close(evaluateExpression("sin(pi / 2) + sqrt(9)"), 4);
  close(evaluateExpression("-2^2"), -4);
  close(evaluateExpression("a * 3", { a: 2.5 }), 7.5);
  assert.throws(() => evaluateExpression("unknown + 1"), /未知变量/);
  assert.throws(() => evaluateExpression("globalThis.alert(1)"));
});

test("expression identifier extraction ignores functions and constants", () => {
  assert.deepEqual(
    expressionIdentifiers("sin(a) + PI + b_2 + round(c) + e + x"),
    ["a", "b_2", "c", "x"],
  );
});

test("calculations depend only on variables used by their expression", () => {
  const document = new GeometryDocument();
  const a = document.addParameter("a", 2, "none", { x: 0, y: 0 }, settings);
  const b = document.addParameter("b", 7, "none", { x: 0, y: 20 }, settings);
  const calculation = document.addCalculation(
    "square", "a^2 + 1", { a: a.id, b: b.id }, { x: 0, y: 40 }, settings,
  );
  assert.deepEqual(document.dependenciesOf(calculation), [a.id]);
  document.removeWithDependents(b.id);
  assert.ok(document.getObject(calculation.id));
  assert.equal(document.getNumericValue(calculation), 5);
});

test("coordinate plots retain explicit parameter bindings", () => {
  const document = new GeometryDocument();
  const a = document.addParameter("a", 2, "none", { x: 0, y: 0 }, settings);
  const system = document.addCoordinateSystem({ x: 0, y: 0 }, settings, { unitX: 10, unitY: 10 });
  const point = document.addPlottedPoint(system.id, "a", "a + 1", settings);
  const graph = document.addFunctionGraph(system.id, "a*x", settings, { min: 0, max: 1, samples: 32 });
  const curve = document.addParametricPlot(system.id, "a*cos(t)", "a*sin(t)", settings, { min: 0, max: Math.PI * 2, samples: 32 });
  for (const object of [point, graph, curve]) {
    assert.ok(document.dependenciesOf(object).includes(a.id));
  }

  document.addParameter("a", 9, "none", { x: 0, y: 60 }, settings);
  document.setParameterValue(a.id, 3);
  assert.deepEqual(document.getPointPosition(point), { x: 30, y: -40 });
  close(document.getShapeGeometry(graph).paths.at(-1).at(-1).y, -30);
  close(document.getShapeGeometry(curve).paths.at(-1).at(-1).x, 30);

  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.getObject(graph.id).variables.a, a.id);
  close(restored.getShapeGeometry(graph).paths.at(-1).at(-1).y, -30);
});

test("graph sampling variables override parameters with the same name", () => {
  const document = new GeometryDocument();
  const xParameter = document.addParameter("x", 99, "none", { x: 0, y: 0 }, settings);
  document.addParameter("t", 77, "none", { x: 0, y: 20 }, settings);
  const system = document.addCoordinateSystem({ x: 0, y: 0 }, settings, { unitX: 10, unitY: 10 });
  const graph = document.addFunctionGraph(system.id, "x", settings, { min: 0, max: 1, samples: 32 });
  const curve = document.addParametricPlot(system.id, "t", "0", settings, { min: 0, max: 1, samples: 32 });
  const point = document.addPlottedPoint(system.id, "x", "0", settings);
  assert.deepEqual(graph.variables, {});
  assert.deepEqual(curve.variables, {});
  assert.equal(point.definition.variables.x, xParameter.id);
  close(document.getShapeGeometry(graph).paths.at(-1).at(-1).y, -10);
  close(document.getShapeGeometry(curve).paths.at(-1).at(-1).x, 10);
  close(document.getPointPosition(point).x, 990);
});

test("legacy plots migrate name bindings while duplicated plots remap dependency ids", () => {
  const document = new GeometryDocument();
  const first = document.addParameter("a", 2, "none", { x: 0, y: 0 }, settings);
  const system = document.addCoordinateSystem({ x: 0, y: 0 }, settings, { unitX: 10, unitY: 10 });
  const graph = document.addFunctionGraph(system.id, "a*x", settings, { min: 0, max: 1, samples: 32 });
  const second = document.addParameter("a", 9, "none", { x: 0, y: 20 }, settings);

  const explicit = GeometryDocument.fromJSON(document.serialize());
  assert.equal(explicit.getObject(graph.id).variables.a, first.id);

  const legacyData = document.toJSON();
  delete legacyData.objects.find((object) => object.id === graph.id).variables;
  const legacy = GeometryDocument.fromJSON(legacyData);
  assert.equal(legacy.getObject(graph.id).variables.a, second.id);
  close(legacy.getShapeGeometry(graph.id).paths.at(-1).at(-1).y, -90);

  const [copy] = document.duplicateObjects([graph.id], { x: 20, y: 20 });
  assert.notEqual(copy.variables.a, first.id);
  assert.equal(document.getNumericValue(copy.variables.a), 2);
  document.removeWithDependents(first.id);
  assert.equal(document.getObject(graph.id), null);
  assert.ok(document.getObject(copy.id));
});

test("legacy expression migration preserves invalid calculations and last valid duplicate names", () => {
  const document = new GeometryDocument();
  const parameter = document.addParameter("a", 2, "none", { x: 0, y: 0 }, settings);
  const system = document.addCoordinateSystem({ x: 0, y: 0 }, settings, { unitX: 10, unitY: 10 });
  const graph = document.addFunctionGraph(system.id, "a*x", settings, { min: 0, max: 1, samples: 32 });
  const calculation = document.addCalculation("a", "a + 1", { a: parameter.id }, { x: 0, y: 20 }, settings);
  calculation.expression = "missing + 1";
  calculation.variables = {};
  const legacyData = document.toJSON();
  delete legacyData.objects.find((object) => object.id === graph.id).variables;
  const restored = GeometryDocument.fromJSON(legacyData);
  assert.equal(restored.getObject(graph.id).variables.a, parameter.id);
  close(restored.getShapeGeometry(graph.id).paths.at(-1).at(-1).y, -20);

  const missingCalculationBindings = document.toJSON();
  const savedCalculation = missingCalculationBindings.objects.find((object) => object.id === calculation.id);
  savedCalculation.expression = "a + 1";
  delete savedCalculation.variables;
  const invalidCalculation = GeometryDocument.fromJSON(missingCalculationBindings).getObject(calculation.id);
  assert.deepEqual(invalidCalculation.variables, {});
  assert.equal(GeometryDocument.fromJSON(missingCalculationBindings).getNumericValue(calculation.id), null);
});

test("invalid and cyclic expression dependencies are rejected without recursive copy overflow", () => {
  const document = new GeometryDocument();
  const parameter = document.addParameter("p", 1, "none", { x: 0, y: 0 }, settings);
  const first = document.addCalculation("first", "p + 1", { p: parameter.id }, { x: 0, y: 20 }, settings);
  const second = document.addCalculation("second", "first + 1", { first: first.id }, { x: 0, y: 40 }, settings);
  first.expression = "second + 1";
  first.variables = { second: second.id };
  assert.doesNotThrow(() => document.duplicateObjects([first.id]));
  assert.throws(() => GeometryDocument.fromJSON(document.toJSON()), /循环依赖/);

  const valid = new GeometryDocument();
  const system = valid.addCoordinateSystem({ x: 0, y: 0 }, settings, { unitX: 10, unitY: 10 });
  const graph = valid.addFunctionGraph(system.id, "x", settings, { min: 0, max: 1 });
  const corrupted = valid.toJSON();
  corrupted.objects.find((object) => object.id === graph.id).variables = { a: "obj-999" };
  corrupted.objects.find((object) => object.id === graph.id).expression = "a*x";
  assert.throws(() => GeometryDocument.fromJSON(corrupted), /不存在|无效数值对象/);
});

test("parameters and calculations update dynamically and survive serialization", () => {
  const document = new GeometryDocument();
  const parameter = document.addParameter("a", 3, "none", { x: 10, y: 20 }, settings);
  const calculation = document.addCalculation("c", "a^2 + 1", { a: parameter.id }, { x: 10, y: 40 }, settings);
  assert.equal(document.getNumericValue(calculation), 10);
  assert.equal(document.getValueText(calculation), "c = 10");
  document.setParameterValue(parameter.id, 4);
  assert.equal(document.getNumericValue(calculation), 17);
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.getNumericValue(calculation.id), 17);
  assert.deepEqual(restored.dependenciesOf(restored.getObject(calculation.id)), [parameter.id]);
});

test("coordinate plots and function graphs follow parameter changes", () => {
  const document = new GeometryDocument();
  const system = document.addCoordinateSystem({ x: 100, y: 100 }, settings, { unitX: 20, unitY: 10 });
  const parameter = document.addParameter("a", 2, "none", { x: 0, y: 0 }, settings);
  const point = document.addPlottedPoint(system.id, "a", "a+1", settings);
  assert.deepEqual(document.getPointPosition(point), { x: 140, y: 70 });
  const graph = document.addFunctionGraph(system.id, "a*x", settings, { min: -1, max: 1, samples: 32 });
  let geometry = document.getShapeGeometry(graph);
  assert.equal(geometry.kind, "plot");
  assert.equal(geometry.paths[0].length, 33);
  document.setParameterValue(parameter.id, 3);
  assert.deepEqual(document.getPointPosition(point), { x: 160, y: 60 });
  geometry = document.getShapeGeometry(graph);
  const right = geometry.paths[0].at(-1);
  close(right.x, 120);
  close(right.y, 70);
  const inverse = document.addFunctionGraph(system.id, "y^2", settings, { mode: "x", min: -1, max: 1, samples: 32 });
  const inverseRight = document.getShapeGeometry(inverse).paths[0].at(-1);
  close(inverseRight.x, 120);
  close(inverseRight.y, 90);
  const polar = document.addFunctionGraph(system.id, "2", settings, { mode: "polar", min: 0, max: Math.PI * 2, samples: 64 });
  for (const plotted of document.getShapeGeometry(polar).paths[0]) {
    close(Math.hypot((plotted.x - 100) / 20, (plotted.y - 100) / 10), 2, 1e-6);
  }
});

test("points constrained to an arc stay on the visible arc", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 0, y: 0 }, settings);
  const right = document.addFreePoint({ x: 10, y: 0 }, settings);
  const bottom = document.addFreePoint({ x: 0, y: 10 }, settings);
  const circle = document.addCircle(center.id, right.id, settings);
  const arc = document.addArcOnCircle(circle.id, right.id, bottom.id, settings);
  const point = document.addPointOnShape(arc.id, { x: 7, y: 7 }, settings);
  document.movePoint(point.id, { x: -10, y: 0 });
  const position = document.getPointPosition(point);
  assert.ok(position.x >= -1e-7 && position.y >= -1e-7);
  close(Math.hypot(position.x, position.y), 10);
});

test("locus samples a dependent point while preserving the driver position", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 0, y: 0 }, settings);
  const through = document.addFreePoint({ x: 20, y: 0 }, settings);
  const circle = document.addCircle(center.id, through.id, settings);
  const driver = document.addPointOnShape(circle.id, { x: 20, y: 0 }, settings);
  const traced = document.addMidpoint(center.id, driver.id, settings);
  const original = document.getPointPosition(driver);
  const locus = document.addLocus(traced.id, driver.id, settings, 64);
  const geometry = document.getShapeGeometry(locus);
  assert.equal(geometry.kind, "plot");
  assert.equal(geometry.paths[0].length, 65);
  for (const point of geometry.paths[0]) close(Math.hypot(point.x, point.y), 10, 1e-6);
  assert.deepEqual(document.getPointPosition(driver), original);
});

test("tables collect snapshots from dynamic numeric values", () => {
  const document = new GeometryDocument();
  const parameter = document.addParameter("n", 1, "none", { x: 0, y: 0 }, settings);
  const calculation = document.addCalculation("square", "n^2", { n: parameter.id }, { x: 0, y: 20 }, settings);
  const table = document.addTable([parameter.id, calculation.id], { x: 20, y: 40 }, settings);
  document.setParameterValue(parameter.id, 3);
  document.addTableRow(table.id);
  assert.deepEqual(document.getTableData(table), {
    headers: ["n", "square"], rows: [[1, 1], [3, 9]],
  });
  assert.deepEqual(document.dependenciesOf(table), [parameter.id, calculation.id]);
});

test("angle marker direction and opacity properties are editable", () => {
  const document = new GeometryDocument();
  const vertex = document.addFreePoint({ x: 0, y: 0 }, settings);
  const right = document.addFreePoint({ x: 10, y: 0 }, settings);
  const bottom = document.addFreePoint({ x: 0, y: 10 }, settings);
  const sideA = document.addRay(vertex.id, right.id, settings);
  const sideB = document.addRay(vertex.id, bottom.id, settings);
  const mark = document.addAngleMarkFromSides(vertex.id, sideA.id, 1, sideB.id, 1, settings);
  close(document.getShapeGeometry(mark).signedAngle, Math.PI / 2);
  document.setAngleMarkOpacity(mark.id, 0.4);
  document.setAngleMarkDirectionVisible(mark.id, true);
  assert.equal(document.getShapeGeometry(mark).opacity, 0.4);
  assert.equal(document.getShapeGeometry(mark).showDirection, true);
  document.reverseAngleMark(mark.id);
  close(document.getShapeGeometry(mark).signedAngle, Math.PI * 3 / 2);
});

test("generic transformed shapes preserve dynamic derived geometry", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 0, y: 0 }, settings);
  const right = document.addFreePoint({ x: 10, y: 0 }, settings);
  const circle = document.addCircle(center.id, right.id, settings);
  const bottom = document.addPointOnShape(circle.id, { x: 0, y: 10 }, settings);
  const arc = document.addArcOnCircle(circle.id, right.id, bottom.id, settings);
  document.markTransformCenter(center.id);
  const scaledArc = document.addTransformedShape(arc.id, "scale", 2, settings);
  let geometry = document.getShapeGeometry(scaledArc);
  close(geometry.radius, 20);
  close(geometry.end.y, 20);
  document.movePoint(right.id, { x: 15, y: 0 });
  geometry = document.getShapeGeometry(scaledArc);
  close(geometry.radius, 30);
  const mirrorEnd = document.addFreePoint({ x: 0, y: 20 }, settings);
  const mirror = document.addLine(center.id, mirrorEnd.id, settings);
  document.markMirror(mirror.id);
  const reflected = document.addTransformedShape(arc.id, "reflect", null, settings);
  geometry = document.getShapeGeometry(reflected);
  assert.ok(geometry.start.x < 0);
  assert.equal(Math.sign(geometry.signedAngle), -1);
  assert.deepEqual(document.dependenciesOf(reflected), [arc.id, mirror.id]);
  const secondScale = document.addTransformedShape(scaledArc.id, "scale", 2, settings);
  close(document.getShapeGeometry(secondScale).radius, 60);
});

test("locking, tracing and layer ordering persist in the document", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 0 }, settings);
  const segment = document.addSegment(a.id, b.id, settings);
  const text = document.addText({ x: 0, y: 0 }, "顶层文字", settings);
  const image = document.addImage("data:image/png;base64,AA==", { x: -5, y: -5 }, { width: 20, height: 20 });
  const objectOrder = document.objects.map((object) => object.id);
  document.setObjectsLocked([segment.id], true);
  document.setObjectsTracing([a.id], true);
  assert.equal(document.hitTest({ x: 0, y: 0 }, 1).object.id, text.id);
  document.reorderObjects([image.id], "front");
  assert.equal(document.objectsInPaintOrder().at(-1).id, image.id);
  assert.equal(document.hitTest({ x: 0, y: 0 }, 1).object.id, image.id);
  assert.deepEqual(document.objects.map((object) => object.id), objectOrder);
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.getObject(segment.id).locked, true);
  assert.equal(restored.getObject(a.id).trace, true);
  restored.reorderObjects([segment.id], "front");
  assert.equal(restored.objectsInPaintOrder().at(-1).id, segment.id);
  assert.deepEqual(restored.objects.map((object) => object.id), objectOrder);

  const legacyData = document.toJSON();
  delete legacyData.paintOrder;
  const legacy = GeometryDocument.fromJSON(legacyData);
  const legacyOrder = legacy.objectsInPaintOrder().map((object) => object.id);
  assert.ok(legacyOrder.indexOf(image.id) < legacyOrder.indexOf(segment.id));
  assert.ok(legacyOrder.indexOf(segment.id) < legacyOrder.indexOf(a.id));
  assert.ok(legacyOrder.indexOf(a.id) < legacyOrder.indexOf(text.id));
});

test("hit testing prefers proximity before paint order and copied groups preserve paint order", () => {
  const document = new GeometryDocument();
  const exact = document.addFreePoint({ x: 0, y: 0 }, settings);
  const nearFront = document.addFreePoint({ x: 9, y: 0 }, settings);
  assert.equal(document.hitTest({ x: 0, y: 0 }, 10).object.id, exact.id);
  document.movePoint(nearFront.id, { x: 0, y: 0 });
  assert.equal(document.hitTest({ x: 0, y: 0 }, 10).object.id, nearFront.id);

  const text = document.addText({ x: 20, y: 20 }, "文字", settings);
  const image = document.addImage("data:image/png;base64,AA==", { x: 20, y: 0 }, { width: 40, height: 40 });
  document.reorderObjects([image.id], "front");
  const destination = new GeometryDocument();
  const copied = destination.importObjects(document, [text.id, image.id], { x: 0, y: 0 });
  const copiedText = copied.find((object) => object.type === "text");
  const copiedImage = copied.find((object) => object.type === "image");
  const copiedOrder = destination.objectsInPaintOrder().map((object) => object.id);
  assert.ok(copiedOrder.indexOf(copiedText.id) < copiedOrder.indexOf(copiedImage.id));
  destination.removeWithDependents(copiedImage.id);
  assert.ok(!destination.toJSON().paintOrder.includes(copiedImage.id));
});

test("filled-shape tolerance bands do not outrank an exact point", () => {
  const document = new GeometryDocument();
  const center = document.addFreePoint({ x: 0, y: 0 }, settings);
  const edge = document.addFreePoint({ x: 10, y: 0 }, settings);
  const circle = document.addCircle(center.id, edge.id, settings);
  const disk = document.addCircleInterior(circle.id, settings);
  const exact = document.addFreePoint({ x: 15, y: 0 }, settings);
  document.reorderObjects([disk.id], "front");

  const diskHit = document.hitTestShapes({ x: 15, y: 0 }, 10)
    .find((hit) => hit.object.id === disk.id);
  assert.equal(diskHit.distance, 5);
  assert.equal(document.hitTest({ x: 15, y: 0 }, 10).object.id, exact.id);
});

test("action buttons retain targets and cascade with controlled objects", () => {
  const document = new GeometryDocument();
  const point = document.addFreePoint({ x: 0, y: 0 }, settings);
  const button = document.addActionButton("hide", [point.id], "隐藏 A", { x: 20, y: 20 }, settings);
  assert.deepEqual(document.dependenciesOf(button), [point.id]);
  assert.equal(document.hitTest({ x: 22, y: 18 }, 4).object.id, button.id);
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.getObject(button.id).label, "隐藏 A");
  restored.removeWithDependents(point.id);
  assert.equal(restored.getObject(button.id), null);
  const destination = document.addFreePoint({ x: 30, y: 40 }, settings);
  const move = document.addActionButton("move", [point.id, destination.id], "移动", { x: 20, y: 50 }, settings);
  const link = document.addActionButton("link", [], "资料", { x: 20, y: 80 }, settings, { url: "https://example.com" });
  const sound = document.addActionButton("sound", [], "提示音", { x: 20, y: 110 }, settings, { frequency: 880 });
  assert.ok(move);
  assert.equal(link.url, "https://example.com");
  assert.equal(sound.frequency, 880);
});

test("copying a constructed object rebuilds an independent dependency graph", () => {
  const source = new GeometryDocument();
  const a = source.addFreePoint({ x: 0, y: 0 }, settings);
  const b = source.addFreePoint({ x: 10, y: 0 }, settings);
  const midpoint = source.addMidpoint(a.id, b.id, settings);
  const segment = source.addSegment(a.id, midpoint.id, settings);
  const destination = new GeometryDocument();
  const [copiedSegment] = destination.importObjects(source, [segment.id], { x: 20, y: 30 });
  const dependencies = destination.dependenciesOf(copiedSegment);
  assert.equal(dependencies.length, 2);
  const first = destination.getPointPosition(dependencies[0]);
  const second = destination.getPointPosition(dependencies[1]);
  assert.deepEqual(first, { x: 20, y: 30 });
  assert.deepEqual(second, { x: 25, y: 30 });
  destination.movePoint(dependencies[0], { x: 30, y: 30 });
  assert.deepEqual(source.getPointPosition(a), { x: 0, y: 0 });
  assert.equal(destination.objects.length, 4);
});

test("drag translation moves derived points through their free dependencies", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 0 }, settings);
  const midpoint = document.addMidpoint(a.id, b.id, settings);
  assert.equal(document.isPointDirectlyMovable(midpoint), false);
  assert.equal(document.canTranslateObjects([midpoint.id]), true);
  assert.equal(document.translateObjects([midpoint.id], { x: 6, y: 4 }), true);
  assert.deepEqual(document.getPointPosition(a), { x: 6, y: 4 });
  assert.deepEqual(document.getPointPosition(b), { x: 16, y: 4 });
  assert.deepEqual(document.getPointPosition(midpoint), { x: 11, y: 4 });
});

test("drag translation supports mixed positioned objects, doodles and free coordinate systems", () => {
  const document = new GeometryDocument();
  const text = document.addText({ x: 10, y: 20 }, "第一行\n第二行", settings);
  const image = document.addImage("data:image/png;base64,AA==", { x: 30, y: 40 }, { width: 20, height: 10 });
  const doodle = document.addDoodle([{ x: 1, y: 2 }, { x: 3, y: 4 }], settings);
  const system = document.addCoordinateSystem({ x: 100, y: 120 }, settings);
  assert.equal(document.translateObjects([text.id, image.id, doodle.id, system.id], { x: 5, y: -3 }), true);
  assert.deepEqual({ x: text.x, y: text.y }, { x: 15, y: 17 });
  assert.deepEqual({ x: image.x, y: image.y }, { x: 35, y: 37 });
  assert.deepEqual(doodle.points, [{ x: 6, y: -1 }, { x: 8, y: 1 }]);
  assert.deepEqual(system.origin, { x: 105, y: 117 });
});

test("multiline text and action button hit areas match their rendered bounds", () => {
  const document = new GeometryDocument();
  const text = document.addText({ x: 20, y: 30 }, "短行\n第二行文字", settings);
  const button = document.addActionButton("link", [], "打开资料", { x: 120, y: 60 }, settings, { url: "https://example.com" });
  assert.equal(document.hitTest({ x: 28, y: 53 }, 1).object.id, text.id);
  assert.equal(document.hitTest({ x: 112, y: 48 }, 1).object.id, button.id);
});

test("embedded images can be selected, moved, copied and serialized", () => {
  const document = new GeometryDocument();
  const image = document.addImage("data:image/png;base64,AA==", { x: 10, y: 20 }, { width: 200, height: 100 });
  assert.equal(document.hitTest({ x: 50, y: 50 }, 2).object.id, image.id);
  document.moveText(image.id, { x: 30, y: 40 });
  const [copy] = document.duplicateObjects([image.id], { x: 5, y: 6 });
  assert.deepEqual({ x: copy.x, y: copy.y }, { x: 35, y: 46 });
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.getObject(image.id).dataUrl, "data:image/png;base64,AA==");
});

test("triangle center primitives reject degeneracy and compute classical centers", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 6, y: 0 };
  const c = { x: 0, y: 8 };
  assert.deepEqual(triangleCentroid(a, b, c), { x: 2, y: 8 / 3 });
  assert.deepEqual(triangleOrthocenter(a, b, c), a);
  assert.deepEqual(triangleIncenter(a, b, c), { x: 2, y: 2 });
  assert.deepEqual(triangleIncircle(a, b, c), { center: { x: 2, y: 2 }, radius: 2 });

  const collinear = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 5, y: 0 }];
  for (const constructor of [triangleCentroid, triangleOrthocenter, triangleIncenter, triangleIncircle]) {
    assert.equal(constructor(...collinear), null);
  }
});

test("triangle centers and incircle remain dynamic and serializable", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 6, y: 0 }, settings);
  const c = document.addFreePoint({ x: 0, y: 8 }, settings);
  const incenter = document.addIncenter(a.id, b.id, c.id, settings);
  const centroid = document.addCentroid(a.id, b.id, c.id, settings);
  const orthocenter = document.addOrthocenter(a.id, b.id, c.id, settings);
  const incircle = document.addIncircle(a.id, b.id, c.id, settings);

  assert.deepEqual(document.getPointPosition(incenter), { x: 2, y: 2 });
  assert.deepEqual(document.getPointPosition(centroid), { x: 2, y: 8 / 3 });
  assert.deepEqual(document.getPointPosition(orthocenter), { x: 0, y: 0 });
  assert.deepEqual(document.getShapeGeometry(incircle), {
    kind: "circle", center: { x: 2, y: 2 }, radius: 2,
  });
  assert.deepEqual(document.dependenciesOf(incircle), [a.id, b.id, c.id]);
  assert.equal(document.getObjectName(incircle), "△ABC 的内切圆");

  document.movePoint(c.id, { x: 0, y: 6 });
  assert.deepEqual(document.getPointPosition(centroid), { x: 2, y: 2 });
  assert.ok(document.getShapeGeometry(incircle).radius < 2);
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.deepEqual(restored.getPointPosition(centroid.id), { x: 2, y: 2 });
  assert.ok(restored.getShapeGeometry(incircle.id).radius > 0);

  const degenerate = new GeometryDocument();
  const points = [0, 2, 5].map((x) => degenerate.addFreePoint({ x, y: 0 }, settings));
  assert.equal(degenerate.addIncenter(...points.map((point) => point.id), settings), null);
  assert.equal(degenerate.addCentroid(...points.map((point) => point.id), settings), null);
  assert.equal(degenerate.addOrthocenter(...points.map((point) => point.id), settings), null);
  assert.equal(degenerate.addIncircle(...points.map((point) => point.id), settings), null);
  assert.equal(degenerate.nextLabel, 3);
});

test("two selected edges with one common endpoint define an angle bisector", () => {
  const document = new GeometryDocument();
  const vertex = document.addFreePoint({ x: 0, y: 0 }, settings);
  const horizontal = document.addFreePoint({ x: 6, y: 0 }, settings);
  const vertical = document.addFreePoint({ x: 0, y: 6 }, settings);
  const first = document.addSegment(horizontal.id, vertex.id, settings);
  const second = document.addSegment(vertical.id, vertex.id, settings);
  const adapted = angleBisectorFromCommonEndpoint([first, second]);
  assert.deepEqual(adapted, {
    vertexId: vertex.id,
    pointAId: horizontal.id,
    pointBId: vertical.id,
    sideAId: first.id,
    sideBId: second.id,
  });
  const bisector = document.addAngleBisectorFromSides(first.id, second.id, settings);
  const geometry = document.getShapeGeometry(bisector);
  assert.equal(geometry.ray, true);
  close(geometry.b.x - geometry.a.x, 1);
  close(geometry.b.y - geometry.a.y, 1);
  const duplicateEdge = document.addSegment(vertex.id, horizontal.id, settings);
  assert.equal(angleBisectorFromCommonEndpoint([first, duplicateEdge]), null);
});

test("angle and perpendicular bisectors can be built from points created during the tool gesture", () => {
  const document = new GeometryDocument();
  const [vertex, horizontal, vertical] = [
    { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 },
  ].map((position) => document.addPointAt(position, settings, 1).point);
  assert.ok([vertex, horizontal, vertical].every((point) => point.definition.kind === "free"));
  assert.ok(document.addAngleBisector(vertex.id, horizontal.id, vertical.id, settings));
  assert.ok(document.addPerpendicularBisector(horizontal.id, vertical.id, settings));
});

test("nearby intersection branches can both be created despite point hit tolerance", () => {
  const document = new GeometryDocument();
  const centerA = document.addFreePoint({ x: 0, y: 0 }, settings);
  const throughA = document.addFreePoint({ x: -100, y: 0 }, settings);
  const centerB = document.addFreePoint({ x: 199.99, y: 0 }, settings);
  const throughB = document.addFreePoint({ x: 299.99, y: 0 }, settings);
  const firstCircle = document.addCircle(centerA.id, throughA.id, settings);
  const secondCircle = document.addCircle(centerB.id, throughB.id, settings);
  const intersections = document.getIntersections(firstCircle.id, secondCircle.id)
    .sort((first, second) => first.y - second.y);
  assert.equal(intersections.length, 2);
  assert.ok(intersections[1].y - intersections[0].y < 3);
  assert.equal(document.findNearbyIntersections({ x: intersections[0].x, y: 0 }, 2).length, 2);

  const lower = document.addPointAt(intersections[0], settings, 1);
  assert.equal(lower.snappedToIntersection, true);
  const upper = document.addPointAt(intersections[1], settings, 1);
  assert.equal(upper.snappedToIntersection, true);
  assert.notEqual(upper.point.id, lower.point.id);
  assert.notEqual(upper.point.definition.branch, lower.point.definition.branch);
  close(document.getPointPosition(lower.point).y, intersections[0].y);
  close(document.getPointPosition(upper.point).y, intersections[1].y);
});
