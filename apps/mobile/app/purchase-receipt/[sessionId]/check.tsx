import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import { SplitWorkModal } from "@/components/SplitWorkModal";
import { WorkShareCard, workBlockedMessage } from "@/components/WorkTimer";
import {
  Badge,
  Card,
  EmptyState,
  Loading,
  Notice,
  ProgressBar,
  SectionTitle,
} from "@/components/ui";
import {
  useCompletePurchaseReceipt,
  useConfirmPurchaseReceiptItem,
  usePurchaseReceiptSession,
  useScanPurchaseReceiptItem,
} from "@/hooks/usePurchaseReceipt";
import { useSplitWork } from "@/hooks/useWorkShares";
import { ApiError, type PurchaseReceiptSessionDto } from "@/lib/api";
import { modules } from "@/lib/modules";
import { theme, spacing, typography, radius } from "@/lib/theme";

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
      <ScreenShell module="recebimento" title="Conferência">
        <Loading />
      </ScreenShell>
    );
  }

  const doneCount = myItems.filter((it) => it.completed).length;
  const feedbackOk = feedback?.includes("✓") || feedback?.startsWith("Item OK");

  return (
    <ScreenShell
      scroll
      module="recebimento"
      title={`NF ${data.session.invoiceNumber ?? ""}`}
      subtitle={data.session.supplierName}
      headerRight={
        <Text style={styles.headerCount}>
          {doneCount}/{myItems.length}
        </Text>
      }
    >
      <ProgressBar value={doneCount} total={myItems.length} color={color} />

      {data.session.tinySyncMessage ? (
        <Notice tone="info">{data.session.tinySyncMessage}</Notice>
      ) : null}

      <WorkShareCard work={work} />

      {completed ? (
        <>
          <EmptyState icon="checkmark-circle" title="Recebimento concluído" />
          <FactoryButton
            label="Ir para armazenagem"
            icon={modules.armazenagem.icon}
            color={modules.armazenagem.color}
            onPress={() => router.replace("/putaway")}
          />
        </>
      ) : needsAccept ? (
        <>
          <View style={styles.acceptBox}>
            <Text style={styles.acceptValue}>{pendingCount}</Text>
            <Text style={styles.acceptLabel}>itens para conferir</Text>
          </View>
          <FactoryButton
            label="Aceitar conferência"
            icon="hand-left"
            color={color}
            onPress={() => setSplitOpen(true)}
            loading={splitWork.isPending}
          />
        </>
      ) : blocked ? (
        <Notice tone="warning">{blocked}</Notice>
      ) : next ? (
        <Card accent={color}>
          <Text style={styles.nextLabel}>Próximo item</Text>
          <Text style={styles.nextTitle}>
            {next.description ?? next.productCode ?? "—"}
          </Text>
          <View style={styles.nextRow}>
            <Text style={styles.nextQty}>
              {next.quantityChecked}
              <Text style={styles.nextQtyOf}> / {next.quantityExpected} un.</Text>
            </Text>
            {next.barcode ? <Badge label={next.barcode} icon="barcode" /> : null}
          </View>
        </Card>
      ) : (
        <EmptyState
          icon="checkmark-circle"
          title={shared ? "Sua parte foi conferida" : "Todos os itens conferidos"}
        />
      )}

      {feedback ? (
        <Notice tone={feedbackOk ? "success" : "info"}>{feedback}</Notice>
      ) : null}

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
          label="Bipar produto"
          icon="barcode"
          size="md"
          variant="secondary"
          onPress={() => setScannerOpen(true)}
        />
      ) : shared || data.allChecked ? null : (
        <FactoryButton
          label="Conferência finalizada"
          onPress={handleComplete}
          disabled={!data.allChecked}
        />
      )}

      {!completed && data.allChecked ? (
        <FactoryButton
          label="Finalizar recebimento"
          icon="checkmark-done"
          variant="success"
          onPress={handleComplete}
        />
      ) : null}

      {myItems.length > 0 ? (
        <>
          <SectionTitle
            right={
              othersCount > 0 ? (
                <Badge label={`${othersCount} com colegas`} icon="people" />
              ) : undefined
            }
          >
            Itens
          </SectionTitle>
          <View style={styles.list}>
            {myItems.map((it) => (
              <View key={it.id} style={[styles.row, it.completed && styles.rowDone]}>
                <Ionicons
                  name={it.completed ? "checkmark-circle" : "ellipse-outline"}
                  size={20}
                  color={it.completed ? theme.success : theme.textSoft}
                />
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {it.description ?? it.productCode}
                </Text>
                <Text style={styles.rowQty}>
                  {it.quantityChecked}/{it.quantityExpected}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

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
        title={next?.description ?? next?.productCode ?? "Produto"}
        onScan={handleProductScan}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const color = modules.recebimento.color;

const styles = StyleSheet.create({
  headerCount: { color: theme.headerTint, fontWeight: "900", fontSize: typography.body },
  acceptBox: {
    alignItems: "center",
    paddingVertical: spacing.lg,
    backgroundColor: modules.recebimento.soft,
    borderRadius: radius.xl,
  },
  acceptValue: { fontSize: 48, fontWeight: "900", color },
  acceptLabel: { fontWeight: "800", color, fontSize: typography.body },
  nextLabel: {
    color: theme.textMuted,
    fontSize: typography.small,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  nextTitle: {
    fontWeight: "900",
    fontSize: typography.subtitle,
    color: theme.text,
    marginTop: 2,
  },
  nextRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  nextQty: { fontSize: 30, fontWeight: "900", color },
  nextQtyOf: { fontSize: typography.body, color: theme.textMuted, fontWeight: "700" },
  list: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  rowDone: { opacity: 0.55 },
  rowTitle: { flex: 1, color: theme.text, fontWeight: "700" },
  rowQty: { color: theme.text, fontWeight: "900" },
});
