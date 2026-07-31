import {
  circleTangentToAngleAndCircle,
  EPSILON,
  distance,
  intersectGeometries,
  invertGeometryInCircle,
  invertPointInCircle,
  projectPointToLine,
  triangleCentroid,
  triangleIncircle,
  triangleIncenter,
  triangleOrthocenter,
} from "./geometry.js";
import { evaluateExpression, expressionIdentifiers, validateIdentifier } from "./expression.js";
import { formatMeasurementText } from "./measurement-notation.js";
import { plainMathText } from "./text-format.js";

const POINT_TYPES = new Set(["point"]);
const TEXT_TYPES = new Set(["text", "measurement", "parameter", "calculation", "table", "actionButton"]);
const MEDIA_TYPES = new Set(["image"]);
const SHAPE_TYPES = new Set([
  "segment", "line", "ray", "circle", "radiusCircle", "threePointCircle", "incircle", "arc", "threePointArc",
  "parallelLine", "perpendicularLine", "perpendicularBisector", "angleBisector", "angleMark", "pathMark", "doodle",
  "circleInterior", "sectorInterior", "segmentInterior",
  "coordinateSystem", "functionGraph", "parametricPlot",
  "locus",
  "transformedShape",
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultPointStyle(settings) {
  return {
    radius: Number(settings.pointSize) || 6,
    color: settings.pointColor || "#000000",
    showLabel: settings.autoNamePoints === false ? false : settings.showLabels !== false,
  };
}

function automaticCircumcenterPoint(id, parents, settings = {}) {
  return {
    id,
    type: "point",
    definition: { kind: "circumcenter", parents: [...parents] },
    label: "圆心",
    labelOffset: { x: 12, y: -12 },
    style: { ...defaultPointStyle(settings), showLabel: false },
  };
}

function automaticIncircleCenterPoint(id, parents, settings = {}) {
  return {
    id,
    type: "point",
    definition: { kind: "incenter", parents: [...parents] },
    label: "圆心",
    labelOffset: { x: 12, y: -12 },
    style: { ...defaultPointStyle(settings), showLabel: false },
  };
}

function defaultShapeStyle(settings) {
  return {
    width: Number(settings.lineWidth) || 2,
    color: settings.lineColor || "#334155",
    dash: settings.lineDash === "dashed" ? "dashed" : "solid",
  };
}

function labelForIndex(index) {
  const alphabetIndex = index % 26;
  const suffix = index >= 26 ? String(Math.floor(index / 26)) : "";
  return String.fromCharCode(65 + alphabetIndex) + suffix;
}

function normalizeAngle(angle) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function circumcircleFromPoints(a, b, c) {
  const denominator = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(denominator) <= EPSILON) return null;
  const aSquared = a.x * a.x + a.y * a.y;
  const bSquared = b.x * b.x + b.y * b.y;
  const cSquared = c.x * c.x + c.y * c.y;
  const center = {
    x: (aSquared * (b.y - c.y) + bSquared * (c.y - a.y) + cSquared * (a.y - b.y)) / denominator,
    y: (aSquared * (c.x - b.x) + bSquared * (a.x - c.x) + cSquared * (b.x - a.x)) / denominator,
  };
  const radius = distance(center, a);
  return radius <= EPSILON ? null : { center, radius };
}

function pointOnArcGeometry(point, geometry, angularTolerance = 0.02) {
  if (!geometry || !["arc", "arcInterior"].includes(geometry.kind)) return false;
  const angle = Math.atan2(point.y - geometry.center.y, point.x - geometry.center.x);
  const direction = geometry.signedAngle >= 0 ? 1 : -1;
  const progress = normalizeAngle((angle - geometry.startAngle) * direction);
  return progress <= Math.abs(geometry.signedAngle) + angularTolerance;
}

function clampAngleToArc(angle, geometry) {
  if (geometry?.kind !== "arc") return angle;
  const direction = geometry.signedAngle >= 0 ? 1 : -1;
  const span = Math.abs(geometry.signedAngle);
  const progress = normalizeAngle((angle - geometry.startAngle) * direction);
  if (progress <= span) return angle;
  const distanceToStart = Math.min(progress, Math.PI * 2 - progress);
  const distanceToEndRaw = normalizeAngle((angle - (geometry.startAngle + geometry.signedAngle)) * direction);
  const distanceToEnd = Math.min(distanceToEndRaw, Math.PI * 2 - distanceToEndRaw);
  return distanceToStart <= distanceToEnd ? geometry.startAngle : geometry.startAngle + geometry.signedAngle;
}

export class GeometryDocument {
  constructor(data = null) {
    this.version = 1;
    this.title = "未命名画板";
    this.objects = [];
    this.paintOrder = [];
    this.nextId = 1;
    this.nextLabel = 0;
    this.markedCenterId = null;
    this.markedMirrorId = null;
    this.markedInversionCircleId = null;
    if (data) this.load(data);
  }

  load(data) {
    if (!data || !Array.isArray(data.objects)) throw new Error("无效的画板文件");
    this.version = Number(data.version) || 1;
    this.title = typeof data.title === "string" ? data.title : "未命名画板";
    this.objects = clone(data.objects);
    this.paintOrder = Array.isArray(data.paintOrder) ? [...data.paintOrder] : [];
    this.nextId = Number(data.nextId) || this.#inferNextId();
    this.nextLabel = Number.isFinite(data.nextLabel) ? Number(data.nextLabel) : this.#inferNextLabel();
    this.markedCenterId = typeof data.markedCenterId === "string" ? data.markedCenterId : null;
    this.markedMirrorId = typeof data.markedMirrorId === "string" ? data.markedMirrorId : null;
    this.markedInversionCircleId = typeof data.markedInversionCircleId === "string"
      ? data.markedInversionCircleId : null;
    this.#upgradeLegacyObjects();
    this.#normalizePaintOrder();
    this.#validate();
  }

  #upgradeLegacyObjects() {
    const additions = [];
    for (const object of this.objects) {
      if (object.centerPointId) continue;
      const parents = [object.pointAId, object.pointBId, object.pointCId];
      const center = object.type === "threePointCircle"
        ? automaticCircumcenterPoint(this.#id(), parents)
        : object.type === "incircle"
          ? automaticIncircleCenterPoint(this.#id(), parents)
          : null;
      if (!center) continue;
      object.centerPointId = center.id;
      additions.push(center);
    }
    this.objects.push(...additions);
    for (const object of this.objects) {
      if (object.type === "calculation") {
        const hasBindings = Object.hasOwn(object, "variables");
        const candidates = hasBindings ? object.variables : {};
        object.variables = this.#bindExpressionVariables(
          [object.expression], candidates, [], object.id, hasBindings,
        );
      } else if (object.type === "point" && object.definition?.kind === "plotted") {
        const definition = object.definition;
        const hasBindings = Object.hasOwn(definition, "variables");
        const candidates = hasBindings
          ? definition.variables
          : this.#expressionBindingCandidates({ ownerId: object.id });
        definition.variables = this.#bindExpressionVariables(
          [definition.xExpression, definition.yExpression], candidates, [], object.id, hasBindings,
        );
      } else if (object.type === "functionGraph") {
        const localVariable = object.mode === "x" ? "y" : object.mode === "polar" ? "theta" : "x";
        const hasBindings = Object.hasOwn(object, "variables");
        const candidates = hasBindings
          ? object.variables
          : this.#expressionBindingCandidates({ ownerId: object.id });
        object.variables = this.#bindExpressionVariables(
          [object.expression], candidates, [localVariable], object.id, hasBindings,
        );
      } else if (object.type === "parametricPlot") {
        const hasBindings = Object.hasOwn(object, "variables");
        const candidates = hasBindings
          ? object.variables
          : this.#expressionBindingCandidates({ ownerId: object.id });
        object.variables = this.#bindExpressionVariables(
          [object.xExpression, object.yExpression], candidates, ["t"], object.id, hasBindings,
        );
      }
    }
  }

  #inferNextId() {
    const highest = this.objects.reduce((max, object) => {
      const match = String(object.id || "").match(/(\d+)$/);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return highest + 1;
  }

  #inferNextLabel() {
    const ownedCenterIds = new Set(this.objects
      .filter((object) => ["threePointCircle", "incircle"].includes(object.type) && object.centerPointId)
      .map((object) => object.centerPointId));
    return this.objects.filter((object) =>
      object.type === "point" && !ownedCenterIds.has(object.id)
    ).length;
  }

  #newPointLabel(settings) {
    if (settings?.autoNamePoints === false) return "";
    const label = this.nextAvailablePointLabel();
    this.nextLabel += 1;
    return label;
  }

  #validate() {
    const ids = new Set();
    const objectById = new Map();
    for (const object of this.objects) {
      if (!object.id || ids.has(object.id)) throw new Error("画板中存在重复或缺失的对象编号");
      if (!POINT_TYPES.has(object.type) && !TEXT_TYPES.has(object.type) && !MEDIA_TYPES.has(object.type) && !SHAPE_TYPES.has(object.type)) {
        throw new Error(`不支持的对象类型：${object.type}`);
      }
      ids.add(object.id);
      objectById.set(object.id, object);
    }
    for (const object of this.objects) {
      for (const dependency of this.dependenciesOf(object)) {
        if (!ids.has(dependency)) throw new Error(`对象 ${object.id} 引用了不存在的对象`);
      }
      const bindings = object.type === "calculation" || object.type === "functionGraph" || object.type === "parametricPlot"
        ? object.variables
        : object.type === "point" && object.definition?.kind === "plotted" ? object.definition.variables : null;
      for (const dependency of Object.values(bindings || {})) {
        if (!["parameter", "calculation", "measurement"].includes(objectById.get(dependency)?.type)) {
          throw new Error(`对象 ${object.id} 的表达式引用了无效数值对象`);
        }
      }
    }
    const visitState = new Map();
    for (const object of this.objects) {
      if (visitState.get(object.id) === 2) continue;
      const stack = [{ id: object.id, expanded: false }];
      while (stack.length) {
        const current = stack.pop();
        if (current.expanded) {
          visitState.set(current.id, 2);
          continue;
        }
        const state = visitState.get(current.id) || 0;
        if (state === 2) continue;
        if (state === 1) throw new Error("画板中存在循环依赖");
        visitState.set(current.id, 1);
        stack.push({ id: current.id, expanded: true });
        const dependencies = this.dependenciesOf(objectById.get(current.id));
        for (let index = dependencies.length - 1; index >= 0; index -= 1) {
          const dependency = dependencies[index];
          if (visitState.get(dependency) === 1) throw new Error("画板中存在循环依赖");
          if (visitState.get(dependency) !== 2) stack.push({ id: dependency, expanded: false });
        }
      }
    }
  }

  #id() {
    return `obj-${this.nextId++}`;
  }

  getObject(id) {
    return this.objects.find((object) => object.id === id) || null;
  }

  isPoint(id) {
    return this.getObject(id)?.type === "point";
  }

  isShape(id) {
    return SHAPE_TYPES.has(this.getObject(id)?.type);
  }

  #legacyPaintGroup(object) {
    if (object?.type === "image") return 0;
    if (object?.type === "coordinateSystem") return 1;
    if (SHAPE_TYPES.has(object?.type)) return 2;
    if (object?.type === "point") return 3;
    if (TEXT_TYPES.has(object?.type)) return 4;
    return 2;
  }

  #normalizePaintOrder() {
    const objectById = new Map(this.objects.map((object) => [object.id, object]));
    const seen = new Set();
    const order = [];
    for (const id of this.paintOrder || []) {
      if (!objectById.has(id) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
    const missing = this.objects.filter((object) => !seen.has(object.id));
    if (!order.length) {
      const buckets = Array.from({ length: 5 }, () => []);
      for (const object of missing) buckets[this.#legacyPaintGroup(object)].push(object.id);
      this.paintOrder = buckets.flat();
      return;
    }
    const insertBefore = new Map();
    const append = [];
    const firstHigherGroup = Array(5).fill(null);
    for (const id of order) {
      const existingGroup = this.#legacyPaintGroup(objectById.get(id));
      for (let group = 0; group < existingGroup; group += 1) {
        if (!firstHigherGroup[group]) firstHigherGroup[group] = id;
      }
    }
    for (const object of missing) {
      const group = this.#legacyPaintGroup(object);
      const targetId = firstHigherGroup[group];
      if (!targetId) append.push(object.id);
      else {
        const bucket = insertBefore.get(targetId) || [];
        bucket.push(object.id);
        insertBefore.set(targetId, bucket);
      }
    }
    const normalized = [];
    for (const id of order) normalized.push(...(insertBefore.get(id) || []), id);
    normalized.push(...append);
    this.paintOrder = normalized;
  }

  objectsInPaintOrder() {
    this.#normalizePaintOrder();
    const objectById = new Map(this.objects.map((object) => [object.id, object]));
    return this.paintOrder.map((id) => objectById.get(id)).filter(Boolean);
  }

  addFreePoint(position, settings, label = null) {
    const point = {
      id: this.#id(),
      type: "point",
      definition: { kind: "free", x: position.x, y: position.y },
      label: label || this.#newPointLabel(settings),
      labelOffset: { x: 12, y: -12 },
      style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return point;
  }

  addText(position, content, settings = {}) {
    const normalized = String(content ?? "").trim();
    if (!normalized) return null;
    const object = {
      id: this.#id(),
      type: "text",
      x: Number(position.x),
      y: Number(position.y),
      content: normalized,
      style: {
        color: settings.lineColor || "#334155",
        fontSize: Number(settings.textFontSize ?? settings.textSize) || 18,
      },
    };
    this.objects.push(object);
    return object;
  }

  addImage(dataUrl, position, size, options = {}) {
    const source = String(dataUrl || "");
    const width = Number(size?.width); const height = Number(size?.height);
    if (!source.startsWith("data:image/") || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    const maximum = Math.max(width, height);
    const scale = maximum > 600 ? 600 / maximum : 1;
    const object = {
      id: this.#id(), type: "image", dataUrl: source,
      x: Number(position.x), y: Number(position.y), width: width * scale, height: height * scale,
      opacity: Number.isFinite(Number(options.opacity)) ? Math.max(0.05, Math.min(1, Number(options.opacity))) : 1,
    };
    this.objects.push(object);
    return object;
  }

  addMeasurement(measurementKind, parentIds, position, settings = {}) {
    const parents = Array.isArray(parentIds) ? parentIds : [];
    if (!parents.length || parents.some((id) => !this.getObject(id))) return null;
    const object = {
      id: this.#id(),
      type: "measurement",
      measurementKind,
      parents: [...parents],
      x: Number(position.x),
      y: Number(position.y),
      style: {
        color: settings.lineColor || "#334155",
        fontSize: Number(settings.textFontSize ?? settings.textSize) || 16,
      },
    };
    if (!this.getMeasurementText(object)) return null;
    this.objects.push(object);
    return object;
  }

  addParameter(name, value, unit, position, settings = {}) {
    const identifier = validateIdentifier(name);
    const numericValue = Number(value);
    if (!identifier || !Number.isFinite(numericValue)) return null;
    const object = {
      id: this.#id(), type: "parameter", name: identifier, value: numericValue,
      unit: ["distance", "angle"].includes(unit) ? unit : "none",
      x: Number(position.x), y: Number(position.y),
      style: { color: settings.lineColor || "#334155", fontSize: Number(settings.textFontSize ?? settings.textSize) || 16 },
    };
    this.objects.push(object);
    return object;
  }

  setParameterValue(parameterId, value) {
    const object = this.getObject(parameterId);
    const numericValue = Number(value);
    if (object?.type !== "parameter" || !Number.isFinite(numericValue)) return false;
    object.value = numericValue;
    return true;
  }

  addCalculation(name, expression, variables, position, settings = {}) {
    const identifier = validateIdentifier(name);
    const source = String(expression ?? "").trim();
    if (!identifier || !source) return null;
    const candidates = {
      ...this.#expressionBindingCandidates({ includeMeasurements: true }),
      ...(variables || {}),
    };
    const normalizedVariables = this.#bindExpressionVariables([source], candidates);
    const object = {
      id: this.#id(), type: "calculation", name: identifier, expression: source,
      variables: normalizedVariables, x: Number(position.x), y: Number(position.y),
      style: { color: settings.lineColor || "#334155", fontSize: Number(settings.textFontSize ?? settings.textSize) || 16 },
    };
    if (this.getNumericValue(object) === null) return null;
    this.objects.push(object);
    return object;
  }

  updateCalculation(calculationId, name, expression, variables = null) {
    const object = this.getObject(calculationId);
    const identifier = validateIdentifier(name);
    const source = String(expression ?? "").trim();
    if (object?.type !== "calculation" || !identifier || !source) return false;
    if (variables !== null && (!variables || typeof variables !== "object" || Array.isArray(variables))) {
      return false;
    }

    const candidates = {
      ...this.#expressionBindingCandidates({
        includeMeasurements: true,
        ownerId: object.id,
      }),
      ...(variables || {}),
    };
    const normalizedVariables = this.#bindExpressionVariables(
      [source], candidates, [], object.id,
    );
    const candidate = {
      ...object,
      name: identifier,
      expression: source,
      variables: normalizedVariables,
    };
    if (this.getNumericValue(candidate) === null) return false;
    Object.assign(object, { name: identifier, expression: source, variables: normalizedVariables });
    return true;
  }

  getMeasurementValue(measurementOrId) {
    const object = typeof measurementOrId === "string" ? this.getObject(measurementOrId) : measurementOrId;
    if (object?.type !== "measurement") return null;
    const points = object.parents.map((id) => this.getPointPosition(id));
    const shapes = object.parents.map((id) => this.getShapeGeometry(id));
    if (object.measurementKind === "distance" && points.length === 2 && points.every(Boolean)) return distance(points[0], points[1]);
    if (object.measurementKind === "pointLineDistance" && object.parents.length === 2) {
      const pointIndex = points.findIndex(Boolean);
      const lineIndex = shapes.findIndex((shape) => shape?.kind === "line");
      if (pointIndex < 0 || lineIndex < 0 || pointIndex === lineIndex) return null;
      return projectPointToLine(
        points[pointIndex],
        shapes[lineIndex].a,
        shapes[lineIndex].b,
        shapes[lineIndex].segment === true,
        shapes[lineIndex].ray === true,
      ).distance;
    }
    if (["polygonArea", "polygonPerimeter"].includes(object.measurementKind)
      && points.length >= 3
      && points.every(Boolean)) {
      if (object.measurementKind === "polygonArea") {
        const twiceSignedArea = points.reduce((sum, point, index) => {
          const next = points[(index + 1) % points.length];
          return sum + point.x * next.y - next.x * point.y;
        }, 0);
        return Math.abs(twiceSignedArea) / 2;
      }
      return points.reduce((sum, point, index) =>
        sum + distance(point, points[(index + 1) % points.length]), 0);
    }
    if (object.measurementKind === "collinearity" && points.length === 3 && points.every(Boolean)) {
      const baseLength = distance(points[0], points[1]);
      if (baseLength <= EPSILON) return null;
      const twiceArea = Math.abs(
        (points[1].x - points[0].x) * (points[2].y - points[0].y) -
        (points[1].y - points[0].y) * (points[2].x - points[0].x),
      );
      return twiceArea / baseLength;
    }
    if (object.measurementKind === "pointCircleError"
      && points[0]
      && shapes[1]?.kind === "circle") {
      return Math.abs(distance(points[0], shapes[1].center) - shapes[1].radius);
    }
    if (object.measurementKind === "length" && shapes[0]?.kind === "line" && shapes[0].segment) return distance(shapes[0].a, shapes[0].b);
    if (object.measurementKind === "arcLength" && shapes[0]?.kind === "arc") return shapes[0].radius * Math.abs(shapes[0].signedAngle);
    if (object.measurementKind === "ratio" && shapes.length === 2 && shapes.every((shape) => shape?.kind === "line" && shape.segment)) {
      const denominator = distance(shapes[1].a, shapes[1].b);
      return denominator <= EPSILON ? null : distance(shapes[0].a, shapes[0].b) / denominator;
    }
    if (object.measurementKind === "angle" && shapes.length === 1 && shapes[0]?.kind === "angleMark") {
      return shapes[0].signedAngle * 180 / Math.PI;
    }
    if (object.measurementKind === "angle" && shapes.length === 1 && shapes[0]?.kind === "arc") {
      return Math.abs(shapes[0].signedAngle) * 180 / Math.PI;
    }
    if (object.measurementKind === "angle" && shapes.length === 2 && shapes.every((shape) => shape?.kind === "line")) {
      const first = { x: shapes[0].b.x - shapes[0].a.x, y: shapes[0].b.y - shapes[0].a.y };
      const second = { x: shapes[1].b.x - shapes[1].a.x, y: shapes[1].b.y - shapes[1].a.y };
      const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
      if (denominator <= EPSILON) return null;
      const cosine = Math.max(-1, Math.min(1, Math.abs((first.x * second.x + first.y * second.y) / denominator)));
      return Math.acos(cosine) * 180 / Math.PI;
    }
    if (object.measurementKind === "angle" && points.length === 3 && points.every(Boolean)) {
      const first = { x: points[0].x - points[1].x, y: points[0].y - points[1].y };
      const second = { x: points[2].x - points[1].x, y: points[2].y - points[1].y };
      const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
      if (denominator <= EPSILON) return null;
      const cosine = Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / denominator));
      return Math.acos(cosine) * 180 / Math.PI;
    }
    if (["radius", "circumference", "circleArea"].includes(object.measurementKind) && shapes[0]?.kind === "circle") {
      if (object.measurementKind === "radius") return shapes[0].radius;
      if (object.measurementKind === "circumference") return Math.PI * 2 * shapes[0].radius;
      return Math.PI * shapes[0].radius * shapes[0].radius;
    }
    if (["coordinateX", "coordinateY"].includes(object.measurementKind) && points[0]) {
      const system = object.parents[1] ? this.getCoordinateSystem(object.parents[1]) : null;
      if (object.measurementKind === "coordinateX") {
        return system ? (points[0].x - system.origin.x) / system.unitX : points[0].x;
      }
      return system ? (system.origin.y - points[0].y) / system.unitY : points[0].y;
    }
    if (object.measurementKind === "slope" && shapes[0]?.kind === "line") {
      const dx = shapes[0].b.x - shapes[0].a.x;
      return Math.abs(dx) <= EPSILON ? null : (shapes[0].b.y - shapes[0].a.y) / dx;
    }
    if (object.measurementKind === "pointValue") {
      const point = this.getObject(object.parents[0]);
      return point?.type === "point" && point.definition.kind === "on-shape" ? Number(point.definition.parameter) : null;
    }
    return null;
  }

  getNumericValue(objectOrId, stack = new Set()) {
    const object = typeof objectOrId === "string" ? this.getObject(objectOrId) : objectOrId;
    if (!object || stack.has(object.id)) return null;
    if (object.type === "parameter") return Number.isFinite(Number(object.value)) ? Number(object.value) : null;
    if (object.type === "measurement") return this.getMeasurementValue(object);
    if (object.type !== "calculation") return null;
    const nextStack = new Set(stack).add(object.id);
    const context = {};
    for (const [name, id] of Object.entries(object.variables || {})) {
      const value = this.getNumericValue(id, nextStack);
      if (value === null) return null;
      context[name] = value;
    }
    try { return evaluateExpression(object.expression, context); }
    catch { return null; }
  }

  getValueText(objectOrId, decimalPlaces = 6) {
    const object = typeof objectOrId === "string" ? this.getObject(objectOrId) : objectOrId;
    if (!object || !["parameter", "calculation"].includes(object.type)) return null;
    const value = this.getNumericValue(object);
    if (value === null) return `${object.name} = 无效`;
    const requestedDecimals = Number(decimalPlaces);
    const decimals = Number.isFinite(requestedDecimals) ? Math.max(0, Math.min(10, Math.round(requestedDecimals))) : 6;
    const suffix = object.type === "parameter" && object.unit === "angle" ? "°"
      : object.type === "parameter" && object.unit === "distance" ? " px" : "";
    return `${object.name} = ${Number(value.toFixed(decimals))}${suffix}`;
  }

  addCoordinateSystem(origin, settings = {}, options = {}) {
    const originPointId = typeof origin === "string" && this.isPoint(origin) ? origin : null;
    const point = originPointId ? this.getPointPosition(originPointId) : origin;
    if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) return null;
    const unitX = Math.max(10, Math.abs(Number(options.unitX) || 50));
    const unitY = Math.max(10, Math.abs(Number(options.unitY) || unitX));
    const object = {
      id: this.#id(), type: "coordinateSystem", originPointId,
      origin: { x: Number(point.x), y: Number(point.y) }, unitX, unitY,
      gridType: ["square", "rectangular", "polar"].includes(options.gridType) ? options.gridType : "square",
      showGrid: options.showGrid === true,
      showTicks: options.showTicks !== false,
      showLabels: options.showLabels !== false,
      style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  getCoordinateSystem(systemOrId) {
    const object = typeof systemOrId === "string" ? this.getObject(systemOrId) : systemOrId;
    if (object?.type !== "coordinateSystem") return null;
    const origin = object.originPointId ? this.getPointPosition(object.originPointId) : object.origin;
    if (!origin) return null;
    return {
      origin,
      unitX: object.unitX,
      unitY: object.unitY,
      gridType: object.gridType,
      showGrid: object.showGrid === true,
      showTicks: object.showTicks !== false,
      showLabels: object.showLabels !== false,
    };
  }

  updateCoordinateSystem(systemId, patch = {}) {
    const object = this.getObject(systemId);
    if (object?.type !== "coordinateSystem" || !patch || typeof patch !== "object") return false;

    const next = {};
    for (const key of ["unitX", "unitY"]) {
      if (!(key in patch)) continue;
      const value = Number(patch[key]);
      if (!Number.isFinite(value) || value < 10 || value > 500) return false;
      next[key] = value;
    }
    if ("gridType" in patch) {
      if (!["square", "rectangular", "polar"].includes(patch.gridType)) return false;
      next.gridType = patch.gridType;
    }
    for (const key of ["showGrid", "showTicks", "showLabels"]) {
      if (!(key in patch)) continue;
      if (typeof patch[key] !== "boolean") return false;
      next[key] = patch[key];
    }

    let nextOrigin = null;
    if (!object.originPointId && ("x" in patch || "y" in patch)) {
      const x = "x" in patch ? Number(patch.x) : Number(object.origin?.x);
      const y = "y" in patch ? Number(patch.y) : Number(object.origin?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
      nextOrigin = { x, y };
    }

    Object.assign(object, next);
    if (nextOrigin) object.origin = nextOrigin;
    return true;
  }

  #expressionBindingCandidates({ includeMeasurements = false, ownerId = null } = {}) {
    const lastCandidates = {};
    const lastValidCandidates = {};
    for (const object of this.objects) {
      if (object.id === ownerId) continue;
      let name = null;
      if (["parameter", "calculation"].includes(object.type) && validateIdentifier(object.name)) {
        name = object.name;
      } else if (includeMeasurements && object.type === "measurement") {
        name = object.id.replace("obj-", "m");
      }
      if (!name) continue;
      lastCandidates[name] = object.id;
      try {
        if (this.getNumericValue(object) !== null) lastValidCandidates[name] = object.id;
      } catch {}
    }
    return { ...lastCandidates, ...lastValidCandidates };
  }

  #bindExpressionVariables(expressions, candidates, reserved = [], ownerId = null, preserveInvalid = false) {
    let referenced;
    try {
      referenced = new Set(expressions.flatMap((source) => expressionIdentifiers(source)));
    } catch { return {}; }
    const reservedNames = new Set(reserved);
    const variables = {};
    for (const name of referenced) {
      if (reservedNames.has(name)) continue;
      const id = candidates?.[name];
      const object = id ? this.getObject(id) : null;
      if (preserveInvalid && typeof id === "string") variables[name] = id;
      else if (id !== ownerId && object && ["parameter", "calculation", "measurement"].includes(object.type)) variables[name] = id;
    }
    return variables;
  }

  expressionVariables(extra = {}, bindings = null, stack = new Set()) {
    const variables = {};
    const entries = bindings && typeof bindings === "object"
      ? Object.entries(bindings)
      : Object.entries(this.#expressionBindingCandidates());
    for (const [name, id] of entries) {
      const value = this.getNumericValue(id, stack);
      if (value !== null) variables[name] = value;
    }
    return { ...variables, ...extra };
  }

  addPlottedPoint(coordinateSystemId, xExpression, yExpression, settings, options = {}) {
    if (!this.getCoordinateSystem(coordinateSystemId)) return null;
    const definition = {
      kind: "plotted", coordinateSystemId,
      xExpression: String(xExpression ?? "").trim(), yExpression: String(yExpression ?? "").trim(),
    };
    const candidates = {
      ...this.#expressionBindingCandidates(),
      ...(options.variables || {}),
    };
    definition.variables = this.#bindExpressionVariables(
      [definition.xExpression, definition.yExpression], candidates,
    );
    try {
      const variables = this.expressionVariables({}, definition.variables);
      evaluateExpression(definition.xExpression, variables);
      evaluateExpression(definition.yExpression, variables);
    } catch { return null; }
    const point = {
      id: this.#id(), type: "point", definition, label: this.#newPointLabel(settings),
      labelOffset: { x: 12, y: -12 }, style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return point;
  }

  addFunctionGraph(coordinateSystemId, expression, settings, options = {}) {
    if (!this.getCoordinateSystem(coordinateSystemId)) return null;
    const source = String(expression ?? "").trim();
    const mode = ["y", "x", "polar"].includes(options.mode) ? options.mode : "y";
    const variableName = mode === "x" ? "y" : mode === "polar" ? "theta" : "x";
    const candidates = {
      ...this.#expressionBindingCandidates(),
      ...(options.variables || {}),
    };
    const variables = this.#bindExpressionVariables([source], candidates, [variableName]);
    try { evaluateExpression(source, this.expressionVariables({ [variableName]: 0 }, variables)); } catch { return null; }
    const object = {
      id: this.#id(), type: "functionGraph", coordinateSystemId, expression: source,
      min: Number.isFinite(Number(options.min)) ? Number(options.min) : -10,
      max: Number.isFinite(Number(options.max)) ? Number(options.max) : 10,
      samples: Math.max(32, Math.min(2000, Number(options.samples) || 400)),
      derivative: options.derivative === true, mode, variables, style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addParametricPlot(coordinateSystemId, xExpression, yExpression, settings, options = {}) {
    if (!this.getCoordinateSystem(coordinateSystemId)) return null;
    const xSource = String(xExpression ?? "").trim();
    const ySource = String(yExpression ?? "").trim();
    const candidates = {
      ...this.#expressionBindingCandidates(),
      ...(options.variables || {}),
    };
    const variables = this.#bindExpressionVariables([xSource, ySource], candidates, ["t"]);
    try {
      const context = this.expressionVariables({ t: 0 }, variables);
      evaluateExpression(xSource, context); evaluateExpression(ySource, context);
    } catch { return null; }
    const object = {
      id: this.#id(), type: "parametricPlot", coordinateSystemId,
      xExpression: xSource, yExpression: ySource, variables,
      min: Number.isFinite(Number(options.min)) ? Number(options.min) : 0,
      max: Number.isFinite(Number(options.max)) ? Number(options.max) : Math.PI * 2,
      samples: Math.max(32, Math.min(2000, Number(options.samples) || 400)),
      style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addTable(sourceIds, position, settings = {}) {
    const sources = [...new Set(sourceIds || [])].filter((id) => this.getNumericValue(id) !== null);
    if (!sources.length) return null;
    const object = {
      id: this.#id(), type: "table", sourceIds: sources, rows: [],
      x: Number(position.x), y: Number(position.y),
      style: { color: settings.lineColor || "#334155", fontSize: Number(settings.textFontSize ?? settings.textSize) || 14 },
    };
    this.objects.push(object);
    this.addTableRow(object.id);
    return object;
  }

  addActionButton(actionKind, targetIds, label, position, settings = {}, options = {}) {
    const targets = [...new Set(targetIds || [])].filter((id) => this.getObject(id));
    if (!["hide", "show", "animate", "move", "link", "sound"].includes(actionKind)) return null;
    if (!["link", "sound"].includes(actionKind) && !targets.length) return null;
    if (actionKind === "animate" && targets.some((id) => {
      const target = this.getObject(id);
      return target.type !== "parameter" && !(target.type === "point" && target.definition.kind === "on-shape");
    })) return null;
    if (actionKind === "move") {
      const moving = this.getObject(targets[0]); const destination = this.getObject(targets[1]);
      if (targets.length !== 2 || moving?.type !== "point" || moving.definition.kind !== "free" || destination?.type !== "point") return null;
    }
    const url = actionKind === "link" && /^https?:\/\//i.test(String(options.url || "")) ? String(options.url) : null;
    if (actionKind === "link" && !url) return null;
    const object = {
      id: this.#id(), type: "actionButton", actionKind, targetIds: targets,
      label: String(label || ({ hide: "隐藏", show: "显示", animate: "动画" }[actionKind])).trim().slice(0, 40),
      x: Number(position.x), y: Number(position.y),
      style: { color: settings.lineColor || "#334155", fontSize: Number(settings.textFontSize ?? settings.textSize) || 15 },
      ...(url ? { url } : {}),
      ...(actionKind === "sound" ? {
        frequency: Math.max(80, Math.min(2000, Number(options.frequency) || 440)),
        duration: Math.max(0.05, Math.min(2, Number(options.duration) || 0.25)),
      } : {}),
    };
    this.objects.push(object);
    return object;
  }

  addTableRow(tableId) {
    const object = this.getObject(tableId);
    if (object?.type !== "table") return false;
    const row = object.sourceIds.map((id) => this.getNumericValue(id));
    if (row.some((value) => value === null)) return false;
    object.rows.push(row.map((value) => Number(value.toFixed(8))));
    return true;
  }

  getTableData(tableOrId) {
    const object = typeof tableOrId === "string" ? this.getObject(tableOrId) : tableOrId;
    if (object?.type !== "table") return null;
    const headers = object.sourceIds.map((id) => {
      const source = this.getObject(id);
      return source?.name || (source?.type === "measurement"
        ? (this.getMeasurementText(source)?.split(" = ")[0] || `度量${id.replace("obj-", "")}`)
        : id);
    });
    return { headers, rows: object.rows.map((row) => [...row]) };
  }

  addLocus(tracedPointId, driverPointId, settings, samples = 180) {
    const driver = this.getObject(driverPointId);
    if (!this.isPoint(tracedPointId) || driver?.type !== "point" || driver.definition.kind !== "on-shape") return null;
    const object = {
      id: this.#id(), type: "locus", tracedPointId, driverPointId,
      samples: Math.max(32, Math.min(720, Number(samples) || 180)), style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return this.getShapeGeometry(object) ? object : (this.objects.pop(), null);
  }

  getObjectName(objectOrId) {
    const object = typeof objectOrId === "string" ? this.getObject(objectOrId) : objectOrId;
    if (!object) return "未知对象";
    const pointLabel = (id) => this.getObject(id)?.type === "point"
      ? String(this.getObject(id).label || "").trim() || "未命名点" : "?";
    const pair = (firstId, secondId) => `${pointLabel(firstId)}${pointLabel(secondId)}`;
    if (object.type === "point") return String(object.label || "").trim() ? `点 ${object.label}` : "未命名点";
    if (object.type === "segment") return `线段 ${pair(object.pointAId, object.pointBId)}`;
    if (object.type === "line") return `直线 ${pair(object.pointAId, object.pointBId)}`;
    if (object.type === "ray") return `射线 ${pair(object.pointAId, object.pointBId)}`;
    if (object.type === "circle") return `圆 ${pointLabel(object.centerId)}`;
    if (object.type === "radiusCircle") return `圆 ${pointLabel(object.centerId)}`;
    if (object.type === "threePointCircle") {
      return `过 ${pointLabel(object.pointAId)}、${pointLabel(object.pointBId)}、${pointLabel(object.pointCId)} 三点的圆`;
    }
    if (object.type === "incircle") {
      return `△${pointLabel(object.pointAId)}${pointLabel(object.pointBId)}${pointLabel(object.pointCId)} 的内切圆`;
    }
    if (object.type === "arc") return `弧 ${pair(object.startPointId, object.endPointId)}`;
    if (object.type === "threePointArc") {
      return `弧 ${pointLabel(object.pointAId)}${pointLabel(object.pointBId)}${pointLabel(object.pointCId)}`;
    }
    if (object.type === "angleMark") {
      const vertex = pointLabel(object.vertexId);
      const sideLabel = (sideId) => {
        const side = this.getObject(sideId);
        if (!side) return null;
        const definingIds = [side.pointAId, side.pointBId, side.pointId, side.vertexId].filter(Boolean);
        if (!definingIds.includes(object.vertexId)) return null;
        const candidates = definingIds.filter((id) => id !== object.vertexId && this.getObject(id)?.type === "point");
        return candidates.length ? pointLabel(candidates[0]) : null;
      };
      const first = object.sideAId ? sideLabel(object.sideAId) : pointLabel(object.pointAId);
      const second = object.sideBId ? sideLabel(object.sideBId) : pointLabel(object.pointBId);
      return first && second ? `∠${first}${vertex}${second}`
        : `角标记（顶点 ${vertex}，${this.getObjectName(object.sideAId)} / ${this.getObjectName(object.sideBId)}）`;
    }
    if (object.type === "perpendicularBisector") return `线段 ${pair(object.pointAId, object.pointBId)} 的中垂线`;
    if (object.type === "parallelLine") return `过 ${pointLabel(object.pointId)} 的平行线`;
    if (object.type === "perpendicularLine") return `过 ${pointLabel(object.pointId)} 的垂线`;
    if (object.type === "angleBisector") return `∠${pointLabel(object.pointAId)}${pointLabel(object.vertexId)}${pointLabel(object.pointBId)} 的平分线`;
    return object.type;
  }

  getMeasurementText(measurementOrId, decimalPlaces = 2) {
    return formatMeasurementText(this, measurementOrId, decimalPlaces);
  }

  updateText(textId, content) {
    const object = this.getObject(textId);
    const normalized = String(content ?? "").trim();
    if (object?.type !== "text") return false;
    if (!normalized) {
      this.removeWithDependents(textId);
      return true;
    }
    object.content = normalized;
    return true;
  }

  moveText(textId, position) {
    const object = this.getObject(textId);
    if (!TEXT_TYPES.has(object?.type) && !MEDIA_TYPES.has(object?.type)) return false;
    object.x = Number(position.x);
    object.y = Number(position.y);
    return Number.isFinite(object.x) && Number.isFinite(object.y);
  }

  addPointOnShape(shapeId, position, settings) {
    const shape = this.getObject(shapeId);
    const geometry = this.getShapeGeometry(shapeId);
    if (!shape || !geometry) return this.addFreePoint(position, settings);

    let definition;
    if (geometry.kind === "line") {
      const projection = projectPointToLine(position, geometry.a, geometry.b, geometry.segment, geometry.ray);
      definition = { kind: "on-shape", parentId: shapeId, parameter: projection.t };
    } else if (geometry.kind === "circle" || geometry.kind === "arc" || geometry.kind === "circleInterior") {
      definition = {
        kind: "on-shape",
        parentId: shapeId,
        parameter: Math.atan2(position.y - geometry.center.y, position.x - geometry.center.x),
      };
    } else return this.addFreePoint(position, settings);
    const point = {
      id: this.#id(),
      type: "point",
      definition,
      label: this.#newPointLabel(settings),
      labelOffset: { x: 12, y: -12 },
      style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return point;
  }

  addIncenter(pointAId, pointBId, pointCId, settings) {
    return this.#addTriangleCenter("incenter", pointAId, pointBId, pointCId, settings);
  }

  addCentroid(pointAId, pointBId, pointCId, settings) {
    return this.#addTriangleCenter("centroid", pointAId, pointBId, pointCId, settings);
  }

  addOrthocenter(pointAId, pointBId, pointCId, settings) {
    return this.#addTriangleCenter("orthocenter", pointAId, pointBId, pointCId, settings);
  }

  #addTriangleCenter(kind, pointAId, pointBId, pointCId, settings) {
    const parents = [pointAId, pointBId, pointCId];
    if (new Set(parents).size !== 3 || parents.some((id) => !this.isPoint(id))) return null;
    const positions = parents.map((id) => this.getPointPosition(id));
    const evaluator = kind === "incenter" ? triangleIncenter
      : kind === "centroid" ? triangleCentroid
        : kind === "orthocenter" ? triangleOrthocenter : null;
    if (!evaluator || positions.some((position) => !position) || !evaluator(...positions)) return null;
    const point = {
      id: this.#id(),
      type: "point",
      definition: { kind, parents },
      label: this.#newPointLabel(settings),
      labelOffset: { x: 12, y: -12 },
      style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return point;
  }

  addIncircle(pointAId, pointBId, pointCId, settings) {
    const ids = [pointAId, pointBId, pointCId];
    if (new Set(ids).size !== 3 || ids.some((id) => !this.isPoint(id))) return null;
    const positions = ids.map((id) => this.getPointPosition(id));
    if (positions.some((position) => !position) || !triangleIncircle(...positions)) return null;
    const center = automaticIncircleCenterPoint(this.#id(), ids, settings);
    const object = {
      id: this.#id(),
      type: "incircle",
      pointAId,
      pointBId,
      pointCId,
      centerPointId: center.id,
      style: defaultShapeStyle(settings),
    };
    this.objects.push(center, object);
    return object;
  }

  addAngleTangentCircleCenter(vertexId, pointAId, pointBId, outerCircleId, settings) {
    const parents = [vertexId, pointAId, pointBId];
    if (new Set(parents).size !== 3 || parents.some((id) => !this.isPoint(id))) return null;
    if (this.getShapeGeometry(outerCircleId)?.kind !== "circle") return null;
    const point = {
      id: this.#id(),
      type: "point",
      definition: {
        kind: "angle-circle-center",
        vertexId,
        pointAId,
        pointBId,
        outerCircleId,
      },
      label: this.#newPointLabel(settings),
      labelOffset: { x: 12, y: -12 },
      style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return this.getPointPosition(point) ? point : (this.objects.pop(), null);
  }

  addInternalTangencyPoint(outerCircleId, innerCircleId, settings) {
    if (outerCircleId === innerCircleId) return null;
    if (this.getShapeGeometry(outerCircleId)?.kind !== "circle"
      || this.getShapeGeometry(innerCircleId)?.kind !== "circle") return null;
    const point = {
      id: this.#id(),
      type: "point",
      definition: { kind: "internal-tangency", parents: [outerCircleId, innerCircleId] },
      label: this.#newPointLabel(settings),
      labelOffset: { x: 12, y: -12 },
      style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return this.getPointPosition(point) ? point : (this.objects.pop(), null);
  }

  addPointAt(position, settings, tolerance = 10) {
    const pointHit = this.hitTestPoint(position, tolerance);
    const intersection = this.findNearestIntersection(position, tolerance * 1.5);
    const canDisambiguateIntersection = pointHit &&
      ["intersection", "other-intersection"].includes(pointHit.object.definition?.kind) &&
      intersection && intersection.distance + EPSILON < pointHit.distance;
    if (intersection && (!pointHit || canDisambiguateIntersection)) {
      const coincidentPoint = this.findCoincidentPoint(intersection.position);
      if (coincidentPoint) {
        return { point: coincidentPoint, created: false, snappedToIntersection: true };
      }
      const point = this.addIntersectionPoint(
        intersection.parents[0],
        intersection.parents[1],
        intersection.branch,
        settings,
      );
      return { point, created: true, snappedToIntersection: true };
    }
    if (pointHit) return { point: pointHit.object, created: false };

    const shapeHit = this.hitTestShape(position, tolerance);
    const point = shapeHit
      ? this.addPointOnShape(shapeHit.object.id, position, settings)
      : this.addFreePoint(position, settings);
    return { point, created: true };
  }

  addSegment(pointAId, pointBId, settings) {
    return this.#addTwoPointShape("segment", pointAId, pointBId, settings);
  }

  addLine(pointAId, pointBId, settings) {
    return this.#addTwoPointShape("line", pointAId, pointBId, settings);
  }

  addRay(pointAId, pointBId, settings) {
    return this.#addTwoPointShape("ray", pointAId, pointBId, settings);
  }

  addCircle(centerId, throughId, settings) {
    const center = this.getPointPosition(centerId);
    const through = this.getPointPosition(throughId);
    if (!center || !through || distance(center, through) <= EPSILON) return null;
    return this.#addTwoPointShape("circle", centerId, throughId, settings);
  }

  addCircleWithSegmentRadius(centerId, segmentId, settings) {
    const segment = this.getObject(segmentId);
    const geometry = this.getShapeGeometry(segmentId);
    if (!this.isPoint(centerId) || segment?.type !== "segment" || geometry?.kind !== "line") return null;
    const object = {
      id: this.#id(),
      type: "radiusCircle",
      centerId,
      radiusSegmentId: segmentId,
      style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addArcOnCircle(circleId, startPointId, endPointId, settings) {
    const circle = this.getShapeGeometry(circleId);
    if (circle?.kind !== "circle" || !this.isPoint(startPointId) || !this.isPoint(endPointId) || startPointId === endPointId) return null;
    const start = this.getPointPosition(startPointId);
    const end = this.getPointPosition(endPointId);
    const tolerance = Math.max(1e-6, circle.radius * 1e-6);
    if (!start || !end || Math.abs(distance(start, circle.center) - circle.radius) > tolerance ||
      Math.abs(distance(end, circle.center) - circle.radius) > tolerance || distance(start, end) <= EPSILON) return null;
    const object = {
      id: this.#id(), type: "arc", circleId, startPointId, endPointId, style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addThreePointArc(pointAId, pointBId, pointCId, settings) {
    const ids = [pointAId, pointBId, pointCId];
    if (new Set(ids).size !== 3 || ids.some((id) => !this.isPoint(id))) return null;
    const points = ids.map((id) => this.getPointPosition(id));
    if (points.some((point) => !point) || !circumcircleFromPoints(...points)) return null;
    const object = {
      id: this.#id(), type: "threePointArc", pointAId, pointBId, pointCId, style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addCircleInterior(circleId, settings, opacity = 0.2) {
    if (this.getShapeGeometry(circleId)?.kind !== "circle") return null;
    const object = {
      id: this.#id(), type: "circleInterior", circleId,
      opacity: Math.max(0, Math.min(1, Number(opacity))), style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addArcInterior(arcId, interiorKind, settings, opacity = 0.2) {
    if (this.getShapeGeometry(arcId)?.kind !== "arc") return null;
    const object = {
      id: this.#id(), type: interiorKind === "segment" ? "segmentInterior" : "sectorInterior", arcId,
      opacity: Math.max(0, Math.min(1, Number(opacity))), style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addMidpoint(pointAId, pointBId, settings) {
    if (!this.isPoint(pointAId) || !this.isPoint(pointBId) || pointAId === pointBId) return null;
    const point = {
      id: this.#id(),
      type: "point",
      definition: { kind: "midpoint", parents: [pointAId, pointBId] },
      label: this.#newPointLabel(settings),
      labelOffset: { x: 12, y: -12 },
      style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return point;
  }

  addTranslatedPoint(parentId, dx, dy, settings) {
    return this.#addTransformedPoint({ kind: "translated", parentId, dx: Number(dx), dy: Number(dy) }, settings);
  }

  addRotatedPoint(parentId, centerId, angleDegrees, settings) {
    if (!this.isPoint(centerId)) return null;
    return this.#addTransformedPoint({ kind: "rotated", parentId, centerId, angleDegrees: Number(angleDegrees) }, settings);
  }

  addScaledPoint(parentId, centerId, factor, settings) {
    if (!this.isPoint(centerId)) return null;
    return this.#addTransformedPoint({ kind: "scaled", parentId, centerId, factor: Number(factor) }, settings);
  }

  addReflectedPoint(parentId, mirrorId, settings) {
    const mirror = this.getShapeGeometry(mirrorId);
    if (mirror?.kind !== "line") return null;
    return this.#addTransformedPoint({ kind: "reflected", parentId, mirrorId }, settings);
  }

  addInvertedPoint(parentId, circleId, settings) {
    if (this.getShapeGeometry(circleId)?.kind !== "circle") return null;
    return this.#addTransformedPoint({ kind: "inverted", parentId, circleId }, settings);
  }

  addTransformedShape(parentShapeId, transformKind, value, settings = {}) {
    const parent = this.getObject(parentShapeId);
    if (!parent || !SHAPE_TYPES.has(parent.type) || parent.type === "coordinateSystem") return null;
    let transform;
    if (transformKind === "translate") {
      const dx = Number(value?.dx); const dy = Number(value?.dy);
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
      transform = { kind: "translate", dx, dy };
    } else if (transformKind === "rotate") {
      if (!this.isPoint(this.markedCenterId) || !Number.isFinite(Number(value))) return null;
      transform = { kind: "rotate", centerId: this.markedCenterId, angleDegrees: Number(value) };
    } else if (transformKind === "scale") {
      if (!this.isPoint(this.markedCenterId) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) <= EPSILON) return null;
      transform = { kind: "scale", centerId: this.markedCenterId, factor: Number(value) };
    } else if (transformKind === "reflect") {
      if (this.getShapeGeometry(this.markedMirrorId)?.kind !== "line") return null;
      transform = { kind: "reflect", mirrorId: this.markedMirrorId };
    } else if (transformKind === "invert") {
      const geometry = this.getShapeGeometry(parentShapeId);
      const inversionCircle = this.getShapeGeometry(this.markedInversionCircleId);
      const supportedLine = geometry?.kind === "line" && !geometry.segment && !geometry.ray;
      if ((!supportedLine && geometry?.kind !== "circle") || inversionCircle?.kind !== "circle") return null;
      transform = { kind: "invert", circleId: this.markedInversionCircleId };
    } else return null;
    const object = {
      id: this.#id(), type: "transformedShape", parentShapeId, transform,
      style: parent.style ? clone(parent.style) : defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  #addTransformedPoint(definition, settings) {
    if (!this.isPoint(definition.parentId)) return null;
    const numericValues = [definition.dx, definition.dy, definition.angleDegrees, definition.factor]
      .filter((value) => value !== undefined);
    if (numericValues.some((value) => !Number.isFinite(value))) return null;
    const point = {
      id: this.#id(),
      type: "point",
      definition,
      label: this.#newPointLabel(settings),
      labelOffset: { x: 12, y: -12 },
      style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return point;
  }

  markTransformCenter(pointId) {
    if (!this.isPoint(pointId)) return false;
    this.markedCenterId = pointId;
    return true;
  }

  markMirror(shapeId) {
    if (this.getShapeGeometry(shapeId)?.kind !== "line") return false;
    this.markedMirrorId = shapeId;
    return true;
  }

  markInversionCircle(shapeId) {
    if (this.getShapeGeometry(shapeId)?.kind !== "circle") return false;
    this.markedInversionCircleId = shapeId;
    return true;
  }

  addParallelLine(pointId, parentLineId, settings) {
    return this.#addDerivedLine("parallelLine", pointId, parentLineId, settings);
  }

  addPerpendicularLine(pointId, parentLineId, settings) {
    return this.#addDerivedLine("perpendicularLine", pointId, parentLineId, settings);
  }

  addPerpendicularBisector(pointAId, pointBId, settings) {
    if (!this.isPoint(pointAId) || !this.isPoint(pointBId) || pointAId === pointBId) return null;
    const first = this.getPointPosition(pointAId);
    const second = this.getPointPosition(pointBId);
    if (!first || !second || distance(first, second) <= EPSILON) return null;
    const object = {
      id: this.#id(),
      type: "perpendicularBisector",
      pointAId,
      pointBId,
      style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addAngleBisector(vertexId, pointAId, pointBId, settings) {
    const ids = [vertexId, pointAId, pointBId];
    if (new Set(ids).size !== 3 || ids.some((id) => !this.isPoint(id))) return null;
    const [vertex, a, b] = ids.map((id) => this.getPointPosition(id));
    if (!vertex || !a || !b || distance(vertex, a) <= EPSILON || distance(vertex, b) <= EPSILON) return null;
    const object = {
      id: this.#id(),
      type: "angleBisector",
      vertexId,
      pointAId,
      pointBId,
      style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addAngleBisectorFromSides(sideAId, sideBId, settings) {
    const sides = [this.getObject(sideAId), this.getObject(sideBId)];
    const supportedTypes = new Set(["segment", "line", "ray"]);
    if (sideAId === sideBId || sides.some((side) => !supportedTypes.has(side?.type))) return null;
    const endpoints = sides.map((side) => [side.pointAId, side.pointBId].filter(Boolean));
    const common = endpoints[0].filter((id) => endpoints[1].includes(id));
    if (common.length !== 1) return null;
    const vertexId = common[0];
    const pointAId = endpoints[0].find((id) => id !== vertexId);
    const pointBId = endpoints[1].find((id) => id !== vertexId);
    return this.addAngleBisector(vertexId, pointAId, pointBId, settings);
  }

  addAngleMarkFromSides(vertexId, sideAId, directionA, sideBId, directionB, settings, options = {}) {
    if (!this.isPoint(vertexId) || sideAId === sideBId) return null;
    const sideA = this.getShapeGeometry(sideAId);
    const sideB = this.getShapeGeometry(sideBId);
    if (sideA?.kind !== "line" || sideB?.kind !== "line") return null;
    const object = {
      id: this.#id(),
      type: "angleMark",
      vertexId,
      sideAId,
      sideBId,
      directionA: directionA < 0 ? -1 : 1,
      directionB: directionB < 0 ? -1 : 1,
      directionPointId: this.isPoint(options.directionPointId) ? options.directionPointId : null,
      directionPointSide: options.directionPointSide === "b" ? "b" : "a",
      coupleDirections: options.coupleDirections === true,
      strokeCount: Math.max(1, Math.min(4, Number(options.strokeCount) || 1)),
      opacity: Number.isFinite(options.opacity) ? Math.max(0, Math.min(1, options.opacity)) : 0.25,
      showDirection: options.showDirection === true,
      radius: Number.isFinite(options.radius) ? Math.max(10, Math.min(64, options.radius)) : 24,
      style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addPathMark(parentShapeId, position, settings, options = {}) {
    const parent = this.getShapeGeometry(parentShapeId);
    if (parent?.kind !== "line") return null;
    const projection = projectPointToLine(position, parent.a, parent.b, parent.segment, parent.ray);
    const object = {
      id: this.#id(),
      type: "pathMark",
      parentShapeId,
      parameter: projection.t,
      markKind: options.markKind === "arrow" ? "arrow" : "tick",
      strokeCount: Math.max(1, Math.min(4, Number(options.strokeCount) || 1)),
      style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addDoodle(points, settings) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const object = {
      id: this.#id(),
      type: "doodle",
      points: points.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      style: defaultShapeStyle(settings),
    };
    if (object.points.length < 2) return null;
    this.objects.push(object);
    return object;
  }

  cyclePathMark(pathMarkId) {
    const object = this.getObject(pathMarkId);
    if (object?.type !== "pathMark") return false;
    object.strokeCount = (Math.max(1, Math.min(4, Number(object.strokeCount) || 1)) % 4) + 1;
    return true;
  }

  setPathMarkKind(pathMarkId, markKind) {
    const object = this.getObject(pathMarkId);
    if (object?.type !== "pathMark") return false;
    object.markKind = markKind === "arrow" ? "arrow" : "tick";
    return true;
  }

  movePathMark(pathMarkId, position) {
    const object = this.getObject(pathMarkId);
    if (object?.type !== "pathMark") return false;
    const parent = this.getShapeGeometry(object.parentShapeId);
    if (parent?.kind !== "line") return false;
    object.parameter = projectPointToLine(position, parent.a, parent.b, parent.segment, parent.ray).t;
    return true;
  }

  cycleAngleMark(angleMarkId) {
    const object = this.getObject(angleMarkId);
    if (object?.type !== "angleMark") return false;
    object.strokeCount = (Math.max(1, Math.min(4, Number(object.strokeCount) || 1)) % 4) + 1;
    return true;
  }

  setObjectsHidden(objectIds, hidden = true) {
    let changed = false;
    for (const id of objectIds) {
      const object = this.getObject(id);
      if (!object || object.hidden === Boolean(hidden)) continue;
      object.hidden = Boolean(hidden);
      changed = true;
    }
    return changed;
  }

  setObjectsLocked(objectIds, locked = true) {
    let changed = false;
    for (const id of objectIds) {
      const object = this.getObject(id);
      if (!object || object.locked === Boolean(locked)) continue;
      object.locked = Boolean(locked);
      changed = true;
    }
    return changed;
  }

  setObjectsTracing(objectIds, tracing = true) {
    let changed = false;
    for (const id of objectIds) {
      const object = this.getObject(id);
      if (!object || object.type !== "point" || object.trace === Boolean(tracing)) continue;
      object.trace = Boolean(tracing);
      changed = true;
    }
    return changed;
  }

  reorderObjects(objectIds, direction) {
    const selected = new Set(objectIds || []);
    if (!selected.size) return false;
    this.#normalizePaintOrder();
    const before = this.paintOrder.join("|");
    const targets = this.paintOrder.filter((id) => selected.has(id));
    const others = this.paintOrder.filter((id) => !selected.has(id));
    this.paintOrder = direction === "back" ? [...targets, ...others] : [...others, ...targets];
    return before !== this.paintOrder.join("|");
  }

  importObjects(sourceDocument, objectIds, offset = { x: 24, y: 24 }) {
    if (!(sourceDocument instanceof GeometryDocument)) return [];
    const requested = new Set((objectIds || []).filter((id) => sourceDocument.getObject(id)));
    if (!requested.size) return [];
    const closure = new Set();
    const visit = (id) => {
      if (closure.has(id)) return;
      const object = sourceDocument.getObject(id);
      if (!object) return;
      closure.add(id);
      for (const dependency of sourceDocument.dependenciesOf(object)) visit(dependency);
    };
    for (const id of requested) visit(id);
    this.#normalizePaintOrder();
    const ordered = sourceDocument.objects.filter((object) => closure.has(object.id));
    const automaticCircleCenterIds = new Set(sourceDocument.objects
      .filter((object) => ["threePointCircle", "incircle"].includes(object.type) && object.centerPointId)
      .map((object) => object.centerPointId));
    const idMap = new Map(ordered.map((object) => [object.id, this.#id()]));
    const remap = (value) => {
      if (typeof value === "string") return idMap.get(value) || value;
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item)]));
      return value;
    };
    const dx = Number(offset.x) || 0; const dy = Number(offset.y) || 0;
    const created = ordered.map((source) => {
      const object = remap(clone(source));
      object.id = idMap.get(source.id);
      object.hidden = false;
      if (object.type === "point") {
        if (automaticCircleCenterIds.has(source.id)) {
          object.label = "圆心";
          object.style = { ...defaultPointStyle({}), ...object.style, showLabel: false };
        } else object.label = String(source.label || "").trim() ? this.#newPointLabel({}) : "";
        if (object.definition.kind === "free") { object.definition.x += dx; object.definition.y += dy; }
      } else if (TEXT_TYPES.has(object.type) || MEDIA_TYPES.has(object.type)) { object.x += dx; object.y += dy; }
      else if (object.type === "doodle") object.points = object.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
      else if (object.type === "coordinateSystem" && !object.originPointId) {
        object.origin.x += dx; object.origin.y += dy;
      }
      this.objects.push(object);
      return object;
    });
    const createdIds = new Set(created.map((object) => object.id));
    const copiedPaintOrder = sourceDocument.objectsInPaintOrder()
      .filter((object) => closure.has(object.id))
      .map((object) => idMap.get(object.id));
    this.paintOrder = [
      ...this.paintOrder.filter((id) => !createdIds.has(id)),
      ...copiedPaintOrder,
    ];
    const requestedCreatedIds = new Set([...requested].map((id) => idMap.get(id)));
    return created.filter((object) => requestedCreatedIds.has(object.id));
  }

  duplicateObjects(objectIds, offset = { x: 24, y: 24 }) {
    return this.importObjects(this, objectIds, offset);
  }

  setAngleMarkRadius(angleMarkId, radius) {
    const object = this.getObject(angleMarkId);
    if (object?.type !== "angleMark" || !Number.isFinite(Number(radius))) return false;
    object.radius = Math.max(10, Math.min(64, Number(radius)));
    return true;
  }

  setAngleMarkOpacity(angleMarkId, opacity) {
    const object = this.getObject(angleMarkId);
    if (object?.type !== "angleMark" || !Number.isFinite(Number(opacity))) return false;
    object.opacity = Math.max(0, Math.min(0.9, Number(opacity)));
    return true;
  }

  setAngleMarkDirectionVisible(angleMarkId, visible) {
    const object = this.getObject(angleMarkId);
    if (object?.type !== "angleMark") return false;
    object.showDirection = Boolean(visible);
    return true;
  }

  reverseAngleMark(angleMarkId) {
    const object = this.getObject(angleMarkId);
    if (object?.type !== "angleMark") return false;
    if (object.sideAId && object.sideBId) {
      [object.sideAId, object.sideBId] = [object.sideBId, object.sideAId];
      [object.directionA, object.directionB] = [object.directionB, object.directionA];
      if (object.directionPointId) {
        object.directionPointSide = object.directionPointSide === "b" ? "a" : "b";
      }
    } else [object.pointAId, object.pointBId] = [object.pointBId, object.pointAId];
    return true;
  }

  findAngleAt(vertexId, pointerPosition, tolerance = 10) {
    const vertex = this.getPointPosition(vertexId);
    if (!vertex || distance(vertex, pointerPosition) <= EPSILON) return null;
    const rays = [];
    const domainEpsilon = 1e-6;

    for (const object of this.objects) {
      if (object.hidden || !SHAPE_TYPES.has(object.type) || object.type === "angleMark") continue;
      const geometry = this.getShapeGeometry(object);
      if (geometry?.kind !== "line") continue;
      const rawProjection = projectPointToLine(vertex, geometry.a, geometry.b);
      if (rawProjection.distance > tolerance) continue;
      if (geometry.segment && (rawProjection.t < -domainEpsilon || rawProjection.t > 1 + domainEpsilon)) continue;
      if (geometry.ray && rawProjection.t < -domainEpsilon) continue;

      const dx = geometry.b.x - geometry.a.x;
      const dy = geometry.b.y - geometry.a.y;
      const length = Math.hypot(dx, dy);
      if (length <= EPSILON) continue;
      const signs = geometry.segment
        ? rawProjection.t <= domainEpsilon ? [1]
          : rawProjection.t >= 1 - domainEpsilon ? [-1] : [1, -1]
        : geometry.ray && rawProjection.t <= domainEpsilon ? [1] : [1, -1];
      for (const sign of signs) {
        const unit = { x: dx / length * sign, y: dy / length * sign };
        rays.push({
          sideId: object.id,
          direction: sign,
          unit,
          angle: normalizeAngle(Math.atan2(unit.y, unit.x)),
        });
      }
    }

    rays.sort((first, second) => first.angle - second.angle);
    const distinctRays = rays.filter((ray, index) => {
      const previous = rays[index - 1];
      return !previous || Math.abs(ray.angle - previous.angle) > 1e-5;
    });
    if (distinctRays.length < 2) return null;

    const pointerAngle = normalizeAngle(Math.atan2(
      pointerPosition.y - vertex.y,
      pointerPosition.x - vertex.x,
    ));
    let best = null;
    for (let index = 0; index < distinctRays.length; index += 1) {
      const first = distinctRays[index];
      const second = distinctRays[(index + 1) % distinctRays.length];
      if (first.sideId === second.sideId) continue;
      const span = normalizeAngle(second.angle - first.angle);
      const progress = normalizeAngle(pointerAngle - first.angle);
      if (span <= 1e-5 || progress > span + 1e-5) continue;
      const centerDistance = Math.abs(progress - span / 2);
      if (!best || centerDistance < best.centerDistance) {
        best = { first, second, span, centerDistance };
      }
    }
    if (!best) return null;
    return {
      vertexId,
      sideAId: best.first.sideId,
      directionA: best.first.direction,
      sideBId: best.second.sideId,
      directionB: best.second.direction,
      angle: best.span,
    };
  }

  addThreePointCircle(pointAId, pointBId, pointCId, settings) {
    const ids = [pointAId, pointBId, pointCId];
    if (new Set(ids).size !== 3 || ids.some((id) => !this.isPoint(id))) return null;
    const positions = ids.map((id) => this.getPointPosition(id));
    if (positions.some((point) => !point) || !circumcircleFromPoints(...positions)) return null;
    const center = automaticCircumcenterPoint(this.#id(), ids, settings);
    const object = {
      id: this.#id(),
      type: "threePointCircle",
      pointAId,
      pointBId,
      pointCId,
      centerPointId: center.id,
      style: defaultShapeStyle(settings),
    };
    this.objects.push(center, object);
    return object;
  }

  #addDerivedLine(type, pointId, parentLineId, settings) {
    if (!this.isPoint(pointId)) return null;
    const parentGeometry = this.getShapeGeometry(parentLineId);
    if (!parentGeometry || parentGeometry.kind !== "line") return null;
    const object = {
      id: this.#id(),
      type,
      pointId,
      parentLineId,
      style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  #addTwoPointShape(type, pointAId, pointBId, settings) {
    if (!this.isPoint(pointAId) || !this.isPoint(pointBId) || pointAId === pointBId) return null;
    const first = this.getPointPosition(pointAId);
    const second = this.getPointPosition(pointBId);
    if (!first || !second || distance(first, second) <= EPSILON) return null;
    const object = {
      id: this.#id(),
      type,
      ...(type === "circle"
        ? { centerId: pointAId, throughId: pointBId }
        : { pointAId, pointBId }),
      style: defaultShapeStyle(settings),
    };
    this.objects.push(object);
    return object;
  }

  addIntersectionPoints(firstShapeId, secondShapeId, settings) {
    if (firstShapeId === secondShapeId) return [];
    const positions = this.getIntersections(firstShapeId, secondShapeId);
    return positions.map((_, branch) => this.addIntersectionPoint(firstShapeId, secondShapeId, branch, settings));
  }

  addIntersectionPoint(firstShapeId, secondShapeId, branch, settings) {
    const point = {
      id: this.#id(),
      type: "point",
      definition: {
        kind: "intersection",
        parents: [firstShapeId, secondShapeId],
        branch,
      },
        label: this.#newPointLabel(settings),
        labelOffset: { x: 12, y: -12 },
        style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return point;
  }

  addOtherIntersectionPoint(firstShapeId, secondShapeId, knownPointId, settings) {
    if (!this.isPoint(knownPointId)) return null;
    const intersections = this.getIntersections(firstShapeId, secondShapeId);
    const knownPosition = this.getPointPosition(knownPointId);
    if (!knownPosition || intersections.length < 2) return null;
    const point = {
      id: this.#id(),
      type: "point",
      definition: {
        kind: "other-intersection",
        parents: [firstShapeId, secondShapeId],
        knownPointId,
      },
      label: this.#newPointLabel(settings),
      labelOffset: { x: 12, y: -12 },
      style: defaultPointStyle(settings),
    };
    this.objects.push(point);
    return this.getPointPosition(point) ? point : (this.objects.pop(), null);
  }

  getPointPosition(pointOrId, stack = new Set()) {
    const point = typeof pointOrId === "string" ? this.getObject(pointOrId) : pointOrId;
    if (!point || point.type !== "point") return null;
    if (stack.has(point.id)) return null;
    const nextStack = new Set(stack).add(point.id);
    const definition = point.definition;

    if (definition.kind === "free") return { x: definition.x, y: definition.y };
    if (definition.kind === "midpoint") {
      const first = this.getPointPosition(definition.parents[0], nextStack);
      const second = this.getPointPosition(definition.parents[1], nextStack);
      if (!first || !second) return null;
      return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    }
    if (definition.kind === "circumcenter") {
      const points = definition.parents.map((id) => this.getPointPosition(id, nextStack));
      if (points.length !== 3 || points.some((item) => !item)) return null;
      return circumcircleFromPoints(...points)?.center || null;
    }
    if (["incenter", "centroid", "orthocenter"].includes(definition.kind)) {
      const points = definition.parents.map((id) => this.getPointPosition(id, nextStack));
      if (points.length !== 3 || points.some((item) => !item)) return null;
      if (definition.kind === "centroid") return triangleCentroid(...points);
      if (definition.kind === "orthocenter") return triangleOrthocenter(...points);
      return triangleIncenter(...points);
    }
    if (definition.kind === "angle-circle-center") {
      const vertex = this.getPointPosition(definition.vertexId, nextStack);
      const pointA = this.getPointPosition(definition.pointAId, nextStack);
      const pointB = this.getPointPosition(definition.pointBId, nextStack);
      const outerCircle = this.getShapeGeometry(definition.outerCircleId, nextStack);
      if (!vertex || !pointA || !pointB || outerCircle?.kind !== "circle") return null;
      return circleTangentToAngleAndCircle(
        vertex,
        pointA,
        pointB,
        outerCircle.center,
        outerCircle.radius,
      )?.center || null;
    }
    if (definition.kind === "internal-tangency") {
      const outerCircle = this.getShapeGeometry(definition.parents[0], nextStack);
      const innerCircle = this.getShapeGeometry(definition.parents[1], nextStack);
      if (outerCircle?.kind !== "circle" || innerCircle?.kind !== "circle") return null;
      const direction = {
        x: innerCircle.center.x - outerCircle.center.x,
        y: innerCircle.center.y - outerCircle.center.y,
      };
      const directionLength = Math.hypot(direction.x, direction.y);
      if (directionLength <= EPSILON) return null;
      return {
        x: outerCircle.center.x + direction.x / directionLength * outerCircle.radius,
        y: outerCircle.center.y + direction.y / directionLength * outerCircle.radius,
      };
    }
    if (definition.kind === "translated") {
      const parent = this.getPointPosition(definition.parentId, nextStack);
      if (!parent) return null;
      return { x: parent.x + definition.dx, y: parent.y + definition.dy };
    }
    if (definition.kind === "rotated" || definition.kind === "scaled") {
      const parent = this.getPointPosition(definition.parentId, nextStack);
      const center = this.getPointPosition(definition.centerId, nextStack);
      if (!parent || !center) return null;
      const offset = { x: parent.x - center.x, y: parent.y - center.y };
      if (definition.kind === "scaled") {
        return { x: center.x + offset.x * definition.factor, y: center.y + offset.y * definition.factor };
      }
      const angle = definition.angleDegrees * Math.PI / 180;
      return {
        x: center.x + offset.x * Math.cos(angle) - offset.y * Math.sin(angle),
        y: center.y + offset.x * Math.sin(angle) + offset.y * Math.cos(angle),
      };
    }
    if (definition.kind === "reflected") {
      const parent = this.getPointPosition(definition.parentId, nextStack);
      const mirror = this.getShapeGeometry(definition.mirrorId, nextStack);
      if (!parent || mirror?.kind !== "line") return null;
      const projection = projectPointToLine(parent, mirror.a, mirror.b);
      return { x: projection.point.x * 2 - parent.x, y: projection.point.y * 2 - parent.y };
    }
    if (definition.kind === "inverted") {
      const parent = this.getPointPosition(definition.parentId, nextStack);
      const inversionCircle = this.getShapeGeometry(definition.circleId, nextStack);
      if (!parent || inversionCircle?.kind !== "circle") return null;
      return invertPointInCircle(parent, inversionCircle);
    }
    if (definition.kind === "on-shape") {
      const geometry = this.getShapeGeometry(definition.parentId, nextStack);
      if (!geometry) return null;
      if (geometry.kind === "line") {
        const t = geometry.segment
          ? Math.max(0, Math.min(1, definition.parameter))
          : geometry.ray ? Math.max(0, definition.parameter) : definition.parameter;
        return {
          x: geometry.a.x + (geometry.b.x - geometry.a.x) * t,
          y: geometry.a.y + (geometry.b.y - geometry.a.y) * t,
        };
      }
      const angle = clampAngleToArc(definition.parameter, geometry);
      return {
        x: geometry.center.x + Math.cos(angle) * geometry.radius,
        y: geometry.center.y + Math.sin(angle) * geometry.radius,
      };
    }
    if (definition.kind === "plotted") {
      const system = this.getCoordinateSystem(definition.coordinateSystemId);
      if (!system) return null;
      try {
        const variables = this.expressionVariables({}, definition.variables, nextStack);
        const x = evaluateExpression(definition.xExpression, variables);
        const y = evaluateExpression(definition.yExpression, variables);
        return { x: system.origin.x + x * system.unitX, y: system.origin.y - y * system.unitY };
      } catch { return null; }
    }
    if (definition.kind === "intersection") {
      const positions = this.getIntersections(definition.parents[0], definition.parents[1], nextStack);
      return positions.length === 1 ? positions[0] : positions[definition.branch] || null;
    }
    if (definition.kind === "other-intersection") {
      const knownPosition = this.getPointPosition(definition.knownPointId, nextStack);
      const positions = this.getIntersections(definition.parents[0], definition.parents[1], nextStack);
      if (!knownPosition || !positions.length) return null;
      if (positions.length === 1) return positions[0];
      return positions.reduce((best, position) =>
        distance(position, knownPosition) > distance(best, knownPosition) ? position : best
      );
    }
    return null;
  }

  getShapeGeometry(shapeOrId, stack = new Set()) {
    const shape = typeof shapeOrId === "string" ? this.getObject(shapeOrId) : shapeOrId;
    if (!shape || !SHAPE_TYPES.has(shape.type)) return null;
    if (stack.has(shape.id)) return null;
    const nextStack = new Set(stack).add(shape.id);

    if (shape.type === "transformedShape") {
      const parent = this.getShapeGeometry(shape.parentShapeId, nextStack);
      if (!parent) return null;
      const transform = shape.transform || {};
      if (transform.kind === "invert") {
        const inversionCircle = this.getShapeGeometry(transform.circleId, nextStack);
        return inversionCircle?.kind === "circle"
          ? invertGeometryInCircle(parent, inversionCircle) : null;
      }
      const center = transform.centerId ? this.getPointPosition(transform.centerId, nextStack) : null;
      const mirror = transform.mirrorId ? this.getShapeGeometry(transform.mirrorId, nextStack) : null;
      const transformPoint = (point) => {
        if (transform.kind === "translate") return { x: point.x + transform.dx, y: point.y + transform.dy };
        if (transform.kind === "rotate" && center) {
          const angle = transform.angleDegrees * Math.PI / 180;
          const dx = point.x - center.x; const dy = point.y - center.y;
          return { x: center.x + dx * Math.cos(angle) - dy * Math.sin(angle), y: center.y + dx * Math.sin(angle) + dy * Math.cos(angle) };
        }
        if (transform.kind === "scale" && center) {
          return { x: center.x + (point.x - center.x) * transform.factor, y: center.y + (point.y - center.y) * transform.factor };
        }
        if (transform.kind === "reflect" && mirror?.kind === "line") {
          const projection = projectPointToLine(point, mirror.a, mirror.b);
          return { x: projection.point.x * 2 - point.x, y: projection.point.y * 2 - point.y };
        }
        return null;
      };
      const radiusScale = transform.kind === "scale" ? Math.abs(transform.factor) : 1;
      if (parent.kind === "line") {
        const a = transformPoint(parent.a); const b = transformPoint(parent.b);
        return a && b ? { ...parent, a, b } : null;
      }
      if (parent.kind === "circle" || parent.kind === "circleInterior") {
        const transformedCenter = transformPoint(parent.center);
        return transformedCenter ? { ...parent, center: transformedCenter, radius: parent.radius * radiusScale } : null;
      }
      if (parent.kind === "arc" || parent.kind === "arcInterior") {
        const transformedCenter = transformPoint(parent.center);
        const start = transformPoint(parent.start); const end = transformPoint(parent.end);
        if (!transformedCenter || !start || !end) return null;
        return {
          ...parent, center: transformedCenter, start, end, radius: parent.radius * radiusScale,
          startAngle: Math.atan2(start.y - transformedCenter.y, start.x - transformedCenter.x),
          signedAngle: transform.kind === "reflect" ? -parent.signedAngle : parent.signedAngle,
        };
      }
      if (parent.kind === "doodle") {
        const points = parent.points.map(transformPoint);
        return points.every(Boolean) ? { ...parent, points } : null;
      }
      if (parent.kind === "plot") {
        const paths = parent.paths.map((path) => path.map(transformPoint));
        return paths.every((path) => path.every(Boolean)) ? { ...parent, paths } : null;
      }
      if (parent.kind === "pathMark") {
        const transformedCenter = transformPoint(parent.center);
        const directionEnd = transformPoint({ x: parent.center.x + parent.direction.x, y: parent.center.y + parent.direction.y });
        if (!transformedCenter || !directionEnd) return null;
        const dx = directionEnd.x - transformedCenter.x; const dy = directionEnd.y - transformedCenter.y;
        const length = Math.hypot(dx, dy);
        if (length <= EPSILON) return null;
        return { ...parent, center: transformedCenter, direction: { x: dx / length, y: dy / length }, normal: { x: -dy / length, y: dx / length } };
      }
      if (parent.kind === "angleMark") {
        let start = transformPoint(parent.start); let end = transformPoint(parent.end);
        const vertex = transformPoint(parent.vertex); const corner = parent.corner ? transformPoint(parent.corner) : null;
        if (!start || !end || !vertex) return null;
        if (transform.kind === "reflect") [start, end] = [end, start];
        return {
          ...parent, vertex, start, end, corner, radius: parent.radius * radiusScale,
          startAngle: Math.atan2(start.y - vertex.y, start.x - vertex.x),
        };
      }
      return null;
    }

    if (shape.type === "coordinateSystem") {
      const system = this.getCoordinateSystem(shape);
      return system ? { kind: "coordinateSystem", ...system } : null;
    }

    if (shape.type === "functionGraph" || shape.type === "parametricPlot") {
      const system = this.getCoordinateSystem(shape.coordinateSystemId);
      if (!system || shape.max <= shape.min) return null;
      const paths = [];
      let current = [];
      const context = this.expressionVariables({}, shape.variables, nextStack);
      const sampleCount = Math.max(32, Math.min(2000, Number(shape.samples) || 400));
      const evaluateAt = (value) => {
        if (shape.type === "parametricPlot") {
          return {
            x: evaluateExpression(shape.xExpression, { ...context, t: value }),
            y: evaluateExpression(shape.yExpression, { ...context, t: value }),
          };
        }
        const h = Math.max(1e-5, Math.abs(shape.max - shape.min) / sampleCount / 8);
        if (shape.mode === "x") return { x: evaluateExpression(shape.expression, { ...context, y: value }), y: value };
        if (shape.mode === "polar") {
          const radius = evaluateExpression(shape.expression, { ...context, theta: value });
          return { x: radius * Math.cos(value), y: radius * Math.sin(value) };
        }
        const y = shape.derivative
          ? (evaluateExpression(shape.expression, { ...context, x: value + h }) -
              evaluateExpression(shape.expression, { ...context, x: value - h })) / (2 * h)
          : evaluateExpression(shape.expression, { ...context, x: value });
        return { x: value, y };
      };
      for (let index = 0; index <= sampleCount; index += 1) {
        const value = shape.min + (shape.max - shape.min) * index / sampleCount;
        try {
          const point = evaluateAt(value);
          const world = { x: system.origin.x + point.x * system.unitX, y: system.origin.y - point.y * system.unitY };
          const previous = current.at(-1);
          const discontinuity = previous && Math.abs(world.y - previous.y) > system.unitY * 20;
          if (!Number.isFinite(world.x) || !Number.isFinite(world.y) || discontinuity) throw new Error("break");
          current.push(world);
        } catch {
          if (current.length > 1) paths.push(current);
          current = [];
        }
      }
      if (current.length > 1) paths.push(current);
      return paths.length ? { kind: "plot", paths } : null;
    }

    if (shape.type === "locus") {
      const driver = this.getObject(shape.driverPointId);
      const definition = driver?.definition;
      const parent = definition?.kind === "on-shape" ? this.getShapeGeometry(definition.parentId, nextStack) : null;
      if (!driver || !parent) return null;
      const originalParameter = definition.parameter;
      const points = [];
      const sampleCount = Math.max(32, Math.min(720, Number(shape.samples) || 180));
      let minimum = 0;
      let maximum = 1;
      if (parent.kind === "circle") maximum = Math.PI * 2;
      else if (parent.kind === "arc") {
        minimum = parent.startAngle;
        maximum = parent.startAngle + parent.signedAngle;
      } else if (parent.kind === "line" && parent.ray) maximum = 5;
      else if (parent.kind === "line" && !parent.segment) { minimum = -2; maximum = 2; }
      try {
        for (let index = 0; index <= sampleCount; index += 1) {
          definition.parameter = minimum + (maximum - minimum) * index / sampleCount;
          const position = this.getPointPosition(shape.tracedPointId, nextStack);
          if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) points.push({ ...position });
        }
      } finally {
        definition.parameter = originalParameter;
      }
      return points.length > 1 ? { kind: "plot", paths: [points], locus: true } : null;
    }

    if (shape.type === "segment" || shape.type === "line" || shape.type === "ray") {
      const a = this.getPointPosition(shape.pointAId, nextStack);
      const b = this.getPointPosition(shape.pointBId, nextStack);
      if (!a || !b || distance(a, b) <= EPSILON) return null;
      return {
        kind: "line",
        a,
        b,
        segment: shape.type === "segment",
        ray: shape.type === "ray",
      };
    }

    if (shape.type === "parallelLine" || shape.type === "perpendicularLine") {
      const point = this.getPointPosition(shape.pointId, nextStack);
      const parent = this.getShapeGeometry(shape.parentLineId, nextStack);
      if (!point || !parent || parent.kind !== "line") return null;
      const parentDirection = { x: parent.b.x - parent.a.x, y: parent.b.y - parent.a.y };
      const direction = shape.type === "parallelLine"
        ? parentDirection
        : { x: -parentDirection.y, y: parentDirection.x };
      if (Math.hypot(direction.x, direction.y) <= EPSILON) return null;
      return {
        kind: "line",
        a: point,
        b: { x: point.x + direction.x, y: point.y + direction.y },
        segment: false,
        ray: false,
      };
    }

    if (shape.type === "perpendicularBisector") {
      const a = this.getPointPosition(shape.pointAId, nextStack);
      const b = this.getPointPosition(shape.pointBId, nextStack);
      if (!a || !b || distance(a, b) <= EPSILON) return null;
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const direction = { x: -(b.y - a.y), y: b.x - a.x };
      return {
        kind: "line",
        a: midpoint,
        b: { x: midpoint.x + direction.x, y: midpoint.y + direction.y },
        segment: false,
        ray: false,
      };
    }

    if (shape.type === "angleBisector") {
      const vertex = this.getPointPosition(shape.vertexId, nextStack);
      const a = this.getPointPosition(shape.pointAId, nextStack);
      const b = this.getPointPosition(shape.pointBId, nextStack);
      if (!vertex || !a || !b) return null;
      const vectorA = { x: a.x - vertex.x, y: a.y - vertex.y };
      const vectorB = { x: b.x - vertex.x, y: b.y - vertex.y };
      const lengthA = Math.hypot(vectorA.x, vectorA.y);
      const lengthB = Math.hypot(vectorB.x, vectorB.y);
      if (lengthA <= EPSILON || lengthB <= EPSILON) return null;
      const direction = {
        x: vectorA.x / lengthA + vectorB.x / lengthB,
        y: vectorA.y / lengthA + vectorB.y / lengthB,
      };
      if (Math.hypot(direction.x, direction.y) <= EPSILON) return null;
      return {
        kind: "line",
        a: vertex,
        b: { x: vertex.x + direction.x, y: vertex.y + direction.y },
        segment: false,
        ray: true,
      };
    }

    if (shape.type === "pathMark") {
      const parent = this.getShapeGeometry(shape.parentShapeId, nextStack);
      if (parent?.kind !== "line") return null;
      const dx = parent.b.x - parent.a.x;
      const dy = parent.b.y - parent.a.y;
      const length = Math.hypot(dx, dy);
      if (length <= EPSILON) return null;
      const parameter = parent.segment
        ? Math.max(0, Math.min(1, Number(shape.parameter) || 0))
        : parent.ray ? Math.max(0, Number(shape.parameter) || 0) : Number(shape.parameter) || 0;
      return {
        kind: "pathMark",
        center: { x: parent.a.x + dx * parameter, y: parent.a.y + dy * parameter },
        direction: { x: dx / length, y: dy / length },
        normal: { x: -dy / length, y: dx / length },
        markKind: shape.markKind === "arrow" ? "arrow" : "tick",
        strokeCount: Math.max(1, Math.min(4, Number(shape.strokeCount) || 1)),
      };
    }

    if (shape.type === "doodle") {
      if (!Array.isArray(shape.points) || shape.points.length < 2) return null;
      return { kind: "doodle", points: shape.points };
    }

    if (shape.type === "angleMark") {
      const vertex = this.getPointPosition(shape.vertexId, nextStack);
      if (!vertex) return null;
      let unitA;
      let unitB;
      let maximumRadius = Number.POSITIVE_INFINITY;
      if (shape.sideAId && shape.sideBId) {
        const sideA = this.getShapeGeometry(shape.sideAId, nextStack);
        const sideB = this.getShapeGeometry(shape.sideBId, nextStack);
        if (sideA?.kind !== "line" || sideB?.kind !== "line") return null;
        const vectorA = { x: sideA.b.x - sideA.a.x, y: sideA.b.y - sideA.a.y };
        const vectorB = { x: sideB.b.x - sideB.a.x, y: sideB.b.y - sideB.a.y };
        const lengthA = Math.hypot(vectorA.x, vectorA.y);
        const lengthB = Math.hypot(vectorB.x, vectorB.y);
        if (lengthA <= EPSILON || lengthB <= EPSILON) return null;
        const baseSignA = shape.directionA < 0 ? -1 : 1;
        const baseSignB = shape.directionB < 0 ? -1 : 1;
        let signA = baseSignA;
        let signB = baseSignB;
        if (shape.directionPointId) {
          const reference = this.getPointPosition(shape.directionPointId, nextStack);
          const referenceVector = reference
            ? { x: reference.x - vertex.x, y: reference.y - vertex.y }
            : null;
          const referenceSide = shape.directionPointSide === "b" ? "b" : "a";
          const sideVector = referenceSide === "b" ? vectorB : vectorA;
          const sideLength = referenceSide === "b" ? lengthB : lengthA;
          const alignment = referenceVector
            ? (sideVector.x * referenceVector.x + sideVector.y * referenceVector.y) / sideLength
            : 0;
          if (Math.abs(alignment) > EPSILON) {
            const dynamicSign = alignment < 0 ? -1 : 1;
            const baseSign = referenceSide === "b" ? baseSignB : baseSignA;
            const flip = dynamicSign === baseSign ? 1 : -1;
            if (referenceSide === "b") signB = dynamicSign;
            else signA = dynamicSign;
            if (shape.coupleDirections) {
              if (referenceSide === "b") signA = baseSignA * flip;
              else signB = baseSignB * flip;
            }
          }
        }
        unitA = { x: vectorA.x / lengthA * signA, y: vectorA.y / lengthA * signA };
        unitB = { x: vectorB.x / lengthB * signB, y: vectorB.y / lengthB * signB };
      } else {
        // Compatibility with projects saved by the earlier three-point prototype.
        const a = this.getPointPosition(shape.pointAId, nextStack);
        const b = this.getPointPosition(shape.pointBId, nextStack);
        if (!a || !b) return null;
        const vectorA = { x: a.x - vertex.x, y: a.y - vertex.y };
        const vectorB = { x: b.x - vertex.x, y: b.y - vertex.y };
        const lengthA = Math.hypot(vectorA.x, vectorA.y);
        const lengthB = Math.hypot(vectorB.x, vectorB.y);
        if (lengthA <= EPSILON || lengthB <= EPSILON) return null;
        unitA = { x: vectorA.x / lengthA, y: vectorA.y / lengthA };
        unitB = { x: vectorB.x / lengthB, y: vectorB.y / lengthB };
        maximumRadius = Math.min(lengthA * 0.35, lengthB * 0.35);
      }
      const signedAngle = normalizeAngle(Math.atan2(unitB.y, unitB.x) - Math.atan2(unitA.y, unitA.x));
      if (signedAngle <= EPSILON || Math.abs(signedAngle - Math.PI) <= EPSILON) return null;
      const radius = Math.max(8, Math.min(Number(shape.radius) || 32, maximumRadius));
      const start = { x: vertex.x + unitA.x * radius, y: vertex.y + unitA.y * radius };
      const end = { x: vertex.x + unitB.x * radius, y: vertex.y + unitB.y * radius };
      const rightAngle = Math.abs(signedAngle - Math.PI / 2) <= Math.PI / 240;
      const corner = rightAngle ? {
        x: vertex.x + (unitA.x + unitB.x) * radius,
        y: vertex.y + (unitA.y + unitB.y) * radius,
      } : null;
      return {
        kind: "angleMark",
        vertex,
        start,
        end,
        corner,
        radius,
        startAngle: Math.atan2(unitA.y, unitA.x),
        signedAngle,
        rightAngle,
        strokeCount: Math.max(1, Math.min(4, Number(shape.strokeCount) || 1)),
        opacity: Number.isFinite(shape.opacity) ? shape.opacity : 0.25,
        showDirection: shape.showDirection === true,
      };
    }

    if (shape.type === "arc") {
      const circle = this.getShapeGeometry(shape.circleId, nextStack);
      const startPoint = this.getPointPosition(shape.startPointId, nextStack);
      const endPoint = this.getPointPosition(shape.endPointId, nextStack);
      if (circle?.kind !== "circle" || !startPoint || !endPoint) return null;
      const tolerance = Math.max(1e-6, circle.radius * 1e-6);
      if (Math.abs(distance(startPoint, circle.center) - circle.radius) > tolerance ||
        Math.abs(distance(endPoint, circle.center) - circle.radius) > tolerance ||
        distance(startPoint, endPoint) <= EPSILON) return null;
      const startAngle = Math.atan2(startPoint.y - circle.center.y, startPoint.x - circle.center.x);
      const endAngle = Math.atan2(endPoint.y - circle.center.y, endPoint.x - circle.center.x);
      const signedAngle = normalizeAngle(endAngle - startAngle);
      if (signedAngle <= EPSILON) return null;
      return {
        kind: "arc", center: circle.center, radius: circle.radius, startAngle, signedAngle,
        start: { ...startPoint }, end: { ...endPoint },
      };
    }

    if (shape.type === "threePointArc") {
      const a = this.getPointPosition(shape.pointAId, nextStack);
      const b = this.getPointPosition(shape.pointBId, nextStack);
      const c = this.getPointPosition(shape.pointCId, nextStack);
      if (!a || !b || !c) return null;
      const circle = circumcircleFromPoints(a, b, c);
      if (!circle) return null;
      const startAngle = Math.atan2(a.y - circle.center.y, a.x - circle.center.x);
      const middleAngle = Math.atan2(b.y - circle.center.y, b.x - circle.center.x);
      const endAngle = Math.atan2(c.y - circle.center.y, c.x - circle.center.x);
      const positiveSpan = normalizeAngle(endAngle - startAngle);
      const middleProgress = normalizeAngle(middleAngle - startAngle);
      const signedAngle = middleProgress <= positiveSpan ? positiveSpan : positiveSpan - Math.PI * 2;
      return {
        kind: "arc", center: circle.center, radius: circle.radius, startAngle, signedAngle,
        start: { ...a }, end: { ...c },
      };
    }

    if (shape.type === "circleInterior") {
      const circle = this.getShapeGeometry(shape.circleId, nextStack);
      return circle?.kind === "circle" ? { ...circle, kind: "circleInterior", opacity: shape.opacity ?? 0.2 } : null;
    }

    if (shape.type === "sectorInterior" || shape.type === "segmentInterior") {
      const arc = this.getShapeGeometry(shape.arcId, nextStack);
      return arc?.kind === "arc" ? {
        ...arc, kind: "arcInterior", interiorKind: shape.type === "segmentInterior" ? "segment" : "sector",
        opacity: shape.opacity ?? 0.2,
      } : null;
    }

    if (shape.type === "threePointCircle") {
      const a = this.getPointPosition(shape.pointAId, nextStack);
      const b = this.getPointPosition(shape.pointBId, nextStack);
      const c = this.getPointPosition(shape.pointCId, nextStack);
      if (!a || !b || !c) return null;
      const center = shape.centerPointId ? this.getPointPosition(shape.centerPointId, nextStack) : null;
      const circle = center ? { center, radius: distance(center, a) } : circumcircleFromPoints(a, b, c);
      return !circle || circle.radius <= EPSILON ? null : { kind: "circle", ...circle };
    }

    if (shape.type === "incircle") {
      const points = [shape.pointAId, shape.pointBId, shape.pointCId]
        .map((id) => this.getPointPosition(id, nextStack));
      if (points.some((point) => !point)) return null;
      const circle = triangleIncircle(...points);
      if (!circle) return null;
      const center = shape.centerPointId
        ? this.getPointPosition(shape.centerPointId, nextStack) || circle.center
        : circle.center;
      return { kind: "circle", ...circle, center };
    }

    if (shape.type === "radiusCircle") {
      const center = this.getPointPosition(shape.centerId, nextStack);
      const radiusSegment = this.getShapeGeometry(shape.radiusSegmentId, nextStack);
      if (!center || radiusSegment?.kind !== "line" || !radiusSegment.segment) return null;
      const radius = distance(radiusSegment.a, radiusSegment.b);
      return radius <= EPSILON ? null : { kind: "circle", center, radius };
    }

    const center = this.getPointPosition(shape.centerId, nextStack);
    const through = this.getPointPosition(shape.throughId, nextStack);
    if (!center || !through) return null;
    const radius = distance(center, through);
    if (radius <= EPSILON) return null;
    return { kind: "circle", center, radius };
  }

  getIntersections(firstShapeId, secondShapeId, stack = new Set()) {
    const first = this.getShapeGeometry(firstShapeId, stack);
    const second = this.getShapeGeometry(secondShapeId, stack);
    const primitive = (geometry) => geometry?.kind === "arc"
      ? { kind: "circle", center: geometry.center, radius: geometry.radius }
      : geometry?.kind === "circleInterior"
        ? { kind: "circle", center: geometry.center, radius: geometry.radius }
        : geometry;
    return intersectGeometries(primitive(first), primitive(second)).filter((point) =>
      (first?.kind !== "arc" || pointOnArcGeometry(point, first)) &&
      (second?.kind !== "arc" || pointOnArcGeometry(point, second))
    );
  }

  movePoint(pointId, position) {
    const point = this.getObject(pointId);
    if (!point || point.type !== "point") return false;
    const definition = point.definition;
    if (definition.kind === "intersection" || definition.kind === "plotted") return false;
    if (definition.kind === "free") {
      definition.x = position.x;
      definition.y = position.y;
      return true;
    }

    const geometry = this.getShapeGeometry(definition.parentId);
    if (!geometry) return false;
    if (geometry.kind === "line") {
      definition.parameter = projectPointToLine(
        position, geometry.a, geometry.b, geometry.segment, geometry.ray,
      ).t;
    } else {
      definition.parameter = clampAngleToArc(
        Math.atan2(position.y - geometry.center.y, position.x - geometry.center.x), geometry,
      );
    }
    return true;
  }

  isPointDirectlyMovable(pointOrId) {
    const point = typeof pointOrId === "string" ? this.getObject(pointOrId) : pointOrId;
    return point?.type === "point" && ["free", "on-shape"].includes(point.definition?.kind);
  }

  setFreePointPosition(pointId, position) {
    const point = this.getObject(pointId);
    if (!point || point.type !== "point" || point.definition.kind !== "free") return false;
    point.definition.x = position.x;
    point.definition.y = position.y;
    return true;
  }

  #translationTargets(objectIds) {
    const freePointIds = new Set();
    const positionedIds = new Set();
    const doodleIds = new Set();
    const coordinateSystemIds = new Set();
    const visited = new Set();
    const visitGeometry = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const object = this.getObject(id);
      if (!object || object.locked) return;
      if (object.type === "point" && object.definition.kind === "free") {
        freePointIds.add(object.id);
        return;
      }
      if (object.type === "coordinateSystem") {
        if (object.originPointId) visitGeometry(object.originPointId);
        else coordinateSystemIds.add(object.id);
        return;
      }
      for (const dependency of this.dependenciesOf(object)) visitGeometry(dependency);
    };

    for (const id of [...new Set(Array.isArray(objectIds) ? objectIds : [objectIds])]) {
      const object = this.getObject(id);
      if (!object || object.locked) continue;
      if (TEXT_TYPES.has(object.type) || MEDIA_TYPES.has(object.type)) positionedIds.add(object.id);
      else if (object.type === "doodle") doodleIds.add(object.id);
      else visitGeometry(object.id);
    }
    return { freePointIds, positionedIds, doodleIds, coordinateSystemIds };
  }

  canTranslateObjects(objectIds) {
    const targets = this.#translationTargets(objectIds);
    return Object.values(targets).some((ids) => ids.size > 0);
  }

  translateObjects(objectIds, delta) {
    const dx = Number(delta?.x);
    const dy = Number(delta?.y);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON)) return false;
    const targets = this.#translationTargets(objectIds);
    if (!Object.values(targets).some((ids) => ids.size > 0)) return false;

    for (const id of targets.freePointIds) {
      const point = this.getObject(id);
      point.definition.x += dx;
      point.definition.y += dy;
    }
    for (const id of targets.positionedIds) {
      const object = this.getObject(id);
      object.x += dx;
      object.y += dy;
    }
    for (const id of targets.doodleIds) {
      const doodle = this.getObject(id);
      doodle.points = doodle.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    }
    for (const id of targets.coordinateSystemIds) {
      const system = this.getObject(id);
      system.origin.x += dx;
      system.origin.y += dy;
    }
    return true;
  }

  renamePoint(pointId, label) {
    const point = this.getObject(pointId);
    if (!point || point.type !== "point") return false;
    const normalized = String(label ?? "").trim().slice(0, 12);
    if (!normalized) return false;
    const wasUnnamed = !String(point.label || "").trim();
    point.label = normalized;
    if (wasUnnamed) point.style = { ...(point.style || {}), showLabel: true };
    return true;
  }

  nextAvailablePointLabel(excludePointId = null) {
    const occupied = new Set(this.objects
      .filter((object) => object.type === "point" && object.id !== excludePointId)
      .map((object) => String(object.label || "").trim())
      .filter(Boolean));
    let index = 0;
    while (occupied.has(labelForIndex(index))) index += 1;
    return labelForIndex(index);
  }

  assignNextPointLabel(pointId) {
    const point = this.getObject(pointId);
    if (!point || point.type !== "point") return null;
    if (String(point.label || "").trim()) return point.label;
    point.label = this.nextAvailablePointLabel(point.id);
    point.style = { ...(point.style || {}), showLabel: true };
    return point.label;
  }

  suggestPointLabelOffset(pointId, options = {}) {
    const point = this.getObject(pointId);
    const origin = this.getPointPosition(point);
    if (!point || point.type !== "point" || !origin) return { x: 12, y: -12 };
    const fontSize = Math.max(8, Number(options.fontSize) || 17);
    const width = Math.max(fontSize * 0.58, Array.from(String(point.label || ""))
      .reduce((sum, character) => sum + fontSize * (/\s/.test(character) ? 0.32 : /[A-Z0-9]/.test(character) ? 0.62 : 0.9), 0));
    const centerOffset = { x: width / 2, y: -fontSize * 0.32 };
    const halfDiagonal = Math.hypot(width, fontSize * 1.05) / 2;
    const baseRadius = Math.max(1, Number(options.baseRadius) || 32);
    const margin = 4;
    const directions = [];
    for (const object of this.objects) {
      if (object.hidden || !["segment", "line", "ray"].includes(object.type)) continue;
      const otherId = object.pointAId === point.id ? object.pointBId
        : object.pointBId === point.id ? object.pointAId : null;
      const other = otherId ? this.getPointPosition(otherId) : null;
      if (!other) continue;
      const dx = other.x - origin.x; const dy = other.y - origin.y; const length = Math.hypot(dx, dy);
      if (length <= EPSILON) continue;
      const direction = { x: dx / length, y: dy / length };
      if (!directions.some((candidate) => Math.abs(candidate.x * direction.x + candidate.y * direction.y) > 0.9999)) {
        directions.push(direction);
      }
    }
    let preferred = null;
    if (directions.length === 2) {
      const sum = { x: directions[0].x + directions[1].x, y: directions[0].y + directions[1].y };
      const length = Math.hypot(sum.x, sum.y);
      if (length > EPSILON) preferred = { x: -sum.x / length, y: -sum.y / length };
    }
    const samples = preferred ? [{ ...preferred, preferred: true }] : [];
    for (let index = 0; index < 32; index += 1) {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / 32;
      const direction = { x: Math.cos(angle), y: Math.sin(angle), preferred: false };
      if (!preferred || preferred.x * direction.x + preferred.y * direction.y < 0.999) samples.push(direction);
    }
    const scoreCandidate = (center) => {
      let clearance = Number.POSITIVE_INFINITY;
      for (const other of this.objects) {
        if (other.hidden || other.id === point.id || other.type !== "point") continue;
        const position = this.getPointPosition(other);
        if (!position) continue;
        const available = distance(center, position)
          - halfDiagonal - Math.max(1, Number(other.style?.radius) || 6) - margin;
        if (available < 0) return null;
        clearance = Math.min(clearance, available);
        if (other.style?.showLabel !== false && String(other.label || "").trim()) {
          const otherFontSize = Math.max(8, Number(other.style?.labelFontSize) || fontSize);
          const otherWidth = Math.max(otherFontSize * 0.58, Array.from(String(other.label))
            .reduce((sum, character) => sum + otherFontSize * (/\s/.test(character) ? 0.32 : /[A-Z0-9]/.test(character) ? 0.62 : 0.9), 0));
          const otherHalfDiagonal = Math.hypot(otherWidth, otherFontSize * 1.05) / 2;
          const offset = other.labelOffset || { x: 12, y: -12 };
          const otherCenter = {
            x: position.x + offset.x + otherWidth / 2,
            y: position.y + offset.y - otherFontSize * 0.32,
          };
          const labelClearance = distance(center, otherCenter) - halfDiagonal - otherHalfDiagonal - margin;
          if (labelClearance < 0) return null;
          clearance = Math.min(clearance, labelClearance);
        }
      }
      if (this.hitTestShapes(center, halfDiagonal + margin).some((hit) => !hit.object.hidden)) return null;
      return Number.isFinite(clearance) ? clearance : 1e6;
    };
    const maximumRadius = baseRadius + halfDiagonal;
    const radii = [baseRadius]; const step = Math.max(4, Math.min(8, halfDiagonal / 3 || 4));
    for (let radius = baseRadius + step; radius < maximumRadius; radius += step) radii.push(radius);
    if (maximumRadius > baseRadius + EPSILON) radii.push(maximumRadius);
    for (const radius of radii) {
      const candidates = samples.map((direction) => {
        const center = { x: origin.x + direction.x * radius, y: origin.y + direction.y * radius };
        const clearance = scoreCandidate(center);
        return clearance === null ? null : { direction, center, score: clearance + (direction.preferred ? 6 : 0) };
      }).filter(Boolean).sort((first, second) => second.score - first.score);
      if (candidates.length) return {
        x: candidates[0].center.x - origin.x - centerOffset.x,
        y: candidates[0].center.y - origin.y - centerOffset.y,
      };
    }
    return { x: 12, y: -12 };
  }

  setPointLabelOffset(pointId, offset, baseRadius = 64, labelGeometry = null) {
    const point = this.getObject(pointId);
    if (!point || point.type !== "point") return false;
    const centerOffset = {
      x: Number(labelGeometry?.centerOffset?.x) || 0,
      y: Number(labelGeometry?.centerOffset?.y) || 0,
    };
    const halfDiagonal = Math.max(0, Number(labelGeometry?.halfDiagonal) || 0);
    const desiredCenter = {
      x: Number(offset.x) + centerOffset.x,
      y: Number(offset.y) + centerOffset.y,
    };
    if (!Number.isFinite(desiredCenter.x) || !Number.isFinite(desiredCenter.y)) return false;
    const maximumCenterDistance = Math.max(0, Number(baseRadius) || 0) + halfDiagonal;
    const centerDistance = Math.hypot(desiredCenter.x, desiredCenter.y);
    const factor = centerDistance > maximumCenterDistance
      ? maximumCenterDistance / centerDistance
      : 1;
    const clampedCenter = {
      x: desiredCenter.x * factor,
      y: desiredCenter.y * factor,
    };
    point.labelOffset = {
      x: clampedCenter.x - centerOffset.x,
      y: clampedCenter.y - centerOffset.y,
    };
    return true;
  }

  getFreePointDependencyIds(objectIds) {
    const result = new Set();
    const visited = new Set();
    const visit = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const object = this.getObject(id);
      if (!object) return;
      if (object.type === "point" && object.definition.kind === "free") {
        result.add(object.id);
        return;
      }
      for (const dependency of this.dependenciesOf(object)) visit(dependency);
    };
    for (const id of Array.isArray(objectIds) ? objectIds : [objectIds]) visit(id);
    return [...result];
  }

  hitTest(position, tolerance = 10) {
    const shapeHits = new Map(this.hitTestShapes(position, tolerance)
      .map((hit) => [hit.object.id, hit]));
    const paintOrder = this.objectsInPaintOrder();
    const paintIndex = new Map(paintOrder.map((object, index) => [object.id, index]));
    const candidates = [];
    const rectangleDistance = (left, top, right, bottom) => {
      const dx = Math.max(left - position.x, 0, position.x - right);
      const dy = Math.max(top - position.y, 0, position.y - bottom);
      return Math.hypot(dx, dy);
    };
    for (const object of paintOrder) {
      if (object.hidden) continue;
      if (object.type === "point") {
        const point = this.getPointPosition(object);
        if (!point) continue;
        const centerDistance = distance(position, point);
        const radius = Number(object.style?.radius) || 6;
        const threshold = Math.max(tolerance, radius + 4);
        if (centerDistance <= threshold) candidates.push({
          object, distance: Math.max(0, centerDistance - radius), paintIndex: paintIndex.get(object.id),
        });
      } else if (object.type === "image") {
        const hitDistance = rectangleDistance(object.x, object.y, object.x + object.width, object.y + object.height);
        if (hitDistance <= tolerance) candidates.push({ object, distance: hitDistance, paintIndex: paintIndex.get(object.id) });
      } else if (TEXT_TYPES.has(object.type)) {
        const fontSize = Number(object.style?.fontSize) || 18;
        const content = object.type === "measurement" ? this.getMeasurementText(object) || ""
          : ["parameter", "calculation"].includes(object.type) ? this.getValueText(object) || ""
            : object.type === "table" ? (this.getTableData(object)?.rows || []).map((row) => row.join("  ")).join("\n")
              : object.type === "actionButton" ? object.label : object.content;
        const visibleContent = plainMathText(content, { enableScripts: true });
        const lines = String(visibleContent).split(/\r?\n/);
        const longestLine = lines.reduce((longest, line) => Math.max(longest, line.length), 0);
        const actionWidth = Math.max(72, String(visibleContent).length * fontSize * 0.9 + 24);
        const width = object.type === "actionButton" ? actionWidth : Math.max(fontSize, longestLine * fontSize * 0.58);
        const left = object.type === "actionButton" ? object.x - 12 : object.x;
        const top = object.type === "actionButton" ? object.y - fontSize - 8 : object.y - fontSize;
        const bottom = object.type === "actionButton"
          ? object.y + 10
          : object.y + Math.max(0, lines.length - 1) * fontSize * 1.35 + fontSize * 0.3;
        const hitDistance = rectangleDistance(left, top, left + width, bottom);
        if (hitDistance <= tolerance) candidates.push({ object, distance: hitDistance, paintIndex: paintIndex.get(object.id) });
      } else if (shapeHits.has(object.id)) {
        const hit = shapeHits.get(object.id);
        candidates.push({
          object,
          distance: Math.max(0, hit.distance - (Number(object.style?.width) || 2) / 2),
          paintIndex: paintIndex.get(object.id),
        });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || b.paintIndex - a.paintIndex);
    if (!candidates.length) return null;
    return { object: candidates[0].object, distance: candidates[0].distance };
  }

  hitTestPoint(position, tolerance = 10) {
    let best = null;
    const paintIndex = new Map(this.objectsInPaintOrder().map((object, index) => [object.id, index]));
    for (const object of this.objects) {
      if (object.hidden || object.type !== "point") continue;
      const point = this.getPointPosition(object);
      if (!point) continue;
      const hitDistance = distance(position, point);
      const threshold = Math.max(tolerance, Number(object.style?.radius) + 4);
      if (hitDistance > threshold) continue;
      if (!best || hitDistance < best.distance ||
        (Math.abs(hitDistance - best.distance) <= EPSILON && paintIndex.get(object.id) > paintIndex.get(best.object.id))) {
        best = { object, distance: hitDistance };
      }
    }
    return best;
  }

  hitTestShape(position, tolerance = 10) {
    return this.hitTestShapes(position, tolerance)[0] || null;
  }

  hitTestShapes(position, tolerance = 10) {
    const hits = [];
    const paintIndex = new Map(this.objectsInPaintOrder().map((object, index) => [object.id, index]));
    for (const object of this.objects) {
      if (object.hidden || !SHAPE_TYPES.has(object.type)) continue;
      const geometry = this.getShapeGeometry(object);
      if (!geometry) continue;
      let hitDistance;
      if (geometry.kind === "line") {
        hitDistance = projectPointToLine(
          position, geometry.a, geometry.b, geometry.segment, geometry.ray,
        ).distance;
      } else if (geometry.kind === "pathMark") {
        hitDistance = distance(position, geometry.center);
      } else if (geometry.kind === "doodle") {
        hitDistance = Number.POSITIVE_INFINITY;
        for (let index = 0; index < geometry.points.length - 1; index += 1) {
          hitDistance = Math.min(hitDistance, projectPointToLine(
            position, geometry.points[index], geometry.points[index + 1], true,
          ).distance);
        }
      } else if (geometry.kind === "arc") {
        const radial = Math.abs(distance(position, geometry.center) - geometry.radius);
        hitDistance = pointOnArcGeometry(position, geometry, 0.08) ? radial : Number.POSITIVE_INFINITY;
      } else if (geometry.kind === "circleInterior") {
        hitDistance = Math.max(0, distance(position, geometry.center) - geometry.radius);
      } else if (geometry.kind === "arcInterior") {
        const radial = distance(position, geometry.center);
        const withinArc = radial <= EPSILON || pointOnArcGeometry(position, geometry, 0);
        if (geometry.interiorKind === "sector") {
          const inside = radial <= geometry.radius && withinArc;
          const boundaryDistances = [
            projectPointToLine(position, geometry.center, geometry.start, true).distance,
            projectPointToLine(position, geometry.center, geometry.end, true).distance,
          ];
          if (withinArc) boundaryDistances.push(Math.abs(radial - geometry.radius));
          hitDistance = inside ? 0 : Math.min(...boundaryDistances);
        } else {
          const chord = { x: geometry.end.x - geometry.start.x, y: geometry.end.y - geometry.start.y };
          const middleAngle = geometry.startAngle + geometry.signedAngle / 2;
          const middle = {
            x: geometry.center.x + Math.cos(middleAngle) * geometry.radius,
            y: geometry.center.y + Math.sin(middleAngle) * geometry.radius,
          };
          const side = (point) => chord.x * (point.y - geometry.start.y) - chord.y * (point.x - geometry.start.x);
          const inside = radial <= geometry.radius && side(position) * side(middle) >= 0;
          const chordDistance = projectPointToLine(position, geometry.start, geometry.end, true).distance;
          const arcDistance = withinArc ? Math.abs(radial - geometry.radius) : Number.POSITIVE_INFINITY;
          hitDistance = inside ? 0 : Math.min(chordDistance, arcDistance);
        }
      } else if (geometry.kind === "plot") {
        hitDistance = Number.POSITIVE_INFINITY;
        for (const path of geometry.paths) {
          for (let index = 0; index < path.length - 1; index += 1) {
            hitDistance = Math.min(hitDistance, projectPointToLine(position, path[index], path[index + 1], true).distance);
          }
        }
      } else if (geometry.kind === "coordinateSystem") {
        hitDistance = Math.min(Math.abs(position.x - geometry.origin.x), Math.abs(position.y - geometry.origin.y));
      } else if (geometry.kind === "angleMark") {
        const currentAngle = Math.atan2(position.y - geometry.vertex.y, position.x - geometry.vertex.x);
        const progress = normalizeAngle(currentAngle - geometry.startAngle);
        const radialDistance = distance(position, geometry.vertex);
        if (geometry.rightAngle) {
          const polygon = [geometry.vertex, geometry.start, geometry.corner, geometry.end];
          let inside = false;
          for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
            const a = polygon[index];
            const b = polygon[previous];
            if ((a.y > position.y) !== (b.y > position.y) &&
              position.x < (b.x - a.x) * (position.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
          }
          hitDistance = inside ? 0 : Math.min(...polygon.map((point, index) =>
            projectPointToLine(position, point, polygon[(index + 1) % polygon.length], true).distance
          ));
        } else {
          const withinAngle = radialDistance <= EPSILON || progress <= geometry.signedAngle;
          const inside = radialDistance <= geometry.radius && withinAngle;
          const boundaryDistances = [
            projectPointToLine(position, geometry.vertex, geometry.start, true).distance,
            projectPointToLine(position, geometry.vertex, geometry.end, true).distance,
          ];
          if (withinAngle) boundaryDistances.push(Math.abs(radialDistance - geometry.radius));
          hitDistance = inside ? 0 : Math.min(...boundaryDistances);
        }
      } else {
        hitDistance = Math.abs(distance(position, geometry.center) - geometry.radius);
      }
      const threshold = tolerance + (Number(object.style?.width) || 2) / 2;
      if (hitDistance <= threshold) hits.push({ object, distance: hitDistance });
    }
    return hits.sort((a, b) => a.distance - b.distance ||
      (paintIndex.get(b.object.id) || 0) - (paintIndex.get(a.object.id) || 0));
  }

  findNearbyIntersections(position, tolerance = 15) {
    const nearby = this.hitTestShapes(position, tolerance);
    const candidates = [];
    for (let firstIndex = 0; firstIndex < nearby.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < nearby.length; secondIndex += 1) {
        const parents = [nearby[firstIndex].object.id, nearby[secondIndex].object.id];
        const intersections = this.getIntersections(parents[0], parents[1]);
        intersections.forEach((intersection, branch) => {
          const hitDistance = distance(position, intersection);
          if (hitDistance <= tolerance) candidates.push({
            parents, branch, position: intersection, distance: hitDistance,
          });
        });
      }
    }
    return candidates.sort((first, second) => first.distance - second.distance || first.branch - second.branch);
  }

  findNearestIntersection(position, tolerance = 15) {
    return this.findNearbyIntersections(position, tolerance)[0] || null;
  }

  findCoincidentPoint(position, tolerance = 1e-6) {
    const coordinateScale = Math.max(1, Math.abs(position.x), Math.abs(position.y));
    const threshold = Math.max(Number(tolerance) || 0, EPSILON * 64 * coordinateScale);
    const paintIndex = new Map(this.paintOrder.map((id, index) => [id, index]));
    return this.objects
      .filter((object) => object.type === "point" && !object.hidden)
      .map((object) => ({ object, position: this.getPointPosition(object) }))
      .filter((entry) => entry.position && distance(entry.position, position) <= threshold)
      .sort((first, second) =>
        Number(this.isPointDirectlyMovable(second.object))
          - Number(this.isPointDirectlyMovable(first.object))
        || (paintIndex.get(second.object.id) || 0) - (paintIndex.get(first.object.id) || 0)
      )[0]?.object || null;
  }

  objectsInRect(rectangle) {
    const rect = {
      left: Math.min(rectangle.x1, rectangle.x2),
      right: Math.max(rectangle.x1, rectangle.x2),
      top: Math.min(rectangle.y1, rectangle.y2),
      bottom: Math.max(rectangle.y1, rectangle.y2),
    };
    const contains = (point) => point && point.x >= rect.left && point.x <= rect.right &&
      point.y >= rect.top && point.y <= rect.bottom;
    const corners = [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.right, y: rect.bottom },
      { x: rect.left, y: rect.bottom },
    ];
    const edges = corners.map((corner, index) => ({
      kind: "line",
      a: corner,
      b: corners[(index + 1) % corners.length],
      segment: true,
    }));

    return this.objects.filter((object) => {
      if (object.hidden) return false;
      if (object.type === "image") return contains({ x: object.x, y: object.y }) || contains({ x: object.x + object.width, y: object.y + object.height });
      if (TEXT_TYPES.has(object.type)) return contains({ x: object.x, y: object.y });
      if (object.type === "point") return contains(this.getPointPosition(object));
      const geometry = this.getShapeGeometry(object);
      if (!geometry) return false;
      if (geometry.kind === "line") {
        if (contains(geometry.a) || contains(geometry.b)) return true;
        return edges.some((edge) => intersectGeometries(geometry, edge).length > 0);
      }
      if (geometry.kind === "pathMark") return contains(geometry.center);
      if (geometry.kind === "coordinateSystem") return contains(geometry.origin);
      if (geometry.kind === "plot") {
        return geometry.paths.some((path) => path.some(contains) || path.slice(0, -1).some((point, index) => {
          const section = { kind: "line", a: point, b: path[index + 1], segment: true };
          return edges.some((edge) => intersectGeometries(section, edge).length > 0);
        }));
      }
      if (geometry.kind === "doodle") {
        if (geometry.points.some(contains)) return true;
        return geometry.points.slice(0, -1).some((point, index) => {
          const section = { kind: "line", a: point, b: geometry.points[index + 1], segment: true };
          return edges.some((edge) => intersectGeometries(section, edge).length > 0);
        });
      }
      if (geometry.kind === "arc" || geometry.kind === "arcInterior") {
        return [geometry.start, geometry.end, geometry.center].some(contains) || edges.some((edge) =>
          intersectGeometries(edge, { kind: "circle", center: geometry.center, radius: geometry.radius })
            .some((point) => pointOnArcGeometry(point, geometry))
        );
      }
      if (geometry.kind === "circleInterior") {
        if (contains(geometry.center)) return true;
        return edges.some((edge) => intersectGeometries(edge, {
          kind: "circle", center: geometry.center, radius: geometry.radius,
        }).length > 0);
      }
      if (geometry.kind === "angleMark") {
        return [geometry.vertex, geometry.start, geometry.corner, geometry.end].some(contains);
      }
      if (contains(geometry.center)) return true;
      return edges.some((edge) => intersectGeometries(edge, geometry).length > 0);
    });
  }

  dependenciesOf(object) {
    if (!object) return [];
    if (object.type === "image") return [];
    if (object.type === "text" || object.type === "parameter") return [];
    if (object.type === "measurement") return [...object.parents];
    if (object.type === "actionButton") return [...object.targetIds];
    if (object.type === "calculation") return [...new Set(Object.values(object.variables || {}))];
    if (object.type === "table") return [...object.sourceIds];
    if (object.type === "point") {
      if (object.definition.kind === "midpoint") return [...object.definition.parents];
      if (object.definition.kind === "circumcenter") return [...object.definition.parents];
      if (object.definition.kind === "incenter") return [...object.definition.parents];
      if (object.definition.kind === "centroid") return [...object.definition.parents];
      if (object.definition.kind === "orthocenter") return [...object.definition.parents];
      if (object.definition.kind === "angle-circle-center") {
        return [
          object.definition.vertexId,
          object.definition.pointAId,
          object.definition.pointBId,
          object.definition.outerCircleId,
        ];
      }
      if (object.definition.kind === "internal-tangency") return [...object.definition.parents];
      if (object.definition.kind === "translated") return [object.definition.parentId];
      if (object.definition.kind === "rotated" || object.definition.kind === "scaled") {
        return [object.definition.parentId, object.definition.centerId];
      }
      if (object.definition.kind === "reflected") return [object.definition.parentId, object.definition.mirrorId];
      if (object.definition.kind === "inverted") return [object.definition.parentId, object.definition.circleId];
      if (object.definition.kind === "on-shape") return [object.definition.parentId];
      if (object.definition.kind === "plotted") {
        return [object.definition.coordinateSystemId, ...new Set(Object.values(object.definition.variables || {}))];
      }
      if (object.definition.kind === "intersection") return [...object.definition.parents];
      if (object.definition.kind === "other-intersection") {
        return [...object.definition.parents, object.definition.knownPointId];
      }
      return [];
    }
    if (object.type === "circle") return [object.centerId, object.throughId];
    if (object.type === "coordinateSystem") return object.originPointId ? [object.originPointId] : [];
    if (object.type === "functionGraph" || object.type === "parametricPlot") {
      return [object.coordinateSystemId, ...new Set(Object.values(object.variables || {}))];
    }
    if (object.type === "locus") return [object.tracedPointId, object.driverPointId];
    if (object.type === "transformedShape") {
      const dependencies = [object.parentShapeId];
      if (object.transform?.centerId) dependencies.push(object.transform.centerId);
      if (object.transform?.mirrorId) dependencies.push(object.transform.mirrorId);
      if (object.transform?.circleId) dependencies.push(object.transform.circleId);
      return dependencies;
    }
    if (object.type === "radiusCircle") return [object.centerId, object.radiusSegmentId];
    if (object.type === "arc") return [object.circleId, object.startPointId, object.endPointId];
    if (object.type === "threePointArc") return [object.pointAId, object.pointBId, object.pointCId];
    if (object.type === "circleInterior") return [object.circleId];
    if (object.type === "sectorInterior" || object.type === "segmentInterior") return [object.arcId];
    if (object.type === "threePointCircle") {
      return [object.pointAId, object.pointBId, object.pointCId, object.centerPointId].filter(Boolean);
    }
    if (object.type === "incircle") {
      return [object.pointAId, object.pointBId, object.pointCId, object.centerPointId].filter(Boolean);
    }
    if (["segment", "line", "ray", "perpendicularBisector"].includes(object.type)) {
      return [object.pointAId, object.pointBId];
    }
    if (object.type === "angleMark" && object.sideAId && object.sideBId) {
      return [object.vertexId, object.sideAId, object.sideBId, object.directionPointId].filter(Boolean);
    }
    if (object.type === "pathMark") return [object.parentShapeId];
    if (object.type === "doodle") return [];
    if (object.type === "angleBisector" || object.type === "angleMark") {
      return [object.vertexId, object.pointAId, object.pointBId];
    }
    if (object.type === "parallelLine" || object.type === "perpendicularLine") {
      return [object.pointId, object.parentLineId];
    }
    return [];
  }

  removeWithDependents(id) {
    const target = this.getObject(id);
    const ownedCenterId = ["threePointCircle", "incircle"].includes(target?.type)
      && this.getObject(target.centerPointId)?.type === "point"
      ? target.centerPointId
      : null;
    const removed = new Set();
    const visit = (targetId) => {
      if (removed.has(targetId)) return;
      removed.add(targetId);
      for (const object of this.objects) {
        if (this.dependenciesOf(object).includes(targetId)) visit(object.id);
      }
    };
    visit(id);
    if (ownedCenterId) visit(ownedCenterId);
    this.objects = this.objects.filter((object) => !removed.has(object.id));
    this.paintOrder = this.paintOrder.filter((id) => !removed.has(id));
    if (this.markedCenterId && removed.has(this.markedCenterId)) this.markedCenterId = null;
    if (this.markedMirrorId && removed.has(this.markedMirrorId)) this.markedMirrorId = null;
    if (this.markedInversionCircleId && removed.has(this.markedInversionCircleId)) this.markedInversionCircleId = null;
    return [...removed];
  }

  applyStyle(id, settings) {
    const object = this.getObject(id);
    if (!object) return false;
    object.style = object.type === "point" ? defaultPointStyle(settings)
      : MEDIA_TYPES.has(object.type) ? object.style || {}
        : TEXT_TYPES.has(object.type) ? {
        ...object.style,
        color: settings.lineColor || object.style?.color || "#334155",
        fontSize: Number(object.style?.fontSize) || Number(settings.textFontSize ?? settings.textSize) || 16,
      }
        : defaultShapeStyle(settings);
    return true;
  }

  applyStylePatch(id, patch = {}) {
    const object = this.getObject(id);
    if (!object) return false;
    const style = { ...(object.style || {}) };
    if (typeof patch.color === "string" && patch.color) style.color = patch.color;
    if (object.type === "point") {
      if (Number.isFinite(Number(patch.radius))) style.radius = Math.max(1, Number(patch.radius));
      if (typeof patch.showLabel === "boolean") style.showLabel = patch.showLabel;
    } else if (TEXT_TYPES.has(object.type)) {
      if (Number.isFinite(Number(patch.fontSize))) style.fontSize = Math.max(1, Number(patch.fontSize));
    } else if (SHAPE_TYPES.has(object.type)) {
      if (Number.isFinite(Number(patch.width))) style.width = Math.max(0.5, Number(patch.width));
      if (["solid", "dashed"].includes(patch.dash)) style.dash = patch.dash;
    }
    object.style = style;
    return true;
  }

  toJSON() {
    this.#normalizePaintOrder();
    return {
      version: this.version,
      title: this.title,
      nextId: this.nextId,
      nextLabel: this.nextLabel,
      markedCenterId: this.markedCenterId,
      markedMirrorId: this.markedMirrorId,
      markedInversionCircleId: this.markedInversionCircleId,
      paintOrder: [...this.paintOrder],
      objects: clone(this.objects),
    };
  }

  serialize() {
    return JSON.stringify(this.toJSON());
  }

  static fromJSON(data) {
    return new GeometryDocument(typeof data === "string" ? JSON.parse(data) : data);
  }
}
