import { test } from "node:test";
import assert from "node:assert/strict";
import { planEstantePositions } from "./estante-generator.js";

test("só LD: colunas × linhas com etiqueta ESTANTE-LD-COLUNA-LINHA", () => {
  const plan = planEstantePositions("a", { colunas: 2, linhas: 3 });
  assert.equal(plan.length, 6);
  assert.deepEqual(plan[0], { colunaCode: "1", linhaCode: "1", face: "A", barcode: "A-LD-1-1" });
  assert.equal(plan.at(-1)!.barcode, "A-LD-2-3");
});

test("LE continua a numeração das colunas do LD", () => {
  const plan = planEstantePositions("A", { colunas: 7, linhas: 1 }, { colunas: 7, linhas: 1 });
  const ld = plan.filter((p) => p.face === "A").map((p) => p.colunaCode);
  const le = plan.filter((p) => p.face === "B").map((p) => p.colunaCode);
  assert.deepEqual(ld, ["1", "2", "3", "4", "5", "6", "7"]);
  assert.deepEqual(le, ["8", "9", "10", "11", "12", "13", "14"]);
  assert.equal(plan.find((p) => p.face === "B")!.barcode, "A-LE-8-1");
});

test("com barracão a etiqueta é o endereço BARRACAO-ESTANTE-COLUNA-LINHA", () => {
  const plan = planEstantePositions("o-e7", { colunas: 2, linhas: 1 }, { colunas: 2, linhas: 1 }, "b1");
  assert.deepEqual(
    plan.map((p) => p.barcode),
    ["B1-O-E7-1-1", "B1-O-E7-2-1", "B1-O-E7-3-1", "B1-O-E7-4-1"],
  );
});

test("LD e LE com quantidades diferentes", () => {
  const plan = planEstantePositions("B", { colunas: 3, linhas: 2 }, { colunas: 2, linhas: 4 });
  assert.equal(plan.length, 3 * 2 + 2 * 4);
  assert.equal(plan.at(-1)!.barcode, "B-LE-5-4");
});
