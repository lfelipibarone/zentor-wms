import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ScreenShell } from "@/components/ScreenShell";
import { api, ApiError } from "@/lib/api";
import type { LocationLookup } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

type Phase = "scan-pulmao" | "scan-product" | "confirm-qty" | "done";

type ScannerMode = "pulmao" | "product" | null;

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export default function CargoTransportScreen() {
  const [phase, setPhase] = useState<Phase>("scan-pulmao");
  const [pulmao, setPulmao] = useState<LocationLookup | null>(null);
  const [productBarcode, setProductBarcode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<ScannerMode>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openScanner = (mode: ScannerMode) => {
    setScannerMode(mode);
    setScannerOpen(true);
  };

  const handlePulmaoScan = async (raw: string) => {
    setScannerOpen(false);
    setLoading(true);
    setMessage(null);
    try {
      const loc = await api.getLocationByBarcode(normalizeBarcode(raw));
      if (loc.type !== "PULMAO") {
        setMessage("Bipe um pulmão (estoque de reserva)");
        return;
      }
      setPulmao(loc);
      if (loc.product?.sku || loc.product?.barcode) {
        setProductBarcode(loc.product.barcode ?? loc.product.sku);
        setPhase("confirm-qty");
        setMessage(
          `${loc.product.sku} no pulmão — informe a quantidade retirada.`,
        );
      } else {
        setPhase("scan-product");
        setMessage("Pulmão OK. Bipe o produto.");
      }
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Pulmão não encontrado");
    } finally {
      setLoading(false);
    }
  };

  const handleProductScan = (raw: string) => {
    setScannerOpen(false);
    setProductBarcode(raw.trim());
    setPhase("confirm-qty");
    setMessage(`Produto: ${raw.trim()}. Informe a quantidade retirada.`);
  };

  const confirmWithdraw = async (qty: number) => {
    if (!pulmao || !productBarcode) {
      setMessage("Bipe o pulmão e o produto antes de confirmar");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const result = await api.withdrawCargoTransfer({
        fromLocationBarcode: pulmao.barcode,
        productBarcode,
        quantity: qty,
      });
      setMessage(
        `Retirado ${result.transfer.quantity} un. do pulmão (saldo: ${result.fromLocation.currentQuantity}). Abasteça em "Estoque de giro".`,
      );
      setPhase("done");
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro no transporte");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setPhase("scan-pulmao");
    setPulmao(null);
    setProductBarcode(null);
    setMessage(null);
  };

  const maxFromPulmao = pulmao?.currentQuantity ?? 0;

  return (
    <ScreenShell scroll backToHome>
      <Text style={styles.pageHint}>
        Retire mercadoria do pulmão. O abastecimento na gôndola é feito em
        Estoque de giro.
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
          <Text style={styles.instruction}>2. Bipe o produto</Text>
          <FactoryButton
            label="Bipar produto"
            variant="secondary"
            onPress={() => openScanner("product")}
          />
        </>
      ) : null}

      {phase === "confirm-qty" && pulmao ? (
        <>
          <Text style={styles.instruction}>Quantidade retirada do pulmão</Text>
          {productBarcode ? (
            <Text style={styles.meta}>Produto: {productBarcode}</Text>
          ) : null}
          <QuantityInput
            label={`Quantidade (máx. ${maxFromPulmao})`}
            max={maxFromPulmao}
            onConfirm={confirmWithdraw}
          />
        </>
      ) : null}

      {phase === "done" ? (
        <>
          <FactoryButton
            label="Abastecer estoque de giro"
            onPress={() => router.push("/stocking")}
          />
          <FactoryButton
            label="Novo transporte"
            variant="secondary"
            onPress={reset}
          />
        </>
      ) : null}

      {message ? <Text style={styles.message}>{message}</Text> : null}

      <BarcodeScanner
        visible={scannerOpen}
        title={scannerMode === "pulmao" ? "Bipar pulmão" : "Bipar produto"}
        onScan={(code) => {
          if (scannerMode === "pulmao") handlePulmaoScan(code);
          else handleProductScan(code);
        }}
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
