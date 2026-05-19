import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import {
  useCompletePurchaseReceipt,
  useConfirmPurchaseReceiptItem,
  usePurchaseReceiptSession,
  useScanPurchaseReceiptItem,
} from "@/hooks/usePurchaseReceipt";
import { api, ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export default function PurchaseReceiptCheckScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { data, isLoading } = usePurchaseReceiptSession(sessionId);
  const scan = useScanPurchaseReceiptItem(sessionId ?? "");
  const confirm = useConfirmPurchaseReceiptItem(sessionId ?? "");
  const complete = useCompletePurchaseReceipt(sessionId ?? "");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const next = data?.nextItem;
  const remaining = next
    ? Math.max(0, next.quantityExpected - next.quantityChecked)
    : 0;

  useEffect(() => {
    if (!sessionId) return;
    api.markPurchaseReceiptConferenceStart(sessionId).catch(() => {});
  }, [sessionId]);

  const applySessionFeedback = (
    updated: Awaited<ReturnType<typeof api.getPurchaseReceiptSession>>,
  ) => {
    const item = updated.nextItem;
    if (!item) {
      setFeedback("Todos os itens conferidos ✓");
    } else if (item.remaining > 0) {
      setFeedback(
        `${item.description ?? item.productCode}: faltam ${item.remaining}`,
      );
    } else {
      setFeedback("Item OK — próximo");
    }
  };

  const handleConfirmQty = async (qty: number) => {
    if (!next) return;
    try {
      const updated = await confirm.mutateAsync({
        itemId: next.id,
        quantity: qty,
      });
      applySessionFeedback(updated);
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Erro ao confirmar");
    }
  };

  const handleProductScan = async (barcode: string) => {
    setScannerOpen(false);
    if (!next) return;
    try {
      const updated = await scan.mutateAsync({ barcode, quantity: 1 });
      applySessionFeedback(updated);
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Erro no bip");
    }
  };

  const handleComplete = async () => {
    try {
      await complete.mutateAsync();
      Alert.alert(
        "Conferência concluída",
        "NF conferida. Próximo passo: armazenagem no pulmão.",
        [
          { text: "Armazenagem", onPress: () => router.replace("/putaway") },
          { text: "Voltar", onPress: () => router.replace("/purchase-receipt") },
        ],
      );
    } catch (e) {
      Alert.alert(
        "Erro",
        e instanceof ApiError ? e.message : "Não foi possível finalizar",
      );
    }
  };

  if (isLoading || !data) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  return (
    <ScreenShell
      backToHome
      scroll
      title={`NF ${data.session.invoiceNumber ?? ""}`}
      subtitle={data.session.supplierName ?? "Conferência de itens"}
    >
      {data.session.tinySyncMessage ? (
        <Text style={styles.syncHint}>{data.session.tinySyncMessage}</Text>
      ) : null}

      {next ? (
        <View style={styles.nextCard}>
          <Text style={styles.nextLabel}>Próximo item</Text>
          <Text style={styles.nextTitle}>
            {next.description ?? next.productCode ?? "—"}
          </Text>
          <Text style={styles.nextMeta}>
            {next.quantityChecked} / {next.quantityExpected} un.
          </Text>
          {next.barcode ? (
            <Text style={styles.nextBarcode}>GTIN: {next.barcode}</Text>
          ) : null}
        </View>
      ) : (
        <Text style={styles.done}>Todos os itens conferidos</Text>
      )}

      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

      {next && remaining > 0 ? (
        <QuantityInput
          label="Quantidade conferida"
          max={remaining}
          loading={confirm.isPending}
          onConfirm={handleConfirmQty}
        />
      ) : null}

      {next ? (
        <FactoryButton
          label="Bipar produto (opcional)"
          variant="secondary"
          onPress={() => setScannerOpen(true)}
        />
      ) : (
        <FactoryButton
          label="Conferência finalizada"
          onPress={handleComplete}
          disabled={!data.allChecked}
        />
      )}

      {data.allChecked ? (
        <FactoryButton
          label="Finalizar recebimento"
          variant="success"
          onPress={handleComplete}
        />
      ) : null}

      <ScrollView style={styles.list}>
        {data.items.map((it) => (
          <View
            key={it.id}
            style={[styles.row, it.completed && styles.rowDone]}
          >
            <Text style={styles.rowTitle}>
              {it.lineNumber}. {it.description ?? it.productCode}
            </Text>
            <Text style={styles.rowQty}>
              {it.quantityChecked} / {it.quantityExpected}
            </Text>
          </View>
        ))}
      </ScrollView>

      <BarcodeScanner
        visible={scannerOpen}
        title="Bipar produto"
        onScan={handleProductScan}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  syncHint: {
    fontSize: typography.caption,
    color: theme.textMuted,
    marginBottom: spacing.sm,
  },
  nextCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: theme.primary,
    marginBottom: spacing.sm,
  },
  nextLabel: { color: theme.textMuted, fontSize: typography.caption },
  nextTitle: {
    fontWeight: "800",
    fontSize: typography.subtitle,
    color: theme.text,
    marginTop: 4,
  },
  nextMeta: { marginTop: spacing.xs, color: theme.primary, fontWeight: "700" },
  nextBarcode: {
    marginTop: 4,
    fontSize: typography.caption,
    color: theme.textMuted,
  },
  done: {
    fontWeight: "700",
    color: theme.success,
    marginBottom: spacing.sm,
    textAlign: "center",
  },
  feedback: {
    textAlign: "center",
    marginBottom: spacing.sm,
    color: theme.text,
  },
  list: { marginTop: spacing.md, maxHeight: 220 },
  row: {
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  rowDone: { opacity: 0.55 },
  rowTitle: { color: theme.text, fontSize: typography.caption },
  rowQty: { color: theme.textMuted, fontSize: typography.caption },
});
