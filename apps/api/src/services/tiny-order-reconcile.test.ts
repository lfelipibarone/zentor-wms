import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrderStatus } from "@prisma/client";
import {
  decideTinyOrderReconcileAction,
  decideTinySeparacaoBlockAction,
} from "./tiny-order-reconcile.js";

describe("decideTinyOrderReconcileAction", () => {
  const base = {
    status: OrderStatus.PENDING,
    hasOperationalProgress: false,
    alreadyFlagged: false,
  };

  it("mantém pedidos ainda no estágio importável do Tiny", () => {
    for (const situacao of [1, null]) {
      assert.equal(decideTinyOrderReconcileAction({ ...base, situacao }), "keep");
    }
  });

  it("remove pendentes que já saíram do estágio importável no Tiny", () => {
    for (const situacao of [0, 2, 3, 4, 5, 6, 7, 8, 9]) {
      assert.equal(
        decideTinyOrderReconcileAction({ ...base, situacao }),
        "remove",
      );
    }
  });

  it("remove pausados por integração, mas não pausados durante a operação", () => {
    assert.equal(
      decideTinyOrderReconcileAction({
        ...base,
        status: OrderStatus.PAUSED_ISSUE,
        situacao: 5,
      }),
      "remove",
    );
    assert.equal(
      decideTinyOrderReconcileAction({
        ...base,
        status: OrderStatus.PAUSED_ISSUE,
        hasOperationalProgress: true,
        situacao: 5,
      }),
      "keep",
    );
  });

  it("pausa pedidos em operação cancelados no Tiny uma única vez", () => {
    assert.equal(
      decideTinyOrderReconcileAction({
        ...base,
        status: OrderStatus.PICKING,
        hasOperationalProgress: true,
        situacao: 2,
      }),
      "flag_cancelled",
    );
    assert.equal(
      decideTinyOrderReconcileAction({
        ...base,
        status: OrderStatus.PAUSED_ISSUE,
        hasOperationalProgress: true,
        alreadyFlagged: true,
        situacao: 2,
      }),
      "keep",
    );
  });

  it("não mexe em pedidos em operação já enviados no Tiny", () => {
    assert.equal(
      decideTinyOrderReconcileAction({
        ...base,
        status: OrderStatus.DISPATCHING,
        hasOperationalProgress: true,
        situacao: 5,
      }),
      "keep",
    );
  });
});

describe("decideTinySeparacaoBlockAction", () => {
  it("remove PENDING em Em Separação no Tiny", () => {
    assert.equal(
      decideTinySeparacaoBlockAction({
        separacaoSituacao: 4,
        status: OrderStatus.PENDING,
        hasOperationalProgress: false,
      }),
      "remove",
    );
  });

  it("mantém Aguardando Separação, Separada e pedidos já em operação no WMS", () => {
    for (const separacaoSituacao of [1, 2, 3, null]) {
      assert.equal(
        decideTinySeparacaoBlockAction({
          separacaoSituacao,
          status: OrderStatus.PENDING,
          hasOperationalProgress: false,
        }),
        "keep",
      );
    }
    assert.equal(
      decideTinySeparacaoBlockAction({
        separacaoSituacao: 4,
        status: OrderStatus.PICKING,
        hasOperationalProgress: true,
      }),
      "keep",
    );
  });
});
