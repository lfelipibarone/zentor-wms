import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { PercentInput } from "@/components/PercentInput";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import {
  BigCode,
  Card,
  Field,
  Notice,
  OptionRow,
  OrDivider,
  SectionTitle,
} from "@/components/ui";
import { useAdjustLocationStock } from "@/hooks/useAdjustLocationStock";
import { api, ApiError, type ProductLocationOption } from "@/lib/api";
import { showErrorAlert } from "@/lib/app-alert";
import { modules } from "@/lib/modules";
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
          (result.location.needsReplenishment ? " · foi para reposição" : "") +
          " ✓",
      );
      reset();
    } catch (e) {
      showErrorAlert(e instanceof ApiError ? e.message : "Erro ao salvar a %");
    }
  };

  const saved = message?.includes("✓");

  return (
    <ScreenShell scroll module="gondola" title="Atualizar gôndola">
      {message ? <Notice tone={saved ? "success" : "info"}>{message.replace(" ✓", "")}</Notice> : null}

      {!product ? (
        <>
          <FactoryButton
            label={saved ? "Ler próxima" : "Ler produto ou gôndola"}
            icon="scan"
            color={color}
            onPress={() => reset(true)}
            loading={loading}
          />
          <OrDivider />
          <View style={styles.searchRow}>
            <Field
              style={styles.flex}
              value={codeDraft}
              onChangeText={setCodeDraft}
              placeholder="SKU ou código"
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={() => loadCode(codeDraft)}
            />
            <FactoryButton
              label="Buscar"
              icon="search"
              size="md"
              variant="secondary"
              disabled={!codeDraft.trim()}
              loading={loading}
              onPress={() => loadCode(codeDraft)}
            />
          </View>
        </>
      ) : (
        <>
          <Card>
            <View style={styles.productRow}>
              <ProductThumbnail imageUrl={product.imageUrl} alt={product.name} size={64} />
              <View style={styles.productInfo}>
                <Text style={styles.sku}>{product.sku}</Text>
                <Text style={styles.name} numberOfLines={2}>
                  {product.name}
                </Text>
              </View>
            </View>
          </Card>

          {faces.length > 1 && !face ? (
            <>
              <SectionTitle>Qual gôndola?</SectionTitle>
              {faces.map((loc) => (
                <OptionRow
                  key={loc.id}
                  title={loc.label}
                  meta={`${loc.fillPercent}% · mín. ${loc.minPercent}%`}
                  onPress={() => setFace(loc)}
                />
              ))}
            </>
          ) : null}

          {face ? (
            <>
              <BigCode
                label="Gôndola"
                code={face.label}
                meta={`Agora ${face.fillPercent}% · mín. ${face.minPercent}%`}
                color={color}
              />
              <PercentInput
                label="Quanto tem agora?"
                initialValue={face.fillPercent}
                resetKey={face.id}
                confirmLabel="Salvar"
                loading={adjust.isPending}
                onConfirm={savePercent}
              />
              {faces.length > 1 ? (
                <FactoryButton
                  label="Outra gôndola deste produto"
                  icon="swap-horizontal"
                  size="sm"
                  variant="secondary"
                  onPress={() => setFace(null)}
                />
              ) : null}
            </>
          ) : null}

          <FactoryButton
            label="Ler outro código"
            icon="scan"
            size="sm"
            variant="secondary"
            onPress={() => reset(true)}
          />
        </>
      )}

      <BarcodeScanner
        visible={scannerOpen}
        title="Produto ou gôndola"
        onScan={(code) => {
          setScannerOpen(false);
          void loadCode(code);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const color = modules.gondola.color;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  productRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  productInfo: { flex: 1, gap: 2 },
  sku: { fontWeight: "900", fontSize: typography.subtitle, color: theme.info },
  name: { color: theme.text, fontWeight: "600" },
});
