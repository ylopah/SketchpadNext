const EPSILON = 1e-9;

function resolveObject(documentModel, objectOrId) {
  return typeof objectOrId === "string" ? documentModel.getObject(objectOrId) : objectOrId;
}

function objectSuffix(object) {
  return String(object?.id || "").match(/\d+$/)?.[0] || "?";
}

function pointToken(documentModel, pointOrId) {
  const point = resolveObject(documentModel, pointOrId);
  if (point?.type !== "point") return "P_?";
  const label = String(point.label ?? "").trim();
  if (label && label !== "圆心") return label;
  return `P_${objectSuffix(point)}`;
}

function pointSequence(documentModel, ids) {
  return ids.map((id) => pointToken(documentModel, id)).join("");
}

function basicLinePair(documentModel, object) {
  if (!["segment", "line", "ray"].includes(object?.type)) return null;
  if (!object.pointAId || !object.pointBId) return null;
  return pointSequence(documentModel, [object.pointAId, object.pointBId]);
}

function lineToken(documentModel, objectOrId, geometry = null) {
  const object = resolveObject(documentModel, objectOrId);
  const shape = geometry || documentModel.getShapeGeometry(object);
  const pair = basicLinePair(documentModel, object);
  if (object?.type === "segment" || shape?.segment === true) {
    return `\\overline{${pair || `L_${objectSuffix(object)}`}}`;
  }
  if (object?.type === "ray" || shape?.ray === true) {
    return pair ? `r(${pair})` : `r_${objectSuffix(object)}`;
  }
  return pair ? `ℓ(${pair})` : `ℓ_${objectSuffix(object)}`;
}

function circleToken(documentModel, objectOrId) {
  const object = resolveObject(documentModel, objectOrId);
  if (!object) return "⊙_?";
  if (["circle", "radiusCircle"].includes(object.type) && object.centerId) {
    return `⊙${pointToken(documentModel, object.centerId)}`;
  }
  if (object.type === "threePointCircle") {
    return `⊙(${pointSequence(documentModel, [object.pointAId, object.pointBId, object.pointCId])})`;
  }
  if (object.type === "incircle") {
    return `ω(${pointSequence(documentModel, [object.pointAId, object.pointBId, object.pointCId])})`;
  }
  return `⊙_${objectSuffix(object)}`;
}

function arcToken(documentModel, objectOrId) {
  const object = resolveObject(documentModel, objectOrId);
  if (object?.type === "arc") {
    return `⌢${pointSequence(documentModel, [object.startPointId, object.endPointId])}`;
  }
  if (object?.type === "threePointArc") {
    return `⌢${pointSequence(documentModel, [object.pointAId, object.pointBId, object.pointCId])}`;
  }
  return `⌢A_${objectSuffix(object)}`;
}

function otherLinePoint(documentModel, lineOrId, vertexId) {
  const line = resolveObject(documentModel, lineOrId);
  if (!line) return null;
  const candidates = [line.pointAId, line.pointBId, line.pointId, line.vertexId, line.directionPointId]
    .filter((id) => id && id !== vertexId && documentModel.getObject(id)?.type === "point");
  return candidates[0] || null;
}

function angleMarkToken(documentModel, object) {
  const vertexId = object?.vertexId;
  if (!vertexId) return `θ_${objectSuffix(object)}`;
  const firstId = object.pointAId || otherLinePoint(documentModel, object.sideAId, vertexId);
  const secondId = object.pointBId || otherLinePoint(documentModel, object.sideBId, vertexId);
  if (!firstId || !secondId) return `θ_${objectSuffix(object)}`;
  return `∠${pointSequence(documentModel, [firstId, vertexId, secondId])}`;
}

function pointPosition(documentModel, objectOrId) {
  try {
    return documentModel.getPointPosition(objectOrId);
  } catch {
    return null;
  }
}

function shapeGeometry(documentModel, objectOrId) {
  try {
    return documentModel.getShapeGeometry(objectOrId);
  } catch {
    return null;
  }
}

function measurementValue(documentModel, object) {
  try {
    return documentModel.getMeasurementValue(object);
  } catch {
    return null;
  }
}

function fixed(value, decimals) {
  return Number.isFinite(value) ? value.toFixed(decimals) : null;
}

