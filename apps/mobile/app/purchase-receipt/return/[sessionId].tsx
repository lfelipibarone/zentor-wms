import { useCallback, useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { CompactPercentField } from "@/components/PercentInput";
import { PulmaoLocationPicker } from "@/components/PulmaoLocationPicker";
import { PulmaoStockList } from "@/components/PulmaoStockList";
import { ScreenShell } from "@/components/ScreenShell";
import { api, ApiError, type LocationLookup } from "@/lib/api";
import { parsePercentText } from "@/lib/percent";
import { theme, spacing, typography } from "@/lib/theme";

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
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const defaultSku =
    data.items.find((it) => it.productCode)?.productCode ?? "";

  return (
    <ScreenShell
      scroll
      title="Devolução"
      subtitle={data.session.reference ?? "Bipe produtos devolvidos"}
    >
      <Text style={styles.total}>{data.totalUnits} un. registradas</Text>
      {feedback ? <Text style={styles.feedback}>{feedback}</Text> : null}

      <FactoryButton
        label="Bipar produto"
        onPress={() => setProductScanner(true)}
        loading={saving}
      />

      <FlatList
        data={data.items}
        keyExtractor={(it) => it.id}
        style={styles.list}
        scrollEnabled={false}
        ListEmptyComponent={
          <Text style={styles.empty}>Nenhum item — bipe um produto</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.sku}>{item.productCode}</Text>
            <Text style={styles.qty}>{item.quantityChecked} un.</Text>
          </View>
        )}
      />

      {data.hasItems ? (
        <View style={styles.destinoSection}>
          <Text style={styles.sectionTitle}>Destino no pulmão</Text>
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
              <View style={styles.locCard}>
                <Text style={styles.locTitle}>{selectedPulmao.label}</Text>
                <Text style={styles.locMeta}>
                  Ocupação {selectedPulmao.fillPercent}%
                </Text>
                <PulmaoStockList stocks={selectedPulmao.stocks} />
              </View>
              <Text style={styles.sectionTitle}>
                Quanto cada SKU ocupa no pulmão depois de guardar?
              </Text>
              {itemsToStore.map((it) => (
                <View key={it.id} style={styles.percentRow}>
                  <View style={styles.percentInfo}>
                    <Text style={styles.sku}>{it.productCode}</Text>
                    <Text style={styles.locMeta}>{it.quantityChecked} un. devolvidas</Text>
                  </View>
                  <CompactPercentField
                    value={percents[it.id] ?? ""}
                    onChange={(t) => setPercents((prev) => ({ ...prev, [it.id]: t }))}
                  />
                </View>
              ))}
              <FactoryButton
                label="Finalizar devolução"
                variant="success"
                onPress={handleFinalize}
                disabled={!percentsValid}
                loading={saving}
              />
              <FactoryButton
                label="Trocar pulmão"
                variant="secondary"
                onPress={() => selectPulmao(null)}
                disabled={saving}
              />
            </>
          )}
        </View>
      ) : null}

      <BarcodeScanner
        visible={productScanner}
        title="Produto devolvido"
        hint="Código de barras do produto"
        onScan={handleProductScan}
        onClose={() => setProductScanner(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  total: {
    fontSize: typography.subtitle,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  feedback: { color: theme.primary, marginBottom: spacing.sm },
  list: { maxHeight: 280, marginVertical: spacing.md },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.sm,
    borderBottomWidth: 1,
    borderColor: theme.border,
  },
  sku: { fontFamily: "monospace", fontWeight: "600" },
  percentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderColor: theme.border,
  },
  percentInfo: { flex: 1, gap: 2 },
  qty: { fontWeight: "700" },
  empty: { color: theme.textMuted, textAlign: "center", padding: spacing.lg },
  destinoSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: {
    fontWeight: "900",
    fontSize: typography.body,
    color: theme.text,
  },
  locCard: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  locTitle: {
    fontSize: typography.subtitle,
    fontWeight: "900",
    color: theme.primary,
  },
  locMeta: {
    color: theme.textMuted,
    fontSize: typography.caption,
    marginTop: 4,
  },
});
