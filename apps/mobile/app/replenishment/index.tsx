import { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { PercentInput } from "@/components/PercentInput";
import { ScreenShell } from "@/components/ScreenShell";
import {
  useLocationByBarcode,
  useRequestReplenishment,
} from "@/hooks/useReplenishment";
import { ApiError } from "@/lib/api";
import { theme, spacing, typography } from "@/lib/theme";

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export default function RequestReplenishmentScreen() {
  const [barcode, setBarcode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data: location, isLoading, error, refetch } =
    useLocationByBarcode(barcode);
  const request = useRequestReplenishment(barcode);

  const handleScan = (raw: string) => {
    setScannerOpen(false);
    setMessage(null);
    setBarcode(normalizeBarcode(raw));
  };

  const reset = () => {
    setBarcode(null);
    setMessage(null);
    request.reset();
  };

  const submitPercent = async (percent: number) => {
    if (!barcode) return;
    setMessage(null);
    try {
      const result = await request.mutateAsync({ percent });
      setMessage(result.message);
      await refetch();
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : "Erro ao solicitar");
    }
  };

  return (
    <ScreenShell scroll title="Solicitar reabastecimento">
      <Text style={styles.subtitle}>
        Informe a % que a gôndola está. A fila de
        transporte de carga usa a % atualizada.
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

      {error ? (
        <Text style={styles.error}>
          {error instanceof Error ? error.message : "Gôndola não encontrada"}
        </Text>
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
            <>
              <Text style={styles.sku}>{location.product.sku}</Text>
              <Text style={styles.name}>{location.product.name}</Text>
            </>
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

      {message ? (
        <Text
          style={[
            styles.feedback,
            message.includes("fila") ? styles.feedbackOk : styles.feedbackInfo,
          ]}
        >
          {message}
        </Text>
      ) : null}

      {barcode ? (
        <FactoryButton
          label="Nova gôndola"
          variant="secondary"
          onPress={reset}
        />
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
  error: { color: theme.danger, fontWeight: "700", marginTop: spacing.sm },
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
  sku: { fontSize: typography.body, color: theme.info, fontWeight: "800" },
  name: {
    fontSize: typography.subtitle,
    color: theme.text,
    fontWeight: "700",
    textAlign: "center",
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
  feedback: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  feedbackOk: { backgroundColor: "#d1fae5", color: "#065f46" },
  feedbackInfo: { backgroundColor: theme.bg, color: theme.text },
});
