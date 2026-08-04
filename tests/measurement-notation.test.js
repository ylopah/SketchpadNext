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

const CJK = /[\u3400-\u9fff]/;

function createFixture() {
  const document = new GeometryDocument();
  const point = (label, x, y) => document.addFreePoint({ x, y }, settings, label);
  const a = point("A", 0, 0);
  const b = point("B", 200, 0);
  const c = point("C", 0, 150);
  const d = point("D", 100, 0);
  const e = point("E", 0, 200);
  const segmentAB = document.addSegment(a.id, b.id, settings);
  const segmentAC = document.addSegment(a.id, c.id, settings);
  const lineBC = document.addLine(b.id, c.id, settings);
  const circle = document.addCircle(a.id, b.id, settings);
  const arc = document.addArcOnCircle(circle.id, b.id, e.id, settings);
  const driver = document.addPointOnShape(segmentAB.id, { x: 100, y: 0 }, settings);
  assert.equal(document.renamePoint(driver.id, "F"), true);
  const system = document.addCoordinateSystem(a.id, settings, { unitX: 500, unitY: 500 });
  return {
    document, a, b, c, d, e, segmentAB, segmentAC, lineBC, circle, arc, driver, system,
  };
}

test("every measurement kind uses concise mathematical notation without CJK boilerplate", async (t) => {
  const fixture = createFixture();
  const { document, a, b, c, d, segmentAB, segmentAC, lineBC, circle, arc, driver, system } = fixture;
  const cases = [
    ["distance", [a.id, b.id], "AB = 4.00 cm"],
    ["pointLineDistance", [c.id, segmentAB.id], "d(C,\\overline{AB}) = 3.00 cm"],
    ["polygonArea", [a.id, b.id, c.id], "S(ABC) = 6.00 cm^2"],
    ["polygonPerimeter", [a.id, b.id, c.id], "P(ABC) = 12.00 cm"],
    ["collinearity", [a.id, b.id, d.id], "ε_{col}(A,B,D) = 0.000e+0 cm"],
    ["pointCircleError", [c.id, circle.id], "ε(C,⊙A) = 1.000e+0 cm"],
    ["length", [segmentAB.id], "\\overline{AB} = 4.00 cm"],
    ["arcLength", [arc.id], "⌢BE = 6.28 cm"],
    ["ratio", [segmentAB.id, segmentAC.id], "\\overline{AB}/\\overline{AC} = 1.33"],
    ["angle", [b.id, a.id, c.id], "∠BAC = 90.00°"],
    ["radius", [circle.id], "r(⊙A) = 4.00 cm"],
    ["circumference", [circle.id], "C(⊙A) = 25.13 cm"],
    ["circleArea", [circle.id], "S(⊙A) = 50.27 cm^2"],
    ["coordinates", [b.id, system.id], "B = (0.40, 0.00)"],
    ["coordinateX", [b.id, system.id], "x(B) = 0.40"],
    ["coordinateY", [b.id, system.id], "y(B) = 0.00"],
    ["slope", [lineBC.id], "k(BC) = 0.75"],
    ["pointValue", [driver.id], "t(F) = 0.50"],
  ];

  for (const [kind, parents, expected] of cases) {
    await t.test(kind, () => {
      const measurement = document.addMeasurement(kind, parents, { x: 0, y: 0 }, settings);
      assert.ok(measurement, kind + " should create a measurement");
      const actual = document.getMeasurementText(measurement);
      assert.equal(actual, expected, kind);
      assert.doesNotMatch(actual, CJK, kind + " should not contain CJK boilerplate");
    });
  }
});

test("arc-angle notation names the measured arc without descriptive prose", () => {
  const { document, arc } = createFixture();
  const measurement = document.addMeasurement("angle", [arc.id], { x: 0, y: 0 }, settings);
  assert.ok(measurement);
  assert.equal(document.getMeasurementText(measurement), "m(⌢BE) = 90.00°");
  assert.doesNotMatch(document.getMeasurementText(measurement), CJK);
});

