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
  const b = point("B", 4, 0);
  const c = point("C", 0, 3);
  const d = point("D", 2, 0);
  const e = point("E", 0, 4);
  const segmentAB = document.addSegment(a.id, b.id, settings);
  const segmentAC = document.addSegment(a.id, c.id, settings);
  const lineBC = document.addLine(b.id, c.id, settings);
  const circle = document.addCircle(a.id, b.id, settings);
  const arc = document.addArcOnCircle(circle.id, b.id, e.id, settings);
  const driver = document.addPointOnShape(segmentAB.id, { x: 2, y: 0 }, settings);
  assert.equal(document.renamePoint(driver.id, "F"), true);
  const system = document.addCoordinateSystem(a.id, settings, { unitX: 10, unitY: 10 });
  return {
    document, a, b, c, d, e, segmentAB, segmentAC, lineBC, circle, arc, driver, system,
  };
}

test("every measurement kind uses concise mathematical notation without CJK boilerplate", async (t) => {
  const fixture = createFixture();
  const { document, a, b, c, d, segmentAB, segmentAC, lineBC, circle, arc, driver, system } = fixture;
  const cases = [
    ["distance", [a.id, b.id], "AB = 4.00"],
    ["pointLineDistance", [c.id, segmentAB.id], "d(C,\\overline{AB}) = 3.00"],
    ["polygonArea", [a.id, b.id, c.id], "S(ABC) = 6.00"],
    ["polygonPerimeter", [a.id, b.id, c.id], "P(ABC) = 12.00"],
    ["collinearity", [a.id, b.id, d.id], "ε_{col}(A,B,D) = 0.000e+0"],
    ["pointCircleError", [c.id, circle.id], "ε(C,⊙A) = 1.000e+0"],
    ["length", [segmentAB.id], "\\overline{AB} = 4.00"],
    ["arcLength", [arc.id], "⌢BE = 6.28"],
    ["ratio", [segmentAB.id, segmentAC.id], "\\overline{AB}/\\overline{AC} = 1.33"],
    ["angle", [b.id, a.id, c.id], "∠BAC = 90.00°"],
    ["radius", [circle.id], "r(⊙A) = 4.00"],
    ["circumference", [circle.id], "C(⊙A) = 25.13"],
    ["circleArea", [circle.id], "S(⊙A) = 50.27"],
    ["coordinates", [b.id, system.id], "B = (0.40, 0.00)"],
    ["coordinateX", [b.id, system.id], "x(B) = 0.40"],
    ["coordinateY", [b.id, system.id], "y(B) = 0.00"],
    ["slope", [lineBC.id], "k(ℓ(BC)) = 0.75"],
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

test("anonymous point tokens are stable and renaming updates dependent notation", () => {
  const document = new GeometryDocument();
  const anonymous = document.addFreePoint({ x: 0, y: 0 }, settings, "A");
  anonymous.label = "";
  const b = document.addFreePoint({ x: 3, y: 4 }, settings, "B");
  const measurement = document.addMeasurement("distance", [anonymous.id, b.id], { x: 0, y: 0 }, settings);
  assert.ok(measurement);
  const suffix = anonymous.id.match(/\d+$/)?.[0];
  assert.ok(suffix);
  const expectedToken = "P_" + suffix;
  assert.equal(document.getMeasurementText(measurement), expectedToken + "B = 5.00");

  document.addFreePoint({ x: 20, y: 20 }, settings, "Z");
  assert.equal(document.getMeasurementText(measurement), expectedToken + "B = 5.00");
  assert.equal(document.renamePoint(anonymous.id, "Q"), true);
  assert.equal(document.getMeasurementText(measurement), "QB = 5.00");
});

test("point distance and segment length remain distinct while ratio decorates both segments", () => {
  const { document, a, b, segmentAB, segmentAC } = createFixture();
  const distance = document.addMeasurement("distance", [a.id, b.id], { x: 0, y: 0 }, settings);
  const length = document.addMeasurement("length", [segmentAB.id], { x: 0, y: 0 }, settings);
  const ratio = document.addMeasurement("ratio", [segmentAB.id, segmentAC.id], { x: 0, y: 0 }, settings);
  const distanceText = document.getMeasurementText(distance);
  const lengthText = document.getMeasurementText(length);
  const ratioText = document.getMeasurementText(ratio);

  assert.equal(distanceText, "AB = 4.00");
  assert.doesNotMatch(distanceText, /\\overline/);
  assert.equal(lengthText, "\\overline{AB} = 4.00");
  assert.equal(ratioText.match(/\\overline/g)?.length, 2);
});
