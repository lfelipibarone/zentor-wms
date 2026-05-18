import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import { api, ApiError } from "@/lib/api";
import type { LocationLookup } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

type Phase = "scan-pulmao" | "scan-product" | "scan-gondola" | "done";

type ScannerMode = "pulmao" | "product" | "gondola" | null;

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export default function ReplenishmentScreen() {
  const [phase, setPhase] = useState<Phase>("scan-pulmao");
  const [pulmao, setPulmao] = useState<LocationLookup | null>(null);
  const [gondola, setGondola] = useState<LocationLookup | null>(null);
  const [productBarcode, setProductBarcode] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(0);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<ScannerMode>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openScanner = (mode: ScannerMode) => {
    setScannerMode(mode);
    setScannerOpen(true);
  };

  const loadLocation = async (barcode: string) => {
    return api.getLocationByBarcode(barcode);
  };

  const handlePulmaoScan = async (raw: string) => {
    setScannerOpen(false);
    setLoading(true);
    setMessage(null);
    try {
      const loc = await loadLocation(normalizeBarcode(raw));
      if (loc.type !== "PULMAO") {
        setMessage("Bipe um pulmão (estoque de reserva)");
        return;
      }
      setPulmao(loc);
      setPhase("scan-product");
      setMessage("Pulmão OK. Bipe o produto e informe a quantidade.");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Pulmão não encontrado");
    } finally {
      setLoading(false);
    }
  };

  const handleProductScan = (raw: string) => {
    setScannerOpen(false);
    setProductBarcode(raw.trim());
    setMessage(`Produto: ${raw.trim()}. Informe a quantidade retirada.`);
  };

  const handleGondolaScan = async (raw: string) => {
    setScannerOpen(false);
    if (!pulmao || !productBarcode || quantity <= 0) {
      setMessage("Complete pulmão, produto e quantidade antes da gôndola");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const loc = await loadLocation(normalizeBarcode(raw));
      if (loc.type !== "PICK_FACE") {
        setMessage("Destino deve ser uma gôndola (pick face)");
        return;
      }
      setGondola(loc);
      const result = await api.transferReplenishment({
        fromLocationBarcode: pulmao.barcode,
        toLocationBarcode: loc.barcode,
        productBarcode,
        quantity,
      });
      setMessage(
        `Transferido ${result.transferred} un. · Pulmão: ${result.fromLocation.currentQuantity} · Gôndola: ${result.toLocation.currentQuantity}`,
      );
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro na transferência");
    } finally {
      setLoading(false);
    }
  };

  const onScan = (code: string) => {
    if (scannerMode === "pulmao") handlePulmaoScan(code);
    else if (scannerMode === "product") handleProductScan(code);
    else if (scannerMode === "gondola") handleGondolaScan(code);
  };

  const reset = () => {
    setPhase("scan-pulmao");
    setPulmao(null);
    setGondola(null);
    setProductBarcode(null);
    setQuantity(0);
    setMessage(null);
  };

  const maxFromPulmao = pulmao?.currentQuantity ?? 0;

  return (
    <ScreenShell scroll>
      <Text style={styles.pageHint}>
        Retire do pulmão e abasteça a gôndola (transferência com baixa no estoque)
      </Text>

      {phase === "scan-pulmao" ? (
        <>
          <Text style={styles.instruction}>1. Bipe o pulmão de origem</Text>
          <FactoryButton
            label="Bipar pulmão"
            onPress={() => openScanner("pulmao")}
            loading={loading}
          />
        </>
      ) : null}

      {pulmao ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>PULMÃO</Text>
          <Text style={styles.locTitle}>{pulmao.label}</Text>
          <Text style={styles.meta}>
            {pulmao.product?.sku ?? "—"} · Estoque: {pulmao.currentQuantity}
          </Text>
        </View>
      ) : null}

      {phase === "scan-product" && pulmao ? (
        <>
          <Text style={styles.instruction}>2. Bipe o produto e a quantidade</Text>
          <FactoryButton
            label={productBarcode ? `Produto: ${productBarcode}` : "Bipar produto"}
            variant="success"
            onPress={() => openScanner("product")}
          />
          <QuantityInput
            label={`Quantidade (máx. ${maxFromPulmao})`}
            max={maxFromPulmao}
            onConfirm={(q) => {
              setQuantity(q);
              setPhase("scan-gondola");
              setMessage("3. Bipe a gôndola de destino");
            }}
          />
        </>
      ) : null}

      {gondola ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>GÔNDOLA</Text>
          <Text style={styles.locTitle}>{gondola.label}</Text>
        </View>
      ) : null}

      {phase === "scan-gondola" && pulmao && quantity > 0 ? (
        <>
          <Text style={styles.instruction}>3. Bipe a gôndola de destino</Text>
          <FactoryButton
            label="Bipar gôndola"
            onPress={() => openScanner("gondola")}
            loading={loading}
          />
        </>
      ) : null}

      {phase === "done" ? (
        <FactoryButton label="Nova transferência" onPress={reset} />
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <BarcodeScanner
        visible={scannerOpen}
        title={
          scannerMode === "pulmao"
            ? "Bipar pulmão"
            : scannerMode === "product"
              ? "Bipar produto"
              : "Bipar gôndola"
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
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    marginVertical: spacing.md,
    borderWidth: 2,
    borderColor: theme.border,
  },
  cardLabel: {
    fontSize: typography.caption,
    fontWeight: "800",
    color: theme.textMuted,
    letterSpacing: 1,
  },
  locTitle: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.primary,
  },
  meta: { color: theme.textMuted, marginTop: spacing.xs },
  message: {
    marginTop: spacing.md,
    color: theme.success,
    fontWeight: "700",
    textAlign: "center",
  },
});
