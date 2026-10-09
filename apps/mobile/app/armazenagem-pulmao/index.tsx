import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { PercentInput } from "@/components/PercentInput";
import { ProductThumbnail } from "@/components/ProductThumbnail";
import { PulmaoStockList } from "@/components/PulmaoStockList";
import { ScreenShell } from "@/components/ScreenShell";
import { BigCode, Field, OptionRow, OrDivider, SectionTitle } from "@/components/ui";
import { modules } from "@/lib/modules";
import {
  api,
  ApiError,
  type LocationLookup,
  type ProductLocationOption,
} from "@/lib/api";
import { showErrorAlert, showToast } from "@/lib/app-alert";
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

  const confirmStock = async (percent: number) => {
    if (!pulmaoBarcode) return;
    const code = productCode.trim();
    if (!code) {
      showErrorAlert("Informe o produto");
      return;
    }
    setLoading(true);
    try {
      const result = await api.stockPulmao({
        locationBarcode: pulmaoBarcode,
        productBarcode: code,
        percent,
      });
      showToast(
        `${result.location.product.sku} ocupa ${result.location.productPercent}% de ${result.location.barcode} · pulmão em ${result.location.fillPercent}%`,
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
    <ScreenShell scroll module="armazenagem" title="Entrada avulsa">
      {!pulmao ? (
        <>
          <FactoryButton
            label="Bipar pulmão"
            icon="scan"
            color={color}
            onPress={() => {
              setScanWhat("pulmao");
              setScannerOpen(true);
            }}
          />
          <OrDivider label="ou busque pelo SKU" />
          <View style={styles.searchRow}>
            <Field
              style={styles.flex}
              value={skuSearch}
              onChangeText={setSkuSearch}
              placeholder="SKU"
              autoCapitalize="characters"
              returnKeyType="search"
              onSubmitEditing={() => {
                setProductCode(skuSearch);
                void searchPulmaoBySku();
              }}
            />
            <FactoryButton
              label="Buscar"
              icon="search"
              size="md"
              variant="secondary"
              onPress={async () => {
                setProductCode(skuSearch);
                await searchPulmaoBySku();
              }}
              loading={loading}
            />
          </View>
          {pulmaoOptions.length > 0 ? (
            <View style={styles.productRow}>
              <ProductThumbnail
                imageUrl={searchProductImageUrl}
                alt={productCode || skuSearch}
                size={48}
              />
              <Text style={styles.sku}>{productCode || skuSearch}</Text>
            </View>
          ) : null}
          {pulmaoOptions.map((loc) => (
            <OptionRow
              key={loc.id}
              title={loc.label}
              meta={`${loc.fillPercent}% deste SKU`}
              onPress={() => void loadPulmao(loc.barcode)}
            />
          ))}
        </>
      ) : (
        <>
          <BigCode
            label="Pulmão"
            code={pulmao.label}
            meta={`Ocupação ${pulmao.fillPercent}%`}
            color={color}
          />
          <PulmaoStockList stocks={pulmao.stocks} />

          <SectionTitle>Produto</SectionTitle>
          <View style={styles.searchRow}>
            <Field
              style={styles.flex}
              value={productCode}
              onChangeText={setProductCode}
              placeholder="SKU ou código de barras"
              autoCapitalize="characters"
            />
            <FactoryButton
              label="Bipar"
              icon="barcode"
              size="md"
              color={color}
              onPress={() => {
                setScanWhat("product");
                setScannerOpen(true);
              }}
            />
          </View>
          <PercentInput
            label="% do SKU no pulmão"
            minPercent={1}
            confirmLabel="Guardar"
            loading={loading}
            onConfirm={confirmStock}
          />
          <FactoryButton
            label="Outro pulmão"
            icon="swap-horizontal"
            size="sm"
            variant="secondary"
            onPress={reset}
          />
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

const color = modules.armazenagem.color;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  productRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  sku: { fontWeight: "900", color: theme.info, fontSize: typography.body },
});
