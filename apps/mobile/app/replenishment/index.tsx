import { useEffect } from "react";
import { router } from "expo-router";

/** Fluxo unificado em Transporte de carga + Abastecer estoque. */
export default function ReplenishmentRedirect() {
  useEffect(() => {
    router.replace("/cargo-transport");
  }, []);
  return null;
}
