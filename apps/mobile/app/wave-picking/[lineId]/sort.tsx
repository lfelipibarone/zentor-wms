import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { Badge, Card, Loading, Notice } from "@/components/ui";
import { useWaveLine, useWaveLineSort } from "@/hooks/useWavePicking";
import { ApiError } from "@/lib/api";
import { modules } from "@/lib/modules";
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
      <ScreenShell module="picking" title="Distribuir nas cestas">
        <Loading />
      </ScreenShell>
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
        router.replace("/picking");
      }
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro no packing");
    }
  };

  return (
    <ScreenShell
      scroll
      module="picking"
      title="Distribuir nas cestas"
      subtitle={`${line.product.sku} · ${line.quantityPicked} un.`}
    >
      {line.allocations.map((alloc) => (
        <Card
          key={alloc.id}
          accent={alloc.remaining > 0 ? modules.picking.color : theme.success}
          style={styles.card}
        >
          <View style={styles.cardTop}>
            <Text style={styles.erp} numberOfLines={1}>
              {alloc.order.erpOrderId}
            </Text>
            <Text style={styles.qty}>
              {alloc.quantitySorted}/{alloc.quantity}
            </Text>
          </View>
          {alloc.order.basketCode ? (
            <Badge label={alloc.order.basketCode} icon="basket" tone="info" />
          ) : null}
          {alloc.remaining > 0 ? (
            <FactoryButton
              label={
                activeAllocId === alloc.id
                  ? "Bipando cesta…"
                  : alloc.order.basketCode
                    ? "Confirmar na cesta"
                    : "Bipar cesta"
              }
              icon="basket"
              size="md"
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
            <Badge label="Separado" tone="success" icon="checkmark" />
          )}
        </Card>
      ))}

      {message ? <Notice tone="info">{message}</Notice> : null}

      <FactoryButton
        label="Voltar à onda"
        icon="arrow-back"
        size="md"
        variant="secondary"
        onPress={() => router.replace("/picking")}
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
  card: { gap: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  erp: { flex: 1, fontWeight: "900", fontSize: typography.subtitle, color: theme.text },
  qty: { fontWeight: "900", fontSize: typography.subtitle, color: theme.text },
});
