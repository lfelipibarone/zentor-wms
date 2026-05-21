import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { FactoryButton } from "@/components/FactoryButton";
import { ScreenShell } from "@/components/ScreenShell";
import { theme, spacing, typography } from "@/lib/theme";

export default function PurchaseReceiptHomeScreen() {
  return (
    <ScreenShell
      backToHome
      title="Recebimento"
      subtitle="Escolha o tipo de entrada no caminhão"
    >
      <View style={styles.infoBox}>
        <Text style={styles.info}>
          NF de entrada: conferência via DANFE (Tiny). Devolução: bip dos produtos
          devolvidos e destino no pulmão.
        </Text>
      </View>

      <FactoryButton
        label="Nota fiscal de entrada"
        onPress={() => router.push("/purchase-receipt/entry")}
      />
      <FactoryButton
        label="Devolução"
        variant="secondary"
        onPress={() => router.push("/purchase-receipt/return")}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  infoBox: {
    backgroundColor: theme.surface,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  info: {
    color: theme.textMuted,
    fontSize: typography.body,
    lineHeight: 22,
  },
});
