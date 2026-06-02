import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { QuantityInput } from "@/components/QuantityInput";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { ScreenShell } from "@/components/ScreenShell";
import {
  api,
  ApiError,
  type LocationLookup,
  type ProductLocationOption,
} from "@/lib/api";
import { showErrorAlert, showInfoAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export default function ArmazenagemPulmaoScreen() {
  const [pulmaoBarcode, setPulmaoBarcode] = useState<string | null>(null);
  const [pulmao, setPulmao] = useState<LocationLookup | null>(null);
  const [productCode, setProductCode] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const [pulmaoOptions, setPulmaoOptions] = useState<ProductLocationOption[]>([]);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanWhat, setScanWhat] = useState<"pulmao" | "product">("pulmao");
  const [loading, setLoading] = useState(false);
  const [searchProductImageUrl, setSearchProductImageUrl] = useState<
    string | null
  >(null);

  const loadPulmao = async (barcode: string) => {
    setLoading(true);
    try {
      const loc = await api.getLocationByBarcode(barcode);
      if (loc.type !== "PULMAO") {
        showErrorAlert("Bipe uma posição de pulmão");
        return;
      }
      setPulmao(loc);
      setPulmaoBarcode(barcode);
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Posição não encontrada",
      );
    } finally {
      setLoading(false);
    }
  };

  const searchPulmaoBySku = async () => {
    const code = (skuSearch || productCode).trim();
    if (!code) return;
    setLoading(true);
    try {
      const res = await api.listProductLocations(code, "PULMAO");
      setProductCode(code);
      setSearchProductImageUrl(res.product.imageUrl ?? null);
      setPulmaoOptions(res.locations);
    } catch (e) {
      showErrorAlert(e instanceof ApiError ? e.message : "Erro na busca");
    } finally {
      setLoading(false);
    }
  };

  const confirmStock = async (qty: number) => {
    if (!pulmaoBarcode) return;
    const code = productCode.trim() || pulmao?.product?.sku;
    if (!code) {
      showErrorAlert("Informe o produto");
      return;
    }
    setLoading(true);
    try {
      const result = await api.stockPulmao({
        locationBarcode: pulmaoBarcode,
        productBarcode: code,
        quantity: qty,
      });
      showInfoAlert(
        `+${result.added} un. · saldo ${result.location.currentQuantity} em ${result.location.barcode}`,
      );
      await loadPulmao(pulmaoBarcode);
      setProductCode("");
    } catch (e) {
      showErrorAlert(e instanceof ApiError ? e.message : "Erro ao armazenar");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setPulmao(null);
    setPulmaoBarcode(null);
    setProductCode("");
    setPulmaoOptions([]);
    setSearchProductImageUrl(null);
  };

  return (
    <ScreenShell scroll backToHome title="Armazenagem pulmão">
      <Text style={styles.subtitle}>
        Entrada avulsa no pulmão. Bipe a posição e o produto, ou selecione manualmente.
      </Text>

      {!pulmao ? (
        <>
          <FactoryButton
            label="Bipar posição (pulmão)"
            onPress={() => {
              setScanWhat("pulmao");
              setScannerOpen(true);
            }}
          />
          <Text style={styles.or}>Buscar pulmão por SKU do produto</Text>
          <TextInput
            style={styles.input}
            value={skuSearch}
            onChangeText={setSkuSearch}
            placeholder="SKU"
            autoCapitalize="characters"
          />
          <FactoryButton
            label="Listar posições"
            variant="secondary"
            onPress={async () => {
              setProductCode(skuSearch);
              await searchPulmaoBySku();
            }}
            loading={loading}
          />
          {searchProductImageUrl || productCode ? (
            <View style={styles.productRow}>
              <ProductThumbnail
                imageUrl={searchProductImageUrl}
                alt={productCode || skuSearch}
                size={64}
              />
              <Text style={styles.sku}>{productCode || skuSearch}</Text>
            </View>
          ) : null}
          {pulmaoOptions.map((loc) => (
            <Pressable
              key={loc.id}
              style={styles.optionRow}
              onPress={() => loadPulmao(loc.barcode)}
            >
              <Text style={styles.optionLabel}>{loc.label}</Text>
              <Text style={styles.meta}>
                {loc.currentQuantity}/{loc.capacity} un.
              </Text>
            </Pressable>
          ))}
        </>
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.locTitle}>{pulmao.label}</Text>
            <Text style={styles.meta}>
              Saldo: {pulmao.currentQuantity} / cap. {pulmao.capacity}
            </Text>
            {pulmao.product ? (
              <View style={styles.productRow}>
                <ProductThumbnail
                  imageUrl={pulmao.product.imageUrl ?? searchProductImageUrl}
                  alt={pulmao.product.name}
                />
                <View style={styles.productInfo}>
                  <Text style={styles.sku}>Alocado: {pulmao.product.sku}</Text>
                  <Text style={styles.productName}>{pulmao.product.name}</Text>
                </View>
              </View>
            ) : searchProductImageUrl || productCode ? (
              <View style={styles.productRow}>
                <ProductThumbnail
                  imageUrl={searchProductImageUrl}
                  alt={productCode}
                />
                <Text style={styles.sku}>{productCode}</Text>
              </View>
            ) : null}
          </View>

          <FactoryButton
            label="Bipar produto"
            onPress={() => {
              setScanWhat("product");
              setScannerOpen(true);
            }}
          />
          <TextInput
            style={styles.input}
            value={productCode}
            onChangeText={setProductCode}
            placeholder="SKU / código de barras"
            autoCapitalize="characters"
          />
          <QuantityInput
            label="Quantidade"
            max={pulmao.capacity - pulmao.currentQuantity}
            onConfirm={confirmStock}
          />
          <FactoryButton label="Outra posição" variant="secondary" onPress={reset} />
        </>
      )}

      <BarcodeScanner
        visible={scannerOpen}
        title={scanWhat === "pulmao" ? "Bipar pulmão" : "Bipar produto"}
        onScan={(raw) => {
          setScannerOpen(false);
          const code = normalizeBarcode(raw);
          if (scanWhat === "pulmao") void loadPulmao(code);
          else setProductCode(code);
        }}
        onClose={() => setScannerOpen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  subtitle: { color: theme.textMuted, marginBottom: spacing.md },
  or: { textAlign: "center", color: theme.textMuted, marginVertical: spacing.sm },
  input: {
    borderWidth: 2,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  locTitle: { fontWeight: "900", fontSize: typography.title, color: theme.primary },
  productRow: {
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  productInfo: { flex: 1, gap: spacing.xs },
  productName: { color: theme.text, fontWeight: "700" },
  sku: { fontWeight: "700", color: theme.info, marginTop: 4 },
  meta: { color: theme.textMuted, fontSize: typography.caption },
  optionRow: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  optionLabel: { fontWeight: "700" },
});
