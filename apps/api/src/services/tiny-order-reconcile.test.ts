import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OrderStatus } from "@prisma/client";
import { decideTinyOrderReconcileAction } from "./tiny-order-reconcile.js";

describe("decideTinyOrderReconcileAction", () => {
  const base = {
    status: OrderStatus.PENDING,
    hasOperationalProgress: false,
    alreadyFlagged: false,
  };

  it("mantém pedidos ainda abertos no Tiny", () => {
    for (const situacao of [0, 1, 3, 4, 7, 8, null]) {
      assert.equal(decideTinyOrderReconcileAction({ ...base, situacao }), "keep");
    }
  });

  it("remove pendentes já cancelados, enviados, entregues ou não entregues", () => {
    for (const situacao of [2, 5, 6, 9]) {
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
