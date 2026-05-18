import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import {
  useLocationByBarcode,
  useReplenish,
} from "@/hooks/useReplenishment";
import { ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

type Phase = "scan-shelf" | "add-stock" | "done";

export default function ReplenishmentScreen() {
  const [phase, setPhase] = useState<Phase>("scan-shelf");
  const [shelfBarcode, setShelfBarcode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [productScans, setProductScans] = useState(0);
  const [manualQty, setManualQty] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const { data: location, isLoading, error } =
    useLocationByBarcode(shelfBarcode);
  const replenish = useReplenish(location?.id ?? "");

  const maxAdd = location
    ? Math.max(0, location.capacity - location.currentQuantity)
    : 0;

  const handleShelfScan = (barcode: string) => {
    setScannerOpen(false);
    setShelfBarcode(barcode);
    setPhase("add-stock");
    setProductScans(0);
    setManualQty(null);
    setMessage(null);
  };

  const handleProductScan = () => {
    if (!location?.product) {
      setMessage("Gôndola sem produto alocado");
      return;
    }
    setProductScans((c) => c + 1);
    setMessage(`Unidades bipadas: ${productScans + 1}`);
  };

  const handleConfirm = async () => {
    if (!location) return;
    const qty = manualQty ?? productScans;
    if (qty <= 0) {
      setMessage("Informe ou bipe ao menos 1 unidade");
      return;
    }
    try {
      const result = await replenish.mutateAsync({
        quantity: qty,
        productBarcode: location.product?.barcode ?? undefined,
      });
      setMessage(
        `Reabastecido +${result.added} un. · Total na gôndola: ${result.currentQuantity}`
      );
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro ao confirmar");
    }
  };

  const reset = () => {
    setPhase("scan-shelf");
    setShelfBarcode(null);
    setProductScans(0);
    setManualQty(null);
    setMessage(null);
  };

  return (
    <ScreenShell scroll>
      <Text style={styles.pageHint}>
        Traga produtos do pulmão para a pick face
      </Text>
      {phase === "scan-shelf" ? (
        <>
          <Text style={styles.instruction}>
            Escaneie a gôndola (pick face) que deseja reabastecer.
          </Text>
          <FactoryButton
            label="Bipar gôndola"
            onPress={() => setScannerOpen(true)}
          />
        </>
      ) : null}

      {isLoading && shelfBarcode ? (
        <Text style={styles.loading}>Carregando gôndola...</Text>
      ) : null}

      {error && shelfBarcode ? (
        <Text style={styles.error}>
          {error instanceof Error ? error.message : "Gôndola não encontrada"}
        </Text>
      ) : null}

      {location && phase !== "scan-shelf" ? (
        <View style={styles.card}>
          <Text style={styles.locTitle}>{location.label}</Text>
          {location.product ? (
            <>
              <Text style={styles.sku}>{location.product.sku}</Text>
              <Text style={styles.name}>{location.product.name}</Text>
            </>
          ) : (
            <Text style={styles.warn}>Sem produto alocado nesta gôndola</Text>
          )}
          <View style={styles.statsRow}>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{location.currentQuantity}</Text>
              <Text style={styles.statLbl}>Atual</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statVal}>{location.capacity}</Text>
              <Text style={styles.statLbl}>Capacidade</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statVal, location.needsReplenishment && styles.low]}>
                {location.minThreshold}
              </Text>
              <Text style={styles.statLbl}>Mínimo</Text>
            </View>
          </View>
        </View>
      ) : null}

      {location && phase === "add-stock" ? (
        <>
          <Text style={styles.instruction}>
            Bipe os produtos trazidos do pulmão ou digite a quantidade.
          </Text>
          <FactoryButton
            label={`Bipar produto (+1) · ${productScans}`}
            variant="success"
            onPress={handleProductScan}
            disabled={!location.product}
          />
          <QuantityInput
            label="Ou digite a quantidade"
            max={maxAdd}
            onConfirm={(q) => {
              setManualQty(q);
              setMessage(`Quantidade definida: ${q}`);
            }}
          />
          <FactoryButton
            label="Confirmar reabastecimento"
            loading={replenish.isPending}
            onPress={handleConfirm}
          />
        </>
      ) : null}

      {phase === "done" ? (
        <FactoryButton label="Nova gôndola" onPress={reset} />
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <BarcodeScanner
        visible={scannerOpen}
        title="Bipar gôndola"
        onScan={handleShelfScan}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  pageHint: {
    fontSize: typography.body,
    color: theme.textMuted,
    marginBottom: spacing.md,
  },
  instruction: {
    fontSize: typography.body,
    color: theme.textMuted,
    lineHeight: 24,
  },
  loading: { color: theme.textMuted },
  error: { color: theme.danger, fontWeight: "700" },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: theme.border,
  },
  locTitle: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.primary,
  },
  sku: { color: theme.info, fontWeight: "800" },
  name: { fontSize: typography.subtitle, color: theme.text, fontWeight: "700" },
  warn: { color: theme.warning },
  statsRow: { flexDirection: "row", marginTop: spacing.md, gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: theme.bg,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: "center",
  },
  statVal: {
    fontSize: 32,
    fontWeight: "900",
    color: theme.text,
  },
  statLbl: { color: theme.textMuted, fontSize: typography.caption },
  low: { color: theme.danger },
  message: {
    color: theme.success,
    fontSize: typography.body,
    fontWeight: "700",
    textAlign: "center",
  },
});
