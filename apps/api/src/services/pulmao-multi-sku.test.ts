import { test } from "node:test";
import assert from "node:assert/strict";
import { LocationFace, LocationType } from "@prisma/client";
import { summarizeStoredLocations } from "./putaway.js";
import { assertLocationTypeChange, assertPulmaoWithoutFixedSku } from "./location-rules.js";

const pulmao = (id: string, barcode: string) => ({
  id,
  barcode,
  corridor: "B1-P",
  row: barcode.slice(-1),
  estanteId: null,
  face: LocationFace.A,
});

test("armazenagem: item guardado em dois pulmões soma as guardas do mesmo pulmão", () => {
  const p1 = pulmao("l1", "P-01");
  const p2 = pulmao("l2", "P-02");
  const stored = summarizeStoredLocations([
    { quantity: 10, toLocation: p1 },
    { quantity: 4, toLocation: p2 },
    { quantity: 6, toLocation: p1 },
  ]);
  assert.deepEqual(
    stored.map((s) => [s.barcode, s.quantity]),
    [
      ["P-01", 16],
      ["P-02", 4],
    ],
  );
  assert.equal(stored[0]!.label, "B1-P-1 · P-01");
});

test("armazenagem: movimentação sem pulmão de destino é ignorada", () => {
  assert.deepEqual(summarizeStoredLocations([{ quantity: 3, toLocation: null }]), []);
});

test("pulmão não aceita SKU fixo; gôndola aceita", () => {
  assert.throws(() => assertPulmaoWithoutFixedSku(LocationType.PULMAO, "prod-1"), /não tem SKU fixo/);
  assert.doesNotThrow(() => assertPulmaoWithoutFixedSku(LocationType.PULMAO, null));
  assert.doesNotThrow(() => assertPulmaoWithoutFixedSku(LocationType.PICK_FACE, "prod-1"));
});

test("troca de tipo só com a posição vazia (0%)", () => {
  const cheio = { type: LocationType.PULMAO, fillPercent: 40, barcode: "P-01" };
  assert.throws(() => assertLocationTypeChange(cheio, LocationType.PICK_FACE), /esvazie/);
  assert.doesNotThrow(() => assertLocationTypeChange(cheio, LocationType.PULMAO));
  assert.doesNotThrow(() => assertLocationTypeChange(cheio, undefined));
  assert.doesNotThrow(() =>
    assertLocationTypeChange({ ...cheio, fillPercent: 0 }, LocationType.PICK_FACE),
  );
});
