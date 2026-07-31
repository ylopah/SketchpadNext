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

function close(actual, expected, epsilon = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= epsilon, String(actual) + " should be close to " + String(expected));
}

test("calculation updates atomically and numeric text honors precision and units", () => {
  const document = new GeometryDocument();
  const a = document.addParameter("a", 1, "none", { x: 0, y: 0 }, settings);
  const b = document.addParameter("b", 5, "none", { x: 0, y: 20 }, settings);
  const calculation = document.addCalculation(
    "result", "a / 3", { a: a.id }, { x: 0, y: 40 }, settings,
  );

  assert.equal(document.getValueText(calculation), "result = 0.333333");
  assert.equal(document.getValueText(calculation, 2), "result = 0.33");
  assert.equal(document.getValueText(calculation, -4), "result = 0");
  assert.equal(document.getValueText(calculation, 20), "result = 0.3333333333");

  const angle = document.addParameter("theta", 12.3456, "angle", { x: 0, y: 60 }, settings);
  const length = document.addParameter("length", 9.8764, "distance", { x: 0, y: 80 }, settings);
  assert.equal(document.getValueText(angle, 2), "theta = 12.35°");
  assert.equal(document.getValueText(length, 3), "length = 9.876 px");

  assert.equal(document.updateCalculation(calculation.id, "twice", "b * 2"), true);
  assert.equal(calculation.name, "twice");
  assert.equal(calculation.expression, "b * 2");
  assert.deepEqual(calculation.variables, { b: b.id });
  assert.equal(document.getNumericValue(calculation), 10);
  assert.equal(document.getValueText(calculation, 2), "twice = 10");
});

test("invalid calculation edits leave every old field unchanged", () => {
  const document = new GeometryDocument();
  const source = document.addParameter("a", 2, "none", { x: 0, y: 0 }, settings);
  const calculation = document.addCalculation(
    "result", "a + 1", { a: source.id }, { x: 0, y: 20 }, settings,
  );
  const dependent = document.addCalculation(
    "dependent", "result + 1", { result: calculation.id }, { x: 0, y: 40 }, settings,
  );
  const before = {
    name: calculation.name,
    expression: calculation.expression,
    variables: { ...calculation.variables },
    value: document.getNumericValue(calculation),
  };

  assert.equal(document.updateCalculation(calculation.id, "broken", "missing + 1"), false);
  assert.deepEqual({
    name: calculation.name,
    expression: calculation.expression,
    variables: calculation.variables,
    value: document.getNumericValue(calculation),
  }, before);

  assert.equal(document.updateCalculation(calculation.id, "not valid", "a + 2"), false);
  assert.equal(document.updateCalculation(calculation.id, "broken", "a + 2", []), false);
  assert.equal(
    document.updateCalculation(
      calculation.id, "cyclic", "dependent + 1", { dependent: dependent.id },
    ),
    false,
  );
  assert.deepEqual({
    name: calculation.name,
    expression: calculation.expression,
    variables: calculation.variables,
    value: document.getNumericValue(calculation),
  }, before);
  assert.equal(document.updateCalculation(source.id, "other", "1"), false);
});

test("calculation edits rebind only the variables used by the new expression", () => {
  const document = new GeometryDocument();
  const a = document.addParameter("a", 2, "none", { x: 0, y: 0 }, settings);
  const b = document.addParameter("b", 7, "none", { x: 0, y: 20 }, settings);
  const calculation = document.addCalculation(
    "value", "a * 2", { a: a.id }, { x: 0, y: 40 }, settings,
  );
  assert.deepEqual(document.dependenciesOf(calculation), [a.id]);

  assert.equal(document.updateCalculation(calculation.id, "updated", "b + 1"), true);
  assert.deepEqual(calculation.variables, { b: b.id });
  assert.deepEqual(document.dependenciesOf(calculation), [b.id]);
  assert.equal(document.getNumericValue(calculation), 8);

  document.setParameterValue(a.id, 100);
  assert.equal(document.getNumericValue(calculation), 8);
  document.setParameterValue(b.id, 10);
  assert.equal(document.getNumericValue(calculation), 11);

  assert.equal(
    document.updateCalculation(calculation.id, "mapped", "input * 3", { input: a.id }),
    true,
  );
  assert.deepEqual(calculation.variables, { input: a.id });
  assert.equal(document.getNumericValue(calculation), 300);
});

