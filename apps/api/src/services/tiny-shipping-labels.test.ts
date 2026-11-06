import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import {
  parseTinyPedidoId,
  detectLabelFormat,
  apiLabelFormat,
  unwrapShippingLabelPayload,
  isDemoPackErpOrderId,
  buildDemoShippingLabelZpl,
  DEMO_LABEL_SCHEME,
} from "./tiny-shipping-labels.js";
import {
  isOneStepRetryable,
  needsConcludeEtiqueta,
  type OneStepShippingItem,
} from "./tiny-expedicao-labels.js";

describe("parseTinyPedidoId", () => {
  it("parses TINY-{id}", () => {
    assert.equal(parseTinyPedidoId("TINY-862886936"), 862886936);
    assert.equal(parseTinyPedidoId("tiny-123"), 123);
  });

  it("returns null for invalid ids", () => {
    assert.equal(parseTinyPedidoId("PED-1"), null);
    assert.equal(parseTinyPedidoId(""), null);
  });
});

describe("detectLabelFormat", () => {
  it("detects zpl, pdf and zip urls", () => {
    assert.equal(
      detectLabelFormat("https://s3.amazonaws.com/foo/etiqueta.zpl"),
      "zpl",
    );
    assert.equal(detectLabelFormat("https://example.com/label.pdf"), "pdf");
    assert.equal(
      detectLabelFormat("https://s3.amazonaws.com/foo/etiqueta.zip"),
      "zip",
    );
    assert.equal(detectLabelFormat("https://example.com/unknown"), "unknown");
    assert.equal(detectLabelFormat(`${DEMO_LABEL_SCHEME}abc`), "zpl");
  });

  it("apiLabelFormat maps zip to unknown", () => {
    assert.equal(apiLabelFormat("https://example.com/a.zip"), "unknown");
    assert.equal(apiLabelFormat("https://example.com/a.zpl"), "zpl");
  });
});

describe("unwrapShippingLabelPayload", () => {
  it("extracts ZPL from Shopee-style ZIP (.txt with ~DGR)", () => {
    const zpl = "~DGR:DEMO.GRF,10,1,:Z64:abc^\n^XA^FO50,50^FDTEST^FS^XZ\n";
    const zipped = Buffer.from(
      zipSync({
        "thermal_zpl_shipping_label.txt": new TextEncoder().encode(zpl),
      }),
    );
    const out = unwrapShippingLabelPayload(
      zipped,
      "https://s3.amazonaws.com/tiny-tmp/etiquetas/abc.zip",
    );
    assert.equal(out.fromZip, true);
    assert.equal(out.format, "zpl");
    assert.match(out.content.toString("utf-8"), /\^XA/);
    assert.equal(out.filenameHint, "thermal_zpl_shipping_label.zpl");
  });

  it("sniffs ZPL even when URL has no extension (Correios/S3)", () => {
    const zpl = "^XA^FO40,40^FDHI^FS^XZ\n";
    const out = unwrapShippingLabelPayload(
      Buffer.from(zpl, "utf-8"),
      "https://s3.amazonaws.com/tiny-tmp/etiquetas/abc123",
    );
    assert.equal(out.fromZip, false);
    assert.equal(out.format, "zpl");
  });

  it("sniffs PDF magic bytes without .pdf in URL (Amazon-style)", () => {
    const pdf = Buffer.from("%PDF-1.4 fake-content");
    const out = unwrapShippingLabelPayload(
      pdf,
      "https://s3.amazonaws.com/tiny-tmp/etiquetas/amazon-label",
    );
    assert.equal(out.fromZip, false);
    assert.equal(out.format, "pdf");
    assert.equal(out.contentType, "application/pdf");
  });

  it("extracts PDF from ZIP", () => {
    const pdf = Buffer.from("%PDF-1.4 inside-zip");
    const zipped = Buffer.from(
      zipSync({
        "label.pdf": new Uint8Array(pdf),
      }),
    );
    const out = unwrapShippingLabelPayload(
      zipped,
      "https://example.com/label.zip",
    );
    assert.equal(out.fromZip, true);
    assert.equal(out.format, "pdf");
  });

  it("passes through plain ZPL without unzip", () => {
    const zpl = "^XA^FO40,40^FDHI^FS^XZ\n";
    const out = unwrapShippingLabelPayload(
      Buffer.from(zpl, "utf-8"),
      "https://example.com/label.zpl",
    );
    assert.equal(out.fromZip, false);
    assert.equal(out.format, "zpl");
    assert.equal(out.content.toString("utf-8"), zpl);
  });
});

describe("demo packing labels", () => {
  it("recognizes DEMO-PACK erp ids", () => {
    assert.equal(isDemoPackErpOrderId("DEMO-PACK-2000"), true);
    assert.equal(isDemoPackErpOrderId("TINY-1"), false);
  });

  it("builds printable ZPL", () => {
    const zpl = buildDemoShippingLabelZpl({
      erpOrderId: "DEMO-PACK-2000",
      customerName: "Cliente X",
      marketplace: "AMAZON",
      basketCode: "DEMO-C01",
    });
    assert.match(zpl, /\^XA/);
    assert.match(zpl, /DEMO-PACK-2000/);
    assert.match(zpl, /SIMULADA/);
    assert.match(zpl, /\^XZ/);
  });
});

describe("needsConcludeEtiqueta", () => {
  it("detects conclude messages", () => {
    assert.equal(
      needsConcludeEtiqueta("Agrupamento ainda não foi concluído"),
      true,
    );
    assert.equal(needsConcludeEtiqueta("ok"), false);
  });
});

describe("isOneStepRetryable", () => {
  it("retries Tiny code 39 (timeout budget)", () => {
    const item: OneStepShippingItem = {
      idPedido: 1,
      idExpedicao: null,
      idAgrupamento: null,
      urls: [],
      erro: { codigo: 39, mensagem: "timeout" },
    };
    assert.equal(isOneStepRetryable(item), true);
    assert.equal(
      isOneStepRetryable({ ...item, erro: { codigo: 35, mensagem: "ml" } }),
      false,
    );
    assert.equal(isOneStepRetryable(null), false);
  });
});
