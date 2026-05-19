import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import { useStockLocation } from "@/hooks/useGondolaStocking";
import { api, ApiError } from "@/lib/api";
import type { LocationLookup } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

type Phase =
  | "scan-shelf"
  | "confirm-shelf"
  | "scan-product"
  | "done";

type ScannerTarget = "shelf" | "product" | null;

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export default function StockingScreen() {
  const [phase, setPhase] = useState<Phase>("scan-shelf");
  const [shelfBarcode, setShelfBarcode] = useState<string | null>(null);
  const [locationSnapshot, setLocationSnapshot] = useState<LocationLookup | null>(
    null,
  );
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerTarget, setScannerTarget] = useState<ScannerTarget>(null);
  const [message, setMessage] = useState<string | null>(null);

  const location = locationSnapshot;
  const stock = useStockLocation(location?.id ?? "");

  const maxAdd = location
    ? Math.max(0, location.capacity - location.currentQuantity)
    : 0;

  const openShelfScanner = () => {
    setScannerTarget("shelf");
    setScannerOpen(true);
  };

  const openProductScanner = () => {
    setScannerTarget("product");
    setScannerOpen(true);
  };

  const applyLocation = (loc: LocationLookup) => {
    setLocationSnapshot(loc);
    setShelfBarcode(loc.barcode);
  };

  const handleShelfScan = async (raw: string) => {
    const code = normalizeBarcode(raw);
    setScannerOpen(false);
    setMessage(null);

    if (phase === "confirm-shelf") {
      if (code !== normalizeBarcode(shelfBarcode ?? "")) {
        setMessage("Gôndola diferente. Bipe a mesma etiqueta.");
        return;
      }
      setPhase("scan-product");
      setMessage("Gôndola confirmada. Bipe os produtos.");
      return;
    }

    try {
      const loc = await api.getLocationByBarcode(code);
      applyLocation(loc);
      if (loc.product) {
        setPhase("scan-product");
        setMessage("Produto na gôndola. Bipe para adicionar unidades.");
      } else {
        setPhase("confirm-shelf");
        setMessage(
          "Gôndola sem produto. Bipe a etiqueta novamente para confirmar.",
        );
      }
    } catch (e) {
      setPhase("scan-shelf");
      setShelfBarcode(null);
      setLocationSnapshot(null);
      setMessage(
        e instanceof ApiError ? e.message : "Gôndola não encontrada no sistema",
      );
    }
  };

  const handleProductScan = async (raw: string) => {
    if (!location) return;
    setScannerOpen(false);
    setMessage(null);

    try {
      const result = await stock.mutateAsync({
        productBarcode: raw.trim(),
        quantity: 1,
      });
      applyLocation({
        ...location,
        currentQuantity: result.location.currentQuantity,
        product: result.location.product,
        needsReplenishment:
          result.location.currentQuantity <= result.location.minThreshold,
      });
      setMessage(
        `+${result.added} un. · Total: ${result.location.currentQuantity} / ${result.location.capacity}`,
      );
      if (result.location.currentQuantity >= result.location.capacity) {
        setPhase("done");
        setMessage("Capacidade máxima atingida.");
      }
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro ao registrar");
    }
  };

  const handleManualQty = async (qty: number) => {
    if (!location?.product?.barcode && !location?.product?.sku) {
      setMessage("Bipe ao menos um produto antes de informar quantidade.");
      return;
    }
    const barcode =
      location.product.barcode ?? location.product.sku;
    setMessage(null);
    try {
      const result = await stock.mutateAsync({
        productBarcode: barcode,
        quantity: qty,
      });
      applyLocation({
        ...location,
        currentQuantity: result.location.currentQuantity,
        product: result.location.product,
        needsReplenishment:
          result.location.currentQuantity <= result.location.minThreshold,
      });
      setMessage(
        `Total: ${result.location.currentQuantity} / ${result.location.capacity}`,
      );
      if (result.location.currentQuantity >= result.location.capacity) {
        setPhase("done");
      }
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro ao registrar");
    }
  };

  const reset = () => {
    setPhase("scan-shelf");
    setShelfBarcode(null);
    setLocationSnapshot(null);
    setMessage(null);
    setScannerTarget(null);
  };

  const onScan =
    scannerTarget === "product" ? handleProductScan : handleShelfScan;

  return (
    <ScreenShell scroll>
      <Text style={styles.pageHint}>
        Alocar produto e registrar quantidade na gôndola
      </Text>

      {phase === "scan-shelf" ? (
        <>
          <Text style={styles.instruction}>
            Escaneie a etiqueta da gôndola para consultar o cadastro.
          </Text>
          <FactoryButton label="Bipar gôndola" onPress={openShelfScanner} />
        </>
      ) : null}

      {location && phase !== "scan-shelf" ? (
        <View style={styles.card}>
          <Text style={styles.locTitle}>{location.label}</Text>
          <Text style={styles.barcode}>{location.barcode}</Text>

          {location.product ? (
            <View style={styles.productBlock}>
              <Text style={styles.blockLabel}>PRODUTO NA GÔNDOLA</Text>
              <Text style={styles.sku}>{location.product.sku}</Text>
              <Text style={styles.name}>{location.product.name}</Text>
            </View>
          ) : (
            <Text style={styles.warn}>Sem produto alocado</Text>
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
              <Text
                style={[
                  styles.statVal,
                  location.needsReplenishment && styles.low,
                ]}
              >
                {location.minThreshold}
              </Text>
              <Text style={styles.statLbl}>Mínimo</Text>
            </View>
          </View>
        </View>
      ) : null}

      {phase === "confirm-shelf" ? (
        <>
          <Text style={styles.instruction}>
            Para abastecer uma gôndola vazia, bipe a mesma etiqueta outra vez.
          </Text>
          <FactoryButton
            label="Confirmar gôndola (bipar de novo)"
            onPress={openShelfScanner}
          />
        </>
      ) : null}

      {phase === "scan-product" && location ? (
        <>
          {location.product ? (
            <>
              <Text style={styles.instruction}>
                Informe a quantidade a adicionar na gôndola.
              </Text>
              <QuantityInput
                label={`Adicionar quantidade (máx. ${maxAdd})`}
                max={maxAdd}
                loading={stock.isPending}
                onConfirm={handleManualQty}
              />
              <FactoryButton
                label="Bipar produto (+1) — opcional"
                variant="secondary"
                onPress={openProductScanner}
                disabled={maxAdd <= 0 || stock.isPending}
                loading={stock.isPending}
              />
            </>
          ) : (
            <>
              <Text style={styles.instruction}>
                Bipe o produto ou informe a quantidade após o primeiro bip.
              </Text>
              <FactoryButton
                label="Bipar produto"
                variant="success"
                onPress={openProductScanner}
                disabled={maxAdd <= 0 || stock.isPending}
                loading={stock.isPending}
              />
            </>
          )}
          <FactoryButton
            label="Finalizar"
            variant="secondary"
            onPress={() => setPhase("done")}
          />
        </>
      ) : null}

      {phase === "done" ? (
        <FactoryButton label="Nova gôndola" onPress={reset} />
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <BarcodeScanner
        visible={scannerOpen}
        title={
          scannerTarget === "product" ? "Bipar produto" : "Bipar gôndola"
        }
        hint={
          scannerTarget === "product"
            ? "Cada bip adiciona 1 unidade na gôndola"
            : phase === "confirm-shelf"
              ? "Confirme a mesma gôndola"
              : "Etiqueta da posição"
        }
        onScan={onScan}
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
    marginBottom: spacing.sm,
  },
  loading: { color: theme.textMuted, marginVertical: spacing.sm },
  error: { color: theme.danger, fontWeight: "700", marginVertical: spacing.sm },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: theme.border,
    marginVertical: spacing.md,
  },
  locTitle: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.primary,
  },
  barcode: {
    fontFamily: "monospace",
    color: theme.textMuted,
    fontSize: typography.caption,
  },
  productBlock: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  blockLabel: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.textMuted,
    letterSpacing: 1,
  },
  sku: { color: theme.info, fontWeight: "800", marginTop: spacing.xs },
  name: {
    fontSize: typography.subtitle,
    color: theme.text,
    fontWeight: "700",
  },
  warn: { color: theme.warning, fontWeight: "600" },
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
    marginTop: spacing.md,
  },
});