test("measurements assign the first available visible label instead of inventing P_i tokens", () => {
  const document = new GeometryDocument();
  const anonymous = document.addFreePoint({ x: 0, y: 0 }, settings, "A");
  anonymous.label = "";
  const b = document.addFreePoint({ x: 150, y: 200 }, settings, "B");
  const measurement = document.addMeasurement("distance", [anonymous.id, b.id], { x: 0, y: 0 }, settings);
  assert.ok(measurement);
  assert.equal(anonymous.label, "A");
  assert.equal(anonymous.style.showLabel, true);
  assert.equal(document.getMeasurementText(measurement), "AB = 5.00 cm");
  assert.doesNotMatch(document.getMeasurementText(measurement), /P_/);

  document.addFreePoint({ x: 20, y: 20 }, settings, "Z");
  assert.equal(document.getMeasurementText(measurement), "AB = 5.00 cm");
  assert.equal(document.renamePoint(anonymous.id, "Q"), true);
  assert.equal(document.getMeasurementText(measurement), "QB = 5.00 cm");
});

test("point distance and segment length remain distinct while ratio decorates both segments", () => {
  const { document, a, b, segmentAB, segmentAC } = createFixture();
  const distance = document.addMeasurement("distance", [a.id, b.id], { x: 0, y: 0 }, settings);
  const length = document.addMeasurement("length", [segmentAB.id], { x: 0, y: 0 }, settings);
  const ratio = document.addMeasurement("ratio", [segmentAB.id, segmentAC.id], { x: 0, y: 0 }, settings);
  const distanceText = document.getMeasurementText(distance);
  const lengthText = document.getMeasurementText(length);
  const ratioText = document.getMeasurementText(ratio);

  assert.equal(distanceText, "AB = 4.00 cm");
  assert.doesNotMatch(distanceText, /\\overline/);
  assert.equal(lengthText, "\\overline{AB} = 4.00 cm");
  assert.equal(ratioText.match(/\\overline/g)?.length, 2);
});

test("slope notation uses the two nearest visible on-line points and creates only missing points", () => {
  const document = new GeometryDocument();
  const unnamedSettings = { ...settings, autoNamePoints: false };
  const baseA = document.addFreePoint({ x: 0, y: 0 }, unnamedSettings);
  const baseB = document.addFreePoint({ x: 500, y: 0 }, unnamedSettings);
  const through = document.addFreePoint({ x: 0, y: 100 }, unnamedSettings);
  const base = document.addLine(baseA.id, baseB.id, unnamedSettings);
  const parallel = document.addParallelLine(through.id, base.id, unnamedSettings);
  const hidden = document.addPointOnShape(parallel.id, { x: 40, y: 100 }, unnamedSettings);
  hidden.hidden = true;
  const pointCount = document.objects.filter((object) => object.type === "point").length;

  const slope = document.addMeasurement("slope", [parallel.id], { x: 0, y: 0 }, {
    ...unnamedSettings,
    selectionAnchor: { x: 2, y: 100 },
  });
  const pair = slope.notationRefs.linePointPairs[0].pointIds;
  assert.equal(document.objects.filter((object) => object.type === "point").length, pointCount + 1);
  assert.equal(pair.includes(through.id), true);
  assert.equal(pair.includes(hidden.id), false);
  assert.deepEqual(pair.map((id) => document.getObject(id).label), ["A", "B"]);
  assert.ok(pair.every((id) => document.getObject(id).style.showLabel));
  assert.equal(document.getMeasurementText(slope), "k(AB) = 0.00");

  const c = document.addFreePoint({ x: 250, y: 0 }, settings, "C");
  const d = document.addFreePoint({ x: 300, y: 0 }, settings, "D");
  document.addFreePoint({ x: 400, y: 0 }, settings, "E");
  const baseSlope = document.addMeasurement("slope", [base.id], { x: 0, y: 0 }, {
    ...settings,
    selectionAnchor: { x: 280, y: 0 },
  });
  assert.deepEqual(baseSlope.notationRefs.linePointPairs[0].pointIds, [d.id, c.id]);
  assert.equal(document.getMeasurementText(baseSlope), "k(DC) = 0.00");
});

