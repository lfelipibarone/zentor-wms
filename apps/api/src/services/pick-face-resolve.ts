import { Location, LocationType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getRouteEngine, LegacyRouteEngine } from "./route-engine/index.js";

export class PickFaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PickFaceError";
  }
}

/**
 * Gôndola de estoque de giro do produto.
 * - `pick`: entre as que têm produto (% > 0), a de menor % (esvazia primeiro); sem nenhuma, a primeira da rota.
 * - `deposit`: a de menor %.
 * Empate por rota.
 */
export async function resolvePickFaceForProduct(
  productId: string,
  tenantId?: string,
  purpose: "pick" | "deposit" = "pick",
): Promise<Location> {
  const locations = await prisma.location.findMany({
    where: {
      type: LocationType.PICK_FACE,
      active: true,
      productId,
      ...(tenantId ? { tenantId } : {}),
    },
  });

  if (locations.length === 0) {
    throw new PickFaceError(
      "Nenhum endereço de estoque de giro ativo para este produto. Cadastre ou abasteça.",
    );
  }

  const withStock = locations.filter((l) => l.fillPercent > 0);
  const pool = purpose === "pick" && withStock.length > 0 ? withStock : locations;
  const minPct = Math.min(...pool.map((l) => l.fillPercent));
  const tied =
    purpose === "pick" && withStock.length === 0
      ? pool
      : pool.filter((l) => l.fillPercent === minPct);
  if (tied.length === 1) return tied[0]!;

  const engine = tenantId ? await getRouteEngine(tenantId) : new LegacyRouteEngine();
  return engine.sortByRoute(tied)[0]!;
}

export async function suggestPickFaceDeposit(
  tenantId: string,
  productId: string,
): Promise<Location | null> {
  try {
    return await resolvePickFaceForProduct(productId, tenantId, "deposit");
  } catch {
    return null;
  }
}
