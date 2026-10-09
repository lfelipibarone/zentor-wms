import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { accessCellForSlot, sortSlotCodes } from "./access-points.js";
import { buildFloorGrid, cellIndex } from "./floor-grid.js";
import { LegacyRouteEngine } from "./legacy-engine.js";
import { PhysicalRouteEngine, PlanRuntime, UNMAPPED_PENALTY_METERS } from "./physical-engine.js";
import { pickNextItemByEngine, sortPendingItemsByEngine } from "./route-helpers.js";
import { solveOpenTour } from "./tour.js";
import type { GondolaSlots, FloorElementSpec, FloorPlanSpec } from "./types.js";
import { validateFloorPlan } from "./validation.js";

function el(partial: Partial<FloorElementSpec> & Pick<FloorElementSpec, "id" | "type" | "x" | "y" | "width" | "height">): FloorElementSpec {
  return {
    rotation: 0,
    estanteId: null,
    faceAEnabled: true,
    faceBEnabled: false,
    colunaReversedA: false,
    colunaReversedB: false,
    label: null,
    ...partial,
  };
}

function plan(elements: FloorElementSpec[], width = 20, height = 10): FloorPlanSpec {
  return { id: "p1", barracaoId: "b1", cellSizeCm: 50, widthCells: width, heightCells: height, version: 1, elements };
}

const COLUNAS = ["1", "2", "3", "4", "5", "6", "7"];
const slots: GondolaSlots = new Map([
  ["cA", { A: COLUNAS, B: COLUNAS }],
  ["cB", { A: COLUNAS, B: COLUNAS }],
]);

const basePlan = () =>
  plan([
    el({ id: "gA", type: "GONDOLA", x: 4, y: 3, width: 7, height: 2, estanteId: "cA", faceBEnabled: true }),
    el({ id: "gB", type: "GONDOLA", x: 4, y: 7, width: 7, height: 2, estanteId: "cB" }),
    el({ id: "start", type: "START_POINT", x: 0, y: 9, width: 1, height: 1 }),
    el({ id: "pack", type: "PACKING_POINT", x: 19, y: 9, width: 1, height: 1 }),
  ]);

const loc = (estanteId: string, row: string, face: "A" | "B" = "A", corridor = "X") => ({
  id: `${estanteId}-${row}-${face}`,
  corridor,
  row,
  estanteId,
  face,
});

describe("access points", () => {
  it("posiciona Face A acima e Face B abaixo com rotação 0", () => {
    const p = basePlan();
    const grid = buildFloorGrid(p);
    const g = p.elements[0]!;
    assert.equal(accessCellForSlot(grid, g, 0, 7, "A"), cellIndex(grid, 4, 2));
    assert.equal(accessCellForSlot(grid, g, 0, 7, "B"), cellIndex(grid, 4, 5));
    assert.equal(accessCellForSlot(grid, g, 6, 7, "A"), cellIndex(grid, 10, 2));
  });

  it("respeita rotação 90 e sentido invertido", () => {
    const p = plan([el({ id: "g", type: "GONDOLA", x: 2, y: 1, width: 2, height: 7, rotation: 90 })]);
    const grid = buildFloorGrid(p);
    const g = p.elements[0]!;
    assert.equal(accessCellForSlot(grid, g, 0, 7, "A"), cellIndex(grid, 4, 1));
    assert.equal(accessCellForSlot(grid, g, 0, 7, "B"), cellIndex(grid, 1, 1));
    const reversed = { ...g, colunaReversedA: true };
    assert.equal(accessCellForSlot(grid, reversed, 0, 7, "A"), cellIndex(grid, 4, 7));
    assert.equal(accessCellForSlot(grid, reversed, 0, 7, "B"), cellIndex(grid, 1, 1));
  });

  it("permite sentido das colunas diferente em cada face", () => {
    const p = basePlan();
    const grid = buildFloorGrid(p);
    const g = { ...p.elements[0]!, colunaReversedB: true };
    assert.equal(accessCellForSlot(grid, g, 0, 7, "A"), cellIndex(grid, 4, 2));
    assert.equal(accessCellForSlot(grid, g, 0, 7, "B"), cellIndex(grid, 10, 5));
    assert.equal(accessCellForSlot(grid, g, 6, 7, "B"), cellIndex(grid, 4, 5));
  });

  it("ordena códigos de coluna numericamente", () => {
    assert.deepEqual(sortSlotCodes(["10", "2", "1", "2"]), ["1", "2", "10"]);
  });
});

