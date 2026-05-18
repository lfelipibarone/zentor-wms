import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { useWaveLine, useWaveLineSort } from "@/hooks/useWavePicking";
import { ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

export default function WaveSortScreen() {
  const { lineId } = useLocalSearchParams<{ lineId: string }>();
  const { data, isLoading, refetch } = useWaveLine(lineId);
  const sort = useWaveLineSort(lineId);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [activeAllocId, setActiveAllocId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const line = data?.line;

  if (isLoading || !line) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const handleBasketScan = async (barcode: string) => {
    if (!activeAllocId) return;
    const alloc = line.allocations.find((a) => a.id === activeAllocId);
    if (!alloc) return;
    setScannerOpen(false);
    try {
      const result = await sort.mutateAsync({
        allocationId: activeAllocId,
        quantity: alloc.remaining,
        basketBarcode: barcode,
      });
      setMessage(
        `${alloc.order.erpOrderId}: ${result.quantitySorted}/${alloc.quantity} na cesta ${result.basketCode ?? ""}`,
      );
      setActiveAllocId(null);
      await refetch();
      if (result.lineSortStatus === "SORTED") {
        router.replace("/wave-picking/index");
      }
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro no packing");
    }
  };

  return (
    <ScreenShell scroll>
      <Text style={styles.title}>Packing — separar nas cestas</Text>
      <Text style={styles.sub}>
        {line.product.sku} · {line.quantityPicked} un. coletadas
      </Text>

      {line.allocations.map((alloc) => (
        <View key={alloc.id} style={styles.card}>
          <Text style={styles.erp}>{alloc.order.erpOrderId}</Text>
          <Text style={styles.qty}>
            {alloc.quantitySorted} / {alloc.quantity} un.
          </Text>
          {alloc.order.basketCode ? (
            <Text style={styles.basket}>Cesta: {alloc.order.basketCode}</Text>
          ) : null}
          {alloc.remaining > 0 ? (
            <FactoryButton
              label={
                activeAllocId === alloc.id
                  ? "Bipar cesta..."
                  : alloc.order.basketCode
                    ? "Confirmar na cesta"
                    : "Bipar cesta e confirmar"
              }
              variant="success"
              loading={sort.isPending && activeAllocId === alloc.id}
              onPress={() => {
                if (alloc.order.basketCode && !activeAllocId) {
                  sort
                    .mutateAsync({
                      allocationId: alloc.id,
                      quantity: alloc.remaining,
                    })
                    .then(() => refetch())
                    .catch((e) =>
                      setMessage(
                        e instanceof ApiError ? e.message : "Erro",
                      ),
                    );
                  return;
                }
                setActiveAllocId(alloc.id);
                setScannerOpen(true);
              }}
            />
          ) : (
            <Text style={styles.done}>Separado ✓</Text>
          )}
        </View>
      ))}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <FactoryButton
        label="Voltar à onda"
        variant="secondary"
        onPress={() => router.replace("/wave-picking/index")}
      />

      <BarcodeScanner
        visible={scannerOpen}
        title="Bipar cesta"
        onScan={handleBasketScan}
        onClose={() => {
          setScannerOpen(false);
          setActiveAllocId(null);
        }}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: typography.title, fontWeight: "900", color: theme.primary },
  sub: { color: theme.textMuted, marginBottom: spacing.lg },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: theme.border,
  },
  erp: { fontWeight: "900", fontSize: typography.subtitle },
  qty: { marginTop: spacing.xs, fontWeight: "700" },
  basket: { color: theme.info, marginTop: spacing.xs },
  done: { color: theme.success, fontWeight: "800", marginTop: spacing.sm },
  message: {
    textAlign: "center",
    fontWeight: "700",
    color: theme.success,
    marginVertical: spacing.md,
  },
});
