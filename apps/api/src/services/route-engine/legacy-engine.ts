import {
  locationDistance,
  sortLocationsByRoute,
  toRouteCoord,
} from "../location-route.js";
import type { RoutableLocation, RouteEngine } from "./types.js";

/** Comportamento atual: coordenada abstrata (corredor, linha) e serpentina. */
export class LegacyRouteEngine implements RouteEngine {
  readonly kind = "LEGACY" as const;

  distance(a: RoutableLocation, b: RoutableLocation): number {
    return locationDistance(toRouteCoord(a), toRouteCoord(b));
  }

  sortByRoute<T extends RoutableLocation>(
    locations: T[],
    start?: RoutableLocation | null,
  ): T[] {
    return sortLocationsByRoute(locations, start ? toRouteCoord(start) : null);
  }

  locate(): null {
    return null;
  }
}
