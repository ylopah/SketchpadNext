import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateExpression,
  expressionIdentifiers,
  supportedFunctions,
} from "../src/core/expression.js";

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("degree trigonometric functions accept and return degrees", () => {
  close(evaluateExpression("sind(30)"), 0.5);
  close(evaluateExpression("cosd(60)"), 0.5);
  close(evaluateExpression("tand(45)"), 1);
  close(evaluateExpression("asind(0.5)"), 30);
  close(evaluateExpression("acosd(0.5)"), 60);
  close(evaluateExpression("atand(1)"), 45);
});

test("deg and rad convert between radians and degrees", () => {
  close(evaluateExpression("deg(pi)"), 180);
  close(evaluateExpression("rad(180)"), Math.PI);
  close(evaluateExpression("deg(rad(a))", { a: 37.5 }), 37.5);
});

test("binary functions support nested expressions and variables", () => {
  assert.equal(evaluateExpression("min(8, 3)"), 3);
  assert.equal(evaluateExpression("max(-2, 5)"), 5);
  close(evaluateExpression("atan2(1, 1)"), Math.PI / 4);
  assert.equal(evaluateExpression("mod(17, 5)"), 2);
  assert.equal(evaluateExpression("max(min(a, b), mod(11, 4))", { a: 9, b: 2 }), 3);
});

test("function arity is validated explicitly", () => {
  assert.throws(() => evaluateExpression("sin()"), /需要 1 个参数/);
  assert.throws(() => evaluateExpression("sin(1, 2)"), /需要 1 个参数/);
  assert.throws(() => evaluateExpression("min(1)"), /需要 2 个参数/);
  assert.throws(() => evaluateExpression("max(1, 2, 3)"), /需要 2 个参数/);
  assert.throws(() => evaluateExpression("atan2()"), /需要 2 个参数/);
  assert.throws(() => evaluateExpression("mod(1, 0)"), /不是有限数值/);
});

test("new function names are excluded from dependency identifiers", () => {
  assert.deepEqual(
    expressionIdentifiers("sind(angle) + max(a, b) + atan2(y, x) + deg(theta)"),
    ["angle", "a", "b", "y", "x", "theta"],
  );
});

test("supportedFunctions exposes every added expression function", () => {
  for (const name of [
    "sind", "cosd", "tand", "asind", "acosd", "atand", "deg", "rad",
    "min", "max", "atan2", "mod",
  ]) {
    assert.ok(supportedFunctions.includes(name), `${name} should be listed as supported`);
  }
});

test("existing expression behavior and unsafe input rejection remain intact", () => {
  assert.equal(evaluateExpression("2 + 3 * 4^2"), 50);
  close(evaluateExpression("sin(pi / 2) + sqrt(9)"), 4);
  assert.equal(evaluateExpression("-2^2"), -4);
  assert.equal(evaluateExpression("value * 3", { value: 2.5 }), 7.5);
  assert.throws(() => evaluateExpression("unknown + 1"), /未知变量/);
  assert.throws(() => evaluateExpression("globalThis.alert(1)"));
});
