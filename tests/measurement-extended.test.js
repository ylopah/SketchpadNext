import test from "node:test";
import assert from "node:assert/strict";

import { GeometryDocument } from "../src/core/document.js";

const settings = {
  pointSize: 6,
  pointColor: "#000000",
  lineWidth: 2,
  lineColor: "#334155",
  showLabels: true,
};

function close(actual, expected, epsilon = 1e-7) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be close to ${expected}`);
}

test("point-to-line distance respects segment, ray, and infinite-line bounds", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 10, y: 0 }, settings);
  const point = document.addFreePoint({ x: -5, y: 4 }, settings);
  const segment = document.addSegment(a.id, b.id, settings);
  const ray = document.addRay(a.id, b.id, settings);
  const line = document.addLine(a.id, b.id, settings);

  const segmentDistance = document.addMeasurement(
    "pointLineDistance", [point.id, segment.id], { x: 0, y: 0 }, settings,
  );
  const rayDistance = document.addMeasurement(
    "pointLineDistance", [ray.id, point.id], { x: 0, y: 20 }, settings,
  );
  const lineDistance = document.addMeasurement(
    "pointLineDistance", [point.id, line.id], { x: 0, y: 40 }, settings,
  );

  close(document.getMeasurementValue(segmentDistance), Math.sqrt(41));
  close(document.getMeasurementValue(rayDistance), Math.sqrt(41));
  close(document.getMeasurementValue(lineDistance), 4);
  assert.equal(
    document.getMeasurementText(segmentDistance),
    "\u70b9 C \u5230\u7ebf\u6bb5 AB \u7684\u8ddd\u79bb = 6.40",
  );

  document.movePoint(point.id, { x: 15, y: 4 });
  close(document.getMeasurementValue(segmentDistance), Math.sqrt(41));
  close(document.getMeasurementValue(rayDistance), 4);
  close(document.getMeasurementValue(lineDistance), 4);
});

test("polygon area and perimeter follow ordered vertices dynamically", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 4, y: 0 }, settings);
  const c = document.addFreePoint({ x: 4, y: 3 }, settings);
  const d = document.addFreePoint({ x: 0, y: 3 }, settings);
  const parents = [a.id, b.id, c.id, d.id];

  const area = document.addMeasurement("polygonArea", parents, { x: 0, y: 0 }, settings);
  const perimeter = document.addMeasurement("polygonPerimeter", parents, { x: 0, y: 20 }, settings);

  close(document.getMeasurementValue(area), 12);
  close(document.getMeasurementValue(perimeter), 14);
  assert.equal(
    document.getMeasurementText(area),
    "\u591a\u8fb9\u5f62 ABCD \u9762\u79ef = 12.00",
  );
  assert.equal(
    document.getMeasurementText(perimeter),
    "\u591a\u8fb9\u5f62 ABCD \u5468\u957f = 14.00",
  );

  document.movePoint(c.id, { x: 4, y: 4 });
  close(document.getMeasurementValue(area), 14);
  close(document.getMeasurementValue(perimeter), 11 + Math.sqrt(17));
  document.renamePoint(d.id, "P");
  assert.equal(
    document.getMeasurementText(area),
    "\u591a\u8fb9\u5f62 ABCP \u9762\u79ef = 14.00",
  );
});

test("extended measurements handle degenerate inputs consistently", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 2, y: 0 }, settings);
  const c = document.addFreePoint({ x: 5, y: 0 }, settings);

  assert.equal(
    document.addMeasurement("polygonArea", [a.id, b.id], { x: 0, y: 0 }, settings),
    null,
  );
  assert.equal(
    document.addMeasurement("pointLineDistance", [a.id, b.id], { x: 0, y: 0 }, settings),
    null,
  );

  const area = document.addMeasurement("polygonArea", [a.id, b.id, c.id], { x: 0, y: 0 }, settings);
  const perimeter = document.addMeasurement("polygonPerimeter", [a.id, b.id, c.id], { x: 0, y: 20 }, settings);
  close(document.getMeasurementValue(area), 0);
  close(document.getMeasurementValue(perimeter), 10);

  const segment = document.addSegment(a.id, b.id, settings);
  const distance = document.addMeasurement(
    "pointLineDistance", [c.id, segment.id], { x: 0, y: 40 }, settings,
  );
  close(document.getMeasurementValue(distance), 3);
  document.movePoint(b.id, { x: 0, y: 0 });
  assert.equal(document.getMeasurementValue(distance), null);
  assert.equal(document.getMeasurementText(distance), null);
});

test("extended measurement kinds and dependencies survive serialization", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings);
  const b = document.addFreePoint({ x: 6, y: 0 }, settings);
  const c = document.addFreePoint({ x: 6, y: 8 }, settings);
  const line = document.addLine(a.id, b.id, settings);
  const pointLineDistance = document.addMeasurement(
    "pointLineDistance", [c.id, line.id], { x: 10, y: 10 }, settings,
  );
  const polygonArea = document.addMeasurement(
    "polygonArea", [a.id, b.id, c.id], { x: 10, y: 30 }, settings,
  );
  const polygonPerimeter = document.addMeasurement(
    "polygonPerimeter", [a.id, b.id, c.id], { x: 10, y: 50 }, settings,
  );

  const restored = GeometryDocument.fromJSON(document.serialize());
  close(restored.getMeasurementValue(pointLineDistance.id), 8);
  close(restored.getMeasurementValue(polygonArea.id), 24);
  close(restored.getMeasurementValue(polygonPerimeter.id), 24);
  assert.deepEqual(restored.dependenciesOf(restored.getObject(pointLineDistance.id)), [c.id, line.id]);
  assert.deepEqual(restored.dependenciesOf(restored.getObject(polygonArea.id)), [a.id, b.id, c.id]);
  assert.equal(restored.getObject(polygonPerimeter.id).measurementKind, "polygonPerimeter");

  restored.movePoint(c.id, { x: 3, y: 4 });
  close(restored.getMeasurementValue(pointLineDistance.id), 4);
  close(restored.getMeasurementValue(polygonArea.id), 12);
  close(restored.getMeasurementValue(polygonPerimeter.id), 6 + 5 + 5);
});
