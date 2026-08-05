import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractImageUrlFromTinyProduct,
  isTinyProductSituacaoSyncable,
  parseTinyProductDetail,
} from "./tiny-product-sync.js";

describe("tiny product sync", () => {
  it("ignora produtos excluídos no Tiny", () => {
    assert.equal(isTinyProductSituacaoSyncable("A"), true);
    assert.equal(isTinyProductSituacaoSyncable("I"), true);
    assert.equal(isTinyProductSituacaoSyncable("E"), false);
  });

  it("extrai imageUrl de anexos preferindo interno", () => {
    const url = extractImageUrlFromTinyProduct({
      anexos: [
        { url: "https://externo.example/a.jpg", externo: true },
        { url: "https://interno.example/b.jpg", externo: false },
      ],
    });
    assert.equal(url, "https://interno.example/b.jpg");
  });

  it("mapeia detalhe Tiny para payloads WMS incluindo variações", () => {
    const payloads = parseTinyProductDetail({
      id: 1,
      sku: "PAI-01",
      descricao: "Produto pai",
      situacao: "A",
      unidade: "UN",
      gtin: "7891000000001",
      dimensoes: { pesoLiquido: 1.5, pesoBruto: 0 },
      anexos: [{ url: "https://img.example/pai.jpg", externo: false }],
      estoque: { quantidade: 475 },
      fornecedores: [{ id: 893028952, nome: "FORNECEDOR", codigoProdutoNoFornecedor: "" }],
      variacoes: [
        {
          id: 2,
          sku: "VAR-01",
          descricao: "Variação P",
          situacao: "A",
          gtin: "7891000000002",
          estoque: { quantidade: 12 },
        },
      ],
    });

    assert.equal(payloads.length, 2);
    assert.deepEqual(
      payloads.map((p) => p.sku),
      ["PAI-01", "VAR-01"],
    );
    assert.equal(payloads[0]?.imageUrl, "https://img.example/pai.jpg");
    assert.equal(payloads[1]?.imageUrl, "https://img.example/pai.jpg");
    assert.equal(payloads[0]?.weight, 1.5);
    assert.equal(payloads[0]?.barcode, "7891000000001");
    assert.equal(payloads[0]?.active, true);
    assert.equal(payloads[0]?.supplierName, "FORNECEDOR");
    assert.equal(payloads[0]?.erpStockQuantity, 475);
    assert.equal(payloads[1]?.erpStockQuantity, 12);
  });

  it("omite produto excluído", () => {
    const payloads = parseTinyProductDetail({
      id: 9,
      sku: "DEL-01",
      descricao: "Excluído",
      situacao: "E",
    });
    assert.equal(payloads.length, 0);
  });

  it("omite kits (tipo K)", () => {
    const payloads = parseTinyProductDetail({
      id: 10,
      sku: "KIT-01",
      descricao: "Kit promocional",
      situacao: "A",
      tipo: "K",
    });
    assert.equal(payloads.length, 0);
  });
});
