import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import { useWaveLine, useWaveLinePick } from "@/hooks/useWavePicking";
import { ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export default function WavePickScreen() {
  const { lineId } = useLocalSearchParams<{ lineId: string }>();
  const { data, isLoading } = useWaveLine(lineId);
  const pick = useWaveLinePick(lineId);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"location" | "product">(
    "location",
  );
  const [locationOk, setLocationOk] = useState(false);
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
        router.replace({
          pathname: "/wave-picking/[lineId]/sort",
          params: { lineId },
        });
      }
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro no pick");
    }
  };

  return (
    <ScreenShell scroll>
      <Text style={styles.sku}>{line.product.sku}</Text>
      <Text style={styles.name}>{line.product.name}</Text>
      <Text style={styles.loc}>{line.pickLocation.label}</Text>
      <Text style={styles.qty}>
        Coletar: {line.remaining} un. ({line.ordersCount} pedidos)
      </Text>

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
        <FactoryButton
          label="Ir para packing"
          onPress={() =>
            router.push({
              pathname: "/wave-picking/[lineId]/sort",
              params: { lineId },
            })
          }
        />
      ) : null}

      <BarcodeScanner
        visible={scannerOpen}
        title={scannerMode === "location" ? "Bipar gôndola" : "Bipar produto"}
        onScan={async (code) => {
          setScannerOpen(false);
          if (scannerMode === "location") {
            if (code.trim().toUpperCase() !== line.pickLocation.barcode) {
              setMessage("Gôndola incorreta");
              return;
            }
            setLocationOk(true);
            setMessage("Gôndola OK");
            return;
          }
          await confirmPick(1, code);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  sku: { fontSize: 24, fontWeight: "900", color: theme.info },
  name: { fontSize: typography.subtitle, fontWeight: "700", marginTop: spacing.xs },
  loc: { fontFamily: "monospace", color: theme.primary, marginTop: spacing.sm },
  qty: { fontSize: typography.hero, fontWeight: "900", marginVertical: spacing.md },
  ordersBox: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  ordersTitle: { fontWeight: "800", color: theme.textMuted, marginBottom: spacing.sm },
  orderRow: { color: theme.text, marginBottom: 4 },
  message: {
    marginTop: spacing.md,
    textAlign: "center",
    fontWeight: "700",
    color: theme.success,
  },
});
