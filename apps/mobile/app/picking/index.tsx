import { useEffect, useState } from "react";
import { router } from "expo-router";
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { OrderStatus } from "@wms/shared";
import {
  useCreateWaveFromOrders,
  useMobileConfig,
  useOrderQueue,
} from "@/hooks/usePicking";
import { AppHeader } from "@/components/AppHeader";
import { FactoryButton } from "@/components/FactoryButton";
import { CollectionDeadlineRow } from "@/components/CollectionDeadlineRow";
import { WavePickingPanel } from "@/components/WavePickingPanel";
import { Badge, Card, EmptyState, Loading, SectionTitle, SegmentedTabs } from "@/components/ui";
import { showErrorAlert, showToast } from "@/lib/app-alert";
import { modules } from "@/lib/modules";
import { theme, spacing, typography, radius } from "@/lib/theme";
import {
  api,
  ApiError,
  type PickingIssueDetail,
  type ProblemOrder,
  type ProblemWave,
  type ProblemWaveOrder,
  type ProximityGroupDto,
  type QueueOrder,
} from "@/lib/api";

type Tab = "wave" | "orders" | "problems";

const color = modules.picking.color;

export default function PickingHubScreen() {
  const [tab, setTab] = useState<Tab>("wave");
  const { data: queueData, isLoading, error, refetch, isRefetching } =
    useOrderQueue();
  const data = queueData?.orders;
  const proximityGroups = queueData?.proximityGroups ?? [];

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

  const handleOrderPress = async (order: QueueOrder | ProblemOrder) => {
    try {
      try {
        await api.acceptOrder(order.id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          showErrorAlert(e.message);
          void refetch();
          void problemOrders.refetch();
          return;
        }
        throw e;
      }
      void refetch();

      const session = await api.getPickingSession(order.id).catch(() => null);
      if (session?.order.basket) {
        router.push({
          pathname: "/picking/[orderId]/pick",
          params: {
            orderId: order.id,
            basketCode: session.order.basket.code,
          },
        });
        return;
      }
      router.push(`/picking/${order.id}/basket`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Erro ao abrir pedido";
      showErrorAlert(msg);
    }
  };

  const problemCount =
    (problemOrders.data?.orders.length ?? 0) +
    (problemWaves.data?.waves.reduce((n, w) => n + w.problemOrders.length, 0) ?? 0);

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "wave", label: "Ondas" },
    { id: "orders", label: "Pedidos", count: data?.length },
    { id: "problems", label: "Problemas", count: problemCount },
  ];

  const problemsLoading =
    problemOrders.isLoading || problemWaves.isLoading;

  const refreshProblems = () => {
    void problemOrders.refetch();
    void problemWaves.refetch();
  };

  return (
    <View style={styles.safe}>
      <AppHeader
        title="Picking"
        module="picking"
        right={
          <Pressable
            onPress={() => router.push("/atualizar-gondola")}
            hitSlop={8}
            style={styles.headerAction}
            accessibilityLabel="Atualizar gôndola"
          >
            <Ionicons name={modules.gondola.icon} size={22} color={theme.headerTint} />
          </Pressable>
        }
      >
        <SegmentedTabs tabs={tabs} value={tab} onChange={setTab} dark />
      </AppHeader>

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
          <Loading />
        ) : (
          <OrdersQueuePanel
            orders={data ?? []}
            proximityGroups={proximityGroups}
            refreshing={isRefetching}
            onRefresh={refetch}
            onPressOrder={handleOrderPress}
            onGoToWaves={() => setTab("wave")}
          />
        )}
      </View>
    </View>
  );
}

