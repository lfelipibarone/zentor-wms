import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import { useAdjustLocationStock } from "@/hooks/useAdjustLocationStock";
import {
  useCompletePicking,
  usePickItem,
  usePickingSession,
  useReleaseOrderAccept,
  useReportIssue,
} from "@/hooks/usePicking";
import { showErrorAlert } from "@/lib/app-alert";
import { api, ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";
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
  const releaseAccept = useReleaseOrderAccept(orderId);
  const adjustStock = useAdjustLocationStock();
  const [itemsExpanded, setItemsExpanded] = useState(false);

  const [step, setStep] = useState<PickStep>("location");
  const [locationValidated, setLocationValidated] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"location" | "product">(
    "location"
  );
  const [problemOpen, setProblemOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
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

  useEffect(() => {
    resetItemFlow();
  }, [itemId, resetItemFlow]);

  const adjustContext: AdjustStockContext | null =
    next?.pickLocation
      ? {
          locationId: next.pickLocation.id,
          locationLabel: next.pickLocation.label,
          systemQuantity: next.pickLocation.currentQuantity ?? 0,
          capacity: next.pickLocation.capacity ?? 9999,
          productBarcode: next.product.barcode,
          orderId,
          itemId: next.id,
        }
      : null;

  const handleAdjustStock = async (countedQuantity: number, reason: string) => {
    if (!adjustContext) return;
    try {
      const result = await adjustStock.mutateAsync({
        locationId: adjustContext.locationId,
        countedQuantity,
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
          `Estoque ajustado. Novo endereço: ${changed.newLocationBarcode}`,
        );
        resetItemFlow();
      } else {
        setFeedback(`Estoque ajustado: ${result.location.currentQuantity} un.`);
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
    setScannerOpen(false);
    if (!itemId) return;
    try {
      await api.validateLocation(orderId, itemId, barcode);
      setLocationValidated(true);
      setStep("product");
      setFeedback("Gôndola confirmada ✓");
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Gôndola incorreta");
    }
  };

  const handleProductScan = async (barcode: string) => {
    setScannerOpen(false);
    if (!next) return;

    const expected = next.product.barcode;
    if (expected && barcode !== expected) {
      setFeedback(`Produto incorreto. Esperado: ${expected}`);
      return;
    }

    const newCount = scanCount + 1;
    setScanCount(newCount);

    if (newCount >= next.remaining) {
      await confirmPick(next.remaining);
    } else {
      setFeedback(`Bipado ${newCount} de ${next.remaining}`);
    }
  };

  const confirmPick = async (qty: number) => {
    if (!itemId) return;
    try {
      const result = await pickItem.mutateAsync({ itemId, quantity: qty });
      await refetch();
      resetItemFlow();
      if (result.completed) {
        setFeedback("Item concluído ✓");
      }
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Erro ao registrar pick");
    }
  };

  const handleCompleteOrder = async () => {
    try {
      await completePicking.mutateAsync();
      Alert.alert(
        "Separação finalizada",
        "Cesta enviada para Aguardando Conferência.",
        [{ text: "OK", onPress: () => router.replace("/picking") }]
      );
    } catch (e) {
      Alert.alert(
        "Erro",
        e instanceof ApiError ? e.message : "Não foi possível finalizar"
      );
    }
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
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (session.order.status === OrderStatus.PAUSED_ISSUE) {
    return (
      <ScreenShell
        scroll
        title="Pedido pausado"
        subtitle={session.order.erpOrderId}
      >
        <Text style={styles.paused}>
          Este pedido está pausado por problema reportado.
        </Text>
        <FactoryButton
          label="Voltar à fila"
          onPress={() => router.replace("/picking")}
        />
      </ScreenShell>
    );
  }

  if (session.allPicked || !next) {
    return (
      <ScreenShell
        scroll
        title="Pedido completo"
        subtitle={`Cesta ${basketCode ?? session.order.basket?.code ?? "—"}`}
      >
        <Text style={styles.doneText}>
          Todos os itens foram separados. Envie a cesta para conferência.
        </Text>
        <FactoryButton
          label="Finalizar — Aguardando conferência"
          variant="success"
          loading={completePicking.isPending}
          onPress={handleCompleteOrder}
        />
        <FactoryButton
          label="Relatar problema"
          variant="danger"
          onPress={() => setProblemOpen(true)}
        />
        <ProblemReportModal
          visible={problemOpen}
          loading={reportIssue.isPending}
          onSubmit={handleReport}
          onClose={() => setProblemOpen(false)}
        />
      </ScreenShell>
    );
  }

  const requiresScan = next.product.requiresItemScan;
  const locLabel = next.pickLocation
    ? (next.pickLocation.label ??
      `${next.pickLocation.corridor}-${next.pickLocation.row}`)
    : "—";

  return (
    <ScreenShell
      scroll
      title={session.order.erpOrderId}
      subtitle={[
        session.order.marketplaceLabel ?? session.order.marketplace,
        `Cesta ${basketCode ?? session.order.basket?.code ?? "—"}`,
        "rota otimizada",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <CollectionDeadlineRow deadline={session.order.collectionDeadline} />
      {session.routeQueue && session.routeQueue.length > 1 ? (
        <Text style={styles.routeHint}>
          Depois:{" "}
          {session.routeQueue
            .slice(1, 3)
            .map((r) => r.pickLocation?.label ?? "?")
            .join(" → ")}
        </Text>
      ) : null}
      <View style={styles.locationCard}>
        <Text style={styles.locLabel}>VÁ ATÉ</Text>
        <Text style={styles.locValue}>{locLabel}</Text>
        <Text style={styles.locBarcode}>
          {next.pickLocation?.barcode ?? "Sem barcode"}
        </Text>
        {next.pickLocation?.currentQuantity != null ? (
          <Text style={styles.locStock}>
            Sistema: {next.pickLocation.currentQuantity} un.
            {next.pickLocation.capacity != null
              ? ` · cap. ${next.pickLocation.capacity}`
              : ""}
          </Text>
        ) : null}
        {next.stockMismatchHint ? (
          <Text style={styles.stockWarn}>{next.stockMismatchHint}</Text>
        ) : null}
      </View>

      {adjustContext ? (
        <FactoryButton
          label="Corrigir estoque na gôndola"
          variant="secondary"
          onPress={() => setAdjustOpen(true)}
        />
      ) : null}

      <View style={styles.productCard}>
        <View style={styles.productRow}>
          <ProductThumbnail
            imageUrl={next.product.imageUrl}
            alt={next.product.name}
            size={88}
          />
          <View style={styles.productInfo}>
            <Text style={styles.sku}>{next.product.sku}</Text>
            <Text style={styles.productName}>{next.product.name}</Text>
            <Text style={styles.qty}>
              Separar: {next.remaining} de {next.quantityOrdered}
            </Text>
          </View>
        </View>
        <Text style={styles.scanHint}>
          Informe a quantidade coletada
          {requiresScan ? " ou bipe o produto (opcional)" : ""}
        </Text>
      </View>

      {feedback ? (
        <Text
          style={[
            styles.feedback,
            feedback.includes("✓") ? styles.feedbackOk : styles.feedbackErr,
          ]}
        >
          {feedback}
        </Text>
      ) : null}

      {step === "location" && !locationValidated ? (
        <FactoryButton
          label="Bipar gôndola"
          onPress={() => {
            setScannerMode("location");
            setScannerOpen(true);
          }}
        />
      ) : null}

      {locationValidated ? (
        <>
          <QuantityInput
            label="Quantidade coletada"
            max={next.remaining}
            loading={pickItem.isPending}
            onConfirm={(qty) => confirmPick(qty)}
          />
          <FactoryButton
            label={
              requiresScan
                ? `Bipar produto (+1) · ${scanCount}/${next.remaining}`
                : "Bipar produto (opcional)"
            }
            variant="secondary"
            onPress={() => {
              setScannerMode("product");
              setScannerOpen(true);
            }}
            loading={pickItem.isPending}
          />
        </>
      ) : null}

      <FactoryButton
        label="Relatar problema"
        variant="danger"
        onPress={() => setProblemOpen(true)}
      />

      {session.items.length > 1 ? (
        <>
          <FactoryButton
            label={
              itemsExpanded
                ? "Ocultar todos os itens"
                : `Ver todos os itens (${session.items.length})`
            }
            variant="secondary"
            onPress={() => setItemsExpanded((v) => !v)}
          />
          {itemsExpanded ? (
            <View style={styles.itemsPreview}>
              {session.items.map((item) => (
                <View key={item.id} style={styles.itemsPreviewRow}>
                  <ProductThumbnail
                    imageUrl={item.product.imageUrl}
                    alt={item.product.name}
                    size={40}
                  />
                  <View style={styles.itemsPreviewInfo}>
                    <Text style={styles.itemsPreviewSku}>
                      {item.product.sku}
                    </Text>
                    <Text style={styles.itemsPreviewQty}>
                      {item.quantityPicked}/{item.quantityOrdered} un.
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {canReleaseAccept ? (
        <FactoryButton
          label="Cancelar aceite"
          variant="secondary"
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
        title={
          scannerMode === "location" ? "Bipar gôndola" : "Bipar produto"
        }
        hint={
          scannerMode === "location"
            ? "Confirme que está na posição correta"
            : "Bipe o código de cada unidade"
        }
        onScan={
          scannerMode === "location" ? handleLocationScan : handleProductScan
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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.bg,
  },
  locationCard: {
    backgroundColor: theme.primary,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: "center",
  },
  locLabel: {
    fontSize: typography.caption,
    fontWeight: "900",
    color: theme.primaryText,
    letterSpacing: 2,
  },
  locValue: {
    fontSize: 40,
    fontWeight: "900",
    color: theme.primaryText,
    textAlign: "center",
  },
  locBarcode: {
    fontSize: typography.body,
    color: theme.primaryText,
    opacity: 0.8,
    marginTop: spacing.xs,
  },
  locStock: {
    color: theme.primaryText,
    fontWeight: "700",
    marginTop: spacing.sm,
    fontSize: typography.body,
  },
  stockWarn: {
    color: "#fef3c7",
    fontWeight: "600",
    marginTop: spacing.xs,
    textAlign: "center",
    fontSize: typography.caption,
  },
  productCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: theme.border,
  },
  productRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  productInfo: { flex: 1, gap: spacing.xs },
  sku: {
    fontSize: typography.caption,
    color: theme.info,
    fontWeight: "800",
  },
  productName: {
    fontSize: typography.subtitle,
    fontWeight: "800",
    color: theme.text,
  },
  qty: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.success,
  },
  routeHint: {
    color: theme.textMuted,
    fontSize: typography.caption,
    marginBottom: spacing.sm,
  },
  scanHint: { color: theme.textMuted, fontSize: typography.body },
  feedback: {
    fontSize: typography.body,
    fontWeight: "700",
    textAlign: "center",
  },
  feedbackOk: { color: theme.success },
  feedbackErr: { color: theme.danger },
  doneText: {
    fontSize: typography.body,
    color: theme.text,
    lineHeight: 26,
  },
  paused: { color: theme.warning, fontSize: typography.body },
  itemsPreview: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  itemsPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: theme.surface,
    borderRadius: 8,
  },
  itemsPreviewInfo: { flex: 1 },
  itemsPreviewSku: { fontWeight: "700", color: theme.text },
  itemsPreviewQty: { color: theme.textMuted, fontSize: typography.caption },
});
