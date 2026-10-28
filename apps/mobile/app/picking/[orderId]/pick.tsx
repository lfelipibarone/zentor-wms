import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { productMatchesCode } from "@wms/shared";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  AdjustStockModal,
  type AdjustStockContext,
} from "@/components/AdjustStockModal";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ProblemReportModal } from "@/components/ProblemReportModal";
import { CollectionDeadlineRow } from "@/components/CollectionDeadlineRow";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import { Card, EmptyState, Loading, Notice, ProgressBar } from "@/components/ui";
import { useAdjustLocationStock } from "@/hooks/useAdjustLocationStock";
import {
  useAttachBasket,
  useCompletePicking,
  usePickItem,
  usePickingSession,
  useReleaseOrderAccept,
  useReportIssue,
} from "@/hooks/usePicking";
import { showErrorAlert } from "@/lib/app-alert";
import { api, ApiError } from "@/lib/api";
import { modules } from "@/lib/modules";
import { formatLevel, formatMinLevel, isQuantityMode } from "@/lib/percent";
import type { GondolaLevel } from "@/components/PercentInput";
import { theme, spacing, typography, radius } from "@/lib/theme";
import { OrderStatus } from "@wms/shared";

type PickStep = "location" | "product" | "quantity";

export default function PickScreen() {
  const { orderId, basketCode } = useLocalSearchParams<{
    orderId: string;
    basketCode?: string;
  }>();

  const { data: session, isLoading, refetch } = usePickingSession(orderId);
  const pickItem = usePickItem(orderId);
  const reportIssue = useReportIssue(orderId);
  const completePicking = useCompletePicking(orderId);
  const attachBasket = useAttachBasket(orderId);
  const releaseAccept = useReleaseOrderAccept(orderId);
  const adjustStock = useAdjustLocationStock();
  const [itemsExpanded, setItemsExpanded] = useState(false);

  const [step, setStep] = useState<PickStep>("location");
  const [locationValidated, setLocationValidated] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerSession, setScannerSession] = useState(0);
  const [scannerMode, setScannerMode] = useState<"location" | "product" | "basket">(
    "location"
  );
  const [problemOpen, setProblemOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  /** Gôndola do item recém-concluído: o separador precisa informar a % */
  const [afterPick, setAfterPick] = useState<AdjustStockContext | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const next = session?.nextItem;
  const itemId = next?.id ?? "";

  const canReleaseAccept = useMemo(() => {
    if (!session) return false;
    if (session.order.basket) return false;
    return session.items.every((i) => i.quantityPicked === 0);
  }, [session]);

  const resetItemFlow = useCallback(() => {
    setStep("location");
    setLocationValidated(false);
    setScanCount(0);
    setFeedback(null);
  }, []);

  const openScanner = useCallback((mode: "location" | "product" | "basket") => {
    setScannerMode(mode);
    setScannerSession((n) => n + 1);
    setScannerOpen(true);
  }, []);

  useEffect(() => {
    resetItemFlow();
  }, [itemId, resetItemFlow]);

  // Abre o leitor da gôndola assim que o item estiver pronto (sem segundo toque)
  useEffect(() => {
    if (!itemId || !next || locationValidated || afterPick) return;
    if (scannerOpen || problemOpen || adjustOpen) return;
    openScanner("location");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao trocar de item
  }, [itemId]);

  // Itens prontos sem cesta: bipar cesta para o packing encontrar o pedido
  useEffect(() => {
    if (!session?.allPicked || session.order.basket || basketCode) return;
    if (afterPick || scannerOpen || problemOpen) return;
    openScanner("basket");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.allPicked, session?.order.basket?.id]);

  const adjustContext: AdjustStockContext | null =
    next?.pickLocation
      ? {
          locationId: next.pickLocation.id,
          locationLabel: next.pickLocation.label,
          currentPercent: next.pickLocation.fillPercent ?? 0,
          level: next.pickLocation,
          productBarcode: next.product?.barcode ?? null,
          productName: next.product?.name ?? null,
          orderId,
          itemId: next.id,
        }
      : null;

  const handleAdjustStock = async (level: GondolaLevel, reason: string) => {
    if (!adjustContext) return;
    try {
      const result = await adjustStock.mutateAsync({
        locationId: adjustContext.locationId,
        ...level,
        productBarcode: adjustContext.productBarcode,
        reason,
        orderId,
        itemId: next?.id,
      });
      setAdjustOpen(false);

      const changed = result.reconciliation.orderItems.find(
        (r) => r.orderItemId === next?.id,
      );
      if (changed) {
        setFeedback(
          `Gôndola ajustada. Novo endereço: ${changed.newLocationBarcode}`,
        );
        resetItemFlow();
      } else {
        setFeedback(`Gôndola ajustada: ${formatLevel(result.location)}`);
      }

      if (result.reconciliation.warnings.length > 0) {
        Alert.alert(
          "Rotas atualizadas",
          result.reconciliation.warnings.slice(0, 3).join("\n"),
        );
      }

      await refetch();
    } catch (e) {
      setFeedback(
        e instanceof ApiError ? e.message : "Erro ao ajustar estoque",
      );
    }
  };

  const handleLocationScan = async (barcode: string) => {
    if (!itemId) return;
    try {
      await api.validateLocation(orderId, itemId, barcode);
      setLocationValidated(true);
      setStep("product");
      setFeedback("Gôndola confirmada ✓");
      // Segue direto para bipar o produto — sem segundo toque
      openScanner("product");
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Gôndola incorreta");
      openScanner("location");
    }
  };

  const handleProductScan = async (barcode: string) => {
    if (!next) return;

    if (next.product && !productMatchesCode(next.product, barcode)) {
      setFeedback(`Produto incorreto. Esperado: ${next.product.sku}`);
      openScanner("product");
      return;
    }

    const requiresScan = next.product?.requiresItemScan ?? false;
    if (!requiresScan) {
      setScannerOpen(false);
      // Um bipo do produto confirma a quantidade restante
      await confirmPick(next.remaining);
      return;
    }

    const newCount = scanCount + 1;
    setScanCount(newCount);

    if (newCount >= next.remaining) {
      setScannerOpen(false);
      await confirmPick(next.remaining);
    } else {
      setFeedback(`Bipado ${newCount} de ${next.remaining}`);
      openScanner("product");
    }
  };

  const confirmPick = async (qty: number) => {
    if (!itemId) return;
    const pickedContext = adjustContext;
    try {
      const result = await pickItem.mutateAsync({ itemId, quantity: qty });
      const countedByUnits = isQuantityMode(result.location);
      if (result.completed && pickedContext && !countedByUnits) {
        setAfterPick({
          ...pickedContext,
          currentPercent: result.location?.fillPercent ?? pickedContext.currentPercent,
        });
      }
      await refetch();
      resetItemFlow();
      if (result.completed) {
        setFeedback(
          countedByUnits
            ? `Item concluído · gôndola com ${formatLevel(result.location)} ✓`
            : "Item concluído ✓",
        );
      }
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Erro ao registrar pick");
    }
  };

  const handleAfterPickPercent = async (level: GondolaLevel, reason: string) => {
    if (!afterPick) return;
    try {
      const result = await adjustStock.mutateAsync({
        locationId: afterPick.locationId,
        ...level,
        productBarcode: afterPick.productBarcode,
        reason,
        orderId,
        itemId: afterPick.itemId,
      });
      setAfterPick(null);
      setFeedback(
        result.location.needsReplenishment
          ? `Gôndola em ${formatLevel(result.location)} — enviada para reposição ✓`
          : `Gôndola em ${formatLevel(result.location)} ✓`,
      );
      if (result.reconciliation.warnings.length > 0) {
        Alert.alert(
          "Rotas atualizadas",
          result.reconciliation.warnings.slice(0, 3).join("\n"),
        );
      }
      await refetch();
    } catch (e) {
      showErrorAlert(e instanceof ApiError ? e.message : "Erro ao salvar a % da gôndola");
    }
  };

  const afterPickModal = (
    <AdjustStockModal
      visible={afterPick !== null}
      mode="after-pick"
      loading={adjustStock.isPending}
      context={afterPick}
      onSubmit={handleAfterPickPercent}
    />
  );

  const finishPicking = useCallback(async () => {
    try {
      await completePicking.mutateAsync();
      Alert.alert(
        "Separação finalizada",
        "Pedido enviado para Aguardando Conferência — packing bipa a cesta.",
        [{ text: "OK", onPress: () => router.replace("/picking") }],
      );
    } catch (e) {
      Alert.alert(
        "Erro",
        e instanceof ApiError ? e.message : "Não foi possível finalizar",
      );
    }
  }, [completePicking]);

  const handleBasketScan = async (barcode: string) => {
    setScannerOpen(false);
    try {
      const result = await attachBasket.mutateAsync(barcode);
      setFeedback(`Cesta ${result.basketCode} vinculada ✓`);
      await refetch();
      // Itens já separados: vinculou a cesta → envia ao packing
      if (session?.allPicked) {
        await finishPicking();
      }
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Cesta inválida");
      openScanner("basket");
    }
  };

  const handleCompleteOrder = async () => {
    const hasBasket = Boolean(session?.order.basket || basketCode);
    if (!hasBasket) {
      setFeedback("Bipe a cesta onde colocou os itens");
      openScanner("basket");
      return;
    }
    await finishPicking();
  };

  const handleReport = async (reason: string) => {
    try {
      await reportIssue.mutateAsync(reason);
      setProblemOpen(false);
      Alert.alert(
        "Problema registrado",
        "Pedido pausado. A equipe na Web foi notificada.",
        [{ text: "OK", onPress: () => router.replace("/picking") }]
      );
    } catch (e) {
      Alert.alert(
        "Erro",
        e instanceof ApiError ? e.message : "Falha ao reportar"
      );
    }
  };

  if (isLoading || !session) {
    return (
      <ScreenShell module="picking" title="Pedido">
        <Loading />
      </ScreenShell>
    );
  }

  const basket = basketCode ?? session.order.basket?.code ?? "—";

  if (session.order.status === OrderStatus.PAUSED_ISSUE) {
    return (
      <ScreenShell scroll module="picking" title={session.order.erpOrderId}>
        <EmptyState icon="pause-circle" title="Pedido pausado por problema" />
        <FactoryButton
          label="Voltar à fila"
          icon="arrow-back"
          onPress={() => router.replace("/picking")}
        />
      </ScreenShell>
    );
  }

  if (session.allPicked || !next) {
    const hasBasket = Boolean(session.order.basket || basketCode);
    return (
      <ScreenShell
        scroll
        module="picking"
        title={session.order.erpOrderId}
        subtitle={hasBasket ? `Cesta ${basket}` : "Coloque na cesta"}
      >
        <EmptyState
          icon="checkmark-circle"
          title="Todos os itens separados"
        />
        {feedback ? (
          <Notice tone={feedback.includes("✓") ? "success" : "info"}>
            {feedback}
          </Notice>
        ) : null}
        {!hasBasket ? (
          <FactoryButton
            label="Bipar cesta"
            icon="basket"
            color={color}
            loading={attachBasket.isPending}
            disabled={afterPick !== null}
            onPress={() => openScanner("basket")}
          />
        ) : (
          <FactoryButton
            label="Enviar para conferência"
            icon="send"
            variant="success"
            loading={completePicking.isPending}
            disabled={afterPick !== null}
            onPress={handleCompleteOrder}
          />
        )}
        <FactoryButton
          label="Relatar problema"
          icon="warning"
          size="md"
          variant="secondary"
          onPress={() => setProblemOpen(true)}
        />
        <BarcodeScanner
          visible={scannerOpen}
          session={scannerSession}
          title="Bipar cesta"
          hint="Cesta onde colocou os itens do pedido"
          onScan={handleBasketScan}
          onClose={() => setScannerOpen(false)}
        />
        <ProblemReportModal
          visible={problemOpen}
          loading={reportIssue.isPending}
          onSubmit={handleReport}
          onClose={() => setProblemOpen(false)}
        />
        {afterPickModal}
      </ScreenShell>
    );
  }

  const requiresScan = next.product?.requiresItemScan ?? false;
  const locLabel = next.pickLocation
    ? next.pickLocation.barcode ||
      next.pickLocation.label ||
      `${next.pickLocation.corridor}-${next.pickLocation.row}`
    : "Sem endereço";
  const doneItems = session.items.filter((i) => i.completed).length;
  const feedbackTone = feedback?.includes("✓")
    ? "success"
    : feedback?.startsWith("Bipado") || feedback?.startsWith("Gôndola ajustada")
      ? "info"
      : "danger";

  return (
    <ScreenShell
      scroll
      module="picking"
      title={session.order.erpOrderId}
      subtitle={[
        `Cesta ${basket}`,
        session.order.marketplaceLabel ?? session.order.marketplace,
      ]
        .filter(Boolean)
        .join(" · ")}
      headerRight={
        <Text style={styles.headerCount}>
          {doneItems}/{session.items.length}
        </Text>
      }
    >
      <View style={styles.progressWrap}>
        <ProgressBar value={doneItems} total={session.items.length} color={color} />
        <CollectionDeadlineRow deadline={session.order.collectionDeadline} compact />
      </View>

      <View style={styles.locationCard}>
        <Text style={styles.locLabel}>Vá até</Text>
        <Text style={styles.locValue} adjustsFontSizeToFit numberOfLines={1}>
          {locLabel}
        </Text>
        {next.pickLocation?.fillPercent != null ? (
          <Text style={styles.locStock}>
            Gôndola {formatLevel(next.pickLocation)}
            {formatMinLevel(next.pickLocation) ? ` · mín. ${formatMinLevel(next.pickLocation)}` : ""}
          </Text>
        ) : null}
        {next.stockMismatchHint ? (
          <Text style={styles.stockWarn}>{next.stockMismatchHint}</Text>
        ) : null}
        {session.routeQueue && session.routeQueue.length > 1 ? (
          <Text style={styles.routeNext} numberOfLines={1}>
            Depois:{" "}
            {session.routeQueue
              .slice(1, 3)
              .map((r) => r.pickLocation?.label ?? "?")
              .join(" → ")}
          </Text>
        ) : null}
      </View>

      <Card>
        <View style={styles.productRow}>
          <ProductThumbnail
            imageUrl={next.product?.imageUrl}
            alt={next.product?.name ?? "Produto"}
            size={84}
          />
          <View style={styles.productInfo}>
            <Text style={styles.sku}>
              {next.product?.sku ?? "SKU indisponível"}
            </Text>
            <Text style={styles.productName} numberOfLines={3}>
              {next.product?.name ?? "Produto não encontrado"}
            </Text>
          </View>
          <View style={styles.qtyBox}>
            <Text style={styles.qtyValue}>{next.remaining}</Text>
            <Text style={styles.qtyLabel}>
              {next.remaining !== next.quantityOrdered ? `de ${next.quantityOrdered}` : "un."}
            </Text>
          </View>
        </View>
      </Card>

      {feedback ? <Notice tone={feedbackTone}>{feedback}</Notice> : null}

      {!locationValidated ? (
        <FactoryButton
          label="Bipar gôndola"
          icon="scan"
          color={color}
          onPress={() => openScanner("location")}
        />
      ) : (
        <>
          <FactoryButton
            label={
              requiresScan
                ? `Bipar produto · ${scanCount}/${next.remaining}`
                : `Bipar produto · confirmar ${next.remaining} un.`
            }
            icon="barcode"
            color={color}
            onPress={() => openScanner("product")}
            loading={pickItem.isPending}
          />
          <QuantityInput
            label="Ou digitar quantidade"
            max={next.remaining}
            defaultValue={next.remaining}
            loading={pickItem.isPending}
            onConfirm={(qty) => confirmPick(qty)}
          />
        </>
      )}

      <View style={styles.toolsRow}>
        {adjustContext ? (
          <FactoryButton
            label="% gôndola"
            icon="speedometer"
            size="sm"
            variant="secondary"
            style={styles.flex}
            onPress={() => setAdjustOpen(true)}
          />
        ) : null}
        {session.items.length > 1 ? (
          <FactoryButton
            label={`Itens (${session.items.length})`}
            icon={itemsExpanded ? "chevron-up" : "list"}
            size="sm"
            variant="secondary"
            style={styles.flex}
            onPress={() => setItemsExpanded((v) => !v)}
          />
        ) : null}
        <FactoryButton
          label="Problema"
          icon="warning"
          size="sm"
          variant="secondary"
          style={styles.flex}
          onPress={() => setProblemOpen(true)}
        />
      </View>

      {itemsExpanded ? (
        <View style={styles.itemsPreview}>
          {session.items.map((item) => (
            <View
              key={item.id}
              style={[styles.itemsPreviewRow, item.completed && styles.itemsPreviewDone]}
            >
              <ProductThumbnail
                imageUrl={item.product?.imageUrl}
                alt={item.product?.name ?? "Produto"}
                size={40}
              />
              <Text style={styles.itemsPreviewSku} numberOfLines={1}>
                {item.product?.sku ?? "SKU indisponível"}
              </Text>
              <Text style={styles.itemsPreviewQty}>
                {item.quantityPicked}/{item.quantityOrdered}
              </Text>
              {item.completed ? (
                <Ionicons name="checkmark-circle" size={20} color={theme.success} />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {canReleaseAccept ? (
        <FactoryButton
          label="Cancelar aceite"
          icon="close"
          size="sm"
          variant="ghost"
          onPress={async () => {
            try {
              await releaseAccept.mutateAsync();
              router.replace("/picking");
            } catch (e) {
              showErrorAlert(
                e instanceof ApiError ? e.message : "Erro ao cancelar aceite",
              );
            }
          }}
          loading={releaseAccept.isPending}
        />
      ) : null}

      <BarcodeScanner
        visible={scannerOpen}
        session={scannerSession}
        title={
          scannerMode === "basket"
            ? "Bipar cesta"
            : scannerMode === "location"
              ? `Gôndola ${locLabel}`
              : next.product?.sku ?? "Produto"
        }
        hint={
          scannerMode === "basket"
            ? "Cesta onde colocou os itens"
            : scannerMode === "location"
              ? "Aponte para o QR da gôndola"
              : requiresScan
                ? `Bipe cada unidade · ${scanCount}/${next.remaining}`
                : `Confirma ${next.remaining} un. no bipo`
        }
        onScan={
          scannerMode === "basket"
            ? handleBasketScan
            : scannerMode === "location"
              ? handleLocationScan
              : handleProductScan
        }
        onClose={() => setScannerOpen(false)}
      />

      <ProblemReportModal
        visible={problemOpen}
        loading={reportIssue.isPending}
        onSubmit={handleReport}
        onClose={() => setProblemOpen(false)}
      />

      <AdjustStockModal
        visible={adjustOpen}
        loading={adjustStock.isPending}
        context={adjustContext}
        onSubmit={handleAdjustStock}
        onClose={() => setAdjustOpen(false)}
      />
      {afterPickModal}
    </ScreenShell>
  );
}

const color = modules.picking.color;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerCount: { color: theme.headerTint, fontWeight: "900", fontSize: typography.body },
  progressWrap: { gap: spacing.sm },
  locationCard: {
    backgroundColor: color,
    borderRadius: radius.xl,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  locLabel: {
    fontSize: typography.caption,
    fontWeight: "900",
    color: "rgba(255,255,255,0.85)",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  locValue: {
    fontSize: 44,
    fontWeight: "900",
    color: "#fff",
    textAlign: "center",
  },
  locStock: {
    color: "#fff",
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  stockWarn: {
    color: "#FEF3C7",
    fontWeight: "700",
    marginTop: spacing.xs,
    textAlign: "center",
    fontSize: typography.caption,
  },
  routeNext: {
    color: "rgba(255,255,255,0.8)",
    fontWeight: "700",
    fontSize: typography.caption,
    marginTop: spacing.sm,
  },
  productRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  productInfo: { flex: 1, gap: 2 },
  sku: { fontSize: typography.body, color: theme.info, fontWeight: "900" },
  productName: { fontSize: typography.caption + 1, fontWeight: "700", color: theme.text },
  qtyBox: {
    minWidth: 64,
    alignItems: "center",
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: modules.picking.soft,
  },
  qtyValue: { fontSize: 34, fontWeight: "900", color: "#0F766E" },
  qtyLabel: { fontSize: typography.small, fontWeight: "800", color: "#0F766E" },
  toolsRow: { flexDirection: "row", gap: spacing.sm },
  itemsPreview: { gap: spacing.xs },
  itemsPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: theme.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  itemsPreviewDone: { opacity: 0.55 },
  itemsPreviewSku: { flex: 1, fontWeight: "800", color: theme.text },
  itemsPreviewQty: { color: theme.textMuted, fontWeight: "800" },
});