describe("PhysicalRouteEngine", () => {
  it("contorna a gôndola para ir da frente ao verso", () => {
    const engine = new PhysicalRouteEngine([new PlanRuntime(basePlan(), slots)]);
    assert.equal(engine.distance(loc("cA", "1", "A"), loc("cA", "1", "B")), 2.5);
  });

  it("LE continua a numeração do LD e a linha (altura) não muda o acesso", () => {
    const p = basePlan();
    p.elements[0] = { ...p.elements[0]!, colunaReversedB: true };
    const ldle: GondolaSlots = new Map([
      ["cA", { A: COLUNAS, B: ["8", "9", "10", "11", "12", "13", "14"] }],
      ["cB", { A: COLUNAS, B: [] }],
    ]);
    const engine = new PhysicalRouteEngine([new PlanRuntime(p, ldle)]);
    assert.equal(engine.distance(loc("cA", "7-1", "A"), loc("cA", "8-1", "B")), 2.5);
    assert.equal(engine.distance(loc("cA", "7-1", "A"), loc("cA", "7-5", "A")), 0);
    assert.ok(engine.distance(loc("cA", "1-1", "A"), loc("cA", "8-1", "B")) > 2.5);
    assert.equal(engine.locate(loc("cA", "1-1", "B")), null);
  });

  it("gôndola com duas estantes de costas: LD = uma estante, LE = outra", () => {
    const p = basePlan();
    p.elements[0] = { ...p.elements[0]!, estanteId: "cD", estanteIdB: "cC", colunaReversedB: true };
    const costas: GondolaSlots = new Map([
      ["cD", { A: COLUNAS, B: [] }],
      ["cC", { A: [], B: COLUNAS }],
      ["cB", { A: COLUNAS, B: [] }],
    ]);
    const engine = new PhysicalRouteEngine([new PlanRuntime(p, costas)]);
    assert.ok(engine.locate(loc("cD", "3-2", "A")));
    assert.ok(engine.locate(loc("cC", "3-2", "B")));
    assert.equal(engine.locate(loc("cC", "3-2", "A")), null);
    assert.equal(engine.distance(loc("cD", "7-1", "A"), loc("cC", "1-1", "B")), 2.5);
    const v = validateFloorPlan(p, costas, new Map([["cD", "D"], ["cC", "C"], ["cB", "B"]]));
    assert.ok(!v.issues.some((i) => i.code === "ESTANTE_NOT_PLACED" || i.code === "FACE_NOT_MAPPED"));
  });

  it("avisa quando a estante tem posições num lado que a gôndola não atende", () => {
    const p = basePlan();
    p.elements[0] = { ...p.elements[0]!, estanteId: "cD", estanteIdB: "cC" };
    const errado: GondolaSlots = new Map([
      ["cD", { A: COLUNAS, B: [] }],
      ["cC", { A: COLUNAS, B: [] }],
      ["cB", { A: COLUNAS, B: [] }],
    ]);
    const v = validateFloorPlan(p, errado, new Map([["cD", "D"], ["cC", "C"], ["cB", "B"]]));
    assert.ok(v.issues.some((i) => i.code === "FACE_NOT_MAPPED" && i.message.includes("Estante C")));
  });

  it("estante em duas partes com corredor no meio: cada gôndola atende uma faixa de colunas", () => {
    const quatorze = [...COLUNAS, "8", "9", "10", "11", "12", "13", "14"];
    const partes: GondolaSlots = new Map([["cC", { A: quatorze, B: [] }]]);
    const p = plan(
      [
        el({ id: "p1", type: "GONDOLA", x: 1, y: 3, width: 7, height: 2, estanteId: "cC", colunaMaxA: 7 }),
        el({ id: "p2", type: "GONDOLA", x: 11, y: 3, width: 7, height: 2, estanteId: "cC", colunaMinA: 8 }),
        el({ id: "start", type: "START_POINT", x: 0, y: 9, width: 1, height: 1 }),
        el({ id: "pack", type: "PACKING_POINT", x: 19, y: 9, width: 1, height: 1 }),
      ],
      20,
      10,
    );
    const engine = new PhysicalRouteEngine([new PlanRuntime(p, partes)]);
    const grid = buildFloorGrid(p);
    assert.equal(engine.locate(loc("cC", "1-1"))?.cell, cellIndex(grid, 1, 2));
    assert.equal(engine.locate(loc("cC", "8-1"))?.cell, cellIndex(grid, 11, 2));
    // Corredor de passagem: de 7 (x=7) para 8 (x=11) são 4 células.
    assert.equal(engine.distance(loc("cC", "7-1"), loc("cC", "8-1")), 2);

    const labels = new Map([["cC", "C"]]);
    const ok = validateFloorPlan(p, partes, labels);
    assert.ok(!ok.issues.some((i) => ["ESTANTE_DUPLICATED", "FACE_NOT_MAPPED", "SLOTS_TOO_SMALL"].includes(i.code)));

    const sobreposta = { ...p, elements: p.elements.map((e) => (e.id === "p2" ? { ...e, colunaMinA: 7 } : e)) };
    const dup = validateFloorPlan(sobreposta, partes, labels).issues.find((i) => i.code === "ESTANTE_DUPLICATED");
    assert.match(dup?.message ?? "", /coluna 7 do LD/);

    const faltando = { ...p, elements: p.elements.map((e) => (e.id === "p2" ? { ...e, colunaMinA: 10 } : e)) };
    const miss = validateFloorPlan(faltando, partes, labels).issues.find((i) => i.code === "FACE_NOT_MAPPED");
    assert.match(miss?.message ?? "", /colunas 8, 9 do LD/);
  });

  it("armazenagem parte da área de recebimento; separação parte do início", () => {
    const p = basePlan();
    // Início em (0,9) embaixo à esquerda; recebimento em cima à direita.
    p.elements.push(el({ id: "rec", type: "RECEIVING_AREA", x: 16, y: 0, width: 3, height: 2 }));
    const rt = new PlanRuntime(p, slots);
    const grid = buildFloorGrid(p);
    assert.equal(rt.receivingCell, cellIndex(grid, 19, 0));
    const engine = new PhysicalRouteEngine([rt]);
    const left = loc("cA", "1", "A");
    const right = loc("cA", "7", "A");
    assert.deepEqual(engine.sortByRoute([right, left]).map((l) => l.id), [left.id, right.id]);
    assert.deepEqual(engine.sortByRoute([left, right], null, "RECEIVING").map((l) => l.id), [right.id, left.id]);

    // Sem área de recebimento, usa a doca; sem doca, o início.
    const semRec = { ...p, elements: p.elements.filter((e) => e.id !== "rec") };
    assert.equal(new PlanRuntime(semRec, slots).receivingCell, new PlanRuntime(semRec, slots).startCell);
    semRec.elements.push(el({ id: "doca", type: "DOCK", x: 19, y: 0, width: 1, height: 1 }));
    assert.equal(new PlanRuntime(semRec, slots).receivingCell, cellIndex(grid, 19, 0));
  });

  it("desvia de obstáculos", () => {
    const p = basePlan();
    p.elements.push(el({ id: "o", type: "OBSTACLE", x: 3, y: 0, width: 1, height: 6 }));
    const engine = new PhysicalRouteEngine([new PlanRuntime(p, slots)]);
    assert.ok(engine.distance(loc("cA", "1", "A"), loc("cA", "1", "B")) > 2.5);
  });

  it("não localiza face desabilitada ou posição isolada", () => {
    const p = basePlan();
    p.elements.push(
      el({ id: "top", type: "OBSTACLE", x: 3, y: 1, width: 9, height: 1 }),
      el({ id: "left", type: "OBSTACLE", x: 3, y: 2, width: 1, height: 3 }),
      el({ id: "right", type: "OBSTACLE", x: 11, y: 2, width: 1, height: 3 }),
    );
    const engine = new PhysicalRouteEngine([new PlanRuntime(p, slots)]);
    assert.equal(engine.locate(loc("cB", "1", "B")), null);
    assert.equal(engine.locate(loc("cA", "1", "A")), null);
    assert.ok(engine.locate(loc("cA", "1", "B")));
  });

  it("ordena a partir do início e deixa não mapeados no fim", () => {
    const engine = new PhysicalRouteEngine([new PlanRuntime(basePlan(), slots)]);
    const far = loc("cA", "7", "A");
    const near = loc("cB", "1", "A");
    const unmapped = { id: "u", corridor: "Z", row: "01" };
    const sorted = engine.sortByRoute([unmapped, far, near]);
    assert.deepEqual(sorted.map((l) => l.id), [near.id, far.id, "u"]);
  });

  it("com várias saídas, parte da mais próxima; com vários packings, termina perto do mais próximo", () => {
    const p = basePlan();
    p.elements.push(el({ id: "start2", type: "START_POINT", x: 19, y: 2, width: 1, height: 1 }));
    p.elements.push(el({ id: "pack2", type: "PACKING_POINT", x: 0, y: 2, width: 1, height: 1 }));
    const rt = new PlanRuntime(p, slots);
    assert.equal(rt.startPoints.length, 2);
    assert.equal(rt.packingPoints.length, 2);
    const grid = buildFloorGrid(p);
    assert.equal(rt.nearest(rt.startPoints, cellIndex(grid, 10, 2))?.elementId, "start2");
    assert.equal(rt.nearest(rt.packingPoints, cellIndex(grid, 4, 2))?.elementId, "pack2");

    const engine = new PhysicalRouteEngine([rt]);
    const left = loc("cA", "1", "A");
    const right = loc("cA", "7", "A");
    // Saída 2 (direita, em cima) e packing 2 (esquerda, em cima): direita → esquerda.
    assert.deepEqual(engine.sortByRoute([left, right]).map((l) => l.id), [right.id, left.id]);
  });

  it("tour prefere terminar perto do destino final", () => {
    const pos = [0, 10, 5];
    const d = (i: number, j: number) => Math.abs(pos[i]! - pos[j]!);
    const comFim = solveOpenTour(3, (i) => Math.abs(4 - pos[i]!), d, { toEnd: (i) => Math.abs(pos[i]!) });
    assert.equal(comFim[comFim.length - 1], 0);
    const comFimDireita = solveOpenTour(3, (i) => Math.abs(4 - pos[i]!), d, { toEnd: (i) => Math.abs(10 - pos[i]!) });
    assert.equal(comFimDireita[comFimDireita.length - 1], 1);
  });

  it("aplica penalidade quando só um lado está mapeado", () => {
    const engine = new PhysicalRouteEngine([new PlanRuntime(basePlan(), slots)]);
    assert.equal(
      engine.distance(loc("cA", "1"), { corridor: "Z", row: "1" }),
      UNMAPPED_PENALTY_METERS,
    );
  });
});

