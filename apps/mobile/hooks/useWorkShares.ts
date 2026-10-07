import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { api, type WorkShareKind } from "@/lib/api";

export function useColleagues(enabled = true) {
  return useQuery({
    queryKey: ["work", "colleagues"],
    queryFn: () => api.listColleagues(),
    enabled,
    staleTime: 60_000,
  });
}

export function useMyWork() {
  return useQuery({
    queryKey: ["work", "mine"],
    queryFn: () => api.listMyWork(),
    refetchInterval: 20_000,
  });
}

/** Divide (ou aceita sozinho) — o usuário logado sempre fica com a parte 1. */
export function useSplitWork() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (body: {
      kind: WorkShareKind;
      refId: string;
      partId?: string | null;
      colleagueIds: string[];
    }) => {
      if (!user) throw new Error("Faça login novamente");
      return api.splitWork({
        kind: body.kind,
        refId: body.refId,
        partId: body.partId,
        assigneeIds: [user.id, ...body.colleagueIds],
      });
    },
    onSuccess: () => qc.invalidateQueries(),
  });
}

export function useWorkShareActions() {
  const qc = useQueryClient();
  const onSuccess = () => qc.invalidateQueries();
  const start = useMutation({ mutationFn: (shareId: string) => api.startWorkShare(shareId), onSuccess });
  const decline = useMutation({
    mutationFn: (shareId: string) => api.declineWorkShare(shareId),
    onSuccess,
  });
  const reassign = useMutation({
    mutationFn: (v: { shareId: string; userId: string }) => api.reassignWorkShare(v.shareId, v.userId),
    onSuccess,
  });
  return { start, decline, reassign };
}
