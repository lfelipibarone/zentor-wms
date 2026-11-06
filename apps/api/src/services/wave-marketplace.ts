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

/** Agrupa pedidos por marketplace (null → chave vazia) para liberar uma onda por loja. */
export function groupOrdersByMarketplace<T extends OrderMarketplace>(
  orders: T[],
): Array<{ marketplace: string | null; orders: T[] }> {
  const map = new Map<string, { marketplace: string | null; orders: T[] }>();
  for (const order of orders) {
    const marketplace = order.marketplace ?? null;
    const key = marketplace ?? "";
    const bucket = map.get(key);
    if (bucket) bucket.orders.push(order);
    else map.set(key, { marketplace, orders: [order] });
  }
  return [...map.values()];
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
