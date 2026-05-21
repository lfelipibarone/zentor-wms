import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import {
  AdjustStockModal,
  type AdjustStockContext,
} from "@/components/AdjustStockModal";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { CollectionDeadlineRow } from "@/components/CollectionDeadlineRow";
import { ScreenShell } from "@/components/ScreenShell";
import { useAdjustLocationStock } from "@/hooks/useAdjustLocationStock";
import { useWaveLine, useWaveLinePick } from "@/hooks/useWavePicking";
import { ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export default function WavePickScreen() {
  const { lineId } = useLocalSearchParams<{ lineId: string }>();
  const { data, isLoading, refetch } = useWaveLine(lineId);
  const pick = useWaveLinePick(lineId);
  const adjustStock = useAdjustLocationStock();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"location" | "product">(
    "location",
  );
  const [locationOk, setLocationOk] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const line = data?.line;

  if (isLoading || !line) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const maxPick = line.remaining;

  const adjustContext: AdjustStockContext = {
    locationId: line.pickLocation.id,
    locationLabel: line.pickLocation.label,
    systemQuantity: line.pickLocation.currentQuantity,
    capacity: line.pickLocation.capacity ?? 9999,
    productBarcode: line.product.barcode,
    waveLineId: lineId,
  };

  const handleAdjustStock = async (countedQuantity: number, reason: string) => {
    try {
      const result = await adjustStock.mutateAsync({
        locationId: line.pickLocation.id,
        countedQuantity,
        productBarcode: line.product.barcode,
        reason,
        waveLineId: lineId,
      });
      setAdjustOpen(false);
      setMessage(`Estoque ajustado: ${result.location.currentQuantity} un.`);

      const waveUpdate = result.reconciliation.waveLines.find(
        (w) => w.waveLineId === lineId,
      );
      if (waveUpdate?.newLocationBarcode && waveUpdate.action === "updated") {
        setMessage(`Gôndola atualizada: ${waveUpdate.newLocationBarcode}`);
        setLocationOk(false);
      }

      if (result.reconciliation.warnings.length > 0) {
        Alert.alert(
          "Avisos",
          result.reconciliation.warnings.slice(0, 4).join("\n"),
        );
      }

      await refetch();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro ao ajustar estoque");
    }
  };

  const confirmPick = async (qty: number, productBarcode?: string) => {
    try {
      const result = await pick.mutateAsync({
        locationBarcode: line.pickLocation.barcode,
        productBarcode,
        quantity: qty,
      });
      setMessage(
        `Pick registrado: ${result.quantityPicked}/${result.quantityTotal}`,
      );
      if (result.readyForSort) {
        setMessage("Pick concluído — finalize o packing no painel web.");
        router.replace("/picking");
      }
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro no pick");
    }
  };

  return (
    <ScreenShell scroll>
      <Text style={styles.sku}>{line.product.sku}</Text>
      <CollectionDeadlineRow deadline={line.collectionDeadline} />
      <Text style={styles.name}>{line.product.name}</Text>
      <Text style={styles.loc}>{line.pickLocation.label}</Text>
      <Text style={styles.stock}>
        Sistema: {line.pickLocation.currentQuantity} un.
        {line.pickLocation.capacity != null
          ? ` · cap. ${line.pickLocation.capacity}`
          : ""}
      </Text>
      <Text style={styles.qty}>
        Coletar: {line.remaining} un. ({line.ordersCount} pedidos)
      </Text>

      <FactoryButton
        label="Corrigir estoque na gôndola"
        variant="secondary"
        onPress={() => setAdjustOpen(true)}
      />

      <View style={styles.ordersBox}>
        <Text style={styles.ordersTitle}>Pedidos nesta linha</Text>
        {line.orders.map((o) => (
          <Text key={o.orderId} style={styles.orderRow}>
            {o.erpOrderId} · {o.quantity} un.
            {o.basketCode ? ` · ${o.basketCode}` : ""}
          </Text>
        ))}
      </View>

      <FactoryButton
        label={locationOk ? "Gôndola confirmada ✓" : "Bipar gôndola"}
        onPress={() => {
          setScannerMode("location");
          setScannerOpen(true);
        }}
      />
      <FactoryButton
        label="Bipar produto (+1)"
        variant="success"
        disabled={!locationOk || maxPick <= 0}
        onPress={() => {
          setScannerMode("product");
          setScannerOpen(true);
        }}
      />
      <QuantityInput
        label={`Quantidade total (máx. ${maxPick})`}
        max={maxPick}
        loading={pick.isPending}
        onConfirm={(q) => confirmPick(q, line.product.barcode ?? undefined)}
      />

      {message ? <Text style={styles.message}>{message}</Text> : null}

      {line.sortStatus === "PICKED" ? (
        <Text style={styles.message}>
          Pick concluído — finalize o packing no painel web.
        </Text>
      ) : null}

      <BarcodeScanner
        visible={scannerOpen}
        title={scannerMode === "location" ? "Bipar gôndola" : "Bipar produto"}
        hint={
          scannerMode === "location"
            ? line.pickLocation.barcode
            : line.product.barcode ?? line.product.sku
        }
        onScan={(code) => {
          setScannerOpen(false);
          if (scannerMode === "location") {
            if (code.trim().toUpperCase() === line.pickLocation.barcode.toUpperCase()) {
              setLocationOk(true);
              setMessage("Gôndola confirmada ✓");
            } else {
              setMessage("Gôndola incorreta");
            }
          } else {
            void confirmPick(1, code);
          }
        }}
        onClose={() => setScannerOpen(false)}
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
  sku: { fontWeight: "900", fontSize: typography.subtitle, color: theme.info },
  name: { fontSize: typography.body, fontWeight: "700", marginBottom: spacing.sm },
  loc: { fontFamily: "monospace", color: theme.textMuted },
  stock: { color: theme.text, fontWeight: "600", marginTop: spacing.xs },
  qty: { fontSize: 22, fontWeight: "900", marginVertical: spacing.md },
  ordersBox: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  ordersTitle: { fontWeight: "800", marginBottom: spacing.xs },
  orderRow: { color: theme.textMuted, fontSize: typography.caption },
  message: { marginTop: spacing.md, color: theme.text, fontWeight: "600" },
});