test("slope keeps existing named points even when an anonymous on-line point is closer", () => {
  const document = new GeometryDocument();
  const a = document.addFreePoint({ x: 0, y: 0 }, settings, "A");
  const b = document.addFreePoint({ x: 500, y: 0 }, settings, "B");
  const line = document.addLine(a.id, b.id, settings);
  const anonymous = document.addPointOnShape(line.id, { x: 250, y: 0 }, {
    ...settings,
    autoNamePoints: false,
  });
  const slope = document.addMeasurement("slope", [line.id], { x: 0, y: 0 }, {
    ...settings,
    selectionAnchor: { x: 250, y: 0 },
  });

  assert.deepEqual(slope.notationRefs.linePointPairs[0].pointIds, [a.id, b.id]);
  assert.equal(anonymous.label, "");
  assert.equal(document.getMeasurementText(slope), "k(AB) = 0.00");
});

test("circle and angle measurements expose real labels in notation order", () => {
  const document = new GeometryDocument();
  const unnamedSettings = { ...settings, autoNamePoints: false };
  const vertex = document.addFreePoint({ x: 0, y: 0 }, unnamedSettings);
  const first = document.addFreePoint({ x: 200, y: 0 }, unnamedSettings);
  const second = document.addFreePoint({ x: 0, y: 200 }, unnamedSettings);
  const circle = document.addThreePointCircle(vertex.id, first.id, second.id, unnamedSettings);
  const center = document.getObject(circle.centerPointId);
  assert.equal(center.style.showLabel, false);
  const radius = document.addMeasurement("radius", [circle.id], { x: 0, y: 0 }, unnamedSettings);
  assert.equal(center.label, "A");
  assert.equal(center.style.showLabel, true);
  assert.equal(radius.notationRefs.circleCenters[0].pointId, center.id);
  assert.equal(document.getMeasurementText(radius), "r(⊙A) = 2.83 cm");

  const sideA = document.addSegment(vertex.id, first.id, unnamedSettings);
  const sideB = document.addSegment(vertex.id, second.id, unnamedSettings);
  const mark = document.addAngleMarkFromSides(vertex.id, sideA.id, 1, sideB.id, 1, unnamedSettings);
  const angle = document.addMeasurement("angle", [mark.id], { x: 0, y: 20 }, unnamedSettings);
  const angleIds = angle.notationRefs.anglePointIds;
  assert.deepEqual(angleIds, [mark.pointAId, vertex.id, mark.pointBId]);
  assert.deepEqual(angleIds.map((id) => document.getObject(id).label), ["B", "C", "D"]);
  assert.equal(document.getMeasurementText(angle), "∠BCD = 90.00°");
  assert.doesNotMatch(document.getMeasurementText(angle), /P_/);
});

