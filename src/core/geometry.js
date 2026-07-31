export const EPSILON = 1e-9;

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(vector, factor) {
  return { x: vector.x * factor, y: vector.y * factor };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}

export function length(vector) {
  return Math.hypot(vector.x, vector.y);
}

export function distance(a, b) {
  return length(subtract(a, b));
}

function isNondegenerateTriangle(a, b, c) {
  if (![a, b, c].every((point) =>
    Number.isFinite(point?.x) && Number.isFinite(point?.y))) return false;
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const bc = subtract(c, b);
  const scaleFactor = Math.max(length(ab) * length(ac), length(ab) * length(bc), length(ac) * length(bc));
  return length(ab) > EPSILON && length(ac) > EPSILON && length(bc) > EPSILON &&
    Math.abs(cross(ab, ac)) > EPSILON * scaleFactor;
}

export function triangleIncenter(a, b, c) {
  if (!isNondegenerateTriangle(a, b, c)) return null;
  const sideA = distance(b, c);
  const sideB = distance(c, a);
  const sideC = distance(a, b);
  const perimeter = sideA + sideB + sideC;
  if (perimeter <= EPSILON) return null;
  return {
    x: (sideA * a.x + sideB * b.x + sideC * c.x) / perimeter,
    y: (sideA * a.y + sideB * b.y + sideC * c.y) / perimeter,
  };
}

export function triangleCentroid(a, b, c) {
  if (!isNondegenerateTriangle(a, b, c)) return null;
  return {
    x: (a.x + b.x + c.x) / 3,
    y: (a.y + b.y + c.y) / 3,
  };
}

export function triangleOrthocenter(a, b, c) {
  if (!isNondegenerateTriangle(a, b, c)) return null;
  const sideBC = subtract(c, b);
  const sideAC = subtract(c, a);
  const altitudeA = { x: -sideBC.y, y: sideBC.x };
  const altitudeB = { x: -sideAC.y, y: sideAC.x };
  return lineLineIntersections(
    a,
    add(a, altitudeA),
    b,
    add(b, altitudeB),
  )[0] || null;
}

export function triangleIncircle(a, b, c) {
  const center = triangleIncenter(a, b, c);
  if (!center) return null;
  const side = subtract(b, a);
  const sideLength = length(side);
  if (sideLength <= EPSILON) return null;
  const radius = Math.abs(cross(side, subtract(center, a))) / sideLength;
  return radius > EPSILON ? { center, radius } : null;
}

export function circleTangentToAngleAndCircle(vertex, pointA, pointB, outerCenter, outerRadius) {
  const vectorA = subtract(pointA, vertex);
  const vectorB = subtract(pointB, vertex);
  const lengthA = length(vectorA);
  const lengthB = length(vectorB);
  if (lengthA <= EPSILON || lengthB <= EPSILON || outerRadius <= EPSILON) return null;
  const unitA = scale(vectorA, 1 / lengthA);
  const unitB = scale(vectorB, 1 / lengthB);
  const bisectorRaw = add(unitA, unitB);
  const bisectorLength = length(bisectorRaw);
  if (bisectorLength <= EPSILON) return null;
  const bisector = scale(bisectorRaw, 1 / bisectorLength);
  const radiusPerDistance = Math.abs(cross(bisector, unitA));
  if (radiusPerDistance <= EPSILON) return null;

  const offset = subtract(vertex, outerCenter);
  const coefficientA = 1 - radiusPerDistance * radiusPerDistance;
  const coefficientB = 2 * (dot(offset, bisector) + outerRadius * radiusPerDistance);
  const coefficientC = dot(offset, offset) - outerRadius * outerRadius;
  let roots;
  if (Math.abs(coefficientA) <= EPSILON) {
    roots = Math.abs(coefficientB) <= EPSILON ? [] : [-coefficientC / coefficientB];
  } else {
    const discriminant = coefficientB * coefficientB - 4 * coefficientA * coefficientC;
    if (discriminant < -EPSILON) return null;
    const root = Math.sqrt(Math.max(0, discriminant));
    roots = [
      (-coefficientB - root) / (2 * coefficientA),
      (-coefficientB + root) / (2 * coefficientA),
    ];
  }
  const candidates = roots
    .filter((value) => value > EPSILON && outerRadius - value * radiusPerDistance > EPSILON)
    .sort((first, second) => first - second);
  if (!candidates.length) return null;
  const distanceFromVertex = candidates[0];
  return {
    center: add(vertex, scale(bisector, distanceFromVertex)),
    radius: distanceFromVertex * radiusPerDistance,
  };
}

export function almostEqual(a, b, epsilon = EPSILON) {
  return Math.abs(a - b) <= epsilon;
}

export function projectPointToLine(point, a, b, clampToSegment = false, clampToRay = false) {
  const direction = subtract(b, a);
  const lengthSquared = dot(direction, direction);
  if (lengthSquared <= EPSILON) {
    return { point: { ...a }, t: 0, distance: distance(point, a) };
  }
  let t = dot(subtract(point, a), direction) / lengthSquared;
  if (clampToSegment) t = Math.max(0, Math.min(1, t));
  else if (clampToRay) t = Math.max(0, t);
  const projected = add(a, scale(direction, t));
  return { point: projected, t, distance: distance(point, projected) };
}

