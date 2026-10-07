import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { splitIntoChunks, WorkShareError, type WorkShareSummary } from "./work-share.js";
import { aggregateByUserStage, formatHms } from "./work-share-metrics.js";

const units = (n: number) => n;

describe("splitIntoChunks", () => {
  it("mantém a ordem e não deixa bloco vazio", () => {
    const items = [1, 1, 1, 1, 1, 1, 1];
    const chunks = splitIntoChunks(items, 3, units);
    assert.equal(chunks.length, 3);
    assert.ok(chunks.every((c) => c.length > 0));
    assert.deepEqual(chunks.flat(), items);
  });

  it("equilibra pelas unidades, não pela contagem de itens", () => {
    const items = [10, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const [a, b] = splitIntoChunks(items, 2, units);
    assert.deepEqual(a, [10]);
    assert.equal(b!.reduce((s, x) => s + x, 0), 10);
  });

  it("divide unidades iguais em blocos seguidos de mesmo peso", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ id: i, qty: 5 }));
    const chunks = splitIntoChunks(items, 4, (it) => it.qty);
    assert.deepEqual(
      chunks.map((c) => c.length),
      [3, 3, 3, 3],
    );
    assert.deepEqual(
      chunks.flat().map((it) => it.id),
      items.map((it) => it.id),
    );
  });

  it("com 1 agente devolve tudo num bloco", () => {
    assert.deepEqual(splitIntoChunks([3, 2, 1], 1, units), [[3, 2, 1]]);
  });

  it("um item por agente quando há exatamente N itens", () => {
    assert.deepEqual(splitIntoChunks([100, 1, 1], 3, units), [[100], [1], [1]]);
  });

  it("recusa mais agentes que itens", () => {
    assert.throws(() => splitIntoChunks([1, 2], 3, units), WorkShareError);
  });

  it("peso zero conta como 1 para não gerar bloco vazio", () => {
    const chunks = splitIntoChunks([0, 0, 0, 0], 2, units);
    assert.deepEqual(
      chunks.map((c) => c.length),
      [2, 2],
    );
  });
});

function share(partial: Partial<WorkShareSummary>): WorkShareSummary {
  return {
    id: "s",
    kind: "PICK_WAVE",
    kindLabel: "Separação em onda",
    status: "FINISHED",
    shareIndex: 1,
    shareCount: 2,
    title: "Onda 1",
    subtitle: null,
    assignedTo: { id: "u1", name: "Ana" },
    assignedBy: null,
    itemsTotal: 4,
    unitsTotal: 10,
    itemsDone: 4,
    unitsDone: 10,
    reservedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedSec: 600,
    waveId: "w",
    wavePartId: "p",
    receiptSessionId: null,
    putawaySessionId: null,
    route: { pathname: "/wave-picking", params: {} },
    ...partial,
  };
}

describe("aggregateByUserStage", () => {
  it("soma por funcionário e etapa e ignora partes não concluídas", () => {
    const rows = aggregateByUserStage([
      share({ id: "a", elapsedSec: 600, unitsDone: 10 }),
      share({ id: "b", elapsedSec: 1200, unitsDone: 20, itemsDone: 6 }),
      share({ id: "c", status: "STARTED", elapsedSec: 99 }),
      share({
        id: "d",
        kind: "RECEIPT_CHECK",
        kindLabel: "Conferência NF",
        elapsedSec: 300,
        unitsDone: 5,
        itemsDone: 2,
      }),
      share({ id: "e", assignedTo: { id: "u2", name: "Bruno" }, elapsedSec: 60, unitsDone: 1 }),
    ]);
    assert.equal(rows.length, 3);
    const anaWave = rows.find((r) => r.userId === "u1" && r.kind === "PICK_WAVE")!;
    assert.equal(anaWave.tasks, 2);
    assert.equal(anaWave.units, 30);
    assert.equal(anaWave.items, 10);
    assert.equal(anaWave.totalSec, 1800);
    assert.equal(anaWave.avgSec, 900);
    assert.equal(anaWave.unitsPerHour, 60);
    assert.deepEqual(
      rows.map((r) => `${r.userName}:${r.kind}`),
      ["Ana:RECEIPT_CHECK", "Ana:PICK_WAVE", "Bruno:PICK_WAVE"],
    );
  });

  it("formata horas:minutos:segundos", () => {
    assert.equal(formatHms(3725), "1:02:05");
    assert.equal(formatHms(59), "0:00:59");
    assert.equal(formatHms(null), null);
  });
});