export function formatMeasurementText(documentModel, measurementOrId, decimalPlaces = 2) {
  const object = resolveObject(documentModel, measurementOrId);
  if (object?.type !== "measurement" || !Array.isArray(object.parents)) return null;
  const parents = object.parents.map((id) => documentModel.getObject(id));
  if (parents.some((parent) => !parent)) return null;
  const points = object.parents.map((id) => pointPosition(documentModel, id));
  const shapes = object.parents.map((id) => shapeGeometry(documentModel, id));
  const decimals = Math.max(0, Math.min(10, Math.round(Number(decimalPlaces) || 0)));
  const value = measurementValue(documentModel, object);
  const formatted = fixed(value, decimals);

  if (object.measurementKind === "distance"
    && parents.length === 2
    && parents.every((parent) => parent.type === "point")
    && formatted !== null) {
    return `${pointSequence(documentModel, object.parents)} = ${formatted}`;
  }

  if (object.measurementKind === "pointLineDistance" && object.parents.length === 2 && formatted !== null) {
    const pointIndex = parents.findIndex((parent) => parent.type === "point");
    const lineIndex = shapes.findIndex((shape) => shape?.kind === "line");
    if (pointIndex < 0 || lineIndex < 0 || pointIndex === lineIndex) return null;
    return `d(${pointToken(documentModel, parents[pointIndex])},${lineToken(documentModel, parents[lineIndex], shapes[lineIndex])}) = ${formatted}`;
  }

  if (["polygonArea", "polygonPerimeter"].includes(object.measurementKind)
    && parents.length >= 3
    && parents.every((parent) => parent.type === "point")
    && formatted !== null) {
    const operator = object.measurementKind === "polygonArea" ? "S" : "P";
    return `${operator}(${pointSequence(documentModel, object.parents)}) = ${formatted}`;
  }

  if (object.measurementKind === "collinearity"
    && parents.length === 3
    && parents.every((parent) => parent.type === "point")
    && Number.isFinite(value)) {
    return `ε_{col}(${object.parents.map((id) => pointToken(documentModel, id)).join(",")}) = ${value.toExponential(3)}`;
  }

  if (object.measurementKind === "pointCircleError" && Number.isFinite(value)) {
    const pointIndex = parents.findIndex((parent) => parent.type === "point");
    const circleIndex = shapes.findIndex((shape) => shape?.kind === "circle");
    if (pointIndex < 0 || circleIndex < 0 || pointIndex === circleIndex) return null;
    return `ε(${pointToken(documentModel, parents[pointIndex])},${circleToken(documentModel, parents[circleIndex])}) = ${value.toExponential(3)}`;
  }

  if (object.measurementKind === "length"
    && shapes[0]?.kind === "line"
    && shapes[0].segment === true
    && formatted !== null) {
    return `${lineToken(documentModel, parents[0], shapes[0])} = ${formatted}`;
  }

  if (object.measurementKind === "arcLength" && shapes[0]?.kind === "arc" && formatted !== null) {
    return `${arcToken(documentModel, parents[0])} = ${formatted}`;
  }

  if (object.measurementKind === "ratio"
    && shapes.length === 2
    && shapes.every((shape) => shape?.kind === "line" && shape.segment === true)
    && formatted !== null) {
    return `${lineToken(documentModel, parents[0], shapes[0])}/${lineToken(documentModel, parents[1], shapes[1])} = ${formatted}`;
  }

  if (object.measurementKind === "angle" && formatted !== null) {
    if (shapes.length === 1 && shapes[0]?.kind === "angleMark") {
      return `${angleMarkToken(documentModel, parents[0])} = ${formatted}°`;
    }
    if (shapes.length === 1 && shapes[0]?.kind === "arc") {
      return `m(${arcToken(documentModel, parents[0])}) = ${formatted}°`;
    }
    if (shapes.length === 2 && shapes.every((shape) => shape?.kind === "line")) {
      return `∠(${lineToken(documentModel, parents[0], shapes[0])},${lineToken(documentModel, parents[1], shapes[1])}) = ${formatted}°`;
    }
    if (parents.length === 3 && parents.every((parent) => parent.type === "point")) {
      return `∠${pointSequence(documentModel, object.parents)} = ${formatted}°`;
    }
  }

  if (["radius", "circumference", "circleArea"].includes(object.measurementKind)
    && shapes[0]?.kind === "circle"
    && formatted !== null) {
    const operator = object.measurementKind === "radius" ? "r"
      : object.measurementKind === "circumference" ? "C" : "S";
    return `${operator}(${circleToken(documentModel, parents[0])}) = ${formatted}`;
  }

  if (object.measurementKind === "coordinates" && points[0]) {
    const system = shapes[1]?.kind === "coordinateSystem" ? shapes[1] : null;
    const coordinates = system
      && Number.isFinite(system.unitX) && system.unitX > EPSILON
      && Number.isFinite(system.unitY) && system.unitY > EPSILON
      ? {
        x: (points[0].x - system.origin.x) / system.unitX,
        y: (system.origin.y - points[0].y) / system.unitY,
      }
      : points[0];
    const x = fixed(coordinates.x, decimals);
    const y = fixed(coordinates.y, decimals);
    if (x === null || y === null) return null;
    return `${pointToken(documentModel, parents[0])} = (${x}, ${y})`;
  }

  if (["coordinateX", "coordinateY"].includes(object.measurementKind)
    && parents[0]?.type === "point"
    && formatted !== null) {
    const operator = object.measurementKind === "coordinateX" ? "x" : "y";
    return `${operator}(${pointToken(documentModel, parents[0])}) = ${formatted}`;
  }

  if (object.measurementKind === "slope" && shapes[0]?.kind === "line") {
    const dx = shapes[0].b.x - shapes[0].a.x;
    const slope = Math.abs(dx) <= EPSILON ? "∞" : formatted;
    if (slope === null) return null;
    return `k(${lineToken(documentModel, parents[0], shapes[0])}) = ${slope}`;
  }

  if (object.measurementKind === "pointValue" && parents[0]?.type === "point" && formatted !== null) {
    const parentId = parents[0].definition?.kind === "on-shape" ? parents[0].definition.parentId : null;
    const parentGeometry = parentId ? shapeGeometry(documentModel, parentId) : null;
    const circular = parentGeometry && parentGeometry.kind !== "line";
    return `${circular ? "θ" : "t"}(${pointToken(documentModel, parents[0])}) = ${formatted}${circular ? " rad" : ""}`;
  }

  return null;
}
