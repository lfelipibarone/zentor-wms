import { useState } from "react";
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
import { SplitWorkModal } from "@/components/SplitWorkModal";
import { WorkShareCard, workBlockedMessage } from "@/components/WorkTimer";
import {
  useCompletePurchaseReceipt,
  useConfirmPurchaseReceiptItem,
  usePurchaseReceiptSession,
  useScanPurchaseReceiptItem,
} from "@/hooks/usePurchaseReceipt";
import { useSplitWork } from "@/hooks/useWorkShares";
import { ApiError, type PurchaseReceiptSessionDto } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export default function PurchaseReceiptCheckScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { data, isLoading } = usePurchaseReceiptSession(sessionId);
  const scan = useScanPurchaseReceiptItem(sessionId ?? "");
  const confirm = useConfirmPurchaseReceiptItem(sessionId ?? "");
  const complete = useCompletePurchaseReceipt(sessionId ?? "");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const splitWork = useSplitWork();

  const next = data?.nextItem;
  const remaining = next
    ? Math.max(0, next.quantityExpected - next.quantityChecked)
    : 0;
  const work = data?.work;
  const shared = (work?.shares.length ?? 0) > 0;
  const blocked = workBlockedMessage(work);
  const completed = data?.session.status === "COMPLETED";
  const pendingCount = data?.items.filter((it) => !it.completed).length ?? 0;
  const needsAccept = Boolean(data) && !shared && !completed && pendingCount > 0;
  const myItems = shared
    ? (data?.items ?? []).filter((it) => it.workShareId && it.workShareId === work?.mine?.id)
    : data?.items ?? [];
  const othersCount = (data?.items.length ?? 0) - myItems.length;

  const showCompletedAlert = () =>
    Alert.alert(
      "Conferência concluída",
      "NF conferida. Próximo passo: armazenagem no pulmão.",
      [
        { text: "Armazenagem", onPress: () => router.replace("/putaway") },
        { text: "Voltar", onPress: () => router.replace("/purchase-receipt") },
      ],
    );

  const handleSplit = async (colleagueIds: string[]) => {
    if (!sessionId) return;
    try {
      await splitWork.mutateAsync({ kind: "RECEIPT_CHECK", refId: sessionId, colleagueIds });
      setSplitOpen(false);
    } catch (e) {
      Alert.alert(
        "Erro",
        e instanceof ApiError ? e.message : "Não foi possível aceitar a conferência",
      );
    }
  };

  const applySessionFeedback = (
    updated: PurchaseReceiptSessionDto,
  ) => {
    if (updated.session.status === "COMPLETED") {
      setFeedback("Todos os itens conferidos ✓");
      showCompletedAlert();
      return;
    }
    const item = updated.nextItem;
    if (!item) {
      setFeedback(
        (updated.work?.shares.length ?? 0) > 0
          ? "Sua parte terminou ✓ — aguardando os colegas"
          : "Todos os itens conferidos ✓",
      );
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
      showCompletedAlert();
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

      <WorkShareCard work={work} />

      {completed ? (
        <>
          <Text style={styles.done}>Recebimento concluído</Text>
          <FactoryButton
            label="Ir para armazenagem"
            variant="success"
            onPress={() => router.replace("/putaway")}
          />
        </>
      ) : needsAccept ? (
        <>
          <Text style={styles.feedback}>
            {pendingCount} itens para conferir. Aceite para começar (sozinho ou dividindo).
          </Text>
          <FactoryButton
            label="Aceitar conferência"
            onPress={() => setSplitOpen(true)}
            loading={splitWork.isPending}
          />
        </>
      ) : blocked ? (
        <Text style={styles.blocked}>{blocked}</Text>
      ) : next ? (
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
        <Text style={styles.done}>
          {shared ? "Sua parte foi conferida ✓" : "Todos os itens conferidos"}
        </Text>
      )}

      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

      {!completed && !needsAccept && !blocked && next && remaining > 0 ? (
        <QuantityInput
          label="Quantidade conferida"
          max={remaining}
          loading={confirm.isPending}
          onConfirm={handleConfirmQty}
        />
      ) : null}

      {completed || needsAccept || blocked ? null : next ? (
        <FactoryButton
          label="Bipar produto (opcional)"
          variant="secondary"
          onPress={() => setScannerOpen(true)}
        />
      ) : shared ? null : (
        <FactoryButton
          label="Conferência finalizada"
          onPress={handleComplete}
          disabled={!data.allChecked}
        />
      )}

      {!completed && data.allChecked ? (
        <FactoryButton
          label="Finalizar recebimento"
          variant="success"
          onPress={handleComplete}
        />
      ) : null}

      <ScrollView style={styles.list}>
        {othersCount > 0 ? (
          <Text style={styles.othersHint}>
            {othersCount} itens com os colegas
          </Text>
        ) : null}
        {myItems.map((it) => (
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

      <SplitWorkModal
        visible={splitOpen}
        title={`Conferir NF ${data.session.invoiceNumber ?? ""}`}
        subtitle={data.session.supplierName}
        itemCount={pendingCount}
        loading={splitWork.isPending}
        onCancel={() => setSplitOpen(false)}
        onConfirm={handleSplit}
      />

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
  blocked: {
    textAlign: "center",
    fontWeight: "700",
    color: theme.warning,
    marginVertical: spacing.sm,
  },
  othersHint: {
    fontSize: typography.caption,
    color: theme.textMuted,
    fontStyle: "italic",
    paddingVertical: spacing.xs,
  },
  rowTitle: { color: theme.text, fontSize: typography.caption },
  rowQty: { color: theme.textMuted, fontSize: typography.caption },
});
