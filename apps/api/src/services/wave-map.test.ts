import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ordersMatchingSelection, parseSelection, WaveMapError, type WaveMapCell } from "./wave-map.js";

const cell = (estanteId: string, face: "A" | "B", coluna: string, linha: string, orderIds: string[]): WaveMapCell => ({
  locationId: `${estanteId}-${face}-${coluna}-${linha}`,
  barcode: `B1-${estanteId}-${coluna}-${linha}`,
  estanteId,
  face,
  coluna,
  linha,
  orderIds,
});

const cells = [
  cell("E", "A", "3", "1", ["p1"]),
  cell("E", "A", "3", "2", ["p2", "p3"]),
  cell("E", "B", "3", "1", ["p4"]),
  cell("F", "A", "1", "5", ["p3", "p5"]),
];

describe("ordersMatchingSelection", () => {
  it("coluna inteira pega todas as linhas daquele lado", () => {
    const ids = ordersMatchingSelection(cells, [{ estanteId: "E", face: "A", coluna: "3", linha: null }]);
    assert.deepEqual(ids.sort(), ["p1", "p2", "p3"]);
  });

  it("linha específica pega só os pedidos dela", () => {
    const ids = ordersMatchingSelection(cells, [{ estanteId: "E", face: "A", coluna: "3", linha: "2" }]);
    assert.deepEqual(ids.sort(), ["p2", "p3"]);
  });

  it("não mistura os lados da mesma coluna", () => {
    const ids = ordersMatchingSelection(cells, [{ estanteId: "E", face: "B", coluna: "3", linha: null }]);
    assert.deepEqual(ids, ["p4"]);
  });

  it("pedido com item em qualquer coluna marcada entra uma vez só", () => {
    const ids = ordersMatchingSelection(cells, [
      { estanteId: "E", face: "A", coluna: "3", linha: "2" },
      { estanteId: "F", face: "A", coluna: "1", linha: null },
    ]);
    assert.deepEqual(ids.sort(), ["p2", "p3", "p5"]);
  });
});

describe("parseSelection", () => {
  const estantes = new Set(["E", "F"]);

  it("remove repetidos e normaliza linha vazia como coluna inteira", () => {
    const sel = parseSelection(
      [
        { estanteId: "E", face: "A", coluna: " 3 ", linha: "" },
        { estanteId: "E", face: "A", coluna: "3", linha: null },
        { estanteId: "F", face: "B", coluna: "1", linha: "2" },
      ],
      estantes,
    );
    assert.deepEqual(sel, [
      { estanteId: "E", face: "A", coluna: "3", linha: null },
      { estanteId: "F", face: "B", coluna: "1", linha: "2" },
    ]);
  });

  it("recusa estante de outro barracão, lado inválido e seleção vazia", () => {
    assert.throws(() => parseSelection([{ estanteId: "X", face: "A", coluna: "1" }], estantes), WaveMapError);
    assert.throws(() => parseSelection([{ estanteId: "E", face: "C", coluna: "1" }], estantes), WaveMapError);
    assert.throws(() => parseSelection([], estantes), /Selecione ao menos/);
  });
});
