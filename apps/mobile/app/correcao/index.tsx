import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import {
  useLocationByBarcode,
  useRequestReplenishment,
} from "@/hooks/useReplenishment";
import { ApiError } from "@/lib/api";
import { showErrorAlert, showInfoAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";

type InputMode = "UNITS" | "PERCENT";

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export default function CorrecaoScreen() {
  const [barcode, setBarcode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [inputMode, setInputMode] = useState<InputMode>("UNITS");
  const [percentDraft, setPercentDraft] = useState("50");

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

  const submitUnits = async (qty: number) => {
    if (!barcode) return;
    try {
      const result = await request.mutateAsync({
        inputMode: "UNITS",
        value: qty,
      });
      showInfoAlert(result.message);
      await refetch();
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao solicitar",
      );
    }
  };

  const submitPercent = async () => {
    if (!barcode || !location) return;
    const pct = Math.min(100, Math.max(0, Math.floor(Number(percentDraft) || 0)));
    try {
      const result = await request.mutateAsync({
        inputMode: "PERCENT",
        value: pct,
      });
      showInfoAlert(result.message);
      await refetch();
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Erro ao solicitar",
      );
    }
  };

  const percentPreview =
    location && inputMode === "PERCENT"
      ? Math.min(
          location.capacity,
          Math.round(
            (location.capacity *
              Math.min(100, Math.max(0, Number(percentDraft) || 0))) /
              100,
          ),
        )
      : null;

  const canSubmit =
    location?.type === "PICK_FACE" && location.product && !request.isPending;

  return (
    <ScreenShell scroll backToHome title="Correção">
      <Text style={styles.subtitle}>
        No passeio pelo estoque de giro, bipar a gôndola e informar o saldo real.
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
              Saldo: {location.currentQuantity} · Cap: {location.capacity} · Mín:{" "}
              {location.minThreshold}
            </Text>
          </View>

          {location.type === "PICK_FACE" && location.product ? (
            <>
              <View style={styles.modeRow}>
                <Pressable
                  onPress={() => setInputMode("UNITS")}
                  style={[
                    styles.modeBtn,
                    inputMode === "UNITS" && styles.modeBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      inputMode === "UNITS" && styles.modeBtnTextActive,
                    ]}
                  >
                    Unidades
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setInputMode("PERCENT")}
                  style={[
                    styles.modeBtn,
                    inputMode === "PERCENT" && styles.modeBtnActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      inputMode === "PERCENT" && styles.modeBtnTextActive,
                    ]}
                  >
                    % posição
                  </Text>
                </Pressable>
              </View>

              {inputMode === "UNITS" ? (
                <QuantityInput
                  label="Quantidade na gôndola"
                  max={location.capacity}
                  allowZero
                  loading={request.isPending}
                  onConfirm={submitUnits}
                />
              ) : (
                <View style={styles.percentBlock}>
                  <Text style={styles.percentLabel}>
                    Preenchimento da posição (0–100%)
                  </Text>
                  <TextInput
                    style={styles.percentInput}
                    keyboardType="number-pad"
                    value={percentDraft}
                    onChangeText={setPercentDraft}
                    maxLength={3}
                  />
                  {percentPreview != null ? (
                    <Text style={styles.preview}>
                      ≈ {percentPreview} un. de {location.capacity}
                    </Text>
                  ) : null}
                  <FactoryButton
                    label="Solicitar reabastecimento"
                    onPress={() => void submitPercent()}
                    disabled={!canSubmit}
                  />
                </View>
              )}
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
  modeRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modeBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.border,
    alignItems: "center",
  },
  modeBtnActive: {
    borderColor: theme.primary,
    backgroundColor: theme.primary,
  },
  modeBtnText: { fontWeight: "700", color: theme.text },
  modeBtnTextActive: { color: "#fff" },
  percentBlock: { marginTop: spacing.md, gap: spacing.sm },
  percentLabel: { fontWeight: "700", color: theme.text },
  percentInput: {
    borderWidth: 2,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: typography.title,
    fontWeight: "800",
    textAlign: "center",
  },
  preview: {
    textAlign: "center",
    color: theme.textMuted,
    fontSize: typography.body,
  },
  actions: { marginTop: spacing.md, gap: spacing.sm },
});
