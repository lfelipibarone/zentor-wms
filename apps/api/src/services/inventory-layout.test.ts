import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInventoryAddress, planInventoryLayout } from "./inventory-layout.js";

test("rua com coluna e linha: B1-D-12-7", () => {
  assert.deepEqual(parseInventoryAddress("B1-D-12-7"), {
    address: { barracao: "B1", estante: "D", coluna: 12, linha: 7, pulmoes: [], code: "B1-D-12-7" },
  });
});

test("rua com estante: B1-O-E7-2-3 vira estante O-E7", () => {
  const { address } = parseInventoryAddress("b1-o-e7-2-3");
  assert.equal(address?.estante, "O-E7");
  assert.equal(address?.coluna, 2);
  assert.equal(address?.linha, 3);
  assert.equal(address?.code, "B1-O-E7-2-3");
});

test("estante com um número só é a coluna, linha 1", () => {
  const { address } = parseInventoryAddress("B1-A-E2-3");
  assert.equal(address?.estante, "A-E2");
  assert.equal(address?.coluna, 3);
  assert.equal(address?.linha, 1);
  assert.equal(address?.code, "B1-A-E2-3-1");
  assert.equal(parseInventoryAddress("B1-E-5").address?.code, "B1-E-5-1");
});

test("sufixo de pulmão é separado do endereço", () => {
  assert.deepEqual(parseInventoryAddress("B1-C-10-1/Z509").address?.pulmoes, ["Z509"]);
  assert.deepEqual(parseInventoryAddress("B1-O-E3-3-7/Z603-604").address?.pulmoes, ["Z603", "Z604"]);
  assert.deepEqual(parseInventoryAddress("B1-A-2-6/Z609 -610").address?.pulmoes, ["Z609", "Z610"]);
  assert.deepEqual(parseInventoryAddress("B1-G-E4-3-6/Z86-Z87").address?.pulmoes, ["Z86", "Z87"]);
  assert.equal(parseInventoryAddress("B1-D-3-4/ Z510").address?.code, "B1-D-3-4");
});

test("endereço inválido retorna erro", () => {
  assert.ok(parseInventoryAddress("").error);
  assert.ok(parseInventoryAddress("D-12-7").error);
  assert.ok(parseInventoryAddress("B1-D-X-7").error);
  assert.ok(parseInventoryAddress("B1-D-0-7").error);
});

test("plano: grade completa por estante, cada estante inteira num lado só", () => {
  const plan = planInventoryLayout([
    { address: "B1-D-1-1", sku: "A" },
    { address: "B1-D-14-7", sku: "B" },
    { address: "B1-O-E7-4-12", sku: "C" },
    { address: "B1-O-E7-1-3/Z509", sku: "D" },
  ]);
  const d = plan.estantes.find((e) => e.estante === "D")!;
  assert.deepEqual(d.ld, { colunas: 14, linhas: 7 });
  assert.equal(d.le, null);
  const o = plan.estantes.find((e) => e.estante === "O-E7")!;
  assert.deepEqual(o.ld, { colunas: 4, linhas: 12 });
  assert.equal(o.le, null);
  assert.equal(plan.pulmaoRefs, 1);
});

test("plano: endereço com vários SKUs fica com o primeiro e lista os demais", () => {
  const plan = planInventoryLayout([
    { address: "B1-F-6-1", sku: "X" },
    { address: "B1-F-6-1", sku: "Y" },
    { address: "B1-F-6-1", sku: "x" },
    { address: "lixo", sku: "Z" },
    { address: "", sku: "W" },
  ]);
  assert.deepEqual(plan.assignments, [{ code: "B1-F-6-1", sku: "X" }]);
  assert.deepEqual(plan.extraSkus, [{ code: "B1-F-6-1", skus: ["Y"] }]);
  assert.equal(plan.invalid.length, 1);
  assert.equal(plan.invalid[0]!.address, "lixo");
  assert.equal(plan.emptyRows, 1);
});
