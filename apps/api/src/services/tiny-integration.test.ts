import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isDemoErpOrderId,
  isTinyOrderSituacaoSyncable,
  parseTinyApiPedido,
  parseTinyPedidoSituacao,
  TINY_ORDER_SITUACAO_CANCELADA,
} from "./tiny-integration.js";

describe("tiny-integration pedidos", () => {
  it("identifica pedidos demo do seed", () => {
    assert.equal(isDemoErpOrderId("ERP-DEMO-0001"), true);
    assert.equal(isDemoErpOrderId("ERP-MOB-0003"), true);
    assert.equal(isDemoErpOrderId("ERP-MOB-WAVE-01"), true);
    assert.equal(isDemoErpOrderId("ERP-10042"), true);
    assert.equal(isDemoErpOrderId("TINY-99"), false);
    assert.equal(isDemoErpOrderId("ERP-OTHER"), false);
  });

  it("filtra situações elegíveis para sync", () => {
    assert.equal(isTinyOrderSituacaoSyncable(3), true);
    assert.equal(isTinyOrderSituacaoSyncable(4), true);
    assert.equal(isTinyOrderSituacaoSyncable(7), true);
    assert.equal(isTinyOrderSituacaoSyncable(1), true);
    assert.equal(isTinyOrderSituacaoSyncable(TINY_ORDER_SITUACAO_CANCELADA), false);
    assert.equal(isTinyOrderSituacaoSyncable(5), false);
    assert.equal(isTinyOrderSituacaoSyncable(null), false);
  });

  it("parseia pedido API v3 com itens e cliente", () => {
    const payload = parseTinyApiPedido({
      id: 12345,
      situacao: 3,
      dataPrevista: "2026-06-10",
      cliente: { nome: "Cliente Teste" },
      ecommerce: { nome: "Mercado Livre", canalVenda: "ML" },
      naturezaOperacao: { nome: "Venda" },
      itens: [
        {
          quantidade: 2,
          produto: { sku: "SKU-001", descricao: "Produto A" },
        },
      ],
    });

    assert.ok(payload);
    assert.equal(payload.erpOrderId, "TINY-12345");
    assert.equal(payload.customerName, "Cliente Teste");
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]!.sku, "SKU-001");
    assert.equal(payload.items[0]!.quantity, 2);
    assert.ok(payload.collectionDeadline instanceof Date);
  });

  it("retorna null sem itens ou situação ignorada", () => {
    assert.equal(
      parseTinyApiPedido({ id: 1, situacao: 5, itens: [] }),
      null,
    );
    assert.equal(
      parseTinyApiPedido({
        id: 2,
        situacao: 3,
        itens: [{ quantidade: 1, produto: {} }],
      }),
      null,
    );
  });

  it("extrai situação numérica do pedido", () => {
    assert.equal(parseTinyPedidoSituacao({ situacao: 4 }), 4);
    assert.equal(parseTinyPedidoSituacao({ situacao: "7" }), 7);
    assert.equal(parseTinyPedidoSituacao({}), null);
  });
});