test("measurement units and notation references persist, remap on import, and remain dependencies", () => {
  const source = new GeometryDocument();
  const unnamedSettings = { ...settings, autoNamePoints: false };
  const a = source.addFreePoint({ x: 0, y: 0 }, unnamedSettings);
  const b = source.addFreePoint({ x: 500, y: 0 }, unnamedSettings);
  const through = source.addFreePoint({ x: 0, y: 100 }, unnamedSettings);
  const base = source.addLine(a.id, b.id, unnamedSettings);
  const parallel = source.addParallelLine(through.id, base.id, unnamedSettings);
  const slope = source.addMeasurement("slope", [parallel.id], { x: 10, y: 10 }, {
    ...unnamedSettings,
    selectionAnchor: { x: 0, y: 100 },
  });
  const distance = source.addMeasurement("distance", [a.id, b.id], { x: 10, y: 30 }, unnamedSettings);
  assert.equal(distance.lengthUnit, "cm");
  assert.equal(distance.worldUnitsPerCentimeter, 50);
  assert.equal(source.getMeasurementValue(distance), 10);
  assert.equal(source.getMeasurementText(distance), "CD = 10.00 cm");

  const restored = GeometryDocument.fromJSON(source.serialize());
  assert.deepEqual(restored.getObject(slope.id).notationRefs, slope.notationRefs);
  assert.deepEqual(
    new Set(restored.dependenciesOf(restored.getObject(slope.id))),
    new Set([parallel.id, ...slope.notationRefs.linePointPairs[0].pointIds]),
  );

  const target = new GeometryDocument();
  const [imported] = target.importObjects(source, [slope.id], { x: 20, y: 20 });
  const importedPair = imported.notationRefs.linePointPairs[0].pointIds;
  assert.notEqual(imported.id, slope.id);
  assert.ok(importedPair.every((id) => target.getObject(id)?.type === "point"));
  assert.ok(importedPair.every((id) => target.getObject(id).style.showLabel));
  assert.ok(importedPair.every((id) => target.dependenciesOf(imported).includes(id)));
  assert.doesNotMatch(target.getMeasurementText(imported), /P_/);

  const legacyData = source.toJSON();
  const legacyDistance = legacyData.objects.find((object) => object.id === distance.id);
  delete legacyDistance.lengthUnit;
  delete legacyDistance.worldUnitsPerCentimeter;
  const legacy = GeometryDocument.fromJSON(legacyData);
  assert.equal(legacy.getMeasurementValue(distance.id), 10);
  assert.equal(legacy.getMeasurementText(distance.id), "CD = 10.00 cm");
});

test("legacy slope, angle, and circle measurements migrate once to real notation references", () => {
  const source = new GeometryDocument();
  const unnamedSettings = { ...settings, autoNamePoints: false };
  const lineA = source.addFreePoint({ x: 0, y: 0 }, unnamedSettings);
  const lineB = source.addFreePoint({ x: 200, y: 100 }, unnamedSettings);
  const line = source.addLine(lineA.id, lineB.id, unnamedSettings);

  const vertex = source.addFreePoint({ x: 400, y: 0 }, unnamedSettings);
  const angleA = source.addFreePoint({ x: 500, y: 0 }, unnamedSettings);
  const angleB = source.addFreePoint({ x: 400, y: 100 }, unnamedSettings);
  const sideA = source.addSegment(vertex.id, angleA.id, unnamedSettings);
  const sideB = source.addSegment(vertex.id, angleB.id, unnamedSettings);
  const mark = source.addAngleMarkFromSides(vertex.id, sideA.id, 1, sideB.id, 1, unnamedSettings);

  const circleA = source.addFreePoint({ x: 700, y: 0 }, unnamedSettings);
  const circleB = source.addFreePoint({ x: 800, y: 0 }, unnamedSettings);
  const circleC = source.addFreePoint({ x: 700, y: 100 }, unnamedSettings);
  const circle = source.addThreePointCircle(circleA.id, circleB.id, circleC.id, unnamedSettings);
  const removedCenterId = circle.centerPointId;

  const data = source.toJSON();
  const serializedCircle = data.objects.find((object) => object.id === circle.id);
  delete serializedCircle.centerPointId;
  data.objects = data.objects.filter((object) => object.id !== removedCenterId);
  data.paintOrder = data.paintOrder.filter((id) => id !== removedCenterId);
  const appendLegacyMeasurement = (measurementKind, parents, x, notationRefs) => {
    const measurement = {
      id: `obj-${data.nextId++}`,
      type: "measurement",
      measurementKind,
      parents,
      x,
      y: 200,
      style: { color: "#334155", fontSize: 16 },
    };
    if (notationRefs) measurement.notationRefs = notationRefs;
    data.objects.push(measurement);
    return measurement;
  };
  const preservedRefs = {
    pointIds: [],
    linePointPairs: [{ objectId: line.id, pointIds: [lineA.id, lineB.id] }],
    circleCenters: [],
    arcPointSequences: [],
    anglePointIds: [],
  };
  const preserved = appendLegacyMeasurement("slope", [line.id], 20, preservedRefs);
  const legacySlope = appendLegacyMeasurement("slope", [line.id], 40);
  const legacyAngle = appendLegacyMeasurement("angle", [mark.id], 60);
  const legacyCircle = appendLegacyMeasurement("radius", [circle.id], 80);

  const restored = GeometryDocument.fromJSON(data);
  assert.deepEqual(restored.getObject(preserved.id).notationRefs, preservedRefs);
  for (const id of [preserved.id, legacySlope.id, legacyAngle.id, legacyCircle.id]) {
    assert.equal(restored.getObject(id).lengthUnit, "cm");
    assert.equal(restored.getObject(id).worldUnitsPerCentimeter, 50);
  }
  const slope = restored.getObject(legacySlope.id);
  const angle = restored.getObject(legacyAngle.id);
  const radius = restored.getObject(legacyCircle.id);
  assert.deepEqual(slope.notationRefs.linePointPairs[0].pointIds, [lineA.id, lineB.id]);
  assert.equal(angle.notationRefs.anglePointIds.length, 3);
  const migratedCenterId = restored.getObject(circle.id).centerPointId;
  assert.equal(radius.notationRefs.circleCenters[0].pointId, migratedCenterId);
  const referencedPointIds = [
    ...slope.notationRefs.linePointPairs[0].pointIds,
    ...angle.notationRefs.anglePointIds,
    migratedCenterId,
  ];
  assert.ok(referencedPointIds.every((id) => {
    const point = restored.getObject(id);
    return point?.type === "point" && point.label && point.label !== "圆心" && point.style.showLabel;
  }));
  assert.doesNotMatch([
    restored.getMeasurementText(slope),
    restored.getMeasurementText(angle),
    restored.getMeasurementText(radius),
  ].join(" "), /P_/);

  const pointCount = restored.objects.filter((object) => object.type === "point").length;
  const reloaded = GeometryDocument.fromJSON(restored.serialize());
  assert.equal(reloaded.objects.filter((object) => object.type === "point").length, pointCount);
  assert.deepEqual(reloaded.getObject(legacySlope.id).notationRefs, slope.notationRefs);
  assert.deepEqual(reloaded.getObject(legacyAngle.id).notationRefs, angle.notationRefs);
  assert.deepEqual(reloaded.getObject(legacyCircle.id).notationRefs, radius.notationRefs);
});

