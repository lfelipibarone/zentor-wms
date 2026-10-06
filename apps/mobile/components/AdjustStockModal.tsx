import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { FactoryButton } from "./FactoryButton";
import { PercentInput } from "./PercentInput";
import { formatPercent } from "@/lib/percent";
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
  /** % registrada hoje */
  currentPercent: number;
  productBarcode?: string | null;
  productName?: string | null;
  orderId?: string;
  itemId?: string;
  waveLineId?: string;
};

interface AdjustStockModalProps {
  visible: boolean;
  loading?: boolean;
  context: AdjustStockContext | null;
  /**
   * Após a coleta: não dá para cancelar e não pede motivo.
   * Correção manual: pede motivo e permite cancelar.
   */
  mode?: "correction" | "after-pick";
  onSubmit: (percent: number, reason: string) => void;
  onClose?: () => void;
}

export function AdjustStockModal({
  visible,
  loading,
  context,
  mode = "correction",
  onSubmit,
  onClose,
}: AdjustStockModalProps) {
  const [reason, setReason] = useState("Contagem física");
  const afterPick = mode === "after-pick";

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.title}>
              {afterPick ? "Quanto ficou na gôndola?" : "Corrigir % da gôndola"}
            </Text>
            {context ? (
              <>
                <Text style={styles.subtitle}>{context.locationLabel}</Text>
                {context.productName ? (
                  <Text style={styles.product} numberOfLines={2}>
                    {context.productName}
                  </Text>
                ) : null}
                <Text style={styles.systemQty}>
                  Registrado: {formatPercent(context.currentPercent)}
                </Text>
              </>
            ) : null}

            <PercentInput
              label={afterPick ? "Olhe a gôndola e informe a %" : "% atual da gôndola"}
              hint={afterPick ? "0% = gôndola vazia. Obrigatório para seguir." : undefined}
              initialValue={afterPick ? null : context?.currentPercent ?? null}
              resetKey={`${context?.locationId}-${visible}`}
              confirmLabel={afterPick ? "Salvar e seguir" : "Confirmar ajuste"}
              loading={loading}
              onConfirm={(pct) => onSubmit(pct, afterPick ? "Após coleta" : reason)}
            >
              {afterPick ? null : (
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
              )}
            </PercentInput>

            {!afterPick && onClose ? (
              <FactoryButton
                label="Cancelar"
                variant="secondary"
                onPress={onClose}
                style={styles.cancelBtn}
              />
            ) : null}
            <Text style={styles.footerHint}>
              Abaixo da % mínima, a gôndola entra na fila de reposição.
            </Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  scroll: {
    flexGrow: 1,
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
  product: {
    color: theme.text,
    fontWeight: "600",
    marginBottom: spacing.xs,
  },
  systemQty: {
    color: theme.textMuted,
    marginBottom: spacing.md,
  },
  presets: { gap: spacing.xs },
  presetBtn: { marginBottom: 0 },
  cancelBtn: { marginTop: spacing.sm },
  footerHint: {
    fontSize: typography.caption,
    color: theme.textMuted,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
