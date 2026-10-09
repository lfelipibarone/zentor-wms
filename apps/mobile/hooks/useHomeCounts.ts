import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/** Contadores da tela inicial — recarregam ao voltar para ela, sem polling. */
export function useHomeCounts() {
  const orders = useQuery({
    queryKey: ["picking", "queue"],
    queryFn: api.getQueue,
    retry: false,
  });
  const wave = useQuery({
    queryKey: ["wave", "current"],
    queryFn: () => api.getCurrentWave(),
    retry: false,
  });
  const putaway = useQuery({
    queryKey: ["putaway-queue"],
    queryFn: async () => (await api.getPutawayQueue()).queue,
    retry: false,
  });
  const replenishment = useQuery({
    queryKey: ["replenishment", "needs"],
    queryFn: () => api.listReplenishmentNeeds(),
    retry: false,
  });

  useFocusEffect(
    useCallback(() => {
      void orders.refetch();
      void wave.refetch();
      void putaway.refetch();
      void replenishment.refetch();
    }, [orders.refetch, wave.refetch, putaway.refetch, replenishment.refetch]),
  );

  const needs = replenishment.data?.needs ?? [];
  return {
    picking: orders.data?.orders.length ?? 0,
    waveOpen: Boolean(wave.data?.wave && (wave.data.wave.canAccept || wave.data.wave.canWork)),
    putaway: putaway.data?.length ?? 0,
    replenishment: needs.filter((n) => n.canAccept || n.isMine).length,
  };
}
