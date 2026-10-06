import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { PercentInput } from "@/components/PercentInput";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import { useAdjustLocationStock } from "@/hooks/useAdjustLocationStock";
import { api, ApiError, type ProductLocationOption } from "@/lib/api";
import { showErrorAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";

type FoundProduct = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  imageUrl?: string | null;
};

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

/** Lê o QR do produto (ou o código da gôndola) e grava a % que a gôndola está. */
export default function AtualizarGondolaScreen() {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [codeDraft, setCodeDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<FoundProduct | null>(null);
  const [faces, setFaces] = useState<ProductLocationOption[]>([]);
  const [face, setFace] = useState<ProductLocationOption | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const adjust = useAdjustLocationStock();

  const reset = (openScanner = false) => {
    setProduct(null);
    setFaces([]);
    setFace(null);
    setCodeDraft("");
    if (openScanner) {
      setMessage(null);
      setScannerOpen(true);
    }
  };

  /** Aceita o código da gôndola ou o QR do produto. */
  const loadCode = async (raw: string) => {
    const code = normalizeCode(raw);
    if (!code) return;
    setLoading(true);
    setMessage(null);
    try {
      const loc = await api.getLocationByBarcode(code).catch((e) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      });
      if (loc) {
        if (loc.type !== "PICK_FACE") {
          showErrorAlert("Isso é um pulmão. A % do pulmão é informada na armazenagem e no ressuprimento.");
          return;
        }
        if (!loc.product) {
          showErrorAlert(`Gôndola ${loc.label} não tem SKU associado.`);
          return;
        }
        const option: ProductLocationOption = {
          id: loc.id,
          barcode: loc.barcode,
          label: loc.label,
          fillPercent: loc.fillPercent,
          minPercent: loc.minPercent,
          isSuggested: true,
        };
        setProduct(loc.product);
        setFaces([option]);
        setFace(option);
        return;
      }
      const res = await api.listProductLocations(code, "PICK_FACE");
      setProduct(res.product);
      setFaces(res.locations);
      setFace(res.locations.length === 1 ? res.locations[0]! : null);
      if (res.locations.length === 0) {
        setMessage(`${res.product.sku} não tem gôndola cadastrada.`);
      }
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError && e.status === 404
          ? "Código não encontrado: não é gôndola nem produto cadastrado."
          : e instanceof ApiError
            ? e.message
            : "Erro ao buscar o código",
      );
    } finally {
      setLoading(false);
    }
  };

  const savePercent = async (percent: number) => {
    if (!product || !face) return;
    try {
      const result = await adjust.mutateAsync({
        locationId: face.id,
        percent,
        productBarcode: product.barcode ?? product.sku,
        reason: "Atualização pelo QR do produto",
      });
      setMessage(
        `${product.sku} · ${face.label}: ${result.location.fillPercent}%` +
          (result.location.needsReplenishment ? " — entrou na fila de reposição" : "") +
          " ✓",
      );
      reset();
    } catch (e) {
      showErrorAlert(e instanceof ApiError ? e.message : "Erro ao salvar a %");
    }
  };

  return (
    <ScreenShell scroll backToHome title="Atualizar gôndola">
      <Text style={styles.subtitle}>
        Leia o QR do produto ou o código da gôndola e informe a % que ela está.
      </Text>

      {message ? (
        <Text style={[styles.message, message.includes("✓") ? styles.ok : styles.info]}>
          {message}
        </Text>
      ) : null}

      {!product ? (
        <>
          <FactoryButton
            label="Ler produto ou gôndola"
            onPress={() => setScannerOpen(true)}
            loading={loading}
          />
          <Text style={styles.or}>ou digite o SKU / código da gôndola</Text>
          <TextInput
            style={styles.input}
            value={codeDraft}
            onChangeText={setCodeDraft}
            placeholder="SKU, EAN ou código da gôndola"
            autoCapitalize="characters"
            onSubmitEditing={() => loadCode(codeDraft)}
          />
          <FactoryButton
            label="Buscar"
            variant="secondary"
            disabled={!codeDraft.trim()}
            loading={loading}
            onPress={() => loadCode(codeDraft)}
          />
        </>
      ) : (
        <>
          <View style={styles.card}>
            <View style={styles.productRow}>
              <ProductThumbnail imageUrl={product.imageUrl} alt={product.name} size={72} />
              <View style={styles.productInfo}>
                <Text style={styles.sku}>{product.sku}</Text>
                <Text style={styles.name} numberOfLines={2}>
                  {product.name}
                </Text>
              </View>
            </View>
          </View>

          {faces.length > 1 && !face ? (
            <>
              <Text style={styles.sectionTitle}>Qual gôndola?</Text>
              {faces.map((loc) => (
                <Pressable key={loc.id} style={styles.optionRow} onPress={() => setFace(loc)}>
                  <Text style={styles.optionLabel}>{loc.label}</Text>
                  <Text style={styles.meta}>
                    {loc.fillPercent}% · mín. {loc.minPercent}%
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}

          {face ? (
            <>
              <View style={styles.faceCard}>
                <Text style={styles.faceLabel}>{face.label}</Text>
                <Text style={styles.faceMeta}>
                  Registrado: {face.fillPercent}% · mínimo {face.minPercent}%
                </Text>
              </View>
              <PercentInput
                label="Quanto tem na gôndola agora?"
                initialValue={face.fillPercent}
                resetKey={face.id}
                confirmLabel="Salvar %"
                loading={adjust.isPending}
                onConfirm={savePercent}
              />
              {faces.length > 1 ? (
                <FactoryButton
                  label="Outra gôndola deste produto"
                  variant="secondary"
                  onPress={() => setFace(null)}
                />
              ) : null}
            </>
          ) : null}

          <FactoryButton label="Ler outro código" variant="secondary" onPress={() => reset(true)} />
        </>
      )}

      {!product && message?.includes("✓") ? (
        <FactoryButton label="Ler próxima gôndola" onPress={() => reset(true)} />
      ) : null}

      <BarcodeScanner
        visible={scannerOpen}
        title="Produto ou gôndola"
        hint="Aponte para o QR do produto ou a etiqueta da gôndola"
        onScan={(code) => {
          setScannerOpen(false);
          void loadCode(code);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  subtitle: { color: theme.textMuted, fontSize: typography.body, marginBottom: spacing.md },
  or: { textAlign: "center", color: theme.textMuted, marginVertical: spacing.sm },
  input: {
    borderWidth: 2,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: theme.surface,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: theme.border,
    marginBottom: spacing.md,
  },
  productRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  productInfo: { flex: 1, gap: 2 },
  sku: { fontWeight: "900", fontSize: typography.subtitle, color: theme.info },
  name: { color: theme.text, fontWeight: "600" },
  sectionTitle: { fontWeight: "900", fontSize: typography.body, color: theme.text },
  optionRow: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: theme.surface,
  },
  optionLabel: { fontWeight: "800", fontSize: typography.body, color: theme.text },
  meta: { color: theme.textMuted, fontSize: typography.caption, marginTop: 2 },
  faceCard: {
    backgroundColor: theme.primary,
    borderRadius: 16,
    padding: spacing.lg,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  faceLabel: { fontSize: 32, fontWeight: "900", color: theme.primaryText, textAlign: "center" },
  faceMeta: { color: theme.primaryText, fontWeight: "700", marginTop: spacing.xs },
  message: {
    padding: spacing.md,
    borderRadius: 12,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: spacing.md,
  },
  ok: { backgroundColor: "#d1fae5", color: "#065f46" },
  info: { backgroundColor: theme.surfaceElevated, color: theme.text },
});
