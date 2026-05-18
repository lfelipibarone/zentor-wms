import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAcceptOrder, useOrderQueue } from "@/hooks/usePicking";
import { FactoryButton } from "@/components/FactoryButton";
import { theme, spacing, typography } from "@/lib/theme";
import type { QueueOrder } from "@/lib/api";
import { ApiError } from "@/lib/api";

export default function OrderQueueScreen() {
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

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.loadingText}>Carregando fila...</Text>
      </View>
    );
  }

  return (
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
                <Text style={styles.priority}>PRIORIDADE {item.priority}</Text>
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg, padding: spacing.md },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.bg,
    gap: spacing.md,
  },
  loadingText: { color: theme.textMuted, fontSize: typography.body },
  count: {
    fontSize: typography.subtitle,
    fontWeight: "800",
    color: theme.primary,
    marginBottom: spacing.md,
  },
  list: { gap: spacing.md, paddingBottom: spacing.md },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: theme.border,
    gap: spacing.sm,
  },
  erp: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.text,
  },
  customer: { fontSize: typography.body, color: theme.textMuted },
  meta: { flexDirection: "row", justifyContent: "space-between" },
  metaText: { color: theme.text, fontSize: typography.body, fontWeight: "600" },
  priority: { color: theme.warning, fontWeight: "900" },
  tapHint: {
    marginTop: spacing.sm,
    color: theme.primary,
    fontWeight: "900",
    fontSize: typography.caption,
    letterSpacing: 1,
  },
  empty: {
    color: theme.textMuted,
    textAlign: "center",
    fontSize: typography.body,
    padding: spacing.xl,
  },
  error: { color: theme.danger, marginBottom: spacing.md },
});
