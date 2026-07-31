import assert from "node:assert/strict";
import test from "node:test";

import {
  invertCircleInCircle,
  invertGeometryInCircle,
  invertLineInCircle,
  invertPointInCircle,
} from "../src/core/geometry.js";

function close(actual, expected, epsilon = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function closePoint(actual, expected, epsilon = 1e-8) {
  assert.ok(actual);
  close(actual.x, expected.x, epsilon);
  close(actual.y, expected.y, epsilon);
}

function inversionCircle(center, radius) {
  return { kind: "circle", center, radius };
}

function pointLineDistance(point, line) {
  const dx = line.b.x - line.a.x;
  const dy = line.b.y - line.a.y;
  return Math.abs(dx * (line.a.y - point.y) - (line.a.x - point.x) * dy) /
    Math.hypot(dx, dy);
}

test("point inversion is involutive and responds to the supplied radius", () => {
  const center = { x: 1, y: -2 };
  const point = { x: 5, y: -2 };
  const circle = inversionCircle(center, 2);
  const image = invertPointInCircle(point, circle);
  closePoint(image, { x: 2, y: -2 });
  closePoint(invertPointInCircle(image, circle), point);

  closePoint(invertPointInCircle(point, inversionCircle(center, 4)), { x: 5, y: -2 });
  closePoint(invertPointInCircle(point, inversionCircle(center, 6)), { x: 10, y: -2 });
});

test("the inversion center and invalid inversion radii have no image", () => {
  const center = { x: 0, y: 0 };
  assert.equal(invertPointInCircle(center, inversionCircle(center, 4)), null);
  assert.equal(invertPointInCircle({ x: 1, y: 0 }, inversionCircle(center, 0)), null);
  assert.equal(invertPointInCircle({ x: 1, y: 0 }, inversionCircle(center, -2)), null);
  assert.equal(invertPointInCircle({ x: Number.NaN, y: 0 }, inversionCircle(center, 2)), null);
});

test("a line through the inversion center remains the same full line", () => {
  const line = {
    kind: "line",
    a: { x: -2, y: -2 },
    b: { x: 3, y: 3 },
    segment: false,
    ray: false,
  };
  const circle = inversionCircle({ x: 0, y: 0 }, 5);
  const image = invertLineInCircle(line, circle);
  assert.equal(image.kind, "line");
  close(pointLineDistance({ x: 0, y: 0 }, image), 0);
  close(pointLineDistance({ x: 7, y: 7 }, image), 0);
  const secondImage = invertGeometryInCircle(image, circle);
  assert.equal(secondImage.kind, "line");
  close(pointLineDistance(line.a, secondImage), 0);
  close(pointLineDistance(line.b, secondImage), 0);
});

test("a line away from the center becomes a circle through the center and inverts back", () => {
  const line = {
    kind: "line",
    a: { x: -3, y: 2 },
    b: { x: 4, y: 2 },
    segment: false,
    ray: false,
  };
  const center = { x: 0, y: 0 };
  const inversion = inversionCircle(center, 2);
  const image = invertLineInCircle(line, inversion);
  assert.equal(image.kind, "circle");
  closePoint(image.center, { x: 0, y: 1 });
  close(image.radius, 1);
  close(Math.hypot(image.center.x - center.x, image.center.y - center.y), image.radius);

  const secondImage = invertCircleInCircle(image, inversion);
  assert.equal(secondImage.kind, "line");
  close(pointLineDistance(line.a, secondImage), 0);
  close(pointLineDistance(line.b, secondImage), 0);
});

test("a circle through the inversion center becomes a line and inverts back", () => {
  const circle = { kind: "circle", center: { x: 2, y: 0 }, radius: 2 };
  const inversionCenter = { x: 0, y: 0 };
  const inversion = inversionCircle(inversionCenter, 2);
  const image = invertCircleInCircle(circle, inversion);
  assert.equal(image.kind, "line");
  close(pointLineDistance({ x: 1, y: -4 }, image), 0);
  close(pointLineDistance({ x: 1, y: 7 }, image), 0);

  const secondImage = invertLineInCircle(image, inversion);
  assert.equal(secondImage.kind, "circle");
  closePoint(secondImage.center, circle.center);
  close(secondImage.radius, circle.radius);
});

test("a circle away from the inversion center remains a circle and is involutive", () => {
  const circle = { kind: "circle", center: { x: 3, y: 0 }, radius: 1 };
  const center = { x: 0, y: 0 };
  const inversion = inversionCircle(center, 2);
  const image = invertGeometryInCircle(circle, inversion);
  assert.equal(image.kind, "circle");
  closePoint(image.center, { x: 1.5, y: 0 });
  close(image.radius, 0.5);

  const secondImage = invertCircleInCircle(image, inversion);
  closePoint(secondImage.center, circle.center);
  close(secondImage.radius, circle.radius);

  const concentric = invertCircleInCircle(
    { kind: "circle", center: { x: 0, y: 0 }, radius: 2 },
    inversionCircle(center, 3),
  );
  closePoint(concentric.center, center);
  close(concentric.radius, 4.5);
});

test("degenerate and unsupported carrier geometries are rejected", () => {
  const center = { x: 0, y: 0 };
  const inversion = inversionCircle(center, 2);
  assert.equal(invertLineInCircle({
    kind: "line", a: { x: 1, y: 1 }, b: { x: 1, y: 1 }, segment: false, ray: false,
  }, inversion), null);
  assert.equal(invertLineInCircle({
    kind: "line", a: { x: 0, y: 1 }, b: { x: 1, y: 1 }, segment: true, ray: false,
  }, inversion), null);
  assert.equal(invertLineInCircle({
    kind: "line", a: { x: 0, y: 1 }, b: { x: 1, y: 1 }, segment: false, ray: true,
  }, inversion), null);
  assert.equal(invertCircleInCircle({
    kind: "circle", center: { x: 1, y: 0 }, radius: 0,
  }, inversion), null);
  assert.equal(invertGeometryInCircle({ kind: "plot", paths: [] }, inversion), null);
});