function OrdersQueuePanel({
  orders,
  proximityGroups,
  refreshing,
  onRefresh,
  onPressOrder,
  onGoToWaves,
}: {
  orders: QueueOrder[];
  proximityGroups: ProximityGroupDto[];
  refreshing: boolean;
  onRefresh: () => void;
  onPressOrder: (o: QueueOrder) => void;
  onGoToWaves: () => void;
}) {
  const { data: config } = useMobileConfig();
  const createWave = useCreateWaveFromOrders();

  const handleAcceptBatch = async (group: ProximityGroupDto) => {
    const firstId = group.orderIds[0];
    if (!firstId) return;
    const order = orders.find((o) => o.id === firstId);
    if (order) {
      await onPressOrder(order);
      return;
    }
    try {
      await api.acceptOrder(firstId);
      const session = await api.getPickingSession(firstId).catch(() => null);
      if (session?.order.basket) {
        router.push({
          pathname: "/picking/[orderId]/pick",
          params: {
            orderId: firstId,
            basketCode: session.order.basket.code,
          },
        });
        return;
      }
      router.push(`/picking/${firstId}/basket`);
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao abrir pedido",
      );
    }
  };

  const runCreateWave = async (
    orderIds: string[],
    appendToWaveId?: string,
  ) => {
    try {
      const result = await createWave.mutateAsync({ orderIds, appendToWaveId });
      await onRefresh();
      showToast(
        `Onda criada com ${result.orderCount} pedido(s) e ${result.lineCount} linha(s).`,
      );
      onGoToWaves();
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao criar onda",
      );
    }
  };

  const handleCreateWave = async (group: ProximityGroupDto) => {
    try {
      const { wave: openWave } = await api.getOpenWave();
      if (openWave) {
        Alert.alert(
          "Onda aberta",
          `Adicionar ${group.orderIds.length} pedido(s) à onda "${openWave.name}" ou criar nova onda?`,
          [
            { text: "Cancelar", style: "cancel" },
            {
              text: "Criar nova",
              onPress: () => void runCreateWave(group.orderIds),
            },
            {
              text: "Adicionar à atual",
              onPress: () =>
                void runCreateWave(group.orderIds, openWave.id),
            },
          ],
        );
        return;
      }
      await runCreateWave(group.orderIds);
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao verificar ondas",
      );
    }
  };

  const header =
    proximityGroups.length > 0 ? (
      <View style={styles.listHeader}>
        <SectionTitle>Pedidos próximos</SectionTitle>
        {proximityGroups.slice(0, 5).map((g) => (
          <Card key={g.id} accent={color}>
            <View style={styles.recTop}>
              <Badge label={`${g.orders.length} pedidos`} tone="primary" icon="git-merge" />
              <Text style={styles.recRoute} numberOfLines={1}>
                {g.routeHint}
              </Text>
            </View>
            <Text style={styles.recOrders} numberOfLines={2}>
              {g.orders.map((o) => o.erpOrderId).join(" · ")}
            </Text>
            <View style={styles.recActions}>
              {config?.waveEnabled ? (
                <FactoryButton
                  label="Criar onda"
                  icon="layers"
                  size="md"
                  color={color}
                  style={styles.flex}
                  onPress={() => void handleCreateWave(g)}
                  loading={createWave.isPending}
                />
              ) : null}
              <FactoryButton
                label="Abrir 1º"
                icon="open-outline"
                size="md"
                variant="secondary"
                style={styles.flex}
                onPress={() => void handleAcceptBatch(g)}
              />
            </View>
          </Card>
        ))}
        <SectionTitle>Fila</SectionTitle>
      </View>
    ) : null;

  return (
    <FlatList
      style={styles.flex}
      data={orders}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyState icon="cart-outline" title="Nenhum pedido na fila" />}
      renderItem={({ item }) => (
        <OrderCard item={item} onPress={() => onPressOrder(item)} />
      )}
    />
  );
}

function waveOrderToProblem(
  o: ProblemWaveOrder,
  waveName: string,
): ProblemOrder {
  return {
    id: o.id,
    erpOrderId: o.erpOrderId,
    status: o.status as OrderStatus,
    priority: 0,
    customerName: o.customerName,
    marketplaceLabel: o.marketplaceLabel,
    collectionDeadline: null,
    returnedFromPacking: o.returnedFromPacking,
    pausedIssue: o.pausedIssue,
    issueSummary: o.issueSummary,
    issueDetail: o.issueDetail,
    waveName,
    itemCount: 0,
    totalUnits: 0,
    qtyPicked: 0,
  };
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
  waves: ProblemWave[];
  onPressOrder: (o: ProblemOrder) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (loading) return <Loading />;

  const header =
    waves.length > 0 ? (
      <View style={styles.listHeader}>
        {waves.map((wave) => (
          <View key={wave.id} style={styles.waveSection}>
            <SectionTitle>{wave.name}</SectionTitle>
            {wave.problemOrders.map((o) => (
              <OrderCard
                key={o.id}
                item={waveOrderToProblem(o, wave.name)}
                problem
                inWave
                onPress={() => onPressOrder(waveOrderToProblem(o, wave.name))}
              />
            ))}
          </View>
        ))}
        {orders.length > 0 ? <SectionTitle>Pedidos avulsos</SectionTitle> : null}
      </View>
    ) : null;

  return (
    <FlatList
      style={styles.flex}
      data={orders}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      refreshing={refreshing}
      onRefresh={onRefresh}
      ListHeaderComponent={header}
      ListEmptyComponent={
        waves.length === 0 ? (
          <EmptyState icon="checkmark-circle-outline" title="Nenhum problema" />
        ) : null
      }
      renderItem={({ item }) => (
        <OrderCard item={item} problem onPress={() => onPressOrder(item)} />
      )}
    />
  );
}