test("two line-like objects create a dynamic three-point angle notation", () => {
  const document = new GeometryDocument();
  const unnamed = { ...settings, autoNamePoints: false };
  const baseA = document.addFreePoint({ x: -100, y: 0 }, unnamed);
  const baseB = document.addFreePoint({ x: 100, y: 0 }, unnamed);
  const horizontalThrough = document.addFreePoint({ x: -50, y: 0 }, unnamed);
  const verticalThrough = document.addFreePoint({ x: 0, y: -50 }, unnamed);
  const base = document.addLine(baseA.id, baseB.id, unnamed);
  const horizontal = document.addParallelLine(horizontalThrough.id, base.id, unnamed);
  const vertical = document.addPerpendicularLine(verticalThrough.id, base.id, unnamed);

  const angle = document.addMeasurement("angle", [horizontal.id, vertical.id], { x: 20, y: 20 }, {
    ...unnamed,
    selectionAnchor: { x: 40, y: 40 },
  });
  assert.ok(angle);
  const [endpointAId, vertexId, endpointBId] = angle.notationRefs.anglePointIds;
  assert.deepEqual(
    [endpointAId, vertexId, endpointBId].map((id) => document.getObject(id).label),
    ["A", "B", "C"],
  );
  assert.equal(document.getObject(vertexId).definition.kind, "intersection");
  assert.deepEqual(new Set(document.getObject(vertexId).definition.parents), new Set([horizontal.id, vertical.id]));
  assert.equal(document.getObject(endpointAId).definition.kind, "angle-ray");
  assert.equal(document.getObject(endpointAId).definition.parentId, horizontal.id);
  assert.equal(document.getObject(endpointBId).definition.kind, "angle-ray");
  assert.equal(document.getObject(endpointBId).definition.parentId, vertical.id);
  assert.equal(document.getMeasurementText(angle), "∠ABC = 90.00°");

  document.movePoint(horizontalThrough.id, { x: -50, y: 20 });
  const vertex = document.getPointPosition(vertexId);
  assert.ok(Math.abs(vertex.x) < 1e-9 && Math.abs(vertex.y - 20) < 1e-9);
  for (const [pointId, sideId] of [[endpointAId, horizontal.id], [endpointBId, vertical.id]]) {
    const point = document.getPointPosition(pointId);
    const side = document.getShapeGeometry(sideId);
    const cross = (point.x - side.a.x) * (side.b.y - side.a.y)
      - (point.y - side.a.y) * (side.b.x - side.a.x);
    assert.ok(Math.abs(cross) < 1e-8);
  }
  assert.equal(document.getMeasurementText(angle), "∠ABC = 90.00°");

  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.deepEqual(restored.getObject(angle.id).notationRefs, angle.notationRefs);
  assert.deepEqual(
    new Set(restored.dependenciesOf(restored.getObject(angle.id))),
    new Set([horizontal.id, vertical.id, endpointAId, vertexId, endpointBId]),
  );
});

