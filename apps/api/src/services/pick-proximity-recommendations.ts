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
    maxGroups: opts?.limit ?? 10,
    maxOrdersPerGroup: 8,
  });

  return {
    groups: clusters.map((g) => ({
      id: g.id,
      orderIds: g.orderIds,
      orders: g.orders.map((o) => ({
        id: o.id,
        erpOrderId: o.erpOrderId,
        marketplace: o.marketplace,
      })),
      routeHint: g.routeHint,
      proximityScore: g.proximityScore,
    })),
  };
}
