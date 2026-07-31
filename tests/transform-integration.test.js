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

test("point, line and circle inversions stay dynamically bound to the inversion circle", () => {
  const document = new GeometryDocument();
  const origin = document.addFreePoint({ x: 0, y: 0 }, settings);
  const radiusPoint = document.addFreePoint({ x: 10, y: 0 }, settings);
  const inversionCircle = document.addCircle(origin.id, radiusPoint.id, settings);
  assert.equal(document.markInversionCircle(inversionCircle.id), true);

  const sourcePoint = document.addFreePoint({ x: 20, y: 0 }, settings);
  const invertedPoint = document.addInvertedPoint(sourcePoint.id, inversionCircle.id, settings);
  assert.deepEqual(document.getPointPosition(invertedPoint), { x: 5, y: 0 });
  assert.deepEqual(document.dependenciesOf(invertedPoint), [sourcePoint.id, inversionCircle.id]);

  const lineStart = document.addFreePoint({ x: 20, y: -10 }, settings);
  const lineEnd = document.addFreePoint({ x: 20, y: 10 }, settings);
  const sourceLine = document.addLine(lineStart.id, lineEnd.id, settings);
  const invertedLine = document.addTransformedShape(sourceLine.id, "invert", null, settings);
  let geometry = document.getShapeGeometry(invertedLine);
  assert.equal(geometry.kind, "circle");
  close(geometry.center.x, 2.5);
  close(geometry.center.y, 0);
  close(geometry.radius, 2.5);

  const circleCenter = document.addFreePoint({ x: 20, y: 0 }, settings);
  const circleThrough = document.addFreePoint({ x: 25, y: 0 }, settings);
  const sourceCircle = document.addCircle(circleCenter.id, circleThrough.id, settings);
  const invertedCircle = document.addTransformedShape(sourceCircle.id, "invert", null, settings);
  geometry = document.getShapeGeometry(invertedCircle);
  assert.equal(geometry.kind, "circle");
  close(geometry.center.x, 16 / 3);
  close(geometry.radius, 4 / 3);

  document.movePoint(radiusPoint.id, { x: 20, y: 0 });
  assert.deepEqual(document.getPointPosition(invertedPoint), { x: 20, y: 0 });
  geometry = document.getShapeGeometry(invertedLine);
  close(geometry.center.x, 10);
  close(geometry.radius, 10);

  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.equal(restored.markedInversionCircleId, inversionCircle.id);
  assert.deepEqual(restored.dependenciesOf(restored.getObject(invertedCircle.id)), [
    sourceCircle.id,
    inversionCircle.id,
  ]);
  close(restored.getShapeGeometry(invertedCircle).center.x, 64 / 3);
});

test("inversion rejects unsupported bounded lines and is undefined at the center", () => {
  const document = new GeometryDocument();
  const origin = document.addFreePoint({ x: 0, y: 0 }, settings);
  const radiusPoint = document.addFreePoint({ x: 10, y: 0 }, settings);
  const inversionCircle = document.addCircle(origin.id, radiusPoint.id, settings);
  document.markInversionCircle(inversionCircle.id);

  const singular = document.addInvertedPoint(origin.id, inversionCircle.id, settings);
  assert.equal(document.getPointPosition(singular), null);

  const endpoint = document.addFreePoint({ x: 20, y: 0 }, settings);
  const segment = document.addSegment(origin.id, endpoint.id, settings);
  assert.equal(document.addTransformedShape(segment.id, "invert", null, settings), null);
});

