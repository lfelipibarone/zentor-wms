import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import { Field, OptionRow, OrDivider } from "@/components/ui";
import { modules } from "@/lib/modules";
import {
  api,
  ApiError,
  type LocationLookup,
  type ProductLocationOption,
} from "@/lib/api";
import { showErrorAlert } from "@/lib/app-alert";
import { spacing } from "@/lib/theme";

function normalizeBarcode(code: string) {
  return code.trim().toUpperCase();
}

export type PulmaoLocationPickerProps = {
  defaultSku?: string;
  productId?: string;
  onSelect: (location: LocationLookup) => void;
  disabled?: boolean;
};

export function PulmaoLocationPicker({
  defaultSku = "",
  productId,
  onSelect,
  disabled = false,
}: PulmaoLocationPickerProps) {
  const [skuDraft, setSkuDraft] = useState(defaultSku);
  const [pulmaoOptions, setPulmaoOptions] = useState<ProductLocationOption[]>(
    [],
  );
  const [scannerOpen, setScannerOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSkuDraft(defaultSku);
    setPulmaoOptions([]);
  }, [defaultSku]);

  const validateAndSelect = (loc: LocationLookup) => {
    if (loc.type !== "PULMAO") {
      showErrorAlert("Bipe ou selecione uma posição de pulmão");
      return;
    }
    if (productId && !loc.stocks.some((s) => s.product.id === productId)) {
      showErrorAlert(`Pulmão ${loc.barcode} não tem saldo deste produto`);
      return;
    }
    onSelect(loc);
  };

  const handlePulmaoScan = async (raw: string) => {
    setScannerOpen(false);
    if (disabled) return;
    setLoading(true);
    try {
      const loc = await api.getLocationByBarcode(normalizeBarcode(raw));
      validateAndSelect(loc);
    } catch (e) {
      showErrorAlert(
        e instanceof ApiError ? e.message : "Pulmão não encontrado",
      );
    } finally {
      setLoading(false);
    }
  };

  const searchPulmaoBySku = async () => {
    const code = skuDraft.trim();
    if (!code) {
      showErrorAlert("Informe o SKU");
      return;
    }
    setLoading(true);
    try {
      const res = await api.listProductLocations(code, "PULMAO");
      setPulmaoOptions(res.locations);
      if (res.locations.length === 0) {
        showErrorAlert("Nenhuma posição de pulmão encontrada para este SKU");
      }
    } catch (e) {
      setPulmaoOptions([]);
      showErrorAlert(e instanceof ApiError ? e.message : "SKU não encontrado");
    } finally {
      setLoading(false);
    }
  };

  const pickPulmao = async (loc: ProductLocationOption) => {
    if (disabled) return;
    setLoading(true);
    try {
      const full = await api.getLocationByBarcode(loc.barcode);
      validateAndSelect(full);
      setPulmaoOptions([]);
    } catch (e) {
      showErrorAlert(e instanceof ApiError ? e.message : "Erro ao carregar posição");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <FactoryButton
        label="Bipar pulmão"
        icon="scan"
        color={modules.armazenagem.color}
        onPress={() => setScannerOpen(true)}
        loading={loading}
        disabled={disabled}
      />
      <OrDivider label="ou busque pelo SKU" />
      <View style={styles.searchRow}>
        <Field
          style={styles.flex}
          value={skuDraft}
          onChangeText={setSkuDraft}
          placeholder="SKU"
          autoCapitalize="characters"
          editable={!disabled}
          onSubmitEditing={searchPulmaoBySku}
          returnKeyType="search"
        />
        <FactoryButton
          label="Buscar"
          icon="search"
          size="md"
          variant="secondary"
          onPress={searchPulmaoBySku}
          loading={loading}
          disabled={disabled}
        />
      </View>
      {pulmaoOptions.map((loc) => (
        <OptionRow
          key={loc.id}
          title={loc.label}
          meta={`${loc.fillPercent}% deste SKU`}
          highlight={loc.isSuggested}
          onPress={() => {
            if (!disabled && !loading) void pickPulmao(loc);
          }}
        />
      ))}

      <BarcodeScanner
        visible={scannerOpen}
        title="Bipar pulmão"
        onScan={handlePulmaoScan}
        onClose={() => setScannerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  flex: { flex: 1 },
  searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
});