test("coordinate-system updates, display flags, bound origins, and serialization stay dynamic", () => {
  const document = new GeometryDocument();
  const origin = document.addFreePoint({ x: 100, y: 120 }, settings);
  const system = document.addCoordinateSystem(origin.id, settings, {
    unitX: 20,
    unitY: 30,
    gridType: "rectangular",
    showGrid: false,
    showTicks: true,
    showLabels: false,
  });

  assert.deepEqual(document.getCoordinateSystem(system), {
    origin: { x: 100, y: 120 },
    unitX: 20,
    unitY: 30,
    gridType: "rectangular",
    showGrid: false,
    showTicks: true,
    showLabels: false,
  });

  const beforeInvalidUpdate = { ...document.getCoordinateSystem(system) };
  assert.equal(document.updateCoordinateSystem(system.id, { unitX: 501, showGrid: true }), false);
  assert.deepEqual(document.getCoordinateSystem(system), beforeInvalidUpdate);

  assert.equal(document.updateCoordinateSystem(system.id, {
    unitX: 40,
    unitY: 50,
    gridType: "polar",
    showGrid: true,
    showTicks: false,
    showLabels: true,
  }), true);
  document.movePoint(origin.id, { x: 150, y: 160 });
  assert.deepEqual(document.getCoordinateSystem(system), {
    origin: { x: 150, y: 160 },
    unitX: 40,
    unitY: 50,
    gridType: "polar",
    showGrid: true,
    showTicks: false,
    showLabels: true,
  });

  const restored = GeometryDocument.fromJSON(document.serialize());
  assert.deepEqual(restored.getCoordinateSystem(system.id), document.getCoordinateSystem(system));
  restored.movePoint(origin.id, { x: 10, y: 20 });
  assert.deepEqual(restored.getCoordinateSystem(system.id).origin, { x: 10, y: 20 });

  const freeSystem = restored.addCoordinateSystem({ x: 5, y: 6 }, settings);
  assert.equal(restored.updateCoordinateSystem(freeSystem.id, { x: 25, y: 35 }), true);
  assert.deepEqual(restored.getCoordinateSystem(freeSystem.id).origin, { x: 25, y: 35 });
});

test("coordinate component measurements render, update, serialize, and feed calculations", () => {
  const document = new GeometryDocument();
  const origin = document.addFreePoint({ x: 100, y: 100 }, settings);
  const point = document.addFreePoint({ x: 140, y: 70 }, settings);
  const system = document.addCoordinateSystem(origin.id, settings, { unitX: 20, unitY: 10 });
  const coordinateX = document.addMeasurement(
    "coordinateX", [point.id, system.id], { x: 0, y: 0 }, settings,
  );
  const coordinateY = document.addMeasurement(
    "coordinateY", [point.id, system.id], { x: 0, y: 20 }, settings,
  );
  const variableX = coordinateX.id.replace("obj-", "m");
  const variableY = coordinateY.id.replace("obj-", "m");
  const calculation = document.addCalculation(
    "sum", variableX + " + " + variableY, {}, { x: 0, y: 40 }, settings,
  );

  close(document.getMeasurementValue(coordinateX), 2);
  close(document.getMeasurementValue(coordinateY), 3);
  assert.equal(document.getMeasurementText(coordinateX), "点 B 横坐标 x = 2.00");
  assert.equal(document.getMeasurementText(coordinateY), "点 B 纵坐标 y = 3.00");
  assert.deepEqual(calculation.variables, {
    [variableX]: coordinateX.id,
    [variableY]: coordinateY.id,
  });
  close(document.getNumericValue(calculation), 5);

  document.movePoint(point.id, { x: 120, y: 80 });
  close(document.getMeasurementValue(coordinateX), 1);
  close(document.getMeasurementValue(coordinateY), 2);
  close(document.getNumericValue(calculation), 3);

  assert.equal(
    document.updateCalculation(
      calculation.id, "product", variableX + " * " + variableY,
    ),
    true,
  );
  close(document.getNumericValue(calculation), 2);
  const restored = GeometryDocument.fromJSON(document.serialize());
  close(restored.getNumericValue(calculation.id), 2);
  assert.equal(restored.getMeasurementText(coordinateX.id, 1), "点 B 横坐标 x = 1.0");
});
