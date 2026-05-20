import { useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAcceptOrder, useOrderQueue } from "@/hooks/usePicking";
import { FactoryButton } from "@/components/FactoryButton";
import { WavePickingPanel } from "@/components/WavePickingPanel";
import { theme, spacing, typography } from "@/lib/theme";
import type { QueueOrder } from "@/lib/api";
import { ApiError } from "@/lib/api";

type Tab = "orders" | "wave";

export default function PickingHubScreen() {
  const [tab, setTab] = useState<Tab>("orders");
  const { data, isLoading, error, refetch, isRefetching } = useOrderQueue();
  const accept = useAcceptOrder();

  const handleAccept = async (order: QueueOrder) => {
    try {
      await accept.mutateAsync(order.id);
      router.push(`/picking/${order.id}/basket`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Erro ao aceitar pedido";
      alert(msg);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <View style={styles.tabRow}>
        <Pressable
          style={[styles.tab, tab === "orders" && styles.tabActive]}
          onPress={() => setTab("orders")}
        >
          <Text
            style={[styles.tabText, tab === "orders" && styles.tabTextActive]}
          >
            Pedidos
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "wave" && styles.tabActive]}
          onPress={() => setTab("wave")}
        >
          <Text
            style={[styles.tabText, tab === "wave" && styles.tabTextActive]}
          >
            Onda
          </Text>
        </Pressable>
      </View>

      {tab === "wave" ? (
        <WavePickingPanel />
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Carregando fila...</Text>
        </View>
      ) : (
        <View style={styles.container}>
          <Text style={styles.count}>
            {data?.length ?? 0} pedido(s) na fila
          </Text>

          {error ? (
            <Text style={styles.error}>
              {error instanceof Error ? error.message : "Erro ao carregar fila"}
            </Text>
          ) : null}

          <FlatList
            data={data ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            refreshing={isRefetching}
            onRefresh={refetch}
            ListEmptyComponent={
              <Text style={styles.empty}>Nenhum pedido pendente</Text>
            }
            renderItem={({ item }) => (
              <Pressable
                style={styles.card}
                onPress={() => handleAccept(item)}
                disabled={accept.isPending}
              >
                <Text style={styles.erp}>{item.erpOrderId}</Text>
                {item.customerName ? (
                  <Text style={styles.customer}>{item.customerName}</Text>
                ) : null}
                <View style={styles.meta}>
                  <Text style={styles.metaText}>
                    {item.itemCount} itens · {item.totalUnits} un.
                  </Text>
                  {item.priority > 0 ? (
                    <Text style={styles.priority}>
                      PRIORIDADE {item.priority}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.tapHint}>TOQUE PARA ACEITAR</Text>
              </Pressable>
            )}
          />

          <FactoryButton
            label="Atualizar fila"
            variant="secondary"
            onPress={() => refetch()}
            loading={isRefetching}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  tabRow: {
    flexDirection: "row",
    padding: spacing.md,
    gap: spacing.sm,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 10,
    backgroundColor: theme.surface,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: "center",
  },
  tabActive: {
    borderColor: theme.primary,
    backgroundColor: theme.primary,
  },
  tabText: { fontWeight: "800", color: theme.textMuted },
  tabTextActive: { color: "#fff" },
  container: { flex: 1, padding: spacing.md, gap: spacing.sm },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
  },
  loadingText: { color: theme.textMuted, fontSize: typography.body },
  count: {
    fontWeight: "800",
    fontSize: typography.body,
    color: theme.text,
  },
  list: { paddingBottom: spacing.md, flexGrow: 1 },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: theme.border,
  },
  erp: {
    fontSize: typography.hero,
    fontWeight: "900",
    color: theme.text,
  },
  customer: { marginTop: 4, color: theme.textMuted },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  metaText: { color: theme.textMuted, fontSize: typography.caption },
  priority: {
    color: theme.danger,
    fontWeight: "800",
    fontSize: typography.caption,
  },
  tapHint: {
    marginTop: spacing.sm,
    textAlign: "center",
    fontWeight: "800",
    color: theme.primary,
    fontSize: typography.caption,
  },
  error: { color: theme.danger },
  empty: { textAlign: "center", color: theme.textMuted, marginTop: spacing.lg },
});