test("two-line angle measurement reuses an existing dynamic intersection", () => {
  const document = new GeometryDocument();
  const unnamed = { ...settings, autoNamePoints: false };
  const left = document.addFreePoint({ x: -50, y: 0 }, unnamed);
  const right = document.addFreePoint({ x: 50, y: 0 }, unnamed);
  const top = document.addFreePoint({ x: 0, y: -50 }, unnamed);
  const bottom = document.addFreePoint({ x: 0, y: 50 }, unnamed);
  const horizontal = document.addLine(left.id, right.id, unnamed);
  const vertical = document.addLine(top.id, bottom.id, unnamed);
  const existing = document.addIntersectionPoint(horizontal.id, vertical.id, 0, unnamed);

  const angle = document.addMeasurement("angle", [horizontal.id, vertical.id], { x: 20, y: 20 }, {
    ...unnamed,
    selectionAnchor: { x: 20, y: 20 },
  });
  assert.ok(angle);
  assert.equal(angle.notationRefs.anglePointIds[1], existing.id);
  assert.equal(document.objects.filter((object) => object.type === "point"
    && object.definition.kind === "intersection").length, 1);
  assert.equal(existing.style.showLabel, true);
  assert.match(document.getMeasurementText(angle), /^∠[^?]+ = 90\.00°$/);
});

test("two-line angle value follows the selected three-point wedge", () => {
  const document = new GeometryDocument();
  const unnamed = { ...settings, autoNamePoints: false };
  const left = document.addFreePoint({ x: -100, y: 0 }, unnamed);
  const right = document.addFreePoint({ x: 100, y: 0 }, unnamed);
  const diagonalA = document.addFreePoint({ x: -50, y: -50 * Math.sqrt(3) }, unnamed);
  const diagonalB = document.addFreePoint({ x: 50, y: 50 * Math.sqrt(3) }, unnamed);
  const horizontal = document.addLine(left.id, right.id, unnamed);
  const diagonal = document.addLine(diagonalA.id, diagonalB.id, unnamed);
  const angle = document.addMeasurement("angle", [horizontal.id, diagonal.id], { x: 20, y: -40 }, {
    ...unnamed,
    selectionAnchor: { x: 20, y: -40 },
  });

  assert.ok(Math.abs(document.getMeasurementValue(angle) - 120) < 1e-9);
  assert.match(document.getMeasurementText(angle), /^∠[^?]+ = 120\.00°$/);
  document.movePoint(diagonalA.id, { x: -50, y: 20 });
  document.movePoint(diagonalB.id, { x: 50, y: 20 });
  assert.equal(document.getMeasurementValue(angle), null);
  assert.equal(document.getMeasurementText(angle), null);
  document.movePoint(diagonalA.id, { x: -50, y: -50 * Math.sqrt(3) });
  document.movePoint(diagonalB.id, { x: 50, y: 50 * Math.sqrt(3) });
  assert.ok(Math.abs(document.getMeasurementValue(angle) - 120) < 1e-9);
});

