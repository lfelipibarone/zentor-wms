import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseTinyPedidoId,
  detectLabelFormat,
} from "./tiny-shipping-labels.js";
import { needsConcludeEtiqueta } from "./tiny-expedicao-labels.js";

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
  it("detects zpl and pdf urls", () => {
    assert.equal(
      detectLabelFormat("https://s3.amazonaws.com/foo/etiqueta.zpl"),
      "zpl",
    );
    assert.equal(detectLabelFormat("https://example.com/label.pdf"), "pdf");
    assert.equal(detectLabelFormat("https://example.com/unknown"), "unknown");
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
