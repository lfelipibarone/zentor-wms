import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FactoryButton } from "@/components/FactoryButton";
import {
  api,
  ApiError,
  type LocationLookup,
  type ProductLocationOption,
} from "@/lib/api";
import { showErrorAlert } from "@/lib/app-alert";
import { theme, spacing, typography } from "@/lib/theme";

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
    if (productId && loc.product?.id && loc.product.id !== productId) {
      showErrorAlert("Produto não corresponde a esta posição");
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
        onPress={() => setScannerOpen(true)}
        loading={loading}
        disabled={disabled}
      />
      <Text style={styles.or}>ou informe o SKU</Text>
      <TextInput
        style={styles.input}
        value={skuDraft}
        onChangeText={setSkuDraft}
        placeholder="SKU / código"
        autoCapitalize="characters"
        editable={!disabled}
      />
      <FactoryButton
        label="Buscar pulmões"
        variant="secondary"
        onPress={searchPulmaoBySku}
        loading={loading}
        disabled={disabled}
      />
      {pulmaoOptions.map((loc) => (
        <Pressable
          key={loc.id}
          style={styles.optionRow}
          onPress={() => pickPulmao(loc)}
          disabled={disabled || loading}
        >
          <Text style={styles.optionLabel}>
            {loc.label}
            {loc.isSuggested ? " ★" : ""}
          </Text>
          <Text style={styles.meta}>
            {loc.currentQuantity}/{loc.capacity} un.
          </Text>
        </Pressable>
      ))}

      <BarcodeScanner
        visible={scannerOpen}
        title="Bipar pulmão"
        hint="Endereço de pulmão"
        onScan={handlePulmaoScan}
        onClose={() => setScannerOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  or: {
    textAlign: "center",
    color: theme.textMuted,
    marginVertical: spacing.sm,
    fontSize: typography.caption,
    fontWeight: "600",
  },
  input: {
    borderWidth: 2,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.xs,
    backgroundColor: theme.surface,
    color: theme.text,
  },
  optionRow: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    backgroundColor: theme.surface,
    borderRadius: 8,
    marginBottom: spacing.xs,
  },
  optionLabel: { fontWeight: "700", color: theme.text },
  meta: { color: theme.textMuted, fontSize: typography.caption, marginTop: 4 },
});