export function clipParametricLineToRect(a, b, rect, ray = false) {
  const direction = subtract(b, a);
  if (length(direction) <= EPSILON) return null;
  const bounds = {
    x1: Math.min(rect.x1, rect.x2),
    x2: Math.max(rect.x1, rect.x2),
    y1: Math.min(rect.y1, rect.y2),
    y2: Math.max(rect.y1, rect.y2),
  };
  let minimum = ray ? 0 : Number.NEGATIVE_INFINITY;
  let maximum = Number.POSITIVE_INFINITY;

  for (const axis of ["x", "y"]) {
    const delta = direction[axis];
    const origin = a[axis];
    const lower = bounds[`${axis}1`];
    const upper = bounds[`${axis}2`];
    if (Math.abs(delta) <= EPSILON) {
      if (origin < lower || origin > upper) return null;
      continue;
    }
    let first = (lower - origin) / delta;
    let second = (upper - origin) / delta;
    if (first > second) [first, second] = [second, first];
    minimum = Math.max(minimum, first);
    maximum = Math.min(maximum, second);
    if (minimum > maximum) return null;
  }

  return {
    a: add(a, scale(direction, minimum)),
    b: add(a, scale(direction, maximum)),
  };
}

export function clipLineGeometryToView(geometry, view, padding = null) {
  if (geometry?.kind !== "line" || geometry.segment) return null;
  const values = [
    geometry.a?.x, geometry.a?.y, geometry.b?.x, geometry.b?.y,
    view?.x, view?.y, view?.width, view?.height,
  ].map(Number);
  if (!values.every(Number.isFinite) || view.width <= 0 || view.height <= 0) return null;
  const margin = padding !== null && padding !== undefined && Number.isFinite(Number(padding))
    ? Math.max(0, Number(padding))
    : Math.max(20, view.width / 50);
  return clipParametricLineToRect(
    geometry.a,
    geometry.b,
    {
      x1: view.x - margin,
      y1: view.y - margin,
      x2: view.x + view.width + margin,
      y2: view.y + view.height + margin,
    },
    geometry.ray,
  );
}

export function lineLineIntersections(
  a1, a2, b1, b2,
  segmentA = false, segmentB = false,
  rayA = false, rayB = false,
) {
  const r = subtract(a2, a1);
  const s = subtract(b2, b1);
  const denominator = cross(r, s);
  if (Math.abs(denominator) <= EPSILON) return [];

  const offset = subtract(b1, a1);
  const t = cross(offset, s) / denominator;
  const u = cross(offset, r) / denominator;
  if (segmentA && (t < -EPSILON || t > 1 + EPSILON)) return [];
  if (segmentB && (u < -EPSILON || u > 1 + EPSILON)) return [];
  if (rayA && t < -EPSILON) return [];
  if (rayB && u < -EPSILON) return [];
  return [add(a1, scale(r, t))];
}

export function lineCircleIntersections(a, b, center, radius, segment = false, ray = false) {
  const direction = subtract(b, a);
  const offset = subtract(a, center);
  const coefficientA = dot(direction, direction);
  if (coefficientA <= EPSILON || radius < 0) return [];

  // Use the closest point on the supporting line. The quadratic
  // discriminant loses precision at tangency and made incircle tangency
  // points flicker between zero, one and two results while dragging.
  const closestParameter = -dot(offset, direction) / coefficientA;
  const closestOffset = add(offset, scale(direction, closestParameter));
  const closestDistanceSquared = dot(closestOffset, closestOffset);
  const radiusSquared = radius * radius;
  const gap = closestDistanceSquared - radiusSquared;
  const gapTolerance = EPSILON * 64 * Math.max(
    1,
    radiusSquared,
    closestDistanceSquared,
  );
  if (gap > gapTolerance) return [];
  const values = Math.abs(gap) <= gapTolerance
    ? [closestParameter]
    : (() => {
      const parameterOffset = Math.sqrt(
        Math.max(0, radiusSquared - closestDistanceSquared) / coefficientA,
      );
      return [closestParameter - parameterOffset, closestParameter + parameterOffset];
    })();
  const result = [];
  for (const t of values) {
    if (segment && (t < -EPSILON || t > 1 + EPSILON)) continue;
    if (ray && t < -EPSILON) continue;
    const point = add(a, scale(direction, t));
    if (!result.some((existing) => distance(existing, point) <= EPSILON * 10)) result.push(point);
  }
  return result;
}

export function circleCircleIntersections(centerA, radiusA, centerB, radiusB) {
  const delta = subtract(centerB, centerA);
  const centerDistance = length(delta);
  if (centerDistance <= EPSILON) return [];
  if (centerDistance > radiusA + radiusB + EPSILON) return [];
  if (centerDistance < Math.abs(radiusA - radiusB) - EPSILON) return [];

  const along = (radiusA * radiusA - radiusB * radiusB + centerDistance * centerDistance) /
    (2 * centerDistance);
  let heightSquared = radiusA * radiusA - along * along;
  if (heightSquared < -EPSILON) return [];
  heightSquared = Math.max(0, heightSquared);

  const unit = scale(delta, 1 / centerDistance);
  const base = add(centerA, scale(unit, along));
  const perpendicular = { x: -unit.y, y: unit.x };
  const height = Math.sqrt(heightSquared);
  if (height <= EPSILON) return [base];
  return [add(base, scale(perpendicular, height)), add(base, scale(perpendicular, -height))];
}

export function intersectGeometries(first, second) {
  if (!first || !second) return [];
  if (first.kind === "line" && second.kind === "line") {
    return lineLineIntersections(
      first.a, first.b, second.a, second.b,
      first.segment, second.segment, first.ray, second.ray,
    );
  }
  if (first.kind === "line" && second.kind === "circle") {
    return lineCircleIntersections(first.a, first.b, second.center, second.radius, first.segment, first.ray);
  }
  if (first.kind === "circle" && second.kind === "line") {
    return lineCircleIntersections(second.a, second.b, first.center, first.radius, second.segment, second.ray);
  }
  if (first.kind === "circle" && second.kind === "circle") {
    return circleCircleIntersections(first.center, first.radius, second.center, second.radius);
  }
  return [];
}
