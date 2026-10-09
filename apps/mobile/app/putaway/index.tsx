import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScreenShell } from "@/components/ScreenShell";
import { SplitWorkModal } from "@/components/SplitWorkModal";
import { Badge, Card, EmptyState, Loading, Notice } from "@/components/ui";
import { usePutawayQueue } from "@/hooks/usePutaway";
import { useSplitWork } from "@/hooks/useWorkShares";
import { ApiError, type PutawayQueueItem } from "@/lib/api";
import { showErrorAlert } from "@/lib/app-alert";
import { modules } from "@/lib/modules";
import { theme, spacing, typography, radius } from "@/lib/theme";

const color = modules.armazenagem.color;

export default function PutawayListScreen() {
  const { data, isLoading, error, refetch, isRefetching } = usePutawayQueue();
  const splitWork = useSplitWork();
  const [toSplit, setToSplit] = useState<PutawayQueueItem | null>(null);

  const openItem = (item: PutawayQueueItem) => {
    if (item.putawaySessionId && item.status !== "PENDING") {
      router.push(`/putaway/${item.putawaySessionId}`);
      return;
    }
    setToSplit(item);
  };

  const handleSplit = async (colleagueIds: string[]) => {
    if (!toSplit) return;
    try {
      const res = await splitWork.mutateAsync({
        kind: "PUTAWAY",
        refId: toSplit.purchaseReceiptId,
        colleagueIds,
      });
      setToSplit(null);
      const sessionId = res.mine?.putawaySessionId ?? res.shares[0]?.putawaySessionId;
      if (sessionId) router.push(`/putaway/${sessionId}`);
      else void refetch();
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao iniciar armazenagem",
      );
    }
  };

  return (
    <ScreenShell
      module="armazenagem"
      title="Armazenagem"
      subtitle={data ? `${data.length} NF na fila` : null}
      style={styles.shell}
    >
      {isLoading ? (
        <Loading />
      ) : error ? (
        <Notice tone="danger">
          {error instanceof Error ? error.message : "Erro ao carregar fila"}
        </Notice>
      ) : (
        <FlatList
          style={styles.listWrap}
          data={data ?? []}
          keyExtractor={(item) => item.purchaseReceiptId}
          refreshing={isRefetching}
          onRefresh={refetch}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<EmptyState icon="archive-outline" title="Nenhuma NF para armazenar" />}
          ListFooterComponent={
            <Pressable
              style={({ pressed }) => [styles.avulso, pressed && styles.pressed]}
              onPress={() => router.push("/armazenagem-pulmao")}
            >
              <Ionicons name="add-circle-outline" size={22} color={color} />
              <Text style={styles.avulsoText}>Entrada avulsa (sem NF)</Text>
            </Pressable>
          }
          renderItem={({ item }) => {
            const started = Boolean(item.putawaySessionId && item.status !== "PENDING");
            return (
              <Card accent={started ? theme.warning : color} onPress={() => openItem(item)}>
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Text style={styles.numero}>NF {item.invoiceNumber ?? "—"}</Text>
                    {item.supplierName ? (
                      <Text style={styles.meta} numberOfLines={1}>
                        {item.supplierName}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={24} color={theme.textSoft} />
                </View>
                <View style={styles.badges}>
                  <Badge label={`${item.itemCount} itens`} icon="cube" />
                  {started ? <Badge label="Em andamento" tone="warning" solid /> : null}
                  {item.receiptOperator ? (
                    <Badge label={item.receiptOperator} icon="person" />
                  ) : null}
                </View>
              </Card>
            );
          }}
        />
      )}
      <SplitWorkModal
        visible={Boolean(toSplit)}
        title={`Armazenar NF ${toSplit?.invoiceNumber ?? ""}`}
        subtitle={toSplit?.supplierName}
        itemCount={toSplit?.itemCount}
        loading={splitWork.isPending}
        onCancel={() => setToSplit(null)}
        onConfirm={handleSplit}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  flex: { flex: 1 },
  listWrap: { flex: 1, minHeight: 120 },
  list: { paddingBottom: spacing.xl, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  numero: { fontWeight: "900", fontSize: typography.subtitle, color: theme.text },
  meta: { color: theme.textMuted, fontWeight: "600" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: spacing.sm },
  avulso: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: color,
  },
  avulsoText: { color, fontWeight: "800", fontSize: typography.body },
  pressed: { opacity: 0.8 },
});
