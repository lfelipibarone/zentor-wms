import { useEffect, useState } from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { FactoryButton } from "./FactoryButton";
import { theme, spacing, typography } from "@/lib/theme";

const REASON_PRESETS = [
  "Contagem física",
  "Produto danificado",
  "Etiqueta errada",
  "Outro",
];

export type AdjustStockContext = {
  locationId: string;
  locationLabel: string;
  systemQuantity: number;
  capacity: number;
  productBarcode?: string | null;
  orderId?: string;
  itemId?: string;
  waveLineId?: string;
};

interface AdjustStockModalProps {
  visible: boolean;
  loading?: boolean;
  context: AdjustStockContext | null;
  onSubmit: (countedQuantity: number, reason: string) => void;
  onClose: () => void;
}

export function AdjustStockModal({
  visible,
  loading,
  context,
  onSubmit,
  onClose,
}: AdjustStockModalProps) {
  const [counted, setCounted] = useState("");
  const [reason, setReason] = useState("Contagem física");

  useEffect(() => {
    if (visible && context) {
      setCounted(String(context.systemQuantity));
      setReason("Contagem física");
    }
  }, [visible, context?.locationId, context?.systemQuantity]);

  const parsed = parseInt(counted, 10);
  const valid =
    context &&
    !Number.isNaN(parsed) &&
    parsed >= 0 &&
    parsed <= context.capacity;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Corrigir estoque no endereço</Text>
          {context ? (
            <>
              <Text style={styles.subtitle}>{context.locationLabel}</Text>
              <Text style={styles.systemQty}>
                Sistema: {context.systemQuantity} un. (cap. {context.capacity})
              </Text>
            </>
          ) : null}

          <Text style={styles.fieldLabel}>Quantidade contada</Text>
          <TextInput
            style={styles.input}
            value={counted}
            onChangeText={setCounted}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={theme.textMuted}
          />

          <View style={styles.presets}>
            {REASON_PRESETS.map((p) => (
              <FactoryButton
                key={p}
                label={p}
                variant={reason === p ? "primary" : "secondary"}
                onPress={() => setReason(p)}
                style={styles.presetBtn}
              />
            ))}
          </View>

          <FactoryButton
            label="Confirmar ajuste"
            loading={loading}
            disabled={!valid}
            onPress={() => valid && onSubmit(parsed, reason)}
          />
          <FactoryButton label="Cancelar" variant="secondary" onPress={onClose} />
          <Text style={styles.footerHint}>
            Após confirmar, rotas de pick do SKU serão recalculadas automaticamente.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: spacing.lg,
  },
  title: {
    fontSize: typography.subtitle,
    fontWeight: "800",
    color: theme.text,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontFamily: "monospace",
    color: theme.info,
    marginBottom: spacing.xs,
  },
  systemQty: {
    color: theme.textMuted,
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontWeight: "700",
    color: theme.text,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 2,
    borderColor: theme.border,
    borderRadius: 12,
    padding: spacing.md,
    fontSize: 24,
    fontWeight: "800",
    color: theme.text,
    marginBottom: spacing.md,
  },
  presets: { gap: spacing.xs, marginBottom: spacing.md },
  presetBtn: { marginBottom: 0 },
  footerHint: {
    fontSize: typography.caption,
    color: theme.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
