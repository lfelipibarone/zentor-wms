import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeMarketplace } from "@wms/shared";

describe("normalizeMarketplace", () => {
  it("reconhece Mercado Livre e MELI", () => {
    assert.equal(normalizeMarketplace("Mercado Livre Mamute"), "MERCADO_LIVRE");
    assert.equal(normalizeMarketplace("MELI"), "MERCADO_LIVRE");
    assert.equal(normalizeMarketplace("MERCADO_LIVRE"), "MERCADO_LIVRE");
  });

  it("não confunde Mercadorias (natureza fiscal) com Mercado Livre", () => {
    assert.equal(
      normalizeMarketplace("Venda de Mercadorias - Regime normal"),
      null,
    );
    assert.equal(normalizeMarketplace("Mercadorias"), null);
  });

  it("reconhece Shopee e Amazon", () => {
    assert.equal(normalizeMarketplace("Shopee Loja Carbi"), "SHOPEE");
    assert.equal(normalizeMarketplace("Amazon"), "AMAZON");
  });
});
