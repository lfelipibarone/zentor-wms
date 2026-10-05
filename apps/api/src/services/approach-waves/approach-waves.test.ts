import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  colunaRankInStop,
  findStopOverlaps,
  formatStop,
  matchLocation,
  sequenceKeyIn,
  type ApproachWaveDef,
} from "./matching.js";
import { packingZoneFor, planWaveParts, sortBySequence, sortByUrgencyThenSequence } from "./parts.js";

const C = "est-c";
const D = "est-d";
const E = "est-e";
const K = "est-k";
const code = (id: string) => id.replace("est-", "").toUpperCase();
const loc = (estanteId: string, face: "A" | "B", coluna: number) => ({ estanteId, face, row: `${coluna}-1` });

const onda1: ApproachWaveDef = {
  id: "w1",
  name: "Onda 1",
  color: "#2563eb",
  sortOrder: 0,
  stops: [
    { estanteId: C, face: "B", colunaFrom: 1, colunaTo: 7 },
    { estanteId: C, face: "B", colunaFrom: 8, colunaTo: 14 },
    { estanteId: D, face: "A", colunaFrom: 8, colunaTo: 14 },
    { estanteId: E, face: "A", colunaFrom: 14, colunaTo: 8 },
    { estanteId: E, face: "A", colunaFrom: 7, colunaTo: 1 },
  ],
};
const onda2: ApproachWaveDef = {
  id: "w2",
  name: "Onda 2",
  color: "#16a34a",
  sortOrder: 1,
  stops: [
    { estanteId: D, face: "A", colunaFrom: 1, colunaTo: 7 },
    { estanteId: K, face: "A", colunaFrom: null, colunaTo: null },
  ],
};

describe("ondas de aproximação — pertencimento", () => {
  it("acha a parada pela estante, lado e faixa", () => {
    assert.deepEqual(matchLocation([onda1, onda2], loc(C, "B", 9)), { waveId: "w1", stopIndex: 1, colunaRank: 1 });
    assert.deepEqual(matchLocation([onda1, onda2], loc(D, "A", 3)), { waveId: "w2", stopIndex: 0, colunaRank: 2 });
  });

  it("lado errado, fora da faixa ou sem estante não pertence", () => {
    assert.equal(matchLocation([onda1], loc(C, "A", 3)), null);
    assert.equal(matchLocation([onda1], loc(D, "A", 3)), null);
    assert.equal(matchLocation([onda1], { estanteId: null, face: "A", row: "3-1" }), null);
  });

  it("faixa invertida anda em ordem decrescente", () => {
    const stop = onda1.stops[3]!;
    assert.equal(colunaRankInStop(stop, loc(E, "A", 14)), 0);
    assert.equal(colunaRankInStop(stop, loc(E, "A", 8)), 6);
    assert.equal(colunaRankInStop(stop, loc(E, "A", 7)), null);
  });

  it("estante inteira aceita qualquer coluna", () => {
    assert.deepEqual(matchLocation([onda2], loc(K, "A", 22)), { waveId: "w2", stopIndex: 1, colunaRank: 22 });
  });

  it("sequência: primeiro a parada, depois a coluna", () => {
    const a = sequenceKeyIn(onda1, loc(C, "B", 14))!;
    const b = sequenceKeyIn(onda1, loc(D, "A", 8))!;
    const c = sequenceKeyIn(onda1, loc(E, "A", 14))!;
    const d = sequenceKeyIn(onda1, loc(E, "A", 3))!;
    assert.ok(a < b && b < c && c < d);
    assert.equal(sequenceKeyIn(onda1, loc(K, "A", 1)), null);
  });

  it("aponta paradas sobrepostas entre ondas", () => {
    assert.deepEqual(findStopOverlaps([onda1, onda2], code), []);
    const clash: ApproachWaveDef = { ...onda2, stops: [{ estanteId: C, face: "B", colunaFrom: 5, colunaTo: 9 }] };
    assert.deepEqual(findStopOverlaps([onda1, clash], code), [
      'C LE 1→7 está em "Onda 1" e em "Onda 2"',
      'C LE 8→14 está em "Onda 1" e em "Onda 2"',
    ]);
  });

  it("formata a parada", () => {
    assert.equal(formatStop(onda1.stops[3]!, code), "E LD 14→8");
    assert.equal(formatStop(onda2.stops[1]!, code), "K LD");
  });
});

describe("ondas de aproximação — partes e filas", () => {
  it("divide as linhas por onda na ordem do cadastro; o resto vai para Sem área", () => {
    const lines = [
      { id: "l1", location: loc(D, "A", 3) },
      { id: "l2", location: loc(C, "B", 2) },
      { id: "l3", location: loc("est-z", "A", 1) },
      { id: "l4", location: loc(E, "A", 9) },
    ];
    const parts = planWaveParts(lines, [onda2, onda1]);
    assert.deepEqual(
      parts.map((p) => [p.name, p.sortOrder, p.approachWaveId, p.lines.map((l) => l.id)]),
      [
        ["Onda 1", 0, "w1", ["l2", "l4"]],
        ["Onda 2", 1, "w2", ["l1"]],
        ["Sem área", 2, null, ["l3"]],
      ],
    );
  });

  it("sem linhas fora de área não cria a parte Sem área", () => {
    const parts = planWaveParts([{ location: loc(C, "B", 1) }], [onda1]);
    assert.deepEqual(parts.map((p) => p.name), ["Onda 1"]);
  });

  it("ordena pela sequência; fora da onda vai para o fim", () => {
    const items = [loc(E, "A", 2), loc("est-z", "A", 1), loc(C, "B", 3), loc(E, "A", 12), loc(C, "B", 1)];
    const sorted = sortBySequence(items, onda1, (l) => l);
    assert.deepEqual(
      sorted.map((l) => `${code(l.estanteId)}${l.row}`),
      ["C1-1", "C3-1", "E12-1", "E2-1", "Z1-1"],
    );
  });

  it("área do pedido no packing: mais unidades; empate fica com a primeira do cadastro", () => {
    const waves = [onda1, onda2];
    assert.equal(
      packingZoneFor([{ quantity: 1, location: loc(C, "B", 1) }, { quantity: 3, location: loc(D, "A", 2) }], waves),
      "w2",
    );
    assert.equal(
      packingZoneFor([{ quantity: 2, location: loc(C, "B", 1) }, { quantity: 2, location: loc(D, "A", 2) }], waves),
      "w1",
    );
    assert.equal(
      packingZoneFor([{ quantity: 2, location: loc("est-z", "A", 1) }, { quantity: 1, location: null }], waves),
      null,
    );
  });

  it("fila filtrada: urgência primeiro, depois a sequência", () => {
    const items = [
      { id: "a", u: 50, k: 3 },
      { id: "b", u: 80, k: 9 },
      { id: "c", u: 50, k: 1 },
      { id: "d", u: 50, k: null },
    ];
    const sorted = sortByUrgencyThenSequence(items, (i) => i.u, (i) => i.k);
    assert.deepEqual(sorted.map((i) => i.id), ["b", "c", "a", "d"]);
  });
});
