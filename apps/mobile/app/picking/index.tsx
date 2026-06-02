import { useEffect, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { OrderStatus } from "@wms/shared";
import { useAcceptOrder, useOrderQueue } from "@/hooks/usePicking";
import { FactoryButton } from "@/components/FactoryButton";
import { CollectionDeadlineRow } from "@/components/CollectionDeadlineRow";
import { WavePickingPanel } from "@/components/WavePickingPanel";
import { BackButton } from "@/components/BackButton";
import { showErrorAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";
import {
  api,
  ApiError,
  type ProblemOrder,
  type ProximityGroupDto,
  type QueueOrder,
} from "@/lib/api";

type Tab = "wave" | "orders" | "problems";

export default function PickingHubScreen() {
  const [tab, setTab] = useState<Tab>("wave");
  const { data: queueData, isLoading, error, refetch, isRefetching } =
    useOrderQueue();
  const data = queueData?.orders;
  const proximityGroups = queueData?.proximityGroups ?? [];
  const accept = useAcceptOrder();

  const problemOrders = useQuery({
    queryKey: ["problem-orders"],
    queryFn: () => api.getProblemOrders(),
    enabled: tab === "problems",
  });

  const problemWaves = useQuery({
    queryKey: ["problem-waves"],
    queryFn: () => api.getProblemWaves(),
    enabled: tab === "problems",
  });

  useEffect(() => {
    if (tab !== "orders" || !error) return;
    const msg =
      error instanceof Error ? error.message : "Erro ao carregar fila";
    showErrorAlert(msg);
  }, [tab, error]);

  useEffect(() => {
    if (tab !== "problems") return;
    if (problemOrders.error) {
      const msg =
        problemOrders.error instanceof Error
          ? problemOrders.error.message
          : "Erro ao carregar pedidos com problema";
      showErrorAlert(msg);
    }
  }, [tab, problemOrders.error]);

  const handleAccept = async (order: QueueOrder | ProblemOrder) => {
    await accept.mutateAsync(order.id);
    router.push(`/picking/${order.id}/basket`);
  };

  const handleOrderPress = async (order: QueueOrder | ProblemOrder) => {
    try {
      const session = await api.getPickingSession(order.id).catch(() => null);
      if (
        session &&
        (session.order.status === OrderStatus.PICKING ||
          session.order.status === OrderStatus.PAUSED_ISSUE)
      ) {
        if (session.order.basket) {
          router.push({
            pathname: "/picking/[orderId]/pick",
            params: {
              orderId: order.id,
              basketCode: session.order.basket.code,
            },
          });
        } else {
          router.push(`/picking/${order.id}/basket`);
        }
        return;
      }
      await handleAccept(order);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Erro ao abrir pedido";
      showErrorAlert(msg);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "wave", label: "Ondas" },
    { id: "orders", label: "Pedidos" },
    { id: "problems", label: "Problemas" },
  ];

  const problemsLoading =
    problemOrders.isLoading || problemWaves.isLoading;

  const refreshProblems = () => {
    void problemOrders.refetch();
    void problemWaves.refetch();
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom", "left", "right"]}>
      <View style={styles.headerFixed}>
        <View style={styles.topBar}>
          <BackButton color={theme.text} />
          <Text style={styles.hubTitle}>Separação</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabScroll}
          contentContainerStyle={styles.tabRow}
        >
          {tabs.map((t) => (
            <Pressable
              key={t.id}
              style={[styles.tab, tab === t.id && styles.tabActive]}
              onPress={() => setTab(t.id)}
            >
              <Text
                style={[styles.tabText, tab === t.id && styles.tabTextActive]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.body}>
        {tab === "wave" ? (
          <WavePickingPanel />
        ) : tab === "problems" ? (
          <ProblemsPanel
            loading={problemsLoading}
            orders={problemOrders.data?.orders ?? []}
            waves={problemWaves.data?.waves ?? []}
            onPressOrder={handleOrderPress}
            onRefresh={refreshProblems}
            refreshing={
              problemOrders.isRefetching || problemWaves.isRefetching
            }
          />
        ) : isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={styles.loadingText}>Carregando fila...</Text>
          </View>
        ) : (
          <OrdersQueuePanel
            orders={data ?? []}
            proximityGroups={proximityGroups}
            refreshing={isRefetching}
            onRefresh={refetch}
            onPressOrder={handleOrderPress}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

function OrdersQueuePanel({
  orders,
  proximityGroups,
  refreshing,
  onRefresh,
  onPressOrder,
}: {
  orders: QueueOrder[];
  proximityGroups: ProximityGroupDto[];
  refreshing: boolean;
  onRefresh: () => void;
  onPressOrder: (o: QueueOrder) => void;
}) {
  const header = (
    <View style={styles.listHeader}>
      <Text style={styles.count}>{orders.length} pedido(s) na fila</Text>
      <Text style={styles.waveHint}>
        Pedidos em onda liberada aparecem na aba Ondas.
      </Text>
      {proximityGroups.length > 0 ? (
        <View style={styles.recBlock}>
          <Text style={styles.recTitle}>Recomendado — pedidos próximos</Text>
          {proximityGroups.slice(0, 5).map((g) => (
            <View key={g.id} style={styles.recCard}>
              <Text style={styles.recMeta}>
                {g.orders.length} pedido(s) · {g.routeHint}
              </Text>
              <Text style={styles.recOrders} numberOfLines={2}>
                {g.orders.map((o) => o.erpOrderId).join(" · ")}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <FlatList
      style={styles.listFlex}
      data={orders}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={header}
      ListFooterComponent={
        <FactoryButton
          label="Atualizar fila"
          variant="secondary"
          onPress={onRefresh}
          loading={refreshing}
        />
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          Nenhum pedido avulso na fila. Verifique a aba Ondas se houver ondas
          liberadas.
        </Text>
      }
      renderItem={({ item }) => (
        <OrderCard item={item} onPress={() => onPressOrder(item)} />
      )}
    />
  );
}

function ProblemsPanel({
  loading,
  orders,
  waves,
  onPressOrder,
  onRefresh,
  refreshing,
}: {
  loading: boolean;
  orders: ProblemOrder[];
  waves: Array<{
    id: string;
    name: string;
    problemOrders: Array<{
      id: string;
      erpOrderId: string;
      issueSummary: string | null;
    }>;
  }>;
  onPressOrder: (o: ProblemOrder) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const header = (
    <View style={styles.listHeader}>
      {waves.length > 0 ? (
        <View style={styles.problemsSection}>
          <Text style={styles.sectionTitle}>
            {waves.length} onda(s) com problema
          </Text>
          {waves.map((wave) => (
            <View key={wave.id} style={styles.waveCard}>
              <Text style={styles.waveName}>{wave.name}</Text>
              {wave.problemOrders.map((o) => (
                <Pressable
                  key={o.id}
                  style={styles.waveOrderRow}
                  onPress={() =>
                    onPressOrder({
                      id: o.id,
                      erpOrderId: o.erpOrderId,
                      issueSummary: o.issueSummary,
                    } as ProblemOrder)
                  }
                >
                  <Text style={styles.erpSmall}>{o.erpOrderId}</Text>
                  {o.issueSummary ? (
                    <Text style={styles.issueSummary}>{o.issueSummary}</Text>
                  ) : null}
                  <Text style={styles.tapHintSmall}>TOQUE PARA CONTINUAR</Text>
                </Pressable>
              ))}
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.sectionTitle}>
        {orders.length} pedido(s) com problema
      </Text>
    </View>
  );

  return (
    <FlatList
      style={styles.listFlex}
      data={orders}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={header}
      ListEmptyComponent={
        waves.length === 0 ? (
          <Text style={styles.empty}>Nenhum pedido com problema</Text>
        ) : null
      }
      renderItem={({ item }) => (
        <OrderCard
          item={item}
          problem
          resume
          onPress={() => onPressOrder(item)}
        />
      )}
      ListFooterComponent={
        <FactoryButton
          label="Atualizar"
          variant="secondary"
          onPress={onRefresh}
          loading={refreshing}
        />
      }
    />
  );
}

function OrderCard({
  item,
  onPress,
  problem,
  resume,
}: {
  item: QueueOrder | ProblemOrder;
  onPress: () => void;
  problem?: boolean;
  resume?: boolean;
}) {
  const returned =
    "returnedFromPacking" in item && item.returnedFromPacking;
  const paused = "pausedIssue" in item && item.pausedIssue;
  const issueSummary =
    "issueSummary" in item ? item.issueSummary : null;

  return (
    <Pressable
      style={[
        styles.card,
        (returned || paused || problem) && styles.cardReturned,
      ]}
      onPress={onPress}
    >
      {returned ? (
        <View style={styles.returnBadge}>
          <Text style={styles.returnBadgeText}>RETORNO PACKING</Text>
        </View>
      ) : null}
      {paused ? (
        <View style={[styles.returnBadge, { backgroundColor: theme.danger }]}>
          <Text style={styles.returnBadgeText}>PAUSADO</Text>
        </View>
      ) : null}
      <Text style={styles.erp}>{item.erpOrderId}</Text>
      {"routeHint" in item && item.routeHint ? (
        <Text style={styles.routeHint}>{item.routeHint}</Text>
      ) : null}
      {"proximityNeighborCount" in item &&
      (item.proximityNeighborCount ?? 0) > 0 ? (
        <Text style={styles.proxBadge}>
          Próximo de {item.proximityNeighborCount} outro(s)
        </Text>
      ) : null}
      {item.marketplaceLabel ? (
        <Text style={styles.marketplace}>{item.marketplaceLabel}</Text>
      ) : null}
      <CollectionDeadlineRow deadline={item.collectionDeadline} />
      {"customerName" in item && item.customerName ? (
        <Text style={styles.customer}>{item.customerName}</Text>
      ) : null}
      {issueSummary ? (
        <Text style={styles.issueSummary}>{issueSummary}</Text>
      ) : null}
      <View style={styles.meta}>
        <Text style={styles.metaText}>
          {problem
            ? `Separado ${(item as ProblemOrder).qtyPicked}/${item.totalUnits} un.`
            : `${item.itemCount} itens · ${item.totalUnits} un.`}
        </Text>
        {item.priority > 0 ? (
          <Text style={styles.priority}>PRIORIDADE {item.priority}</Text>
        ) : null}
      </View>
      <Text style={styles.tapHint}>
        {resume || problem || returned || paused
          ? "TOQUE PARA CONTINUAR"
          : "TOQUE PARA INICIAR"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  headerFixed: {
    flexGrow: 0,
    flexShrink: 0,
  },
  topBar: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  hubTitle: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.text,
  },
  tabScroll: {
    flexGrow: 0,
    maxHeight: 48,
  },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  tab: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: 10,
    backgroundColor: theme.surface,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tabActive: {
    borderColor: theme.primary,
    backgroundColor: theme.primary,
  },
  tabText: {
    fontWeight: "800",
    color: theme.text,
    fontSize: 15,
  },
  tabTextActive: { color: "#fff" },
  body: {
    flex: 1,
    minHeight: 0,
  },
  listFlex: {
    flex: 1,
  },
  listHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  problemsSection: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontWeight: "800",
    fontSize: typography.body,
    color: theme.text,
  },
  waveHint: {
    fontSize: typography.caption,
    color: theme.textMuted,
    fontWeight: "600",
  },
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
  recBlock: { gap: spacing.xs },
  recTitle: {
    fontWeight: "800",
    fontSize: typography.caption,
    color: theme.primary,
  },
  recCard: {
    backgroundColor: "#ecfdf5",
    borderRadius: 10,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: "#99f6e4",
  },
  recMeta: { fontWeight: "700", fontSize: typography.caption },
  recOrders: {
    marginTop: 4,
    fontSize: typography.caption,
    color: theme.textMuted,
  },
  routeHint: {
    marginTop: 2,
    fontSize: typography.caption,
    color: theme.primary,
    fontWeight: "600",
  },
  proxBadge: {
    marginTop: 2,
    fontSize: typography.caption,
    color: "#0f766e",
    fontWeight: "700",
  },
  list: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    flexGrow: 1,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: theme.border,
  },
  cardReturned: {
    borderColor: "#f59e0b",
    backgroundColor: "#fffbeb",
  },
  returnBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#f59e0b",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: spacing.xs,
  },
  returnBadgeText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: typography.caption,
  },
  issueSummary: {
    marginTop: 4,
    color: "#92400e",
    fontWeight: "700",
    fontSize: typography.caption,
  },
  erp: {
    fontSize: typography.hero,
    fontWeight: "900",
    color: theme.text,
  },
  erpSmall: { fontSize: typography.body, fontWeight: "800" },
  customer: { color: theme.textMuted, marginTop: 4 },
  marketplace: { color: theme.info, fontWeight: "700", marginTop: 2 },
  meta: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.sm,
  },
  metaText: { color: theme.textMuted, fontSize: typography.caption },
  priority: {
    color: theme.danger,
    fontWeight: "900",
    fontSize: typography.caption,
  },
  tapHint: {
    marginTop: spacing.sm,
    textAlign: "center",
    fontWeight: "800",
    color: theme.primary,
    fontSize: typography.caption,
  },
  tapHintSmall: {
    marginTop: spacing.xs,
    fontWeight: "700",
    color: theme.primary,
    fontSize: typography.caption - 1,
  },
  empty: { textAlign: "center", color: theme.textMuted, marginTop: spacing.lg },
  waveCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: "#f59e0b",
  },
  waveName: {
    fontWeight: "900",
    fontSize: typography.subtitle,
    marginBottom: spacing.sm,
  },
  waveOrderRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
});
