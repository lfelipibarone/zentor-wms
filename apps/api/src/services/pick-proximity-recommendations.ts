import { buildPickProximityGroups } from "./order-proximity.js";
import { buildWaveCandidateOrders } from "./pick-wave.js";
import { getWaveSettings } from "./wave-settings.js";

export async function getPickProximityGroups(
  tenantId: string,
  opts?: { marketplace?: string; limit?: number },
) {
  const settings = await getWaveSettings(tenantId);
  const orders = await buildWaveCandidateOrders(tenantId, {
    marketplace: opts?.marketplace,
    maxOrders: 200,
  });

  const clusters = await buildPickProximityGroups(tenantId, orders, {
    maxDistance: settings.proximityMaxDistance,
    maxDistanceMeters: settings.proximityMaxDistanceMeters,
    maxGroups: (opts?.limit ?? 10) * 3,
    maxOrdersPerGroup: 8,
  });

  // pedido sozinho não é sugestão de agrupamento
  const groups = clusters.filter((g) => g.orders.length >= 2).slice(0, opts?.limit ?? 10);

  return {
    groups: groups.map((g) => {
      const deadlines = g.orders
        .map((o) => o.collectionDeadline?.getTime())
        .filter((t): t is number => t != null);
      return {
        id: g.id,
        orderIds: g.orderIds,
        orders: g.orders.map((o) => ({
          id: o.id,
          erpOrderId: o.erpOrderId,
          marketplace: o.marketplace,
          customerName: o.customerName,
        })),
        routeHint: g.routeHint === "—" ? null : g.routeHint,
        locationCount: g.locationCount ?? 0,
        units: g.orders.reduce(
          (s, o) =>
            s + o.items.reduce((n, it) => n + Math.max(0, it.quantityOrdered - it.quantityPicked), 0),
          0,
        ),
        earliestDeadline: deadlines.length ? new Date(Math.min(...deadlines)) : null,
        proximityScore: g.proximityScore,
      };
    }),
  };
}
