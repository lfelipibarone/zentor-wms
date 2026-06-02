import { PickWaveError } from "./pick-wave-error.js";

type OrderMarketplace = { marketplace: string | null };

export function assertUniformMarketplace(
  orders: OrderMarketplace[],
): string | null {
  if (orders.length === 0) return null;
  const first = orders[0]!.marketplace ?? null;
  for (const o of orders) {
    const m = o.marketplace ?? null;
    if (m !== first) {
      throw new PickWaveError(
        "Não é possível formar onda com pedidos de marketplaces diferentes. Filtre ou selecione pedidos de uma única loja.",
      );
    }
  }
  return first;
}

export function assertOrdersMatchWaveMarketplace(
  waveMarketplace: string | null | undefined,
  orders: OrderMarketplace[],
): void {
  const expected = waveMarketplace ?? null;
  for (const o of orders) {
    const m = o.marketplace ?? null;
    if (m !== expected) {
      throw new PickWaveError(
        "Pedido de marketplace diferente da onda — filtre pela mesma loja",
      );
    }
  }
}
