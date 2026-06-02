import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractTinyPriorityFromRecord,
  normalizeTinyPriority,
  parseTinyPedidoIdFromErpOrderId,
} from "./tiny-order-priority.js";

describe("tiny-order-priority", () => {
  it("normaliza escala 1-5 para 0-100", () => {
    assert.equal(normalizeTinyPriority(1), 20);
    assert.equal(normalizeTinyPriority(5), 100);
  });

  it("mantém valores já em 0-100", () => {
    assert.equal(normalizeTinyPriority(85), 85);
  });

  it("extrai prioridade do webhook", () => {
    const raw = extractTinyPriorityFromRecord({
      pedido: { prioridade: 4 },
    });
    assert.equal(raw, 4);
    assert.equal(normalizeTinyPriority(raw!), 80);
  });

  it("parseia id Tiny do erpOrderId", () => {
    assert.equal(parseTinyPedidoIdFromErpOrderId("TINY-12345"), 12345);
    assert.equal(parseTinyPedidoIdFromErpOrderId("OTHER-1"), null);
  });
});