test("generated two-line angle endpoints stay on their selected rays after large drags", () => {
  const document = new GeometryDocument();
  const unnamed = { ...settings, autoNamePoints: false };
  const horizontalA = document.addFreePoint({ x: 0, y: 0 }, unnamed);
  const horizontalB = document.addFreePoint({ x: 10, y: 0 }, unnamed);
  const verticalA = document.addFreePoint({ x: 20, y: -10 }, unnamed);
  const verticalB = document.addFreePoint({ x: 20, y: 10 }, unnamed);
  const horizontal = document.addLine(horizontalA.id, horizontalB.id, unnamed);
  const vertical = document.addLine(verticalA.id, verticalB.id, unnamed);
  const angle = document.addMeasurement("angle", [horizontal.id, vertical.id], { x: 30, y: 10 }, {
    ...unnamed,
    selectionAnchor: { x: 30, y: 10 },
  });
  const generated = angle.notationRefs.anglePointIds
    .map((id) => document.getObject(id))
    .find((point) => point.definition.kind === "angle-ray");
  assert.ok(generated);

  const assertOnSelectedRay = () => {
    const endpoint = document.getPointPosition(generated);
    const vertex = document.getPointPosition(generated.definition.vertexId);
    const side = document.getShapeGeometry(generated.definition.parentId);
    const direction = generated.definition.direction < 0 ? -1 : 1;
    const along = ((endpoint.x - vertex.x) * (side.b.x - side.a.x)
      + (endpoint.y - vertex.y) * (side.b.y - side.a.y)) * direction;
    assert.ok(along > 0);
  };
  assertOnSelectedRay();
  document.movePoint(verticalA.id, { x: -40, y: -10 });
  document.movePoint(verticalB.id, { x: -40, y: 10 });
  assertOnSelectedRay();
});

test("circle measurements create and reuse a visible dynamic center for transformed circles", () => {
  const document = new GeometryDocument();
  const unnamed = { ...settings, autoNamePoints: false };
  const center = document.addFreePoint({ x: 0, y: 0 }, unnamed);
  const through = document.addFreePoint({ x: 50, y: 0 }, unnamed);
  const circle = document.addCircle(center.id, through.id, unnamed);
  const translated = document.addTransformedShape(circle.id, "translate", { dx: 100, dy: 25 }, unnamed);
  const first = document.addMeasurement("radius", [translated.id], { x: 20, y: 20 }, unnamed);
  const second = document.addMeasurement("circumference", [translated.id], { x: 20, y: 50 }, unnamed);
  const centerId = first.notationRefs.circleCenters[0].pointId;
  const derivedCenter = document.getObject(centerId);

  assert.equal(second.notationRefs.circleCenters[0].pointId, centerId);
  assert.equal(derivedCenter.definition.kind, "shape-center");
  assert.equal(derivedCenter.definition.parentId, translated.id);
  assert.equal(derivedCenter.hidden, false);
  assert.equal(derivedCenter.style.showLabel, true);
  assert.ok(derivedCenter.label);
  assert.deepEqual(document.getPointPosition(derivedCenter), { x: 100, y: 25 });
  assert.doesNotMatch(document.getMeasurementText(first), /_/);

  document.movePoint(center.id, { x: 10, y: 5 });
  assert.deepEqual(document.getPointPosition(derivedCenter), { x: 110, y: 30 });
  assert.deepEqual(
    new Set(document.dependenciesOf(first)),
    new Set([translated.id, centerId]),
  );
  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.deepEqual(restored.getPointPosition(centerId), { x: 110, y: 30 });
  assert.equal(restored.objects.filter((object) => object.definition?.kind === "shape-center").length, 1);
});