describe("route helpers", () => {
  it("escolhe o próximo item pela rota e mantém sem localização no fim", () => {
    const engine = new PhysicalRouteEngine([new PlanRuntime(basePlan(), slots)]);
    const items = [
      { id: "i1", done: false, pickLocation: loc("cA", "7") },
      { id: "i2", done: false, pickLocation: null },
      { id: "i3", done: false, pickLocation: loc("cB", "2") },
      { id: "i4", done: true, pickLocation: loc("cB", "1") },
    ];
    const pending = (i: (typeof items)[0]) => !i.done;
    assert.equal(pickNextItemByEngine(engine, items, pending)?.id, "i3");
    assert.deepEqual(
      sortPendingItemsByEngine(engine, items, pending).map((i) => i.id),
      ["i3", "i1", "i2"],
    );
  });

  it("modo legado mantém serpentina por corredor/linha", () => {
    const engine = new LegacyRouteEngine();
    const sorted = engine.sortByRoute([
      { corridor: "B", row: "01" },
      { corridor: "A", row: "03" },
      { corridor: "A", row: "01" },
    ]);
    assert.deepEqual(sorted.map((l) => `${l.corridor}${l.row}`), ["A01", "A03", "B01"]);
  });
});

describe("solveOpenTour", () => {
  it("remove cruzamentos com 2-opt", () => {
    const pts = [
      [0, 0],
      [2, 1],
      [1, 1],
      [3, 0],
    ];
    const d = (i: number, j: number) =>
      Math.hypot(pts[i]![0]! - pts[j]![0]!, pts[i]![1]! - pts[j]![1]!);
    const route = solveOpenTour(4, (i) => d(0, i) + (i === 0 ? 0 : 0.01), d);
    const total = route.slice(1).reduce((s, n, k) => s + d(route[k]!, n), 0);
    assert.ok(total <= d(0, 2) + d(2, 1) + d(1, 3) + 1e-9);
  });
});

describe("validateFloorPlan", () => {
  it("aceita planta consistente", () => {
    const labels = new Map([
      ["cA", "A"],
      ["cB", "B"],
    ]);
    const v = validateFloorPlan(basePlan(), slots, labels);
    assert.equal(v.ok, true);
    assert.equal(v.totalAccessPoints, 21);
    assert.equal(v.reachableAccessPoints, 21);
  });

  it("aponta sobreposição, gôndola sem vínculo e falta de início", () => {
    const p = plan([
      el({ id: "g1", type: "GONDOLA", x: 2, y: 2, width: 5, height: 2 }),
      el({ id: "o1", type: "OBSTACLE", x: 3, y: 3, width: 2, height: 2 }),
    ]);
    const codes = validateFloorPlan(p, slots, new Map()).issues.map((i) => i.code);
    assert.ok(codes.includes("OVERLAP"));
    assert.ok(codes.includes("GONDOLA_UNLINKED"));
    assert.ok(codes.includes("NO_START"));
  });
});
