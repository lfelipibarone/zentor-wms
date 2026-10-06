import assert from "node:assert/strict";
import test from "node:test";
import { needsReplenishment, parsePercent, percentToFill, StockPercentError } from "./stock-percent.js";

test("parsePercent aceita 0 a 100 (número, texto ou com %)", () => {
  assert.equal(parsePercent(0), 0);
  assert.equal(parsePercent(100), 100);
  assert.equal(parsePercent("75"), 75);
  assert.equal(parsePercent("40%"), 40);
  assert.equal(parsePercent(33.6), 34);
});

test("parsePercent recusa vazio e fora da faixa", () => {
  assert.throws(() => parsePercent(undefined), StockPercentError);
  assert.throws(() => parsePercent(""), StockPercentError);
  assert.throws(() => parsePercent("abc"), StockPercentError);
  assert.throws(() => parsePercent(-1), /entre 0 e 100/);
  assert.throws(() => parsePercent(101), /entre 0 e 100/);
});

test("ressuprimento quando a % fica igual ou abaixo da mínima", () => {
  assert.equal(needsReplenishment(20, 20), true);
  assert.equal(needsReplenishment(10, 20), true);
  assert.equal(needsReplenishment(21, 20), false);
  assert.equal(percentToFill(30), 70);
  assert.equal(percentToFill(100), 0);
});