function PickingIssueBlock({ detail }: { detail: PickingIssueDetail }) {
  return (
    <View style={styles.issueBlock}>
      <Text style={styles.issueTitle}>
        {detail.source === "PACKING" ? "Packing" : "Separação"} · {detail.typeLabel}
      </Text>
      {detail.sku ? (
        <Text style={styles.issueLine} numberOfLines={1}>
          {detail.sku}
          {detail.quantity > 0 ? ` · ${detail.quantity} un.` : ""}
          {detail.productName ? ` — ${detail.productName}` : ""}
        </Text>
      ) : null}
      {detail.description ? (
        <Text style={styles.issueLine} numberOfLines={2}>
          {detail.description}
        </Text>
      ) : null}
    </View>
  );
}

function OrderCard({
  item,
  onPress,
  problem,
  inWave,
}: {
  item: QueueOrder | ProblemOrder;
  onPress: () => void;
  problem?: boolean;
  inWave?: boolean;
}) {
  const returned =
    "returnedFromPacking" in item && item.returnedFromPacking;
  const resuming =
    "resumingPicking" in item && Boolean(item.resumingPicking);
  const paused = "pausedIssue" in item && item.pausedIssue;
  const issueDetail =
    "issueDetail" in item ? item.issueDetail : null;
  const waveName = "waveName" in item ? item.waveName : null;
  const itemCount = item.itemCount ?? 0;
  const totalUnits = item.totalUnits ?? 0;
  const qtyPicked =
    "qtyPicked" in item ? (item as ProblemOrder).qtyPicked : 0;
  const routeHint = "routeHint" in item ? item.routeHint : null;
  const neighbors =
    "proximityNeighborCount" in item ? item.proximityNeighborCount ?? 0 : 0;

  const accent = paused
    ? theme.danger
    : returned || problem
      ? theme.warning
      : resuming
        ? theme.info
        : color;

  return (
    <Card accent={accent} onPress={onPress} style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.erp} numberOfLines={1}>
          {item.erpOrderId}
        </Text>
        <Ionicons name="chevron-forward" size={24} color={theme.textSoft} />
      </View>

      <View style={styles.badges}>
        {paused ? <Badge label="Pausado" tone="danger" solid /> : null}
        {returned ? <Badge label="Retorno" tone="warning" solid /> : null}
        {resuming ? <Badge label="Em andamento" tone="info" solid /> : null}
        {item.priority > 0 ? (
          <Badge label={`Prioridade ${item.priority}`} tone="danger" icon="flash" />
        ) : null}
        {inWave || waveName ? (
          <Badge label={waveName ? waveName : "Em onda"} tone="info" icon="layers" />
        ) : null}
        {item.marketplaceLabel ? <Badge label={item.marketplaceLabel} /> : null}
        <CollectionDeadlineRow deadline={item.collectionDeadline} compact />
      </View>

      {"customerName" in item && item.customerName ? (
        <Text style={styles.customer} numberOfLines={1}>
          {item.customerName}
        </Text>
      ) : null}

      {issueDetail ? <PickingIssueBlock detail={issueDetail} /> : null}

      <View style={styles.meta}>
        {problem && totalUnits > 0 ? (
          <Text style={styles.metaStrong}>
            {qtyPicked}/{totalUnits} un.
          </Text>
        ) : itemCount > 0 ? (
          <Text style={styles.metaStrong}>
            {itemCount} itens · {totalUnits} un.
          </Text>
        ) : null}
        {routeHint ? (
          <Text style={styles.metaText} numberOfLines={1}>
            {routeHint}
          </Text>
        ) : null}
        {neighbors > 0 ? (
          <Badge label={`+${neighbors} perto`} tone="primary" icon="git-merge" />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  flex: { flex: 1 },
  body: { flex: 1, minHeight: 0 },
  headerAction: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  list: {
    padding: spacing.md,
    paddingBottom: spacing.xl * 2,
    gap: spacing.sm,
    flexGrow: 1,
  },
  listHeader: { gap: spacing.sm, marginBottom: spacing.xs },
  waveSection: { gap: spacing.sm },
  recTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recRoute: { flex: 1, color: color, fontWeight: "700", fontSize: typography.caption },
  recOrders: {
    marginTop: spacing.sm,
    fontSize: typography.caption,
    fontWeight: "700",
    color: theme.text,
  },
  recActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  card: { gap: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  erp: { flex: 1, fontSize: 28, fontWeight: "900", color: theme.text, letterSpacing: 0.3 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  customer: { color: theme.textMuted, fontWeight: "600" },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  metaStrong: { fontWeight: "900", color: theme.text, fontSize: typography.body },
  metaText: { flex: 1, color: theme.textMuted, fontSize: typography.caption, fontWeight: "600" },
  issueBlock: {
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: theme.warningSoft,
    gap: 2,
  },
  issueTitle: { fontWeight: "900", fontSize: typography.caption, color: "#92400E" },
  issueLine: { fontSize: typography.caption, color: "#78350F" },
});
