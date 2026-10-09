import { useCallback, useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { CompactPercentField } from "@/components/PercentInput";
import { PulmaoLocationPicker } from "@/components/PulmaoLocationPicker";
import { PulmaoStockList } from "@/components/PulmaoStockList";
import { ScreenShell } from "@/components/ScreenShell";
import { BigCode, Card, EmptyState, Loading, Notice, SectionTitle } from "@/components/ui";
import { api, ApiError, type LocationLookup } from "@/lib/api";
import { modules } from "@/lib/modules";
import { parsePercentText } from "@/lib/percent";
import { theme, spacing, typography, radius } from "@/lib/theme";

export default function ReturnReceiptCheckScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const [data, setData] = useState<
    Awaited<ReturnType<typeof api.getReturnReceiptSession>> | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [productScanner, setProductScanner] = useState(false);
  const [selectedPulmao, setSelectedPulmao] = useState<LocationLookup | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  /** % que cada SKU devolvido passa a ocupar no pulmão (por item) */
  const [percents, setPercents] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const session = await api.getReturnReceiptSession(sessionId);
      setData(session);
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleProductScan = async (barcode: string) => {
    setProductScanner(false);
    if (!sessionId) return;
    setSaving(true);
    try {
      const updated = await api.scanReturnReceiptProduct(sessionId, barcode, 1);
      setData(updated);
      setFeedback(`+1 ${barcode}`);
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Produto não encontrado");
    } finally {
      setSaving(false);
    }
  };

  const selectPulmao = (loc: LocationLookup | null) => {
    setSelectedPulmao(loc);
    if (!loc || !data) {
      setPercents({});
      return;
    }
    const initial: Record<string, string> = {};
    for (const it of data.items) {
      const current = loc.stocks.find(
        (st) => st.product.sku.toUpperCase() === (it.productCode ?? "").toUpperCase(),
      );
      initial[it.id] = current ? String(current.percent) : "";
    }
    setPercents(initial);
  };

  const itemsToStore = data?.items.filter((it) => it.quantityChecked > 0) ?? [];
  const percentsValid = itemsToStore.every((it) => {
    const p = parsePercentText(percents[it.id] ?? "");
    return p !== null && p >= 1;
  });

  const handleFinalize = async () => {
    if (!sessionId || !selectedPulmao) return;
    if (!percentsValid) {
      setFeedback("Informe a % de cada SKU no pulmão (mínimo 1%).");
      return;
    }
    setSaving(true);
    try {
      await api.completeReturnReceipt(
        sessionId,
        selectedPulmao.barcode,
        itemsToStore.map((it) => ({
          itemId: it.id,
          percent: parsePercentText(percents[it.id] ?? "") ?? 0,
        })),
      );
      Alert.alert("Devolução concluída", "Produtos armazenados no pulmão.", [
        { text: "OK", onPress: () => router.replace("/purchase-receipt") },
      ]);
    } catch (e) {
      setFeedback(e instanceof ApiError ? e.message : "Erro ao finalizar");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) {
    return (
      <ScreenShell module="recebimento" title="Devolução">
        <Loading />
      </ScreenShell>
    );
  }

  const defaultSku =
    data.items.find((it) => it.productCode)?.productCode ?? "";
  const feedbackError = feedback != null && !feedback.startsWith("+1") && !feedback.startsWith("Pulmão:");

  return (
    <ScreenShell
      scroll
      module="recebimento"
      title="Devolução"
      subtitle={data.session.reference}
      headerRight={<Text style={styles.headerCount}>{data.totalUnits} un.</Text>}
    >
      {feedback ? (
        <Notice tone={feedbackError ? "danger" : "success"}>{feedback}</Notice>
      ) : null}

      <FactoryButton
        label="Bipar produto"
        icon="barcode"
        color={color}
        onPress={() => setProductScanner(true)}
        loading={saving}
      />

      {data.items.length === 0 ? (
        <EmptyState icon="cube-outline" title="Nenhum item" />
      ) : (
        <View style={styles.list}>
          {data.items.map((item) => (
            <View key={item.id} style={styles.row}>
              <Text style={styles.sku}>{item.productCode}</Text>
              <Text style={styles.qty}>{item.quantityChecked} un.</Text>
            </View>
          ))}
        </View>
      )}

      {data.hasItems ? (
        <>
          <SectionTitle>Destino no pulmão</SectionTitle>
          {!selectedPulmao ? (
            <PulmaoLocationPicker
              defaultSku={defaultSku}
              onSelect={(loc) => {
                selectPulmao(loc);
                setFeedback(`Pulmão: ${loc.label}`);
              }}
              disabled={saving}
            />
          ) : (
            <>
              <BigCode
                label="Pulmão"
                code={selectedPulmao.label}
                meta={`Ocupação ${selectedPulmao.fillPercent}%`}
                color={modules.armazenagem.color}
              />
              <PulmaoStockList stocks={selectedPulmao.stocks} />
              <SectionTitle>% de cada SKU no pulmão</SectionTitle>
              {itemsToStore.map((it) => (
                <Card key={it.id}>
                  <View style={styles.percentRow}>
                    <View style={styles.percentInfo}>
                      <Text style={styles.sku}>{it.productCode}</Text>
                      <Text style={styles.meta}>{it.quantityChecked} un.</Text>
                    </View>
                    <CompactPercentField
                      value={percents[it.id] ?? ""}
                      onChange={(t) => setPercents((prev) => ({ ...prev, [it.id]: t }))}
                    />
                  </View>
                </Card>
              ))}
              <FactoryButton
                label="Finalizar devolução"
                icon="checkmark-done"
                variant="success"
                onPress={handleFinalize}
                disabled={!percentsValid}
                loading={saving}
              />
              <FactoryButton
                label="Trocar pulmão"
                icon="swap-horizontal"
                size="sm"
                variant="secondary"
                onPress={() => selectPulmao(null)}
                disabled={saving}
              />
            </>
          )}
        </>
      ) : null}

      <BarcodeScanner
        visible={productScanner}
        title="Produto devolvido"
        onScan={handleProductScan}
        onClose={() => setProductScanner(false)}
      />
    </ScreenShell>
  );
}

const color = modules.recebimento.color;

const styles = StyleSheet.create({
  headerCount: { color: theme.headerTint, fontWeight: "900", fontSize: typography.body },
  list: {
    backgroundColor: theme.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: theme.border,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderColor: theme.border,
  },
  sku: { fontWeight: "900", color: theme.text },
  qty: { fontWeight: "900", color: theme.text },
  meta: { color: theme.textMuted, fontSize: typography.caption, fontWeight: "700" },
  percentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  percentInfo: { flex: 1, gap: 2 },
});