test("two-line angle honors segment and ray domains", () => {
  const document = new GeometryDocument();
  const unnamed = { ...settings, autoNamePoints: false };
  const segmentA = document.addFreePoint({ x: -20, y: 0 }, unnamed);
  const segmentB = document.addFreePoint({ x: 20, y: 0 }, unnamed);
  const rayA = document.addFreePoint({ x: 0, y: -20 }, unnamed);
  const rayB = document.addFreePoint({ x: 0, y: 20 }, unnamed);
  const segment = document.addSegment(segmentA.id, segmentB.id, unnamed);
  const ray = document.addRay(rayA.id, rayB.id, unnamed);
  const angle = document.addMeasurement("angle", [segment.id, ray.id], { x: 10, y: 10 }, {
    ...unnamed,
    selectionAnchor: { x: 10, y: 10 },
  });
  assert.ok(angle);
  const [firstId, vertexId, secondId] = angle.notationRefs.anglePointIds;
  const vertex = document.getPointPosition(vertexId);
  const first = document.getPointPosition(firstId);
  const second = document.getPointPosition(secondId);
  assert.ok(first.x - vertex.x > 0);
  assert.ok(second.y - vertex.y > 0);
  assert.equal(document.getMeasurementText(angle), "∠ABC = 90.00°");
});

test("invalid line-like angle domains have no object or naming side effects", () => {
  const unnamed = { ...settings, autoNamePoints: false };
  const cases = [
    (document) => {
      const a = document.addFreePoint({ x: 0, y: 0 }, unnamed);
      const b = document.addFreePoint({ x: 20, y: 0 }, unnamed);
      const c = document.addFreePoint({ x: 0, y: 10 }, unnamed);
      const d = document.addFreePoint({ x: 20, y: 10 }, unnamed);
      return [document.addLine(a.id, b.id, unnamed), document.addLine(c.id, d.id, unnamed)];
    },
    (document) => {
      const a = document.addFreePoint({ x: 0, y: 0 }, unnamed);
      const b = document.addFreePoint({ x: 10, y: 0 }, unnamed);
      const c = document.addFreePoint({ x: 20, y: -10 }, unnamed);
      const d = document.addFreePoint({ x: 20, y: 10 }, unnamed);
      return [document.addSegment(a.id, b.id, unnamed), document.addSegment(c.id, d.id, unnamed)];
    },
    (document) => {
      const a = document.addFreePoint({ x: 0, y: 0 }, unnamed);
      const b = document.addFreePoint({ x: 10, y: 0 }, unnamed);
      const c = document.addFreePoint({ x: -10, y: -10 }, unnamed);
      const d = document.addFreePoint({ x: -10, y: 10 }, unnamed);
      return [document.addRay(a.id, b.id, unnamed), document.addLine(c.id, d.id, unnamed)];
    },
  ];
  for (const build of cases) {
    const document = new GeometryDocument();
    const [first, second] = build(document);
    const before = document.serialize();
    assert.equal(document.addMeasurement("angle", [first.id, second.id], { x: 0, y: 0 }, unnamed), null);
    assert.equal(document.serialize(), before);
  }
});

test("legacy two-line angles migrate to dynamic three-point notation", () => {
  const source = new GeometryDocument();
  const unnamed = { ...settings, autoNamePoints: false };
  const a = source.addFreePoint({ x: -50, y: 0 }, unnamed);
  const b = source.addFreePoint({ x: 50, y: 0 }, unnamed);
  const c = source.addFreePoint({ x: 0, y: -50 }, unnamed);
  const d = source.addFreePoint({ x: 0, y: 50 }, unnamed);
  const horizontal = source.addLine(a.id, b.id, unnamed);
  const vertical = source.addLine(c.id, d.id, unnamed);
  const data = source.toJSON();
  const legacy = {
    id: `obj-${data.nextId++}`,
    type: "measurement",
    measurementKind: "angle",
    parents: [horizontal.id, vertical.id],
    x: 20,
    y: 20,
    style: { color: "#334155", fontSize: 16 },
  };
  data.objects.push(legacy);

  const restored = GeometryDocument.fromJSON(data);
  const measurement = restored.getObject(legacy.id);
  assert.equal(measurement.notationRefs.anglePointIds.length, 3);
  assert.match(restored.getMeasurementText(measurement), /^∠[^?]+ = 90\.00°$/);
  assert.ok(measurement.notationRefs.anglePointIds.every((id) =>
    restored.getObject(id)?.style.showLabel));
});
