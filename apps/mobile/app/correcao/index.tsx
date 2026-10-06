import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { PercentInput } from "@/components/PercentInput";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import {
  useLocationByBarcode,
  useRequestReplenishment,
} from "@/hooks/useReplenishment";
import { ApiError } from "@/lib/api";
import { showErrorAlert, showInfoAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export default function CorrecaoScreen() {
  const [barcode, setBarcode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const { data: location, isLoading, error, refetch } =
    useLocationByBarcode(barcode);
  const request = useRequestReplenishment(barcode);

  useEffect(() => {
    if (!error) return;
    showErrorAlert(
      error instanceof Error ? error.message : "Gôndola não encontrada",
    );
  }, [error]);

  const handleScan = (raw: string) => {
    setScannerOpen(false);
    setBarcode(normalizeBarcode(raw));
  };

  const reset = (openScanner = false) => {
    setBarcode(null);
    request.reset();
    if (openScanner) setScannerOpen(true);
  };

  const submitPercent = async (percent: number) => {
    if (!barcode) return;
    try {
      const result = await request.mutateAsync({ percent });
      showInfoAlert(result.message);
      await refetch();
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao solicitar",
      );
    }
  };

  return (
    <ScreenShell scroll backToHome title="Correção">
      <Text style={styles.subtitle}>
        No passeio pelo estoque de giro, bipe a gôndola e informe a % que ela está.
        Isso alimenta a fila de ressuprimento.
      </Text>

      {!barcode ? (
        <FactoryButton
          label="Bipar gôndola"
          onPress={() => setScannerOpen(true)}
        />
      ) : null}

      {isLoading ? (
        <ActivityIndicator color={theme.primary} style={{ marginTop: spacing.md }} />
      ) : null}

      {location ? (
        <View style={styles.card}>
          <Text style={styles.location}>{location.label}</Text>
          {location.type !== "PICK_FACE" ? (
            <Text style={styles.warn}>
              Use uma gôndola de estoque de giro (pick face).
            </Text>
          ) : null}
          {location.product ? (
            <View style={styles.productRow}>
              <ProductThumbnail
                imageUrl={location.product.imageUrl}
                alt={location.product.name}
              />
              <View style={styles.productInfo}>
                <Text style={styles.sku}>{location.product.sku}</Text>
                <Text style={styles.name}>{location.product.name}</Text>
              </View>
            </View>
          ) : (
            <Text style={styles.warn}>Sem produto alocado nesta posição.</Text>
          )}
          <View style={styles.meta}>
            <Text style={styles.metaText}>
              Gôndola: {location.fillPercent}% · Mínimo: {location.minPercent}%
            </Text>
          </View>

          {location.type === "PICK_FACE" && location.product ? (
            <>
              <PercentInput
                label="Quanto tem na gôndola?"
                hint={`Até ${location.minPercent}% entra na fila de ressuprimento.`}
                initialValue={location.fillPercent}
                resetKey={location.id}
                confirmLabel="Salvar %"
                loading={request.isPending}
                onConfirm={(pct) => void submitPercent(pct)}
              />
            </>
          ) : null}
        </View>
      ) : null}

      {barcode ? (
        <View style={styles.actions}>
          <FactoryButton
            label="Próxima gôndola"
            onPress={() => reset(true)}
          />
          <FactoryButton
            label="Voltar"
            variant="secondary"
            onPress={() => reset(false)}
          />
        </View>
      ) : null}

      <BarcodeScanner
        visible={scannerOpen}
        title="Bipar gôndola"
        onScan={handleScan}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  subtitle: {
    color: theme.textMuted,
    fontSize: typography.body,
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
    borderWidth: 2,
    borderColor: theme.primary,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  location: {
    fontSize: typography.title,
    fontWeight: "900",
    color: theme.primary,
    textAlign: "center",
  },
  productRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
    marginTop: spacing.sm,
  },
  productInfo: { flex: 1, gap: spacing.xs },
  sku: { fontSize: typography.body, color: theme.info, fontWeight: "800" },
  name: {
    fontSize: typography.subtitle,
    color: theme.text,
    fontWeight: "700",
  },
  warn: { color: theme.warning, textAlign: "center", fontSize: typography.body },
  meta: {
    backgroundColor: theme.bg,
    borderRadius: 12,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  metaText: {
    textAlign: "center",
    color: theme.textMuted,
    fontSize: typography.caption,
  },
  actions: { marginTop: spacing.md, gap: spacing.sm },
});
