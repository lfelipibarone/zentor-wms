import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeTinySyncProgressPercent,
  buildTinySyncProgressLabel,
  isTinySyncCheckpointResumable,
  parseTinySyncCheckpoint,
} from "./tiny-sync-checkpoint.js";

describe("tiny-sync-checkpoint", () => {
  const base: NonNullable<ReturnType<typeof parseTinySyncCheckpoint>> = {
    status: "running",
    kind: "products",
    offset: 200,
    total: 1500,
    startedAt: "2026-06-12T10:00:00.000Z",
    updatedAt: new Date().toISOString(),
    connectionId: "conn-1",
  };

  it("parseia checkpoint válido", () => {
    const cp = parseTinySyncCheckpoint(JSON.stringify(base));
    assert.equal(cp?.offset, 200);
    assert.equal(cp?.kind, "products");
  });

  it("rejeita JSON inválido ou status diferente de running", () => {
    assert.equal(parseTinySyncCheckpoint(null), null);
    assert.equal(parseTinySyncCheckpoint("{"), null);
    assert.equal(
      parseTinySyncCheckpoint(JSON.stringify({ ...base, status: "done" })),
      null,
    );
  });

  it("retoma quando há checkpoint recente e mesma conexão", () => {
    assert.equal(
      isTinySyncCheckpointResumable(base, { connectionId: "conn-1" }),
      true,
    );
  });

  it("não retoma com forceRestart ou conexão diferente", () => {
    assert.equal(
      isTinySyncCheckpointResumable(base, { forceRestart: true }),
      false,
    );
    assert.equal(
      isTinySyncCheckpointResumable(base, { connectionId: "outra" }),
      false,
    );
  });

  it("não retoma checkpoint expirado (>7 dias)", () => {
    const stale = {
      ...base,
      updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };
    assert.equal(isTinySyncCheckpointResumable(stale), false);
  });

  it("parseia checkpoint de pedidos", () => {
    const cp = parseTinySyncCheckpoint(
      JSON.stringify({
        ...base,
        kind: "orders",
        situacaoIndex: 2,
        situacao: 3,
        phase: "syncable",
        days: 30,
      }),
    );
    assert.equal(cp?.kind, "orders");
    assert.equal(cp?.situacaoIndex, 2);
    assert.equal(cp?.phase, "syncable");
  });

  it("calcula progresso de produtos", () => {
    assert.equal(computeTinySyncProgressPercent(base), 13);
    assert.match(buildTinySyncProgressLabel(base), /offset 200/);
  });

  it("calcula progresso de pedidos por fase", () => {
    const ordersCp = {
      ...base,
      kind: "orders" as const,
      offset: 100,
      total: 400,
      situacaoIndex: 1,
      situacao: 1,
      phase: "syncable" as const,
      days: 30,
    };
    const pct = computeTinySyncProgressPercent(ordersCp);
    assert.ok(pct !== null && pct > 0 && pct < 100);
    assert.match(buildTinySyncProgressLabel(ordersCp), /Faturada/);
  });
});
