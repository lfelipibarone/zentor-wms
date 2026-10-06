import { StyleSheet, Text, View } from "react-native";
import { FactoryButton } from "./FactoryButton";
import { PercentInput } from "./PercentInput";
import { theme, spacing, typography } from "@/lib/theme";

export type PulmaoWithdrawResult = { remainingPercent: number; skuFinished: boolean };

interface PulmaoWithdrawPercentProps {
  sku: string;
  pulmaoLabel: string;
  /** % que o SKU ocupa no pulmão antes da retirada */
  currentPercent: number;
  loading?: boolean;
  onConfirm: (result: PulmaoWithdrawResult) => void;
}

/** Retirada do pulmão: pergunta quanto do SKU ficou ou se ele acabou ali. */
export function PulmaoWithdrawPercent({
  sku,
  pulmaoLabel,
  currentPercent,
  loading,
  onConfirm,
}: PulmaoWithdrawPercentProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.current}>
        {sku} ocupava {currentPercent}% de {pulmaoLabel}
      </Text>
      <FactoryButton
        label={`Acabou o ${sku} aqui`}
        variant="danger"
        loading={loading}
        onPress={() => onConfirm({ remainingPercent: 0, skuFinished: true })}
      />
      <Text style={styles.or}>ou, se ainda sobrou:</Text>
      <PercentInput
        label="Quanto do SKU ficou no pulmão?"
        hint="0% também tira o SKU da lista do pulmão."
        resetKey={`${pulmaoLabel}-${sku}`}
        confirmLabel="Confirmar retirada"
        loading={loading}
        onConfirm={(pct) => onConfirm({ remainingPercent: pct, skuFinished: pct === 0 })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  current: {
    fontSize: typography.body,
    fontWeight: "700",
    color: theme.text,
  },
  or: { textAlign: "center", color: theme.textMuted, fontSize: typography.caption },
});
