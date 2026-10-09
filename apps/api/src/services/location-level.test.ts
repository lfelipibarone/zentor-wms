import { test } from "node:test";
import assert from "node:assert/strict";
import { LocationStockMode, LocationType } from "@prisma/client";
import { levelFromQuantity, stockModeUpdateData } from "./location-level.js";

const below = (q: number, loc: { capacity: number; minQuantity: number }) => {
  const { fillPercent, minPercent } = levelFromQuantity(q, loc);
  return fillPercent <= minPercent;
};

test("% derivada respeita o mínimo em unidades mesmo com arredondamento", () => {
  const loc = { capacity: 1000, minQuantity: 100 };
  assert.equal(below(100, loc), true);
  assert.equal(below(101, loc), false);
  assert.equal(below(99, loc), true);

  const small = { capacity: 300, minQuantity: 3 };
  assert.equal(below(4, small), false);
  assert.equal(below(3, small), true);
});

test("mínimo zero: só entra no ressuprimento quando zera", () => {
  const loc = { capacity: 50, minQuantity: 0 };
  assert.equal(below(0, loc), true);
  assert.equal(below(1, loc), false);
});

test("% fica entre 0 e 100 e acompanha as unidades", () => {
  const loc = { capacity: 40, minQuantity: 5 };
  assert.deepEqual(levelFromQuantity(20, loc), { fillPercent: 50, minPercent: 13 });
  assert.equal(levelFromQuantity(60, loc).fillPercent, 100);
  assert.equal(levelFromQuantity(0, loc).fillPercent, 0);
});

test("mínimo maior que a capacidade não quebra a regra", () => {
  const loc = { capacity: 10, minQuantity: 20 };
  assert.equal(below(15, loc), true);
  assert.equal(below(21, loc), false);
});

const face = {
  type: LocationType.PICK_FACE,
  stockMode: LocationStockMode.PERCENT,
  stockQuantity: 0,
  capacity: 200,
  minQuantity: 0,
  fillPercent: 50,
  minPercent: 20,
};

test("passar de % para quantidade estima unidades e mínimo pela capacidade", () => {
  const data = stockModeUpdateData(face, { stockMode: "QUANTITY" });
  assert.equal(data?.stockMode, LocationStockMode.QUANTITY);
  assert.equal(data && "stockQuantity" in data ? data.stockQuantity : null, 100);
  assert.equal(data && "minQuantity" in data ? data.minQuantity : null, 40);
});

test("pulmão nunca vira quantidade", () => {
  const data = stockModeUpdateData(
    { ...face, type: LocationType.PULMAO },
    { stockMode: "QUANTITY" },
  );
  assert.equal(data, null);
});

test("sem mudança de modo nem capacidade não grava nada", () => {
  assert.equal(stockModeUpdateData(face, {}), null);
});
