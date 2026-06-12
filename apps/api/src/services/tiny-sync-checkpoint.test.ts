import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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

  it("não retoma checkpoint expirado", () => {
    const stale = {
      ...base,
      updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };
    assert.equal(isTinySyncCheckpointResumable(stale), false);
  });
});
