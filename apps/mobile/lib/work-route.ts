import { router, type Href } from "expo-router";
import type { WorkShareSummary } from "@/lib/api";

export function openWorkShareRoute(route: WorkShareSummary["route"]) {
  router.push({ pathname: route.pathname, params: route.params } as Href);
}
